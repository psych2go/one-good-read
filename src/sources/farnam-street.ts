import type { DiscoveredArticle, ExtractedArticle } from "../domain/types";
import type { DiscoveryOptions, SourceAdapter } from "./adapter";
import { collectLinks, extractMeta, extractText, sha256, wordCount } from "./html";
import { fetchBoundedText, HttpFetchError } from "./http";

const ARCHIVE_URL = "https://fs.blog/blog/";

export class FarnamStreetAdapter implements SourceAdapter {
  readonly sourceId = "farnam-street" as const;

  async discover(options: DiscoveryOptions = {}): Promise<DiscoveredArticle[]> {
    const pages = Math.max(1, Math.min(options.pages ?? 1, 100));
    const results: DiscoveredArticle[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page += 1) {
      const pageUrl = farnamArchivePageUrl(page);
      let html: string;
      try { ({ text: html } = await fetchBoundedText(pageUrl)); }
      catch (error) {
        if (page > 1 && error instanceof HttpFetchError && [403, 404, 429].includes(error.status)) break;
        throw error;
      }
      const links = await collectLinks(html, "main article h2.entry-title a", pageUrl);
      if (!links.length) break;
      for (const link of links) {
        if (!isFarnamArticle(link.url, link.text) || seen.has(link.url)) continue;
        seen.add(link.url);
        results.push({ sourceId: this.sourceId, canonicalUrl: link.url, title: link.text, author: "Farnam Street" });
      }
    }
    return results;
  }

  async extract(article: DiscoveredArticle): Promise<ExtractedArticle> {
    const { text: html } = await fetchBoundedText(article.canonicalUrl);
    const [meta, extracted] = await Promise.all([
      extractMeta(html),
      extractText(html, "article .entry-content"),
    ]);
    const words = wordCount(extracted.text);
    return {
      ...article,
      title: meta.ogTitle || meta.title || article.title,
      publishedAt: meta.published ? new Date(meta.published).toISOString() : article.publishedAt,
      text: extracted.text,
      contentHash: await sha256(extracted.text),
      wordCount: words,
      readingMinutes: Math.max(1, Math.ceil(words / 230)),
      extractionConfidence: words >= 600 ? .99 : words >= 200 ? .97 : words >= 80 ? .92 : .78,
      externalLinkCount: extracted.links,
    };
  }
}

export function farnamArchivePageUrl(page: number): string {
  return page <= 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${page}/`;
}

export function isFarnamArticle(value: string, title: string): boolean {
  const url = new URL(value);
  return url.hostname === "fs.blog" &&
    url.pathname !== "/blog/" &&
    !url.pathname.startsWith("/blog/page/") &&
    !/knowledge-project-podcast|\/podcast\//i.test(url.pathname) &&
    !/^\s*\[?FS Members\]?/i.test(title) &&
    !/\b(?:podcast|video|webinar)\b/i.test(title);
}
