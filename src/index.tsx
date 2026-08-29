import { Hono } from "hono";
import { html } from "hono/html";
import { addFeedback, addSimulationFeedback } from "./db/repository";
import { archiveFacets, archiveRecommendations, latestRecommendation, recommendationByDate } from "./db/queries";
import { shanghaiDate } from "./domain/date";
import { reservoirInstanceId } from "./domain/cron";
import type { FeedbackKind } from "./domain/types";
import { AdminPage } from "./web/admin";
import { AboutPage, ArchivePage, HomePage, ReadPage } from "./web/pages";
import { BackfillWorkflow } from "./workflows/backfill";
import { adapterIds } from "./workflows/pipeline";
import { sourceAdapter } from "./sources";
import { getOrTrainPreferenceModel } from "./preferences/model";
import { embeddingProvider } from "./embeddings";
import { isAuthorizedAdmin } from "./security/access";
import { runOperationalHealthCheck } from "./operations/health";
import { cleanupExpiredObjects, storageUsage } from "./operations/storage";
import { DailyReadingWorkflow } from "./workflows/daily";
import { ReservoirWorkflow } from "./workflows/reservoir";
import { SimulationWorkflow } from "./workflows/simulation";

export { BackfillWorkflow, DailyReadingWorkflow, ReservoirWorkflow, SimulationWorkflow };

type AppBindings = { Bindings: Env };
const app = new Hono<AppBindings>();

app.get("/", async (c) => c.html(<HomePage item={await latestRecommendation(c.env.DB)} origin={String(c.env.APP_ORIGIN)} />));
app.get("/read/:date", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.notFound();
  const item = await recommendationByDate(c.env.DB, date);
  return item ? c.html(<ReadPage item={item} origin={String(c.env.APP_ORIGIN)} />) : c.notFound();
});
app.get("/archive", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const filters = { author: clean(c.req.query("author")), theme: clean(c.req.query("theme")), year: clean(c.req.query("year")) };
  const [archive, facets] = await Promise.all([archiveRecommendations(c.env.DB, { page, ...filters }), archiveFacets(c.env.DB)]);
  return c.html(<ArchivePage rows={archive.rows} facets={facets} page={page} hasNext={archive.hasNext} filters={filters} origin={String(c.env.APP_ORIGIN)} />);
});
app.get("/about", (c) => c.html(<AboutPage origin={String(c.env.APP_ORIGIN)} />));
app.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 ok").first<{ ok: number }>();
  return c.json({ ok: db?.ok === 1, date: shanghaiDate(), analysisVersion: c.env.ANALYSIS_VERSION, selectionVersion: c.env.SELECTION_VERSION, automationEnabled: String(c.env.AUTOMATION_ENABLED) === "true" });
});
app.get("/sitemap.xml", async (c) => {
  const rows = await c.env.DB.prepare("SELECT recommendation_date FROM recommendations WHERE status='published' AND datetime(published_at) <= datetime('now') ORDER BY recommendation_date DESC LIMIT 5000").all<{ recommendation_date: string }>();
  const origin = String(c.env.APP_ORIGIN).replace(/\/$/, "");
  const urls = ["/", "/archive", "/about", ...rows.results.map((row) => `/read/${row.recommendation_date}`)];
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`).join("")}</urlset>`, 200, { "Content-Type": "application/xml; charset=utf-8" });
});

