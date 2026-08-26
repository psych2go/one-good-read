import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { SourceAdapter } from "./adapter";
import { collectLinks, extractMeta, extractText, sha256, wordCount } from "./html";
import { fetchBoundedText } from "./http";

const INDEX = "https://www.oaktreecapital.com/insights/memos";

export class HowardMarksAdapter implements SourceAdapter {
  readonly sourceId = "howard-marks" as const;

  async discover(): Promise<DiscoveredArticle[]> {
    const { text } = await fetchBoundedText(INDEX);
    const links = await collectLinks(text, 'a[href*="/insights/memo/"]', INDEX);
    const seen = new Set<string>();
    return links.flatMap((link) => {
      const url = new URL(link.url);
      url.search = "";
      if (!link.text || seen.has(url.toString()) || url.pathname.includes("memo-podcast")) return [];
      seen.add(url.toString());
      return [{ sourceId: this.sourceId, canonicalUrl: url.toString(), title: link.text, author: "Howard Marks" }];
    });
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    const { text: html } = await fetchBoundedText(article.canonicalUrl);
    const meta = await extractMeta(html);
    const extracted = await extractText(html, ".article-content .col-md-8", /Legal Information and Disclosures/i);
    const title = meta.ogTitle || meta.title || article.title;
    const clean = extracted.text.replace(title, "").trim();
    const words = wordCount(clean);
    return {
      ...article,
      title,
      publishedAt: meta.time ? new Date(meta.time).toISOString() : article.publishedAt,
      text: clean,
      contentHash: await sha256(clean),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words > 500 ? 0.98 : 0.9,
      externalLinkCount: extracted.links,
    };
  }
}
