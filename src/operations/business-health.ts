import { shanghaiDate } from "../domain/date";
import type { StorageUsage } from "./storage";

export type ComponentStatus = "ok" | "disabled" | "grace" | "missing" | "running" | "stale" | "error" | "warning" | "critical";
export interface HealthComponent { status: ComponentStatus; reason: string; }
export interface OperationalCheck {
  id: string; startedAt: string; completedAt: string | null; failedAt: string | null;
  status: "running" | "completed" | "failed";
  error: string | null;
  components: { publication: HealthComponent; cleanup: HealthComponent; storage: HealthComponent };
  errors: Partial<Record<"publication" | "cleanup" | "storage", string>>;
  observations: {
    publication?: { expectedDate: string; currentPublicDate: string | null };
    cleanup?: { deleted: number; bytesFreed: number; failed: number; remaining?: number };
    storage?: StorageUsage;
  };
}
export interface BusinessHealth {
  ok: boolean; status: "healthy" | "warning" | "unhealthy" | "disabled"; date: string;
  analysisVersion: string; selectionVersion: string; automationEnabled: boolean;
  checkedAt: string; currentPublicDate: string | null; expectedPublicationDate: string;
  checks: { startedAt: string | null; completedAt: string | null; failedAt: string | null; lastSuccessfulAt: string | null; lastCompletedAt: string | null; lastFailedAt: string | null; expectedSince: string };
  components: { database: HealthComponent; publication: HealthComponent; monitor: HealthComponent; cleanup: HealthComponent; storage: HealthComponent };
}
export function healthWindow(now: Date) {
  const date = shanghaiDate(now);
  const midnight = new Date(`${date}T00:00:00+08:00`).getTime();
  const minutes = (now.getTime() - midnight) / 60_000;
  const previousDate = shanghaiDate(new Date(midnight - 1));
  return { date, minutes, expectedPublicationDate: minutes < 360 ? previousDate : date,
    publicationGrace: minutes >= 360 && minutes < 390,
    expectedCheckSince: new Date(`${minutes < 420 ? previousDate : date}T06:30:00+08:00`).toISOString() };
}
export async function publicationHealth(env: Env, now: Date): Promise<{ component: HealthComponent; currentPublicDate: string | null; expectedDate: string }> {
  const window = healthWindow(now);
  const rows = await env.DB.prepare(`SELECT max(recommendation_date) current_date,
    max(CASE WHEN recommendation_date=? THEN 1 ELSE 0 END) expected_visible FROM recommendations
    WHERE status='published' AND datetime(published_at)<=datetime(?) AND recommendation_date<=?`)
    .bind(window.expectedPublicationDate, now.toISOString(), window.date).first<{ current_date: string | null; expected_visible: number | null }>();
  const currentPublicDate = rows?.current_date ?? null;
  const present = rows?.expected_visible === 1;
  return { currentPublicDate, expectedDate: window.expectedPublicationDate, component:
    String(env.AUTOMATION_ENABLED) !== "true" ? { status: "disabled", reason: "automation_disabled" } :
    present ? { status: "ok", reason: "publication_visible" } :
    window.publicationGrace ? { status: "grace", reason: "publication_grace_until_0630" } : { status: "missing", reason: "visible_publication_missing" } };
}
export async function readOperationalCheck(env: Env): Promise<{ check: OperationalCheck | null; lastSuccessfulAt: string | null; lastCompletedAt: string | null; lastFailedAt: string | null }> {
  const rows = await env.DB.prepare("SELECT key,value FROM system_state WHERE key IN ('operational_health','operational_health_success','operational_health_completed','operational_health_failed')").all<{ key: string; value: string }>();
  let check: OperationalCheck | null = null;
  let lastSuccessfulAt: string | null = null;
  let lastCompletedAt: string | null = null;
  let lastFailedAt: string | null = null;
  for (const row of rows.results) {
    if (row.key === "operational_health_success") { if (validTimestamp(row.value)) lastSuccessfulAt = row.value; continue; }
    if (row.key === "operational_health_completed") { if (validTimestamp(row.value)) lastCompletedAt = row.value; continue; }
    if (row.key === "operational_health_failed") { if (validTimestamp(row.value)) lastFailedAt = row.value; continue; }
    try {
      const value = JSON.parse(row.value) as OperationalCheck;
      if (value && validTimestamp(value.startedAt) && ["running", "completed", "failed"].includes(value.status)
        && (value.completedAt === null || validTimestamp(value.completedAt)) && (value.failedAt === null || validTimestamp(value.failedAt))
        && [value.components?.publication, value.components?.cleanup, value.components?.storage].every((component) => component && ["ok", "disabled", "grace", "missing", "running", "error", "warning", "critical"].includes(component.status))) check = value;
    } catch { /* Corrupt state is a missing heartbeat, never a successful check. */ }
  }
  return { check, lastSuccessfulAt, lastCompletedAt, lastFailedAt };
}
export async function businessHealth(env: Env, now = new Date()): Promise<BusinessHealth> {
  const window = healthWindow(now);
  const automationEnabled = String(env.AUTOMATION_ENABLED) === "true";
  const disabled: HealthComponent = { status: "disabled", reason: "automation_disabled" };
  const unknown: HealthComponent = { status: "missing", reason: "check_missing" };
  const result: BusinessHealth = { ok: false, status: "unhealthy", date: window.date, analysisVersion: String(env.ANALYSIS_VERSION), selectionVersion: String(env.SELECTION_VERSION), automationEnabled,
    checkedAt: now.toISOString(), currentPublicDate: null, expectedPublicationDate: window.expectedPublicationDate,
    checks: { startedAt: null, completedAt: null, failedAt: null, lastSuccessfulAt: null, lastCompletedAt: null, lastFailedAt: null, expectedSince: window.expectedCheckSince },
    components: { database: { status: "error", reason: "database_unavailable" }, publication: automationEnabled ? unknown : disabled, monitor: automationEnabled ? unknown : disabled, cleanup: automationEnabled ? unknown : disabled, storage: automationEnabled ? unknown : disabled } };
  try {
    const [publication, heartbeat] = await Promise.all([publicationHealth(env, now), readOperationalCheck(env)]);
    result.components.database = { status: "ok", reason: "database_readable" };
    result.currentPublicDate = publication.currentPublicDate;
    result.components.publication = publication.component;
    const { check, lastSuccessfulAt, lastCompletedAt, lastFailedAt } = heartbeat;
    result.checks = { ...result.checks, startedAt: check?.startedAt ?? null, completedAt: check?.completedAt ?? null, failedAt: check?.failedAt ?? null, lastSuccessfulAt, lastCompletedAt, lastFailedAt };
    if (!automationEnabled) { result.ok = true; result.status = "disabled"; return result; }
    if (check) {
      // Export fixed reason codes only, never the persisted diagnostic strings.
      for (const name of ["cleanup", "storage"] as const) result.components[name] = { status: check.components[name].status, reason: `${name}_${check.components[name].status}` };
      const fresh = check.startedAt >= window.expectedCheckSince && check.startedAt <= now.toISOString();
      result.components.monitor = !fresh ? { status: "stale", reason: "daily_check_stale" } :
        check.status === "failed" ? { status: "error", reason: "daily_check_failed" } :
        check.status === "running" ? { status: "running", reason: "daily_check_running" } :
        check.completedAt && check.completedAt <= now.toISOString() ? { status: "ok", reason: "daily_check_completed" } : { status: "error", reason: "daily_check_incomplete" };
    }
    // A short in-progress attempt may use the prior successful observation only before 07:00.
    // Missing, failed, or indefinitely running checks never receive bootstrap/freshness credit.
    const runningGrace = window.minutes < 420 && check?.status === "running"
      && check.startedAt <= now.toISOString() && now.getTime() - Date.parse(check.startedAt) < 10 * 60_000
      && lastSuccessfulAt !== null && lastSuccessfulAt >= window.expectedCheckSince && lastSuccessfulAt <= now.toISOString();
    const failed = Object.values(result.components).some(({ status }) => ["missing", "stale", "error", "critical"].includes(status) || (status === "running" && !runningGrace));
    result.ok = !failed;
    result.status = failed ? "unhealthy" : runningGrace || Object.values(result.components).some(({ status }) => ["grace", "warning"].includes(status)) ? "warning" : "healthy";
  } catch { /* Fail closed with safe public reason codes; detailed errors belong to durable/admin state. */ }
  return result;
}
function validTimestamp(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
