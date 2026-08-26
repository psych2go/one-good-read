import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";
import type { SourceAdapter } from "./adapter";
import { collectLinks, extractMeta, extractText, sha256, stripHtmlFragment, wordCount } from "./html";
import { fetchBoundedText } from "./http";

interface CollabFundConfig { sourceId: Extract<SourceId, "morgan-housel" | "ted-lamade">; indexUrl: string; author: string; }

export class CollabFundAdapter implements SourceAdapter {
  readonly sourceId: CollabFundConfig["sourceId"];
  constructor(private readonly config: CollabFundConfig) { this.sourceId = config.sourceId; }

  async discover(): Promise<DiscoveredArticle[]> {
    const { text } = await fetchBoundedText(this.config.indexUrl);
    const links = await collectLinks(text, 'a[href^="/blog/"]', this.config.indexUrl);
    const seen = new Set<string>();
    return links.flatMap((link) => {
      const title = stripHtmlFragment(link.text).text;
      if (!isCollabArticleUrl(link.url) || !title || seen.has(link.url)) return [];
      seen.add(link.url);
      return [{ sourceId: this.sourceId, canonicalUrl: link.url, title, author: this.config.author }];
    });
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    const { text: html } = await fetchBoundedText(article.canonicalUrl);
    const meta = await extractMeta(html);
    const extracted = await extractText(html, "article.post .longform");
    const title = meta.ogTitle || meta.title || article.title;
    const words = wordCount(extracted.text);
    return {
      ...article,
      title,
      publishedAt: meta.published ? new Date(meta.published).toISOString() : article.publishedAt,
      text: extracted.text,
      contentHash: await sha256(extracted.text),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words >= 200 ? 0.98 : words >= 80 ? 0.93 : 0.8,
      externalLinkCount: extracted.links,
    };
  }
}

export function isCollabArticleUrl(value: string): boolean {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  return url.hostname === "collabfund.com" && segments.length === 2 && segments[0] === "blog" && segments[1] !== "authors";
}

export const COLLAB_FUND_CONFIGS: CollabFundConfig[] = [
  { sourceId: "morgan-housel", indexUrl: "https://collabfund.com/blog/authors/morgan/", author: "Morgan Housel" },
  { sourceId: "ted-lamade", indexUrl: "https://collabfund.com/blog/authors/ted-lamade-managing-director-at-the-carnegie-institution-for-science/", author: "Ted Lamade" },
];
