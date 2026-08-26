export interface RecommendationPageRow {
  id: string;
  recommendation_date: string;
  article_id: string;
  why_worth_reading: string;
  why_today: string;
  public_keywords: string;
  published_at: string;
  title: string;
  author: string;
  canonical_url: string;
  published_at_original: string | null;
  reading_minutes: number;
  primary_theme: string;
}

const BASE_SELECT = `
  SELECT r.id, r.recommendation_date, r.article_id, r.why_worth_reading, r.why_today,
    r.public_keywords, r.published_at, a.title, a.author, a.canonical_url,
    a.published_at AS published_at_original, a.reading_minutes, n.primary_theme
  FROM recommendations r
  JOIN articles a ON a.id=r.article_id
  JOIN analyses n ON n.id=(SELECT n2.id FROM analyses n2 WHERE n2.article_id=a.id ORDER BY n2.created_at DESC LIMIT 1)
  WHERE r.status='published' AND datetime(r.published_at) <= datetime('now')
`;

export async function latestRecommendation(db: D1Database): Promise<RecommendationPageRow | null> {
  return db.prepare(`${BASE_SELECT} ORDER BY r.recommendation_date DESC LIMIT 1`).first<RecommendationPageRow>();
}

export async function recommendationByDate(db: D1Database, date: string): Promise<RecommendationPageRow | null> {
  return db.prepare(`${BASE_SELECT} AND r.recommendation_date=? LIMIT 1`).bind(date).first<RecommendationPageRow>();
}

export async function archiveRecommendations(db: D1Database, input: { page: number; author?: string; theme?: string; year?: string }): Promise<{ rows: RecommendationPageRow[]; hasNext: boolean }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (input.author) { conditions.push("a.author=?"); bindings.push(input.author); }
  if (input.theme) { conditions.push("n.primary_theme=?"); bindings.push(input.theme); }
  if (input.year) { conditions.push("substr(r.recommendation_date,1,4)=?"); bindings.push(input.year); }
  const extra = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  const limit = 21;
  const offset = Math.max(0, input.page - 1) * 20;
  const result = await db.prepare(`${BASE_SELECT}${extra} ORDER BY r.recommendation_date DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, limit, offset).all<RecommendationPageRow>();
  return { rows: result.results.slice(0, 20), hasNext: result.results.length > 20 };
}

export async function archiveFacets(db: D1Database): Promise<{ authors: string[]; themes: string[]; years: string[] }> {
  const [authors, themes, years] = await Promise.all([
    db.prepare("SELECT DISTINCT a.author value FROM recommendations r JOIN articles a ON a.id=r.article_id WHERE r.status='published' ORDER BY value").all<{ value: string }>(),
    db.prepare("SELECT DISTINCT n.primary_theme value FROM recommendations r JOIN analyses n ON n.article_id=r.article_id WHERE r.status='published' ORDER BY value").all<{ value: string }>(),
    db.prepare("SELECT DISTINCT substr(recommendation_date,1,4) value FROM recommendations WHERE status='published' ORDER BY value DESC").all<{ value: string }>(),
  ]);
  return { authors: authors.results.map((x) => x.value), themes: themes.results.map((x) => x.value), years: years.results.map((x) => x.value) };
}
