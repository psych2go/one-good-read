import type { ArticleAnalysis, ContentEligibility, ExtractedArticle } from "./types";

export const CONTENT_FORMATS = ["standalone_essay", "abstract", "quotation_introduction", "roundup", "preview", "media", "uncertain"] as const;
export const ELIGIBILITY_VERSION = "standalone-v1";

/** The provider's JSON schema is not a runtime trust boundary. Evidence must quote the supplied body. */
export function parseContentEligibility(value: unknown, body?: string): ContentEligibility | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (item.version !== ELIGIBILITY_VERSION || !CONTENT_FORMATS.includes(item.format as ContentEligibility["format"])) return undefined;
  if (typeof item.reason !== "string" || !item.reason.trim() || item.reason.length > 1000) return undefined;
  if (!Array.isArray(item.bodyEvidence) || item.bodyEvidence.length < 1 || item.bodyEvidence.length > 5) return undefined;
  if (!item.bodyEvidence.every((quote): quote is string => typeof quote === "string" && !!quote.trim() && quote.length <= 1000 && (body === undefined || body.includes(quote)))) return undefined;
  return { version: ELIGIBILITY_VERSION, format: item.format as ContentEligibility["format"], reason: item.reason, bodyEvidence: item.bodyEvidence };
}

export function invalidContentEligibility(): ContentEligibility {
  return { version: ELIGIBILITY_VERSION, format: "uncertain", reason: "invalid_or_missing_eligibility", bodyEvidence: [] };
}

export function analysisContentRejectionReason(analysis: ArticleAnalysis): string | undefined {
  const eligibility = parseContentEligibility(analysis.contentEligibility);
  if (!eligibility) return "content_review:invalid_or_missing_eligibility";
  return eligibility.format === "standalone_essay" ? undefined : `content_review:${eligibility.format}`;
}

/** Transitional screen, not verification: only explicit descriptions of the supplied text, not topic keywords. */
export function legacyContentRejectionReason(input: { riskNotes: string[]; contextSummary: string; wordCount: number }): string | undefined {
  const evidence = [...input.riskNotes, input.contextSummary].join("\n");
  if (/(?:正文|文本|文章|内容)(?:本身|部分)?(?:主要|仅|只是|更接近|大部分|基本上)(?:是|为|包含|由)?(?:一段|一篇|论文|研究|引述的|引用的|的|[、，\s]){0,4}(?:摘要|转述|节选|预览)/u.test(evidence)
    || /(?:provided (?:text|body)|(?:this |the )?(?:post|article|text|body))\s+(?:is |consists of |contains )?(?:mainly|mostly|only|primarily|essentially)\s+(?:an? |the )?(?:quoted )?(?:paper )?(?:abstract|excerpt|preview|quotation)/i.test(evidence)
    || /(?:正文|提供的文本)(?:本身|明显)?(?:是|并)?(?:不完整|未提供全文|缺少后半部分)/u.test(evidence)
    || /(?:provided (?:text|body)|(?:the |this )(?:article|body|text)) (?:is incomplete|is a partial preview|is truncated)/i.test(evidence)) return "content_review:legacy_non_standalone_evidence";
  // A short abstract with explicitly absent methods is not a self-contained essay; length alone never rejects.
  if (input.wordCount <= 300 && /摘要(?:没有|未)(?:说明|提供|交代).{0,100}(?:样本|估计方法|识别|模型|稳健性)/u.test(evidence)) return "content_review:legacy_abstract_missing_detail";
  return undefined;
}

const EXCLUDED_TITLE_PATTERNS = [
  /\bassorted links\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday) links\b/i,
  /\bpodcast\b/i,
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
