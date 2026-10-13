import { normalizeArticleUrl } from "../domain/url";
import type { DiscoveredArticle, SourceId } from "../domain/types";

export const EMAIL_INGEST_SOURCE_ID = "money-stuff" as const satisfies SourceId;

export interface EmailIngestPayload {
  sourceId: string;
  messageId: string;
  subject: string;
  author?: string;
  publishedAt?: string;
  htmlBody?: string;
  textBody?: string;
  canonicalUrl?: string;
  fromAddress?: string;
  toAddress?: string;
}

export type EmailIngestParseResult =
  | { ok: true; article: DiscoveredArticle; messageId: string }
  | { ok: false; error: string; status: 400 };

/** Normalize a newsletter ingest JSON body into a DiscoveredArticle with inline body. */
export function parseEmailIngestPayload(raw: unknown): EmailIngestParseResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body_must_be_json_object", status: 400 };
  const body = raw as Record<string, unknown>;
  const sourceId = stringField(body.sourceId);
  if (sourceId !== EMAIL_INGEST_SOURCE_ID) return { ok: false, error: "unsupported_source_id", status: 400 };
  const messageId = stringField(body.messageId) || stringField(body.externalId);
  if (!messageId) return { ok: false, error: "messageId_required", status: 400 };
  const subject = stringField(body.subject);
  if (!subject) return { ok: false, error: "subject_required", status: 400 };
  const htmlBody = stringField(body.htmlBody);
  const textBody = stringField(body.textBody);
  if (!htmlBody && !textBody) return { ok: false, error: "htmlBody_or_textBody_required", status: 400 };

  const author = stringField(body.author) || "Matt Levine";
  const publishedAt = parsePublishedAt(stringField(body.publishedAt));
  const providedUrl = stringField(body.canonicalUrl);
  const discoveredUrl = providedUrl || findBloombergUrl(htmlBody) || findBloombergUrl(textBody);
  const canonicalUrl = discoveredUrl
    ? normalizeArticleUrl(discoveredUrl)
    : syntheticMoneyStuffUrl(messageId);

  const inlineHtml = htmlBody || wrapPlainTextAsHtml(textBody!);
  return {
    ok: true,
    messageId,
    article: {
      sourceId: EMAIL_INGEST_SOURCE_ID,
      canonicalUrl,
      title: subject,
      author,
      publishedAt,
      inlineHtml,
    },
  };
}

export function findBloombergUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Keep &amp; as a boundary so query strings encoded as entity separators still parse.
  const matches = value.match(/https?:\/\/(?:www\.)?bloomberg\.com\/[^\s"'<>]+/gi) ?? [];
  const candidates: string[] = [];
  for (const raw of matches) {
    const cleaned = raw
      .replace(/&amp;/gi, "&")
      .replace(/&#0*38;/gi, "&")
      .replace(/[),.;]+$/g, "");
    // HTML sometimes turns ?utm into &utm mid-path; promote the first tracking amp to ?.
    const promoted = cleaned.replace(/&(utm_[a-z0-9]+=)/i, "?$1");
    try {
      const url = new URL(promoted);
      if (!(/bloomberg\.com$/i.test(url.hostname) || /\.bloomberg\.com$/i.test(url.hostname))) continue;
      candidates.push(normalizeArticleUrl(url.toString()));
    } catch {
      // ignore malformed
    }
  }
  const preferred = candidates.find((url) => /\/newsletters?\//i.test(url) || /\/opinion\//i.test(url) || /\/news\//i.test(url) || /money-stuff/i.test(url));
  return preferred ?? candidates[0];
}

export function syntheticMoneyStuffUrl(messageId: string): string {
  const safe = messageId.trim().replace(/[^a-zA-Z0-9._@+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "unknown";
  return `https://www.bloomberg.com/newsletters/money-stuff/email/${encodeURIComponent(safe)}`;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parsePublishedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function wrapPlainTextAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre>${escaped}</pre>`;
}
