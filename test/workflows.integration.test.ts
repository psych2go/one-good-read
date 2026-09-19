import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { aiProvider } from "../src/ai";
import { fallbackRecommendationCopy } from "../src/ai/fallback-copy";
import { recommendationByDate } from "../src/db/queries";
import { BackfillWorkflow } from "../src/workflows/backfill";
import { DailyReadingWorkflow, type DailyWorkflowParams } from "../src/workflows/daily";
import { launchWorkflow } from "../src/workflows/launch";
import { backfillMissingEmbeddings, ingestSource } from "../src/workflows/pipeline";
import { scheduleWorkflows } from "../src/workflows/schedule";
import { seedCandidate, testEnv } from "./helpers/candidates";
import { sqliteD1 } from "./helpers/sqlite-d1";

vi.mock("../src/ai", () => ({ aiProvider: vi.fn() }));
vi.mock("../src/workflows/pipeline", async (original) => ({ ...await original<typeof import("../src/workflows/pipeline")>(), ingestSource: vi.fn(), backfillMissingEmbeddings: vi.fn(), adapterIds: () => ["farnam-street", "marginal-revolution", "paul-graham"] }));
let database: ReturnType<typeof sqliteD1>;
beforeEach(() => {
  database = sqliteD1();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-08T00:30:00+08:00"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  vi.mocked(aiProvider).mockReturnValue({ name: "test", model: "test", probe: vi.fn(), analyze: vi.fn(), choose: vi.fn().mockRejectedValue(new Error("429")), writeRecommendation: vi.fn(async (winner) => fallbackRecommendationCopy(winner)) });
  vi.mocked(backfillMissingEmbeddings).mockRejectedValue(new Error("embedding unavailable"));
});
afterEach(() => { database.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function steps() {
  const calls: string[] = [];
  const sleep = vi.fn(async (name: string, time: Date) => { calls.push(name); vi.setSystemTime(time); });
  const step = { do: async (name: string, ...args: unknown[]) => { calls.push(name); const callback = args.at(-1) as () => Promise<unknown>; return callback(); }, sleepUntil: sleep } as unknown as WorkflowStep;
  return { step, calls, sleep };
}
function event<P>(payload: P) { return { payload } as WorkflowEvent<P>; }
function controller(cron = "30 16 * * *") { return { cron, scheduledTime: new Date("2026-09-08T00:30:00+08:00").getTime(), noRetry: () => {} } as ScheduledController; }
function context() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext;
  return { ctx, pending };
}
function workflowBinding() { return { createBatch: vi.fn(async (options: Array<{ id?: string }>) => options.map((option) => ({ id: option.id }))) }; }

describe("independent daily replenishment and publication", () => {
  it("source outage and unavailable embeddings cannot block publication; scan=true is nonblocking compatibility only", async () => {
    const { db } = database; const winner = await seedCandidate(db, "prepared"); const env = testEnv(db);
    vi.mocked(ingestSource).mockImplementation(async (_, sourceId) => {
      if (sourceId === "farnam-street") throw new Error("source outage");
      return { sourceId, discovered: 1, analyzed: 1, rejected: 0, skipped: 0, errors: [] };
    });
    const backfillSteps = steps();
    const backfill = new BackfillWorkflow({} as ExecutionContext, env).run(event({ scheduledRefresh: true, limit: 5 }), backfillSteps.step);
    const backfillResult = backfill.catch((error: Error) => error.message);
    const dailySteps = steps();
    const daily = await new DailyReadingWorkflow({} as ExecutionContext, env).run(event({ date: "2026-09-08", scan: true, deferPublication: true }), dailySteps.step);
    expect(daily).toMatchObject({ selection: { winnerArticleId: winner.articleId, status: "published" } });
    expect(await backfillResult).toBe("embedding unavailable");
    expect(vi.mocked(ingestSource).mock.calls.map((call) => call[1])).toEqual(["farnam-street", "marginal-revolution", "paul-graham"]);
    expect(dailySteps.calls).toEqual(["wait-for-selection-window", "select-and-publish"]);
    expect(dailySteps.sleep).toHaveBeenCalledWith("wait-for-selection-window", new Date("2026-09-08T05:30:00+08:00"));
    expect(await recommendationByDate(db, "2026-09-08", "2026-09-08T05:59:59+08:00")).toBeNull();
    expect(await recommendationByDate(db, "2026-09-08", "2026-09-08T06:00:00+08:00")).not.toBeNull();
  });

  it("00:30 launches publication even when refresh creation fails, and refresh is scheduled above 300 Ready", async () => {
    const { db, sqlite } = database;
    await seedCandidate(db, "prepared");
    sqlite.exec("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<318) INSERT INTO articles (id,source_id,canonical_url,title,author,discovered_at,status) SELECT 'legacy-'||n,'paul-graham','https://paulgraham.com/legacy-'||n,'Legacy','Legacy',CURRENT_TIMESTAMP,'ready' FROM numbers");
    expect(await db.prepare("SELECT count(*) count FROM articles WHERE status='ready'").first("count")).toBe(319);
    const env = testEnv(db); const dailySteps = steps(); const daily = workflowBinding(); const refresh = workflowBinding();
    let publication: Promise<unknown> | undefined;
    daily.createBatch.mockImplementation(async (options) => {
      const payload = (options[0] as { params: DailyWorkflowParams }).params;
      publication = new DailyReadingWorkflow({} as ExecutionContext, env).run(event(payload), dailySteps.step);
      return [{ id: options[0]?.id }];
    });
    refresh.createBatch.mockRejectedValue(new Error("workflow service unavailable"));
    Object.assign(env, { DAILY_WORKFLOW: daily, BACKFILL_WORKFLOW: refresh });
    const { ctx, pending } = context(); scheduleWorkflows(controller(), env, ctx);
    const results = await Promise.allSettled(pending);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await publication).toMatchObject({ selection: { status: "published" } });
    expect(refresh.createBatch).toHaveBeenCalledWith([expect.objectContaining({ id: "refresh-2026-09-08-farnam-street", params: { sourceId: "farnam-street", scheduledRefresh: true, limit: 5, pages: 1 } })]);
    expect(refresh.createBatch).toHaveBeenCalledWith([expect.objectContaining({ id: "refresh-2026-09-08-paul-graham", params: { sourceId: "paul-graham", scheduledRefresh: true, limit: 5, pages: 1 } })]);
    expect(refresh.createBatch).toHaveBeenCalledWith([expect.objectContaining({ id: "refresh-2026-09-08-embeddings", params: { embeddingsOnly: true, limit: 10 } })]);
  });

  it("daily workflow cannot publish when disabled, including after sleep/recovery", async () => {
    const env = testEnv(database.db); await seedCandidate(database.db, "disabled"); Object.assign(env, { AUTOMATION_ENABLED: "false" });
    const initial = steps(); const workflow = new DailyReadingWorkflow({} as ExecutionContext, env);
    expect(await workflow.run(event({ date: "2026-09-08" }), initial.step)).toEqual({ status: "disabled" });
    expect(initial.calls).toEqual([]);
    Object.assign(env, { AUTOMATION_ENABLED: "true" }); const deferred = steps();
    deferred.sleep.mockImplementation(async () => { Object.assign(env, { AUTOMATION_ENABLED: "false" }); });
    await expect(workflow.run(event({ date: "2026-09-08", deferPublication: true }), deferred.step)).rejects.toThrow("disabled");
    expect(await database.db.prepare("SELECT count(*) count FROM recommendations").first("count")).toBe(0);
  });

  it("refresh scans only active sources, prioritizes new discovery, and respects backfill disable", async () => {
    const env = testEnv(database.db); await database.db.prepare("UPDATE sources SET status='paused' WHERE id='farnam-street'").run();
    vi.mocked(ingestSource).mockResolvedValue({ sourceId: "paul-graham", discovered: 0, analyzed: 0, rejected: 0, skipped: 0, errors: [] });
    vi.mocked(backfillMissingEmbeddings).mockResolvedValue({ processed: 0, failed: 0 });
    await new BackfillWorkflow({} as ExecutionContext, env).run(event({ scheduledRefresh: true, limit: 5 }), steps().step);
    expect(vi.mocked(ingestSource).mock.calls.map((call) => call[1])).toEqual(["marginal-revolution", "paul-graham"]);
    expect(vi.mocked(ingestSource).mock.calls.every((call) => call[4] === true)).toBe(true);
    Object.assign(env, { BACKFILL_ENABLED: "false" }); const disabledSteps = steps();
    expect(await new BackfillWorkflow({} as ExecutionContext, env).run(event({ scheduledRefresh: true }), disabledSteps.step)).toEqual({ status: "disabled" });
    expect(disabledSteps.calls).toEqual([]);
  });
});

