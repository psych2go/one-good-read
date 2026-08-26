import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { SourceAdapter } from "./adapter";
import { collectLinks, extractMeta, extractText, sha256, wordCount } from "./html";
import { fetchBoundedText } from "./http";

const INDEX = "https://paulgraham.com/articles.html";
const EXCLUDED = new Set(["index.html", "articles.html", "books.html", "arc.html", "bel.html", "lisp.html", "antispam.html", "faq.html", "rss.html", "bio.html"]);

export class PaulGrahamAdapter implements SourceAdapter {
  readonly sourceId = "paul-graham" as const;

  async discover(): Promise<DiscoveredArticle[]> {
    const { text } = await fetchBoundedText(INDEX);
    const links = await collectLinks(text, "a", INDEX);
    const seen = new Set<string>();
    return links.flatMap((link) => {
      const url = new URL(link.url);
      const file = url.pathname.split("/").pop() ?? "";
      if (url.hostname !== "paulgraham.com" || !file.endsWith(".html") || EXCLUDED.has(file) || !link.text || seen.has(url.toString())) return [];
      seen.add(url.toString());
      return [{ sourceId: this.sourceId, canonicalUrl: url.toString(), title: link.text, author: "Paul Graham" }];
    });
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    const { text: html } = await fetchBoundedText(article.canonicalUrl);
    const meta = await extractMeta(html);
    const extracted = await extractText(html, "body");
    const dateMatch = extracted.text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/);
    const publishedAt = dateMatch ? new Date(`${dateMatch[0]} 1 00:00:00 UTC`).toISOString() : article.publishedAt;
    const title = meta.ogTitle || meta.title || article.title;
    const clean = extracted.text.replace(title, "").replace(dateMatch?.[0] ?? "$never", "").trim();
    const words = wordCount(clean);
    return {
      ...article,
      title,
      publishedAt,
      text: clean,
      contentHash: await sha256(clean),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words > 300 ? 0.98 : 0.91,
      externalLinkCount: extracted.links,
    };
  }
}
