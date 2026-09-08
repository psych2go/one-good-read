import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import worker from "../src/index";
import { businessHealth, readOperationalCheck, type BusinessHealth } from "../src/operations/business-health";
import { runOperationalHealthCheck } from "../src/operations/health";
import { acknowledgeAlert, sendOperationalAlert } from "../src/operations/alerts";
import { BackfillWorkflow } from "../src/workflows/backfill";
import { scheduleWorkflows } from "../src/workflows/schedule";
import { seedCandidate, testEnv } from "./helpers/candidates";
import { sqliteD1 } from "./helpers/sqlite-d1";

let database: ReturnType<typeof sqliteD1>;
let env: Env;
const at = (value: string) => vi.setSystemTime(new Date(value));
beforeEach(() => {
  database = sqliteD1(); env = testEnv(database.db);
  Object.assign(env, { CONTENT: { delete: vi.fn(async () => {}) } });
  vi.useFakeTimers({ toFake: ["Date"] }); at("2026-09-08T07:00:00+08:00");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network call"); }));
});
afterEach(() => { database.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function publish(date = "2026-09-08", publishedAt = `${date}T06:00:00+08:00`) {
  const candidate = await seedCandidate(database.db, date);
  await database.db.prepare(`INSERT INTO recommendations (id,recommendation_date,article_id,selection_run_id,why_worth_reading,why_today,published_at)
    VALUES (?,?,?,'test-run','private copy','private copy',?)`).bind(`rec-${date}`, date, candidate.articleId, publishedAt).run();
}
async function previousCheck() {
  await publish("2026-09-07"); at("2026-09-07T06:30:00+08:00");
  await runOperationalHealthCheck(env);
}
async function requestHealth() {
  const response = await worker.fetch(new Request("https://example.test/health"), env);
  return { response, health: await response.json() as BusinessHealth };
}
async function expireBody() { await database.db.prepare("INSERT INTO stored_objects (object_key,kind,size_bytes,expires_at) VALUES ('expired','article_body',100,'2000-01-01')").run(); }
function healthWorkflow(step: WorkflowStep) {
  return new BackfillWorkflow({} as ExecutionContext, env).run({ payload: { healthCheck: true } } as WorkflowEvent<{ healthCheck: boolean }>, step);
}
function pauseFirstStorageObservation() {
  let release!: () => void;
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => { captured = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const prepare = env.DB.prepare.bind(env.DB);
  let firstStorageRead = true;
  vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (firstStorageRead && sql.includes("coalesce(sum(size_bytes),0)")) {
      firstStorageRead = false;
      const first = statement.first.bind(statement);
      statement.first = async <T = unknown>(column?: string): Promise<T | null> => {
        const result = column === undefined ? await first<T>() : await first<T>(column);
        captured();
        await paused;
        return result;
      };
    }
    return statement;
  });
  return { ready, release };
}

describe("public business health HTTP and Shanghai windows", () => {
  it.each(["00:00:00", "05:59:59", "06:00:00", "06:29:59", "06:30:00", "06:59:59", "07:00:00"])("enforces publication and heartbeat deadlines at %s", async (time) => {
    await previousCheck(); at(`2026-09-08T${time}+08:00`);
    const before = database.sqlite.prepare("SELECT total_changes() n").get();
    const { response, health } = await requestHealth();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(health.currentPublicDate).toBe("2026-09-07");
    expect(health.components.publication.status).toBe(time < "06:00:00" ? "ok" : time < "06:30:00" ? "grace" : "missing");
    expect(health.components.monitor.status).toBe(time < "07:00:00" ? "ok" : "stale");
    expect(response.status).toBe(time < "06:30:00" ? 200 : 503);
    expect(health.status).toBe(time < "06:00:00" ? "healthy" : time < "06:30:00" ? "warning" : "unhealthy");
    expect(database.sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("missing publication returns 503 even though SELECT 1 liveness succeeds and today's check completed", async () => {
    await runOperationalHealthCheck(env);
    const live = await worker.fetch(new Request("https://example.test/health/live"), env);
    expect(live.status).toBe(200); expect(live.headers.get("cache-control")).toBe("no-store");
    const { response, health } = await requestHealth();
    expect(response.status).toBe(503);
    expect(health).toMatchObject({ ok: false, date: "2026-09-08", automationEnabled: true, analysisVersion: env.ANALYSIS_VERSION, selectionVersion: env.SELECTION_VERSION,
      components: { database: { status: "ok" }, publication: { status: "missing" }, monitor: { status: "ok" } } });
  });
  it("current publication and healthy completed check return 200 without private diagnostics", async () => {
    await publish(); await runOperationalHealthCheck(env);
    const { response, health } = await requestHealth();
    expect(response.status).toBe(200); expect(health.status).toBe("healthy");
    expect(health.checks.lastSuccessfulAt).toBe(new Date().toISOString());
    const text = JSON.stringify(health);
    expect(text).not.toMatch(/private copy|articleId|subject|message|@|test-run/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["future-visible", "withdrawn"])("does not count %s recommendations as published", async (kind) => {
    await publish("2026-09-08", kind === "future-visible" ? "2026-09-08T08:00:00+08:00" : "2026-09-08T06:00:00+08:00");
    if (kind === "withdrawn") database.sqlite.exec("UPDATE recommendations SET status='withdrawn'");
    await runOperationalHealthCheck(env);
    const { response, health } = await requestHealth();
    expect(response.status).toBe(503); expect(health.currentPublicDate).toBeNull(); expect(health.components.publication.status).toBe("missing");
  });
  it("current public date changes only when today's visibility time arrives at 06:00", async () => {
    await previousCheck(); await publish();
    at("2026-09-08T05:59:59+08:00"); expect((await requestHealth()).health.currentPublicDate).toBe("2026-09-07");
    at("2026-09-08T06:00:00+08:00"); expect((await requestHealth()).health.currentPublicDate).toBe("2026-09-08");
  });
  it.each(["2026-09-08T00:00:00+08:00", "2026-09-08T07:00:00+08:00"])("missing heartbeat is unhealthy, not indefinitely initializing (%s)", async (time) => {
    await publish("2026-09-07"); await publish(); at(time);
    const { response, health } = await requestHealth();
    expect(response.status).toBe(503); expect(health.components.monitor).toEqual({ status: "missing", reason: "check_missing" });
  });
  it("previous check is accepted until 07:00, then a current daily observation is required", async () => {
    await previousCheck(); await publish(); at("2026-09-08T06:59:59+08:00");
    expect((await requestHealth()).response.status).toBe(200);
    at("2026-09-08T07:00:00+08:00"); expect((await requestHealth()).response.status).toBe(503);
    await runOperationalHealthCheck(env); expect((await requestHealth()).response.status).toBe(200);
  });
  it("automation disabled is explicit and healthy despite absent publication/check; DB failure still fails", async () => {
    Object.assign(env, { AUTOMATION_ENABLED: "false" });
    const { response, health } = await requestHealth();
    expect(response.status).toBe(200); expect(health.status).toBe("disabled");
    expect(health.components.publication.status).toBe("disabled"); expect(health.components.monitor.status).toBe("disabled");
    database.sqlite.close(); database = sqliteD1();
    // env retains the closed connection, while teardown owns the fresh database.
    expect((await requestHealth()).response.status).toBe(503);
  });
  it.each(["/health", "/health/live"])("D1 errors at %s are safe 503/no-store responses", async (path) => {
    vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("private database token someone@example.test"); });
    const response = await worker.fetch(new Request(`https://example.test${path}`), env);
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text(); expect(text).toContain("database_unavailable"); expect(text).not.toMatch(/private|token|someone|stack/);
  });
  it("corrupt heartbeat fails closed", async () => {
    await publish(); await database.db.prepare("INSERT INTO system_state (key,value) VALUES ('operational_health','not json')").run();
    expect((await requestHealth()).health.components.monitor.status).toBe("missing");
  });
});

describe("durable health Workflow and recovery", () => {
  it("06:30 dispatches on public automation independently of disabled source replenishment", async () => {
    const createBatch = vi.fn(async () => []); Object.assign(env, { BACKFILL_ENABLED: "false", BACKFILL_WORKFLOW: { createBatch } });
    const pending: Promise<unknown>[] = [];
    scheduleWorkflows({ cron: "30 22 * * *", scheduledTime: new Date("2026-09-08T06:30:00+08:00").getTime() } as ScheduledController, env, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext);
    await Promise.all(pending);
    expect(createBatch).toHaveBeenCalledWith([expect.objectContaining({ id: "health-2026-09-08", params: { healthCheck: true } })]);
  });
  it("health branch runs before storage guard/ingestion even with backfill disabled and critical storage", async () => {
    await publish(); Object.assign(env, { BACKFILL_ENABLED: "false", R2_STORAGE_LIMIT_BYTES: "1" });
    const calls: string[] = [];
    const step = { do: async (name: string, ...args: unknown[]) => { calls.push(name); return (args.at(-1) as () => Promise<unknown>)(); } } as unknown as WorkflowStep;
    expect(await healthWorkflow(step)).toMatchObject({ status: "completed", components: { storage: { status: "critical" }, publication: { status: "ok" } } });
    expect(calls).toEqual(["operational-health-check"]);
    expect((await requestHealth()).response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
  });
  it("records running before I/O, does not claim success early, then records failed cleanup independently", async () => {
    await publish(); await runOperationalHealthCheck(env);
    const previous = await readOperationalCheck(env);
    at("2026-09-08T07:05:00+08:00"); await expireBody();
    database.sqlite.exec("UPDATE recommendations SET status='withdrawn'");
    let release!: () => void;
    Object.assign(env, { CONTENT: { delete: vi.fn(() => new Promise<void>((_, reject) => { release = () => reject(new Error("private R2 failure")); })) } });
    const pending = runOperationalHealthCheck(env); const rejection = expect(pending).rejects.toThrow("expired objects");
    // Allow DB reads/alert persistence to advance up to the blocked R2 call.
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await readOperationalCheck(env)).check).toMatchObject({ status: "running", completedAt: null });
    expect((await requestHealth()).health.components.monitor.status).toBe("running");
    release(); await rejection;
    const state = await readOperationalCheck(env);
    expect(state.check).toMatchObject({ status: "failed", completedAt: null, components: { publication: { status: "missing" }, cleanup: { status: "error" }, storage: { status: "ok" } } });
    expect(state.lastSuccessfulAt).toBe(previous.lastSuccessfulAt); expect(state.lastCompletedAt).toBe(previous.lastCompletedAt);
    expect(state.lastFailedAt).toBe(new Date().toISOString());
    const { response, health } = await requestHealth();
    expect(response.status).toBe(503); expect(health.components.monitor.status).toBe("error");
    expect(JSON.stringify(health)).not.toMatch(/private|expired objects/);
    expect(await database.db.prepare("SELECT count(*) n FROM alerts WHERE lifecycle_status='open'").first("n")).toBe(2);
  });
  it("thrown DB I/O records failure if DB recovers, rethrows for Workflow retry, then recovers", async () => {
    await publish(); let attempts = 0;
    const originalPrepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("max(recommendation_date)") && attempts === 1) throw new Error("transient DB read failure");
      return originalPrepare(sql);
    });
    const step = { do: async (_name: string, options: { retries: { limit: number } }, callback: () => Promise<unknown>) => {
      expect(options.retries.limit).toBe(2); attempts++;
      await expect(callback()).rejects.toThrow("transient DB read failure");
      expect((await readOperationalCheck(env)).check).toMatchObject({ status: "failed", error: "transient DB read failure", components: { cleanup: { status: "ok" }, storage: { status: "ok" } } });
      attempts++; at("2026-09-08T07:01:00+08:00"); return callback();
    } } as unknown as WorkflowStep;
    expect(await healthWorkflow(step)).toMatchObject({ status: "completed" });
    expect(attempts).toBe(2); expect((await businessHealth(env)).ok).toBe(true);
    expect((await readOperationalCheck(env)).lastFailedAt).not.toBeNull();
  });
  it("an in-progress daily check is warning only with a prior success and a bounded pre-07:00 grace", async () => {
    await previousCheck(); await publish(); await expireBody(); at("2026-09-08T06:30:00+08:00");
    let finish!: () => void;
    Object.assign(env, { CONTENT: { delete: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) } });
    const pending = runOperationalHealthCheck(env);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect((await requestHealth()).health).toMatchObject({ ok: true, status: "warning", components: { monitor: { status: "running" } } });
    at("2026-09-08T06:40:00+08:00"); expect((await requestHealth()).response.status).toBe(503);
    at("2026-09-08T07:00:00+08:00"); expect((await requestHealth()).response.status).toBe(503);
    finish(); await pending;
    expect((await requestHealth()).response.status).toBe(200);
  });
  it("an older overlapping check cannot overwrite the latest attempt on completion", async () => {
    await publish(); await expireBody();
    let finish!: () => void;
    const remove = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    Object.assign(env, { CONTENT: { delete: remove } });
    const older = runOperationalHealthCheck(env);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    at("2026-09-08T07:01:00+08:00"); const newer = await runOperationalHealthCheck(env);
    finish(); await older;
    expect((await readOperationalCheck(env)).check?.id).toBe(newer.id);
  });
  it.each(["open", "acknowledged"])("a delayed healthy observation cannot resolve a newer %s storage incident", async (status) => {
    await publish(); Object.assign(env, { R2_STORAGE_LIMIT_BYTES: "1000" });
    const pause = pauseFirstStorageObservation();
    const older = runOperationalHealthCheck(env);
    await pause.ready;
    database.sqlite.exec("INSERT INTO stored_objects (object_key,kind,size_bytes) VALUES ('pressure','article_body',1000)");
    at("2026-09-08T07:01:00+08:00");
    const newer = await runOperationalHealthCheck(env);
    const incident = await database.db.prepare("SELECT id FROM alerts WHERE dedupe_key='health:storage'").first<{ id: string }>();
    if (status === "acknowledged") await acknowledgeAlert(env, incident!.id);
    const latest = await readOperationalCheck(env);
    at("2026-09-08T07:02:00+08:00"); pause.release(); await older;
    expect(await database.db.prepare("SELECT lifecycle_status FROM alerts WHERE id=?").bind(incident!.id).first("lifecycle_status")).toBe(status);
    const after = await readOperationalCheck(env);
    expect(after.check?.id).toBe(newer.id);
    expect(after.check?.components.storage.status).toBe("critical");
    expect(after.lastSuccessfulAt).toBe(latest.lastSuccessfulAt);
    expect(after.lastCompletedAt).toBe(latest.lastCompletedAt);
  });
  it("a delayed unhealthy observation cannot reopen storage after a newer healthy check", async () => {
    await publish(); Object.assign(env, { R2_STORAGE_LIMIT_BYTES: "1000" });
    database.sqlite.exec("UPDATE stored_objects SET size_bytes=900");
    const pause = pauseFirstStorageObservation();
    const older = runOperationalHealthCheck(env);
    await pause.ready;
    database.sqlite.exec("UPDATE stored_objects SET size_bytes=100");
    at("2026-09-08T07:01:00+08:00"); const newer = await runOperationalHealthCheck(env);
    const latest = await readOperationalCheck(env);
    at("2026-09-08T07:02:00+08:00"); pause.release(); await older;
    expect(await database.db.prepare("SELECT count(*) n FROM alerts WHERE dedupe_key='health:storage'").first("n")).toBe(0);
    const after = await readOperationalCheck(env);
    expect(after.check?.id).toBe(newer.id);
    expect(after.lastSuccessfulAt).toBe(latest.lastSuccessfulAt);
    expect(after.lastCompletedAt).toBe(latest.lastCompletedAt);
    expect((await requestHealth()).response.status).toBe(200);
  });
  it("initial heartbeat write failure is recorded when DB becomes available and is rethrown", async () => {
    const originalPrepare = env.DB.prepare.bind(env.DB); let failed = false;
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (!failed) { failed = true; throw new Error("temporary write failure"); }
      return originalPrepare(sql);
    });
    await expect(runOperationalHealthCheck(env)).rejects.toThrow("temporary write failure");
    expect((await readOperationalCheck(env)).check).toMatchObject({ status: "failed", error: "temporary write failure" });
  });
  it("actual healthy recovery closes current managed conditions only, never unrelated or past missing dates", async () => {
    await expireBody(); Object.assign(env, { R2_STORAGE_LIMIT_BYTES: "1", CONTENT: { delete: vi.fn(async () => { throw new Error("R2 unavailable"); }) } });
    await expect(runOperationalHealthCheck(env)).rejects.toThrow();
    for (const dedupeKey of ["simulation:old", "health:publication:2026-09-07"]) await sendOperationalAlert(env, { dedupeKey, managedCondition: dedupeKey.startsWith("health:") ? "publication" : undefined, type: "simulation_failed", severity: "warning", subject: "Private", message: "Private" });
    database.sqlite.exec("INSERT INTO alerts (id,dedupe_key,alert_type,severity,subject,message,delivery_status) VALUES ('historical','old','simulation_ready','warning','old','old','disabled')");
    const unrelated = database.sqlite.prepare("SELECT * FROM alerts WHERE dedupe_key IN ('simulation:old','health:publication:2026-09-07','old') ORDER BY id").all();
    await publish(); Object.assign(env, { R2_STORAGE_LIMIT_BYTES: "1000000", CONTENT: { delete: vi.fn(async () => {}) } });
    at("2026-09-08T07:10:00+08:00"); await runOperationalHealthCheck(env);
    expect(await database.db.prepare("SELECT count(*) n FROM alerts WHERE lifecycle_status='resolved'").first("n")).toBe(3);
    expect(database.sqlite.prepare("SELECT * FROM alerts WHERE dedupe_key IN ('simulation:old','health:publication:2026-09-07','old') ORDER BY id").all()).toEqual(unrelated);
    expect((await requestHealth()).response.status).toBe(200);
  });
  it("monitoring and recovery do not rewrite public recommendations or feedback history", async () => {
    await publish();
    database.sqlite.exec("INSERT INTO feedback (id,recommendation_id,kind) VALUES ('feedback','rec-2026-09-08','valuable')");
    const recommendations = database.sqlite.prepare("SELECT * FROM recommendations").all();
    const feedback = database.sqlite.prepare("SELECT * FROM feedback").all();
    await runOperationalHealthCheck(env); await runOperationalHealthCheck(env);
    expect(database.sqlite.prepare("SELECT * FROM recommendations").all()).toEqual(recommendations);
    expect(database.sqlite.prepare("SELECT * FROM feedback").all()).toEqual(feedback);
    expect(await database.db.prepare("SELECT count(*) n FROM selection_runs").first("n")).toBe(0);
  });
  it("a cleanup batch with remaining overdue objects does not falsely resolve an earlier cleanup incident", async () => {
    await publish();
    await sendOperationalAlert(env, { dedupeKey: "health:cleanup", managedCondition: "cleanup", type: "cleanup_failed", severity: "warning", subject: "Cleanup", message: "Failed" });
    database.sqlite.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<101) INSERT INTO stored_objects (object_key,kind,size_bytes,expires_at) SELECT 'old-'||i,'article_body',1,'2000-01-01' FROM n");
    expect((await runOperationalHealthCheck(env)).components.cleanup.status).toBe("warning");
    expect(await database.db.prepare("SELECT lifecycle_status FROM alerts WHERE dedupe_key='health:cleanup'").first("lifecycle_status")).toBe("open");
    await runOperationalHealthCheck(env);
    expect(await database.db.prepare("SELECT lifecycle_status FROM alerts WHERE dedupe_key='health:cleanup'").first("lifecycle_status")).toBe("resolved");
  });
  it("disabled public automation skips manual health workflow without any step", async () => {
    Object.assign(env, { AUTOMATION_ENABLED: "false" }); const run = vi.fn();
    expect(await healthWorkflow({ do: run } as unknown as WorkflowStep)).toEqual({ status: "disabled" }); expect(run).not.toHaveBeenCalled();
  });
});