describe("scheduler launch faults and safety", () => {
  it("duplicate createBatch skip is tolerated, operational failures propagate", async () => {
    const binding = workflowBinding(); binding.createBatch.mockResolvedValue([]);
    await expect(launchWorkflow(binding as unknown as Workflow, { id: "existing" })).resolves.toBeUndefined();
    binding.createBatch.mockRejectedValue(new Error("quota"));
    await expect(launchWorkflow(binding as unknown as Workflow, { id: "new" })).rejects.toThrow("quota");
  });
  it.each(["30 16 * * *", "30 22 * * *"])("automation disabled never launches publication or recovery at %s", async (cron) => {
    const daily = workflowBinding(); const refresh = workflowBinding(); const simulation = workflowBinding();
    const env = Object.assign(testEnv(database.db), { AUTOMATION_ENABLED: "false", BACKFILL_ENABLED: "false", DAILY_WORKFLOW: daily, BACKFILL_WORKFLOW: refresh, SIMULATION_WORKFLOW: simulation }) as unknown as Env;
    const { ctx, pending } = context(); scheduleWorkflows(controller(cron), env, ctx); await Promise.all(pending);
    expect(daily.createBatch).not.toHaveBeenCalled(); expect(refresh.createBatch).not.toHaveBeenCalled(); expect(simulation.createBatch).not.toHaveBeenCalled();
  });
  it("private simulation launch is independent from replenishment", async () => {
    const daily = workflowBinding(); const refresh = workflowBinding(); const simulation = workflowBinding();
    const env = Object.assign(testEnv(database.db), { AUTOMATION_ENABLED: "false", SIMULATION_ENABLED: "true", DAILY_WORKFLOW: daily, BACKFILL_WORKFLOW: refresh, SIMULATION_WORKFLOW: simulation }) as unknown as Env;
    const { ctx, pending } = context(); scheduleWorkflows(controller(), env, ctx); await Promise.all(pending);
    expect(daily.createBatch).not.toHaveBeenCalled(); expect(simulation.createBatch).toHaveBeenCalledOnce();
    expect(vi.mocked(refresh.createBatch).mock.calls.flatMap((call) => (call[0] as Array<{ id: string }>).map((options) => options.id))).toEqual(["refresh-2026-09-08-farnam-street", "refresh-2026-09-08-marginal-revolution", "refresh-2026-09-08-paul-graham", "refresh-2026-09-08-embeddings"]);
  });
});
