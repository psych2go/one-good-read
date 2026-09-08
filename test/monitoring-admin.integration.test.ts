import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sendOperationalAlert } from "../src/operations/alerts";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { testEnv } from "./helpers/candidates";

let database: ReturnType<typeof sqliteD1>;
let env: Env;
beforeEach(() => { database = sqliteD1(); env = testEnv(database.db); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected remote auth call"); })); });
afterEach(() => { database.sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function post(path: string, origin: string | null = "http://localhost:8787", host = "http://localhost:8787") {
  return worker.fetch(new Request(`${host}${path}`, { method: "POST", headers: origin === null ? {} : { Origin: origin } }), env);
}
async function seedAlert() {
  await sendOperationalAlert(env, { dedupeKey: "example", type: "selection_failed", severity: "critical", subject: "Private alert", message: "Private details" });
  return await database.db.prepare("SELECT id FROM alerts").first<string>("id");
}
describe("Access/origin protected monitoring controls", () => {
  it.each(["/admin/run-health-check", "/admin/alerts/unknown/acknowledge"])("unauthenticated production POST %s is rejected before DB/workflow access", async (path) => {
    expect((await post(path, "https://example.test", "https://example.test")).status).toBe(403);
    expect(await database.db.prepare("SELECT count(*) n FROM alerts").first("n")).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", null])("rejects bad/missing Origin %s even for authorized local admin", async (origin) => {
    const id = await seedAlert();
    expect((await post(`/admin/alerts/${id}/acknowledge`, origin)).status).toBe(403);
    expect((await post("/admin/run-health-check", origin)).status).toBe(403);
    expect(await database.db.prepare("SELECT lifecycle_status FROM alerts").first("lifecycle_status")).toBe("open");
  });
  it("acknowledges without resolving, is idempotent, and returns 404 for an unknown id", async () => {
    const id = await seedAlert();
    expect((await post(`/admin/alerts/${id}/acknowledge`)).status).toBe(303);
    expect((await post(`/admin/alerts/${id}/acknowledge`)).status).toBe(303);
    expect(await database.db.prepare("SELECT lifecycle_status,resolved_at FROM alerts").first()).toEqual({ lifecycle_status: "acknowledged", resolved_at: null });
    expect((await post("/admin/alerts/unknown/acknowledge")).status).toBe(404);
    database.sqlite.exec("UPDATE alerts SET lifecycle_status='historical'");
    expect((await post(`/admin/alerts/${id}/acknowledge`)).status).toBe(409);
  });
  it("manual bootstrap launches the same durable health payload with a new id, no fake success state", async () => {
    const createBatch = vi.fn(async () => []); Object.assign(env, { BACKFILL_WORKFLOW: { createBatch }, BACKFILL_ENABLED: "false" });
    const response = await post("/admin/run-health-check");
    expect(response.status).toBe(303); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createBatch).toHaveBeenCalledWith([expect.objectContaining({ id: expect.stringMatching(/^health-manual-/), params: { healthCheck: true } })]);
    expect(await database.db.prepare("SELECT count(*) n FROM system_state WHERE key LIKE 'operational_health%'").first("n")).toBe(0);
    Object.assign(env, { AUTOMATION_ENABLED: "false" }); expect((await post("/admin/run-health-check")).status).toBe(409); expect(createBatch).toHaveBeenCalledOnce();
  });
  it("dashboard exposes lifecycle groups, diagnostics and delivery readiness privately", async () => {
    await seedAlert();
    const response = await worker.fetch(new Request("http://localhost:8787/admin/"), env);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    for (const value of ["业务健康", "open", "acknowledged", "resolved", "historical", "disabled", "Private alert", "Private details", "/admin/run-health-check", "/acknowledge", "最近全部正常", "不代表已验证送达"]) expect(text).toContain(value);
    const privateResponse = await worker.fetch(new Request("https://example.test/admin/"), env);
    expect(privateResponse.status).toBe(403); expect(await privateResponse.text()).not.toContain("Private details");
    expect(fetch).not.toHaveBeenCalled();
  });
});