app.get("/admin", (c) => c.redirect("/admin/", 302));
app.use("/admin/*", async (c, next) => {
  if (!await isAuthorizedAdmin(c.req.raw, c.env)) return c.text("Not authorized", 403);
  if (c.req.method !== "GET" && !sameOrigin(c.req.raw, String(c.env.APP_ORIGIN))) return c.text("Invalid origin", 403);
  await next();
});
app.get("/admin/", async (c) => {
  const [articleCounts, sources, runs, recommendations, embeddingCount, preferenceModel, storage, alerts, reservoir, simulation, simulationRows] = await Promise.all([
    c.env.DB.prepare(`SELECT count(*) articles, sum(CASE WHEN status='ready' THEN 1 ELSE 0 END) ready, sum(CASE WHEN status='analysis_failed' THEN 1 ELSE 0 END) failures FROM articles`).first<{ articles: number; ready: number; failures: number }>(),
    c.env.DB.prepare("SELECT id,name,status,last_scanned_at,consecutive_failures FROM sources ORDER BY name").all<{ id: string; name: string; status: string; last_scanned_at: string | null; consecutive_failures: number }>(),
    c.env.DB.prepare(`SELECT s.id,s.recommendation_date,s.status,a.title winner_title,s.failure_reason,s.created_at FROM selection_runs s LEFT JOIN articles a ON a.id=s.winner_article_id ORDER BY s.created_at DESC LIMIT 20`).all<{ id: string; recommendation_date: string; status: string; winner_title: string | null; failure_reason: string | null; created_at: string }>(),
    c.env.DB.prepare(`SELECT r.id,r.recommendation_date,a.title,a.author,a.recommendation_retry_count retry_count,(SELECT f.kind FROM feedback f WHERE f.recommendation_id=r.id ORDER BY f.created_at DESC LIMIT 1) feedback_kind FROM recommendations r JOIN articles a ON a.id=r.article_id WHERE r.status='published' ORDER BY r.recommendation_date DESC LIMIT 20`).all<{ id: string; recommendation_date: string; title: string; author: string; retry_count: number; feedback_kind: string | null }>(),
    c.env.DB.prepare("SELECT count(*) count FROM embeddings WHERE embedding_version=?").bind(String(c.env.EMBEDDING_VERSION)).first<{ count: number }>(),
    c.env.DB.prepare("SELECT sample_count,max_influence,metrics,created_at FROM preference_models WHERE active=1 AND model_version=? AND embedding_version=? ORDER BY created_at DESC LIMIT 1").bind(String(c.env.PREFERENCE_MODEL_VERSION), String(c.env.EMBEDDING_VERSION)).first<{ sample_count: number; max_influence: number; metrics: string; created_at: string }>(),
    storageUsage(c.env),
    c.env.DB.prepare("SELECT alert_type,severity,subject,delivery_status,created_at FROM alerts ORDER BY created_at DESC LIMIT 10").all<{ alert_type: string; severity: string; subject: string; delivery_status: string; created_at: string }>(),
    c.env.DB.prepare("SELECT value,updated_at FROM system_state WHERE key='reservoir_status'").first<{ value: string; updated_at: string }>(),
    c.env.DB.prepare("SELECT value,updated_at FROM system_state WHERE key='simulation_status'").first<{ value: string; updated_at: string }>(),
    c.env.DB.prepare(`SELECT sr.simulation_date,a.title,a.author,a.canonical_url,a.reading_minutes,sr.why_worth_reading,sr.why_today,sr.public_keywords,sr.created_at,(SELECT sf.kind FROM simulation_feedback sf WHERE sf.simulation_date=sr.simulation_date ORDER BY sf.created_at DESC LIMIT 1) feedback_kind FROM simulation_recommendations sr JOIN articles a ON a.id=sr.article_id ORDER BY sr.simulation_date DESC LIMIT 10`).all<{ simulation_date: string; title: string; author: string; canonical_url: string; reading_minutes: number; why_worth_reading: string; why_today: string; public_keywords: string; feedback_kind: string | null; created_at: string }>(),
  ]);
  const recCount = await c.env.DB.prepare("SELECT count(*) count FROM recommendations WHERE status='published'").first<{ count: number }>();
  return c.html(<AdminPage data={{ automationEnabled: String(c.env.AUTOMATION_ENABLED) === "true", counts: { articles: articleCounts?.articles ?? 0, ready: articleCounts?.ready ?? 0, recommendations: recCount?.count ?? 0, failures: articleCounts?.failures ?? 0, embeddings: embeddingCount?.count ?? 0 }, preferenceModel: preferenceModel ?? undefined, storage, alerts: alerts.results, reservoir: reservoir ?? undefined, simulation: simulation ?? undefined, simulationRows: simulationRows.results, sources: sources.results, runs: runs.results, recommendations: recommendations.results }} />);
});
app.post("/admin/run-daily", async (c) => {
  if (String(c.env.AUTOMATION_ENABLED) !== "true") return c.text("Public automation is disabled during private simulation", 409);
  const date = shanghaiDate();
  try { await c.env.DAILY_WORKFLOW.create({ id: `daily-${date}`, params: { date, scan: false, deferPublication: false }, retention: { successRetention: "3 days", errorRetention: "3 days" } }); } catch (error) { console.log(JSON.stringify({ event: "daily_workflow_existing", date, message: error instanceof Error ? error.message : String(error) })); }
  return c.redirect("/admin/", 303);
});
app.post("/admin/backfill", async (c) => {
  await c.env.BACKFILL_WORKFLOW.create({ id: `backfill-${crypto.randomUUID()}`, params: { limit: 25, pages: 3 }, retention: { successRetention: "3 days", errorRetention: "3 days" } });
  return c.redirect("/admin/", 303);
});
app.post("/admin/run-reservoir", async (c) => {
  await c.env.RESERVOIR_WORKFLOW.create({ id: `reservoir-manual-${crypto.randomUUID()}`, params: {}, retention: { successRetention: "3 days", errorRetention: "3 days" } });
  return c.redirect("/admin/", 303);
});
app.post("/admin/run-simulation", async (c) => {
  const date = shanghaiDate();
  await c.env.SIMULATION_WORKFLOW.create({ id: `simulation-manual-${date}-${crypto.randomUUID()}`, params: { date, deferSelection: false }, retention: { successRetention: "3 days", errorRetention: "3 days" } });
  return c.redirect("/admin/", 303);
});
app.post("/admin/simulations/:date/feedback", async (c) => {
  const date = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.text("Invalid date", 400);
  const body = await c.req.parseBody();
  const kind = body.kind;
  if (typeof kind !== "string" || !isFeedbackKind(kind)) return c.text("Invalid feedback", 400);
  await addSimulationFeedback(c.env.DB, date, kind);
  return c.redirect("/admin/", 303);
});
app.post("/admin/backfill-embeddings", async (c) => {
  await c.env.BACKFILL_WORKFLOW.create({ id: `embedding-backfill-${crypto.randomUUID()}`, params: { embeddingsOnly: true, limit: 10 }, retention: { successRetention: "3 days", errorRetention: "3 days" } });
  return c.redirect("/admin/", 303);
});
app.post("/admin/train-preference", async (c) => {
  await getOrTrainPreferenceModel(c.env);
  return c.redirect("/admin/", 303);
});
app.post("/admin/cleanup-storage", async (c) => {
  await cleanupExpiredObjects(c.env, 100);
  return c.redirect("/admin/", 303);
});
app.get("/admin/probe-embedding", async (c) => {
  const result = await embeddingProvider(c.env).embed("Embedding probe", "Risk, uncertainty, judgment, and long-term investing decisions.");
  const norm = Math.sqrt(result.values.reduce((sum, value) => sum + value * value, 0));
  return c.json({ provider: result.provider, model: result.model, dimensions: result.dimensions, norm });
});
app.get("/admin/probe/:sourceId", async (c) => {
  const sourceId = c.req.param("sourceId");
  if (!adapterIds().includes(sourceId)) return c.json({ error: "unknown_source" }, 404);
  const startedAt = Date.now();
  const adapter = sourceAdapter(sourceId);
  const articles = await adapter.discover();
  const first = c.req.query("extract") === "1" && articles[0] ? await adapter.extract(articles[0]) : undefined;
  return c.json({ sourceId, discovered: articles.length, elapsedMs: Date.now() - startedAt, sample: articles.slice(0, 3).map(({ title, author, canonicalUrl, publishedAt }) => ({ title, author, canonicalUrl, publishedAt })), extraction: first ? { title: first.title, wordCount: first.wordCount, readingMinutes: first.readingMinutes, confidence: first.extractionConfidence, links: first.externalLinkCount } : undefined });
});
app.post("/admin/backfill/:sourceId", async (c) => {
  const sourceId = c.req.param("sourceId");
  if (!adapterIds().includes(sourceId)) return c.text("Unknown source", 404);
  await c.env.BACKFILL_WORKFLOW.create({ id: `backfill-${sourceId}-${crypto.randomUUID()}`, params: { sourceId, limit: 5, pages: 5 }, retention: { successRetention: "3 days", errorRetention: "3 days" } });
  return c.redirect("/admin/", 303);
});
app.post("/admin/recommendations/:id/feedback", async (c) => {
  const body = await c.req.parseBody();
  const kind = body.kind;
  if (typeof kind !== "string" || !isFeedbackKind(kind)) return c.text("Invalid feedback", 400);
  await addFeedback(c.env.DB, c.req.param("id"), kind);
  return c.redirect("/admin/", 303);
});

