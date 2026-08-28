import { XMLParser } from "fast-xml-parser";
import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";
import { discoveryPageWindow } from "../domain/discovery";
import type { DiscoveryOptions, SourceAdapter } from "./adapter";
import { extractMeta, extractText, stripHtmlFragment, sha256, wordCount } from "./html";
import { fetchBoundedText, HttpFetchError } from "./http";

interface RssItem {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  author?: unknown;
  "dc:creator"?: unknown;
  "content:encoded"?: unknown;
  description?: unknown;
  category?: unknown;
}

export interface RssSourceConfig {
  sourceId: SourceId;
  feedUrl: string;
  defaultAuthor: string;
  allowedAuthors?: string[];
  normalizeAuthor?: (raw: string) => string;
  exclude?: (item: ParsedRssItem) => boolean;
  pageUrl?: (page: number) => string;
  articleSelector?: string;
}

export interface ParsedRssItem {
  title: string;
  link: string;
  author: string;
  publishedAt?: string;
  html: string;
  categories: string[];
}

export function parseRssFeed(xml: string, config: RssSourceConfig): ParsedRssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, trimValues: false });
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = parsed.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items.flatMap((item) => {
    const title = cleanText(item.title);
    const link = cleanText(item.link);
    const html = scalar(item["content:encoded"]) || scalar(item.description);
    const rawAuthor = cleanText(item["dc:creator"] ?? item.author) || config.defaultAuthor;
    const author = config.normalizeAuthor?.(rawAuthor) ?? rawAuthor;
    const publishedAt = parseDate(cleanText(item.pubDate));
    const categories = array(item.category).map(categoryText).filter(Boolean);
    if (!title || !link || !html) return [];
    if (config.allowedAuthors?.length && !config.allowedAuthors.includes(author)) return [];
    const result = { title, link, author, publishedAt, html, categories };
    if (config.exclude?.(result)) return [];
    return [result];
  });
}

export class RssSourceAdapter implements SourceAdapter {
  readonly sourceId: SourceId;
  readonly supportsDeferredExtraction: boolean;
  constructor(private readonly config: RssSourceConfig) { this.sourceId = config.sourceId; this.supportsDeferredExtraction = Boolean(config.articleSelector); }

  async discover(options: DiscoveryOptions = {}): Promise<DiscoveredArticle[]> {
    const pages = Math.max(1, Math.min(options.pages ?? 1, 100));
    const results: DiscoveredArticle[] = [];
    const seen = new Set<string>();
    for (const page of discoveryPageWindow(pages)) {
      const url = page === 1 ? this.config.feedUrl : this.config.pageUrl?.(page);
      if (!url) break;
      let text: string;
      try { ({ text } = await fetchBoundedText(url)); }
      catch (error) { if (page > 1 && error instanceof HttpFetchError && [403, 404, 429].includes(error.status)) break; throw error; }
      const items = parseRssFeed(text, this.config);
      if (!items.length) break;
      for (const item of items) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        results.push({ sourceId: this.sourceId, canonicalUrl: item.link, title: item.title, author: item.author, publishedAt: item.publishedAt, inlineHtml: item.html });
      }
    }
    return results;
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    let extracted: { text: string; links: number };
    let title = article.title;
    let publishedAt = article.publishedAt;
    let sourceHtml = article.inlineHtml;
    if (sourceHtml) extracted = stripHtmlFragment(sourceHtml);
    else {
      if (!this.config.articleSelector) throw new Error(`${this.sourceId} RSS item has no deferred extraction selector`);
      const { text: html } = await fetchBoundedText(article.canonicalUrl);
      const [meta, page] = await Promise.all([extractMeta(html), extractText(html, this.config.articleSelector)]);
      extracted = page;
      sourceHtml = html;
      title = meta.ogTitle || meta.title || title;
      publishedAt = meta.published ? new Date(meta.published).toISOString() : publishedAt;
    }
    if (isPartialPreview(extracted.text)) throw new Error("RSS content is a partial or subscriber-only preview");
    const words = wordCount(extracted.text);
    return {
      ...article,
      title,
      publishedAt,
      text: extracted.text,
      contentHash: await sha256(extracted.text),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: extractionConfidence(words, sourceHtml),
      externalLinkCount: extracted.links,
    };
  }
}

function scalar(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function cleanText(value: unknown): string { return stripHtmlFragment(scalar(value)).text.trim(); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]; }
function categoryText(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (value && typeof value === "object" && "#text" in value) return cleanText((value as { "#text": unknown })["#text"]);
  return "";
}
function parseDate(value: string): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }
function extractionConfidence(words: number, _html: string): number {
  if (words >= 600) return 0.99;
  if (words >= 200) return 0.98;
  if (words >= 80) return 0.95;
  if (words >= 30) return 0.91;
  return 0.75;
}
function isPartialPreview(text: string): boolean {
  return /(?:this post is for paid subscribers|subscribe to continue reading|upgrade to paid|members only|subscription required|unlock this post)/i.test(text);
}
