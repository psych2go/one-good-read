import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";
import { PermanentArticleError, type DiscoveryOptions, type SourceAdapter } from "./adapter";
import { decodeHtmlEntities, extractText, sha256, stripHtmlFragment, wordCount } from "./html";
import { fetchBoundedText, HttpFetchError } from "./http";
import { parseRssFeed } from "./rss";

interface SubstackConfig {
  sourceId: Extract<SourceId, "astral-codex-ten" | "nassim-taleb">;
  baseUrl: string;
  feedUrl: string;
  author: string;
}
interface ArchivePost {
  title?: string;
  slug?: string;
  post_date?: string;
  audience?: string;
  type?: string;
  podcast_url?: string | null;
  video_upload_id?: string | null;
  canonical_url?: string;
}
interface FullPost extends ArchivePost {
  body_html?: string | null;
  free_unlock_required?: boolean;
  wordcount?: number;
}

export class SubstackArchiveAdapter implements SourceAdapter {
  readonly sourceId: SubstackConfig["sourceId"];
  readonly supportsDeferredExtraction = true;
  constructor(private readonly config: SubstackConfig) { this.sourceId = config.sourceId; }

  async discover(options: DiscoveryOptions = {}): Promise<DiscoveredArticle[]> {
    const pages = Math.max(1, Math.min(options.pages ?? 1, 50));
    const results: DiscoveredArticle[] = [];
    const seen = new Set<string>();

    const { text: feed } = await fetchBoundedText(this.config.feedUrl);
    const feedItems = parseRssFeed(feed, { sourceId: this.sourceId, feedUrl: this.config.feedUrl, defaultAuthor: this.config.author, allowedAuthors: [this.config.author] });
    for (const item of feedItems) {
      seen.add(item.link);
      results.push({ sourceId: this.sourceId, canonicalUrl: item.link, title: item.title, author: item.author, publishedAt: item.publishedAt, inlineHtml: item.html });
    }
    if (pages === 1) return results;

    // The archive API rate-limits Worker egress after the first request. The
    // publication sitemap is a single bounded document containing the full
    // post history, so use it to extend beyond the RSS window. Eligibility is
    // verified when the post body is fetched.
    try {
      const { text: sitemap } = await fetchBoundedText(`${this.config.baseUrl}/sitemap.xml`);
      const target = pages * 20;
      for (const canonicalUrl of parseSubstackSitemap(sitemap, this.config.baseUrl)) {
        if (results.length >= target) break;
        if (!isSubstackSitemapCandidate(canonicalUrl) || seen.has(canonicalUrl)) continue;
        seen.add(canonicalUrl);
        results.push({ sourceId: this.sourceId, canonicalUrl, title: titleFromSlug(canonicalUrl), author: this.config.author });
      }
    } catch (error) {
      if (!(error instanceof HttpFetchError) || ![403, 429].includes(error.status)) throw error;
      console.warn(JSON.stringify({ event: "substack_sitemap_limited", sourceId: this.sourceId, status: error.status, retryAfter: error.retryAfter ?? null }));
    }
    return results;
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    if (article.inlineHtml) return extractedArticle(article, stripHtmlFragment(article.inlineHtml));
    const slug = new URL(article.canonicalUrl).pathname.split("/").filter(Boolean).at(-1);
    if (!slug) throw new Error("Substack article URL has no slug");
    try {
      const { text } = await fetchBoundedText(`${this.config.baseUrl}/api/v1/posts/${encodeURIComponent(slug)}`);
      const post = JSON.parse(text) as FullPost;
      if (!isFreeTextPost(post) || post.free_unlock_required || typeof post.body_html !== "string" || !post.body_html.trim()) throw new PermanentArticleError("Substack post is not a free full-text article");
      return extractedArticle({ ...article, title: post.title || article.title, publishedAt: parseDate(post.post_date) ?? article.publishedAt }, stripHtmlFragment(post.body_html), post.wordcount);
    } catch (error) {
      if (!(error instanceof HttpFetchError) || ![403, 429].includes(error.status)) throw error;
      const { text: html } = await fetchBoundedText(article.canonicalUrl);
      const extracted = await extractText(html, ".available-content .body.markup");
      if (!extracted.text) throw new Error("Substack HTML fallback did not contain a free article body");
      return extractedArticle(article, extracted);
    }
  }
}

export function isSubstackSitemapCandidate(value: string): boolean {
  const slug = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
  return !/^(?:hidden-)?open-thread(?:-|$)|^links-for-|meetups?-everywhere|survey(?:-|$)|call-for-organizers|classifieds(?:-|$)/i.test(slug);
}

export function parseSubstackSitemap(xml: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeHtmlEntities(match[1] ?? "").trim();
    try {
      const url = new URL(value, baseUrl);
      if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/p/")) continue;
      url.hash = "";
      const canonical = url.toString();
      if (!seen.has(canonical)) { seen.add(canonical); urls.push(canonical); }
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return urls;
}

function titleFromSlug(value: string): string {
  const slug = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "Untitled";
  return slug.split("-").filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

export const SUBSTACK_CONFIGS: SubstackConfig[] = [
  { sourceId: "astral-codex-ten", baseUrl: "https://www.astralcodexten.com", feedUrl: "https://www.astralcodexten.com/feed", author: "Scott Alexander" },
  { sourceId: "nassim-taleb", baseUrl: "https://nntaleb.substack.com", feedUrl: "https://nntaleb.substack.com/feed", author: "Nassim Nicholas Taleb" },
];

export function isFreeTextPost(post: ArchivePost): boolean { return post.audience === "everyone" && post.type === "newsletter" && !post.podcast_url && !post.video_upload_id; }
function parseDate(value: string | undefined): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }
async function extractedArticle(article: DiscoveredArticle, extracted: { text: string; links: number }, knownWordCount?: number): Promise<ExtractedArticle> {
  const words = knownWordCount && knownWordCount > 0 ? knownWordCount : wordCount(extracted.text);
  return { ...article, text: extracted.text, contentHash: await sha256(extracted.text), wordCount: words, readingMinutes: Math.max(1, Math.ceil(words / 230)), extractionConfidence: words >= 200 ? .99 : words >= 80 ? .95 : .82, externalLinkCount: extracted.links };
}