app.notFound((c) => c.html(html`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><link rel="stylesheet" href="/styles.css"><title>Not found — One Good Read</title></head><body><main><section class="empty-state"><p class="edition-label">404</p><h1>这里没有今天的阅读。</h1><p><a href="/">返回首页</a></p></section></main></body></html>`, 404));
app.onError((error, c) => { console.error(JSON.stringify({ event: "request_error", path: c.req.path, message: error.message, stack: error.stack })); return c.json({ error: "internal_error" }, 500); });

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    if (["15 * * * *", "45 * * * *"].includes(controller.cron)) {
      if (String(env.BACKFILL_ENABLED) !== "true") return;
      const instanceId = reservoirInstanceId(controller.scheduledTime);
      ctx.waitUntil((async () => { try { await env.RESERVOIR_WORKFLOW.create({ id: instanceId, params: {}, retention: { successRetention: "3 days", errorRetention: "3 days" } }); } catch (error) { console.log(JSON.stringify({ event: "reservoir_workflow_existing", instanceId, message: error instanceof Error ? error.message : String(error) })); } })());
      return;
    }
    if (controller.cron === "30 22 * * *") {
      if (String(env.AUTOMATION_ENABLED) === "true") ctx.waitUntil(runOperationalHealthCheck(env));
      return;
    }
    const date = shanghaiDate();
    if (String(env.AUTOMATION_ENABLED) === "true") {
      ctx.waitUntil((async () => {
        try { await env.DAILY_WORKFLOW.create({ id: `daily-${date}`, params: { date, scan: true, deferPublication: true }, retention: { successRetention: "3 days", errorRetention: "3 days" } }); }
        catch (error) { console.log(JSON.stringify({ event: "scheduled_workflow_existing", date, message: error instanceof Error ? error.message : String(error) })); }
      })());
      return;
    }
    if (String(env.SIMULATION_ENABLED) === "true") {
      ctx.waitUntil((async () => {
        try { await env.SIMULATION_WORKFLOW.create({ id: `simulation-${date}`, params: { date, deferSelection: true }, retention: { successRetention: "10 days", errorRetention: "10 days" } }); }
        catch (error) { console.log(JSON.stringify({ event: "simulation_workflow_existing", date, message: error instanceof Error ? error.message : String(error) })); }
      })());
      return;
    }
    console.log(JSON.stringify({ event: "automation_and_simulation_disabled", cron: controller.cron }));
  },
} satisfies ExportedHandler<Env>;

function clean(value: string | undefined): string | undefined { const result = value?.trim(); return result || undefined; }
function isFeedbackKind(value: string): value is FeedbackKind { return ["valuable","good","not_for_me","unfinished","later"].includes(value); }
function sameOrigin(request: Request, origin: string): boolean { const value = request.headers.get("Origin"); return !value || value === origin.replace(/\/$/, ""); }
function escapeXml(value: string): string { return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char); }
