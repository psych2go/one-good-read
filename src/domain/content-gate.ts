import type { ExtractedArticle } from "./types";

const EXCLUDED_TITLE_PATTERNS = [
  /\bassorted links\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) links\b/i,
  /\bpodcast\b/i,
  /\bvideo\b/i,
  /\bwebinar\b/i,
  /^open thread\b/i,
  /\bmeetups? everywhere\b/i,
];

export function contentRejectionReason(article: ExtractedArticle): string | undefined {
  if (EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(article.title))) return "non_standalone_format";
  if (!article.text.trim()) return "empty_body";
  if (/knowledge-project-podcast|\/podcast\//i.test(article.canonicalUrl)) return "media_first";
  if (article.wordCount < 80 && article.externalLinkCount >= 2) return "link_roundup";
  if (article.wordCount < 50 && /(?:listen|watch|youtube|spotify)/i.test(article.text)) return "media_first";
  return undefined;
}
