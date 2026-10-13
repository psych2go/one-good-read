import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { SourceAdapter } from "./adapter";
import { PermanentArticleError } from "./adapter";
import { normalizeText, sha256, stripHtmlFragment, wordCount } from "./html";

/** Push-only adapter: discovery is driven by POST /admin/ingest/email (and /api/ingest/email). */
export class MoneyStuffAdapter implements SourceAdapter {
  readonly sourceId = "money-stuff" as const;

  async discover(): Promise<DiscoveredArticle[]> {
    return [];
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    const html = article.inlineHtml?.trim();
    if (!html) throw new PermanentArticleError("Money Stuff email payload has no body");
    const extracted = looksLikeHtml(html) ? stripHtmlFragment(html) : { text: normalizeText(html), links: 0 };
    const text = extracted.text.trim();
    if (!text) throw new PermanentArticleError("Money Stuff email body extracted to empty text");
    const words = wordCount(text);
    return {
      ...article,
      text,
      contentHash: await sha256(text),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words > 400 ? 0.97 : words > 150 ? 0.93 : 0.88,
      externalLinkCount: extracted.links,
    };
  }
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}
