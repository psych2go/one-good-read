import { afterEach, describe, expect, it } from "vitest";
import { contentReviewQueue } from "../src/db/content-review";
import { archiveFacets, archiveRecommendations, latestRecommendation, recommendationByDate } from "../src/db/queries";
import { publishRecommendation, readyCandidates, saveAnalysis, saveSimulationRecommendation } from "../src/db/repository";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { analysisVersion, now, seedCandidate, seedRun } from "./helpers/candidates";
import { abstractRisk } from "./fixtures/content";

const databases: ReturnType<typeof sqliteD1>[] = [];
function database() { const result = sqliteD1(); databases.push(result); return result; }
afterEach(() => { for (const { sqlite } of databases.splice(0)) sqlite.close(); });
const copy = { whyWorthReading: "A reason", whyToday: "Today", keywords: ["a", "b", "c"] };

describe("publication transaction (real SQLite, all migrations)", () => {
  it("same-date overlapping different winners only mutate the actual winner, and retry is idempotent", async () => {
    const { db } = database();
    const a = await seedCandidate(db, "a"); const b = await seedCandidate(db, "b");
    const runA = await seedRun(db); const runB = await seedRun(db);
    const inputs = [a, b].map((winner, i) => ({ db, date: "2026-09-08", runId: [runA, runB][i]!, winner, ...copy, now, publishAt: "2026-09-07T22:00:00.000Z" }));
    const results = await Promise.all(inputs.map(publishRecommendation));
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ winnerArticleId: a.articleId, runId: runA, status: "published" });
    expect(await db.prepare("SELECT status FROM articles WHERE id=?").bind(b.articleId).first("status")).toBe("ready");
    expect(await db.prepare("SELECT expires_at FROM stored_objects WHERE article_id=?").bind(b.articleId).first("expires_at")).toBe("2026-12-31");
    expect(await db.prepare("SELECT status,winner_article_id FROM selection_runs WHERE id=?").bind(runB).first()).toEqual({ status: "degraded", winner_article_id: null });
    await db.prepare("UPDATE articles SET status='ready',retry_eligible_at='2027-01-01' WHERE id=?").bind(a.articleId).run();
    const retry = await publishRecommendation({ ...inputs[0]!, now: "2026-09-09T00:00:00Z", publishAt: "2026-09-09T00:00:00Z" });
    expect(retry).toEqual(results[0]);
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(1);
    expect(await db.prepare("SELECT status,retry_eligible_at FROM articles WHERE id=?").bind(a.articleId).first()).toEqual({ status: "ready", retry_eligible_at: "2027-01-01" });
    expect(await db.prepare("SELECT expires_at FROM stored_objects WHERE article_id=?").bind(a.articleId).first("expires_at")).toBe("2026-12-06 22:00:00");
  });

  it("rolls back insertion and all effects when a transaction statement fails", async () => {
    const { db, sqlite } = database(); const winner = await seedCandidate(db, "rollback"); const runId = await seedRun(db);
    sqlite.exec("CREATE TRIGGER fail_article BEFORE UPDATE OF status ON articles WHEN NEW.status='recommended' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    await expect(publishRecommendation({ db, date: "2026-09-08", winner, runId, ...copy, now })).rejects.toThrow("injected failure");
    expect(await db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
    expect(await db.prepare("SELECT status FROM articles WHERE id=?").bind(winner.articleId).first("status")).toBe("ready");
    expect(await db.prepare("SELECT status FROM selection_runs WHERE id=?").bind(runId).first("status")).toBe("running");
  });

  it("does not republish a withdrawn date or mark its losing article recommended", async () => {
    const { db } = database(); const winner = await seedCandidate(db, "original"); const loser = await seedCandidate(db, "loser");
    const firstRun = await seedRun(db);
    await publishRecommendation({ db, date: "2026-09-08", runId: firstRun, winner, ...copy, now });
    await db.prepare("UPDATE recommendations SET status='withdrawn'").run();
    const result = await publishRecommendation({ db, date: "2026-09-08", runId: await seedRun(db), winner: loser, ...copy, now });
    expect(result).toEqual({ status: "withdrawn", winnerArticleId: winner.articleId, runId: firstRun });
    expect(await db.prepare("SELECT status FROM articles WHERE id=?").bind(loser.articleId).first("status")).toBe("ready");
  });

  it("all public recommendation queries and facets respect the 06:00 Shanghai boundary", async () => {
    const { db } = database(); const winner = await seedCandidate(db, "visible");
    await publishRecommendation({ db, date: "2026-09-08", runId: await seedRun(db), winner, ...copy, now, publishAt: "2026-09-07T22:00:00.000Z" });
    for (const clock of ["2026-09-08T05:59:59+08:00", "2026-09-08T06:00:00+08:00"]) {
      const visible = clock.includes("06:00");
      expect(Boolean(await latestRecommendation(db, clock))).toBe(visible);
      expect(Boolean(await recommendationByDate(db, "2026-09-08", clock))).toBe(visible);
      expect((await archiveRecommendations(db, { page: 1 }, clock)).rows.length).toBe(visible ? 1 : 0);
      expect((await archiveFacets(db, clock)).authors).toEqual(visible ? ["visible"] : []);
    }
  });

  it("simulation writes stay private and leave article and retention unchanged", async () => {
    const { db } = database(); const winner = await seedCandidate(db, "simulation");
    await saveSimulationRecommendation({ db, date: "2026-09-08", runId: await seedRun(db), winner, ...copy, now, requiredDays: 7 });
    expect(await latestRecommendation(db)).toBeNull();
    expect((await archiveRecommendations(db, { page: 1 })).rows).toEqual([]);
    expect(await archiveFacets(db)).toEqual({ authors: [], themes: [], years: [] });
    expect(await db.prepare("SELECT status FROM articles WHERE id=?").bind(winner.articleId).first("status")).toBe("ready");
    expect(await db.prepare("SELECT expires_at FROM stored_objects WHERE article_id=?").bind(winner.articleId).first("expires_at")).toBe("2026-12-31");
    expect(await readyCandidates(db, analysisVersion, "embedding-v1", 250, true)).toEqual([]);
    expect(await readyCandidates(db, analysisVersion, "embedding-v1")).toHaveLength(1);
  });
});

