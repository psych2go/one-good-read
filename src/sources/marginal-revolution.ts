import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { DiscoveryOptions, SourceAdapter } from "./adapter";
import { sha256, stripHtmlFragment, wordCount } from "./html";
import { fetchBoundedText, HttpFetchError } from "./http";
import { parseRssFeed } from "./rss";

const FEED = "https://marginalrevolution.com/feed";


export class MarginalRevolutionAdapter implements SourceAdapter {
  readonly sourceId = "marginal-revolution" as const;

  async discover(options: DiscoveryOptions = {}): Promise<DiscoveredArticle[]> {
    const pages = Math.max(1, Math.min(options.pages ?? 1, 100));
    const results: DiscoveredArticle[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page += 1) {
      const url = page === 1 ? FEED : `${FEED}?paged=${page}`;
      let text: string;
      try { ({ text } = await fetchBoundedText(url)); }
      catch (error) { if (page > 1 && error instanceof HttpFetchError && [403, 404, 429].includes(error.status)) break; throw error; }
      const items = parseRssFeed(text, { sourceId: this.sourceId, feedUrl: FEED, defaultAuthor: "", allowedAuthors: ["Tyler Cowen", "Alex Tabarrok"] });
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
    if (!article.inlineHtml) throw new Error("Marginal Revolution RSS item has no full content");
    const extracted = stripHtmlFragment(article.inlineHtml);
    const words = wordCount(extracted.text);
    return {
      ...article,
      text: extracted.text,
      contentHash: await sha256(extracted.text),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words > 150 ? 0.96 : 0.9,
      externalLinkCount: extracted.links,
    };
  }
}
