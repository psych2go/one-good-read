const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

/**
 * Produces the stable article URL used for identity and publication.
 * RSS feeds occasionally encode query separators as HTML entities and add
 * campaign parameters; treating those spellings as different URLs creates
 * duplicate articles and duplicate embeddings.
 */
export function normalizeArticleUrl(input: string): string {
  const decoded = input.trim()
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&");
  const url = new URL(decoded);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}
