import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiProvider } from "../src/ai";
import { fallbackRecommendationCopy } from "../src/ai/fallback-copy";
import { assertPublicRecommendationCopy } from "../src/ai/validate-copy";
import { createAndStoreEmbedding, backfillMissingEmbeddings } from "../src/embeddings/service";
import { sourceAdapter } from "../src/sources";
import { ingestSource, runDailySelection, runDailySimulation } from "../src/workflows/pipeline";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { seedCandidate, testAnalysis, testEnv } from "./helpers/candidates";
import { abstractArticle, abstractRisk, quoteHeavyEssay, shortEssay, standalone } from "./fixtures/content";
import type { AiProvider } from "../src/ai/provider";

vi.mock("../src/ai", () => ({ aiProvider: vi.fn() }));
vi.mock("../src/sources", () => ({ sourceAdapter: vi.fn(), sourceAdapters: () => [] }));
vi.mock("../src/embeddings/service", async (original) => ({ ...await original<typeof import("../src/embeddings/service")>(), createAndStoreEmbedding: vi.fn(), backfillMissingEmbeddings: vi.fn() }));
let database: ReturnType<typeof sqliteD1>;
let provider: AiProvider;
beforeEach(() => {
  database = sqliteD1();
  vi.mocked(createAndStoreEmbedding).mockReset();
  vi.mocked(backfillMissingEmbeddings).mockReset();
  provider = { name: "test", model: "test", probe: vi.fn(), analyze: vi.fn(), choose: vi.fn(async (candidates) => ({ articleId: candidates[0]!.articleId, rationale: "test" })), writeRecommendation: vi.fn(async (winner) => fallbackRecommendationCopy(winner)) };
  vi.mocked(aiProvider).mockReturnValue(provider);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
});
afterEach(() => { database.sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("prepared-pool publication faults (real SQL)", () => {
  it.each([new Error("429 model_cooldown"), new DOMException("request timeout", "TimeoutError")])("AI choose and write failure falls back: %s", async (failure) => {
    const { db } = database; const winner = await seedCandidate(db, "available");
    vi.mocked(provider.choose).mockRejectedValue(failure); vi.mocked(provider.writeRecommendation).mockRejectedValue(failure);
    vi.mocked(createAndStoreEmbedding).mockRejectedValue(new Error("embedding unavailable"));
    vi.mocked(backfillMissingEmbeddings).mockRejectedValue(new Error("embedding unavailable"));
    const result = await runDailySelection(testEnv(db), "2026-09-08", "2026-09-07T22:00:00Z");
    expect(result.winnerArticleId).toBe(winner.articleId);
    expect(result.status).toBe("published");
    expect(await db.prepare("SELECT status FROM selection_runs WHERE id=?").bind(result.runId).first("status")).toBe("degraded");
    expect(await db.prepare("SELECT failure_reason FROM selection_runs WHERE id=?").bind(result.runId).first("failure_reason")).toContain("copywriting_fallback");
    expect(backfillMissingEmbeddings).not.toHaveBeenCalled(); expect(createAndStoreEmbedding).not.toHaveBeenCalled();
  });

  it.each([new Error("429 model_cooldown"), new DOMException("request timeout", "TimeoutError")])("publishes fallback with repeated stored keywords during outage: %s", async (failure) => {
    const { db } = database;
    const winner = await seedCandidate(db, "repeated-keywords", { primaryTheme: "决策与判断", keywords: ["判断", "判断", "判断"] });
    vi.mocked(provider.writeRecommendation).mockRejectedValue(failure);
    const result = await runDailySelection(testEnv(db), "2026-09-08");
    expect(result.status).toBe("published");
    expect(result.winnerArticleId).toBe(winner.articleId);
    const row = await db.prepare("SELECT why_worth_reading,why_today,public_keywords FROM recommendations").first<{ why_worth_reading: string; why_today: string; public_keywords: string }>();
    const copy = { whyWorthReading: row!.why_worth_reading, whyToday: row!.why_today, keywords: JSON.parse(row!.public_keywords) };
    expect(() => assertPublicRecommendationCopy(copy)).not.toThrow();
    expect(new Set(copy.keywords).size).toBe(copy.keywords.length);
    expect(await db.prepare("SELECT status FROM selection_runs WHERE id=?").bind(result.runId).first("status")).toBe("degraded");
    expect(await db.prepare("SELECT failure_reason FROM selection_runs WHERE id=?").bind(result.runId).first("failure_reason")).toContain("copywriting_fallback");
  });

  it.each([null, { whyWorthReading: "", whyToday: "bad", keywords: [] }, { whyWorthReading: "x".repeat(50), whyToday: "x".repeat(40), keywords: [1, 2, 3] }])("invalid copy fails safely instead of publishing: %j", async (copy) => {
    const { db } = database; await seedCandidate(db, "invalid-copy");
    vi.mocked(provider.writeRecommendation).mockResolvedValue(copy as never);
    await expect(runDailySelection(testEnv(db), "2026-09-08")).rejects.toThrow("Invalid public recommendation copy");
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
    expect(await db.prepare("SELECT status FROM selection_runs").first("status")).toBe("failed");
  });

  it("all links fail => failed run plus alert, no fake publication", async () => {
    const { db } = database; await seedCandidate(db, "unreachable");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(runDailySelection(testEnv(db), "2026-09-08")).rejects.toThrow("All Top candidates failed");
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
    expect(await db.prepare("SELECT status FROM selection_runs").first("status")).toBe("failed");
    expect(await db.prepare("SELECT alert_type FROM alerts").first("alert_type")).toBe("selection_failed");
    expect(provider.choose).not.toHaveBeenCalled();
  });

  it("no publication while disabled, including a switch during editorial preparation", async () => {
    const { db } = database; await seedCandidate(db, "disabled"); const env = testEnv(db);
    Object.assign(env, { AUTOMATION_ENABLED: "false" });
    await expect(runDailySelection(env, "2026-09-08")).rejects.toThrow("disabled");
    expect(await db.prepare("SELECT count(*) count FROM selection_runs").first("count")).toBe(0);
    Object.assign(env, { AUTOMATION_ENABLED: "true" });
    vi.mocked(provider.choose).mockImplementation(async (candidates) => { Object.assign(env, { AUTOMATION_ENABLED: "false" }); return { articleId: candidates[0]!.articleId, rationale: "switch" }; });
    await expect(runDailySelection(env, "2026-09-08")).rejects.toThrow("disabled");
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
    expect(await db.prepare("SELECT status FROM selection_runs").first("status")).toBe("failed");
  });

  it("concurrent pipeline selections return the actual publication winner and run", async () => {
    const { db } = database; await seedCandidate(db, "a"); await seedCandidate(db, "b"); let choice = 0;
    vi.mocked(provider.choose).mockImplementation(async (candidates) => ({ articleId: candidates[choice++ % 2]!.articleId, rationale: "different winner" }));
    const results = await Promise.all([runDailySelection(testEnv(db), "2026-09-08"), runDailySelection(testEnv(db), "2026-09-08")]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.prepare("SELECT count(*) count FROM articles WHERE status='recommended'").first("count")).toBe(1);
    expect(await db.prepare("SELECT count(*) count FROM selection_runs WHERE status='degraded'").first("count")).toBe(1);
    expect(results[0]?.winnerArticleId).toBe(await db.prepare("SELECT article_id FROM recommendations").first("article_id"));
    expect(results[0]?.runId).toBe(await db.prepare("SELECT selection_run_id FROM recommendations").first("selection_run_id"));
  });

  it("legacy abstract Ready is excluded without an AI reanalysis or body fetch; simulation stays private", async () => {
    const { db } = database;
    const abstract = await seedCandidate(db, "abstract", { riskNotes: [abstractRisk], intrinsicScore: 9.9 });
    const essay = await seedCandidate(db, "essay");
    await db.prepare("UPDATE analyses SET content_eligibility=NULL").run();
    const result = await runDailySimulation(testEnv(db), "2026-09-08");
    expect(result.winnerArticleId).toBe(essay.articleId);
    expect(provider.analyze).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.every((call) => call[0] !== abstract.canonicalUrl)).toBe(true);
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
    expect(await db.prepare("SELECT count(*) count FROM simulation_recommendations").first("count")).toBe(1);
  });
});

describe("ingestion content eligibility (real SQL)", () => {
  it.each(["abstract", "quotation_introduction", "uncertain", "missing", "malformed", "invented-evidence"])("rejects high-scoring abstract fixture with %s eligibility", async (format) => {
    const { db } = database;
    const eligibility = format === "missing" ? undefined : format === "malformed" ? { format: "standalone_essay" } : { version: "standalone-v1", format: format === "invented-evidence" ? "standalone_essay" : format, reason: "The supplied body only introduces a paper.", bodyEvidence: [format === "invented-evidence" ? "invented body text" : abstractArticle.text.slice(0, 90)] };
    vi.mocked(sourceAdapter).mockReturnValue({ sourceId: "marginal-revolution", discover: vi.fn(async () => [abstractArticle]), extract: vi.fn(async () => abstractArticle) });
    vi.mocked(provider.analyze).mockImplementation(async (_, context) => ({ ...testAnalysis(context.articleId), riskNotes: [abstractRisk], contentEligibility: eligibility as never }));
    const env = Object.assign(testEnv(db), { CONTENT: { put: vi.fn(), delete: vi.fn() } });
    await ingestSource(env, "marginal-revolution", 5);
    expect(await db.prepare("SELECT status FROM articles").first("status")).toBe("rejected");
    expect(await db.prepare("SELECT content_review_reason FROM articles").first("content_review_reason")).toMatch(/^content_review:/);
    expect(createAndStoreEmbedding).not.toHaveBeenCalled();
  });

  it.each([shortEssay, quoteHeavyEssay])("accepts self-contained short and quote-heavy essays, not a minimum length or quote ban", async (body) => {
    const { db } = database;
    const article = { ...abstractArticle, title: "Decision journals", text: body, wordCount: body.split(/\s+/).length, externalLinkCount: 0 };
    vi.mocked(sourceAdapter).mockReturnValue({ sourceId: "marginal-revolution", discover: vi.fn(async () => [article]), extract: vi.fn(async () => article) });
    vi.mocked(provider.analyze).mockImplementation(async (_, context) => ({ ...testAnalysis(context.articleId), contentEligibility: standalone(body) }));
    const env = Object.assign(testEnv(db), { CONTENT: { put: vi.fn(), delete: vi.fn() } });
    await ingestSource(env, "marginal-revolution", 5);
    expect(await db.prepare("SELECT status FROM articles").first("status")).toBe("ready");
    expect(createAndStoreEmbedding).toHaveBeenCalledOnce();
  });
});
