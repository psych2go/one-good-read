import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeAlert, alertDeliveryReadiness, resolveHealthAlert, sendOperationalAlert } from "../src/operations/alerts";
import { sqliteD1 } from "./helpers/sqlite-d1";
import { testEnv } from "./helpers/candidates";

let database: ReturnType<typeof sqliteD1>;
beforeEach(() => { database = sqliteD1(); });
afterEach(() => { database.sqlite.close(); vi.restoreAllMocks(); });
const input = { dedupeKey: "health:storage", managedCondition: "storage" as const, type: "storage_pressure", severity: "warning" as const, subject: "Storage", message: "Private details" };
function rows() { return database.sqlite.prepare("SELECT * FROM alerts ORDER BY rowid").all(); }

describe("0013 additive migration and incident SQL", () => {
  it("preserves every old field/history and allows old Worker inserts after migration", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      const migrations = new URL("../migrations/", import.meta.url);
      for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < "0013").sort()) sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
      const insert = `INSERT INTO alerts (id,dedupe_key,alert_type,severity,subject,message,delivery_status,delivery_error,created_at) VALUES (?, 'old','simulation_failed','warning','old subject','old body','disabled',NULL,'2026-09-07 01:02:03')`;
      sqlite.prepare(insert).run("before");
      const before = sqlite.prepare("SELECT * FROM alerts").get();
      sqlite.exec(readFileSync(new URL("0013_alert_lifecycle.sql", migrations), "utf8"));
      expect(sqlite.prepare("SELECT * FROM alerts").get()).toMatchObject({ ...before, lifecycle_status: "historical", last_seen_at: null, occurrence_count: 1, acknowledged_at: null, resolved_at: null });
      sqlite.prepare(insert).run("after");
      expect(sqlite.prepare("SELECT lifecycle_status FROM alerts WHERE id='after'").get()).toEqual({ lifecycle_status: "historical" });
    } finally { sqlite.close(); }
  });
  it("concurrent alert requests atomically increment one unresolved episode and send once", async () => {
    const send = vi.fn(async () => {});
    const env = Object.assign(testEnv(database.db), { ALERTS_ENABLED: "true", ALERT_TO_EMAIL: "to@example.test", ALERT_FROM_EMAIL: "from@example.test", EMAIL: { send } });
    await Promise.all(Array.from({ length: 30 }, () => sendOperationalAlert(env, input)));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ lifecycle_status: "open", occurrence_count: 30, delivery_status: "sent" });
    expect(send).toHaveBeenCalledOnce();
    expect(() => database.sqlite.exec(`INSERT INTO alerts (id,dedupe_key,alert_type,severity,subject,message,delivery_status,lifecycle_status) VALUES ('duplicate','health:storage','storage_pressure','warning','x','x','logged','open')`)).toThrow(/UNIQUE/);
  });
  it("persists before send, retains failed delivery, and does not turn acknowledgement into resolution", async () => {
    const send = vi.fn(async () => {
      expect(rows()[0]).toMatchObject({ delivery_status: "logged", lifecycle_status: "open", occurrence_count: 1 });
      throw new Error("provider unavailable");
    });
    const env = Object.assign(testEnv(database.db), { ALERTS_ENABLED: "true", ALERT_TO_EMAIL: "to@example.test", ALERT_FROM_EMAIL: "from@example.test", EMAIL: { send } });
    await sendOperationalAlert(env, input);
    const id = String(rows()[0]!.id);
    expect(rows()[0]).toMatchObject({ delivery_status: "failed", delivery_error: "provider unavailable" });
    expect(await acknowledgeAlert(env, id)).toBe("acknowledged");
    const acknowledgedAt = rows()[0]!.acknowledged_at;
    await sendOperationalAlert(env, input);
    expect(rows()[0]).toMatchObject({ lifecycle_status: "acknowledged", acknowledged_at: acknowledgedAt, resolved_at: null, occurrence_count: 2, delivery_status: "failed" });
    expect(send).toHaveBeenCalledOnce();
    expect(await acknowledgeAlert(env, "unknown")).toBe("unknown");
  });
  it("interrupted send leaves a durable logged incident instead of losing the record", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const env = Object.assign(testEnv(database.db), { ALERTS_ENABLED: "true", ALERT_TO_EMAIL: "to@example.test", ALERT_FROM_EMAIL: "from@example.test", EMAIL: { send } });
    const pending = sendOperationalAlert(env, input);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(rows()[0]).toMatchObject({ delivery_status: "logged", lifecycle_status: "open" });
    finish(); await pending;
  });
  it("healthy observation resolves matching managed incidents only; recurrence creates a new episode", async () => {
    const env = testEnv(database.db);
    await sendOperationalAlert(env, input);
    await sendOperationalAlert(env, { ...input, dedupeKey: "selection:today", managedCondition: undefined, type: "selection_failed" });
    await sendOperationalAlert(env, { ...input, dedupeKey: "health:publication:2026-09-07", managedCondition: "publication" });
    database.sqlite.exec(`INSERT INTO alerts (id,dedupe_key,alert_type,severity,subject,message,delivery_status) VALUES ('legacy','health:storage','storage_pressure','warning','old','old','disabled')`);
    const unrelated = rows().slice(1);
    const firstId = String(rows()[0]!.id);
    await acknowledgeAlert(env, firstId);
    await database.db.prepare("INSERT INTO system_state (key,value) VALUES ('operational_health',?)").bind(JSON.stringify({ id: "current-check" })).run();
    await resolveHealthAlert(env, "storage", input.dedupeKey, "current-check");
    expect(rows()[0]).toMatchObject({ lifecycle_status: "resolved", occurrence_count: 1 });
    expect(rows().slice(1)).toEqual(unrelated);
    expect(await acknowledgeAlert(env, firstId)).toBe("inactive");
    await sendOperationalAlert(env, input);
    expect(rows()).toHaveLength(5);
    expect(rows()[4]).toMatchObject({ lifecycle_status: "open", occurrence_count: 1, acknowledged_at: null, resolved_at: null });
    expect(rows()[4]!.id).not.toBe(firstId);
  });
  it("superseded check IDs cannot resolve or repeat a newer recurrence", async () => {
    const env = testEnv(database.db);
    await database.db.prepare("INSERT INTO system_state (key,value) VALUES ('operational_health',?)").bind(JSON.stringify({ id: "first" })).run();
    await sendOperationalAlert(env, { ...input, healthCheckId: "first" });
    await resolveHealthAlert(env, "storage", input.dedupeKey, "first");
    await database.db.prepare("UPDATE system_state SET value=? WHERE key='operational_health'").bind(JSON.stringify({ id: "second" })).run();
    await sendOperationalAlert(env, { ...input, healthCheckId: "second" });
    await acknowledgeAlert(env, String(rows()[1]!.id));
    await resolveHealthAlert(env, "storage", input.dedupeKey, "first");
    await sendOperationalAlert(env, { ...input, healthCheckId: "first" });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.lifecycle_status).toBe("resolved");
    expect(rows()[1]).toMatchObject({ lifecycle_status: "acknowledged", occurrence_count: 1, resolved_at: null });
  });
  it("reports configuration readiness honestly and persists disabled/misconfigured delivery distinctly", async () => {
    const env = testEnv(database.db);
    expect(alertDeliveryReadiness(env)).toBe("disabled");
    await sendOperationalAlert(env, input);
    expect(rows()[0]!.delivery_status).toBe("disabled");
    Object.assign(env, { ALERTS_ENABLED: "true" });
    expect(alertDeliveryReadiness(env)).toBe("misconfigured");
    await sendOperationalAlert(env, { ...input, dedupeKey: "other" });
    expect(rows()[1]).toMatchObject({ delivery_status: "failed", delivery_error: "Email configuration incomplete" });
    Object.assign(env, { ALERT_TO_EMAIL: "to@example.test", ALERT_FROM_EMAIL: "from@example.test", EMAIL: { send: vi.fn() } });
    expect(alertDeliveryReadiness(env)).toBe("ready");
  });
});
