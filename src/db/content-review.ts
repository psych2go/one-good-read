import { candidateContentRejectionReason } from "./repository";

export interface ContentReviewQueue {
  legacyUnknownReady: number;
  total: number;
  rows: Array<{ id: string; title: string; status: string; reason: string; evidence: string; eligibility: string | null }>;
}

/** Read-only admin view; never reclassifies or rewrites published history. */
export async function contentReviewQueue(db: D1Database, analysisVersion: string): Promise<ContentReviewQueue> {
  const result = await db.prepare(`SELECT a.id,a.title,a.status,a.word_count,a.content_review_reason,a.rejection_reason,
      n.content_eligibility,n.risk_notes,n.context_summary
    FROM articles a LEFT JOIN analyses n ON n.article_id=a.id AND n.analysis_version=?
    WHERE a.status IN ('ready','rejected','analysis_failed')
      AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.article_id=a.id)
    ORDER BY a.updated_at DESC,a.id ASC`).bind(analysisVersion).all<{
      id: string; title: string; status: string; word_count: number; content_review_reason: string | null; rejection_reason: string | null;
      content_eligibility: string | null; risk_notes: string | null; context_summary: string | null;
    }>();
  let legacyUnknownReady = 0;
  const rows: ContentReviewQueue["rows"] = [];
  for (const row of result.results) {
    const reason = candidateContentRejectionReason({ ...row, risk_notes: row.risk_notes ?? "[]", context_summary: row.context_summary ?? "" })
      ?? row.content_review_reason
      ?? (row.rejection_reason && /^(?:content_review:|non_standalone_format|link_roundup|media_first|empty_body)/.test(row.rejection_reason) ? row.rejection_reason : undefined);
    if (!reason) {
      if (row.status === "ready" && row.content_eligibility === null) legacyUnknownReady += 1;
      continue;
    }
    rows.push({ id: row.id, title: row.title, status: row.status, reason, evidence: `${row.risk_notes ?? "[]"}\n${row.context_summary ?? ""}`, eligibility: row.content_eligibility });
  }
  return { legacyUnknownReady, total: rows.length, rows: rows.slice(0, 100) };
}