describe("stored content eligibility", () => {
  it("excludes legacy abstract evidence before the candidate limit and exposes a read-only review queue", async () => {
    const { db } = database();
    const bad = await seedCandidate(db, "abstract", { riskNotes: [abstractRisk], intrinsicScore: 9.9 });
    const good = await seedCandidate(db, "short-essay");
    await db.prepare("UPDATE analyses SET content_eligibility=NULL").run();
    const rows = await readyCandidates(db, analysisVersion, "embedding-v1", 1);
    expect(rows.map((row) => row.id)).toEqual([good.articleId]);
    expect(rows[0]?.content_eligibility).toBeNull();
    expect(await db.prepare("SELECT status,content_review_reason FROM articles WHERE id=?").bind(bad.articleId).first()).toEqual({ status: "ready", content_review_reason: "content_review:legacy_non_standalone_evidence" });
    const review = await contentReviewQueue(db, analysisVersion);
    expect(review.legacyUnknownReady).toBe(1); expect(review.rows[0]?.evidence).toContain(abstractRisk);
  });

  it("blocks malformed structured eligibility and nonstandalone analyses even at high scores", async () => {
    const { db } = database(); const a = await seedCandidate(db, "invalid"); const b = await seedCandidate(db, "quoted");
    await db.prepare("UPDATE analyses SET content_eligibility=? WHERE article_id=?").bind('{"format":"standalone_essay"}', a.articleId).run();
    await db.prepare("UPDATE analyses SET content_eligibility=? WHERE article_id=?").bind(JSON.stringify({ ...b.analysis.contentEligibility, format: "quotation_introduction" }), b.articleId).run();
    expect(await readyCandidates(db, analysisVersion, "embedding-v1")).toEqual([]);
    expect((await contentReviewQueue(db, analysisVersion)).total).toBe(2);
  });

  it("missing eligibility on a new analysis is rejected, never grandfathered as legacy", async () => {
    const { db } = database(); const a = await seedCandidate(db, "new");
    await db.prepare("DELETE FROM analyses WHERE article_id=?").bind(a.articleId).run();
    await saveAnalysis(db, { ...a.analysis, contentEligibility: undefined }, now);
    expect(await db.prepare("SELECT status,content_review_reason FROM articles WHERE id=?").bind(a.articleId).first()).toEqual({ status: "rejected", content_review_reason: "content_review:invalid_or_missing_eligibility" });
    expect(await readyCandidates(db, analysisVersion, "embedding-v1")).toEqual([]);
  });
});
