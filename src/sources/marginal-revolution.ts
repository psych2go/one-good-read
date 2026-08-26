import { XMLParser } from "fast-xml-parser";
import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { SourceAdapter } from "./adapter";
import { sha256, stripHtmlFragment, wordCount } from "./html";
import { fetchBoundedText } from "./http";

const FEED = "https://marginalrevolution.com/feed";

type FeedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  "dc:creator"?: string;
  "content:encoded"?: string;
  description?: string;
};

export class MarginalRevolutionAdapter implements SourceAdapter {
  readonly sourceId = "marginal-revolution" as const;

  async discover(): Promise<DiscoveredArticle[]> {
    const { text } = await fetchBoundedText(FEED);
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, trimValues: false });
    const parsed = parser.parse(text) as { rss?: { channel?: { item?: FeedItem | FeedItem[] } } };
    const raw = parsed.rss?.channel?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.flatMap((item) => {
      const author = item["dc:creator"]?.trim() ?? "";
      if (!item.title || !item.link || !["Tyler Cowen", "Alex Tabarrok"].includes(author)) return [];
      return [{
        sourceId: this.sourceId,
        canonicalUrl: item.link.trim(),
        title: item.title.trim(),
        author,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
        inlineHtml: item["content:encoded"] ?? item.description,
      }];
    });
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
