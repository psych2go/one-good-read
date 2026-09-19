import { publicationHealth, type OperationalCheck } from "./business-health";
import { resolveHealthAlert, sendOperationalAlert } from "./alerts";
import { cleanupExpiredObjects, storageUsage } from "./storage";

/** A single retried Workflow step: each attempt starts durably, all components are diagnosed independently. */
export async function runOperationalHealthCheck(env: Env): Promise<OperationalCheck> {
  const check: OperationalCheck = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), completedAt: null, failedAt: null, status: "running", error: null,
    components: { publication: { status: "running", reason: "check_running" }, cleanup: { status: "running", reason: "check_running" }, storage: { status: "running", reason: "check_running" } }, errors: {}, observations: {} };
  try {
    await env.DB.prepare(`INSERT INTO system_state (key,value,updated_at) VALUES ('operational_health',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
      WHERE json_extract(system_state.value,'$.startedAt')<=json_extract(excluded.value,'$.startedAt')`)
      .bind(JSON.stringify(check)).run();
    const failures: unknown[] = [];
    const diagnose = async (name: keyof OperationalCheck["components"], action: () => Promise<void>) => {
      try { await action(); }
      catch (error) { failures.push(error); check.components[name] = { status: "error", reason: `${name}_check_failed` }; check.errors[name] = error instanceof Error ? error.message : String(error); }
    };
    await diagnose("publication", async () => {
      const publication = await publicationHealth(env, new Date());
      check.components.publication = publication.component;
      check.observations.publication = { expectedDate: publication.expectedDate, currentPublicDate: publication.currentPublicDate };
      const key = `health:publication:${publication.expectedDate}`;
      if (publication.component.status === "missing") await sendOperationalAlert(env, { dedupeKey: key, managedCondition: "publication", healthCheckId: check.id, type: "missing_publication", severity: "critical", subject: `${publication.expectedDate} 尚未发布`, message: `健康检查未找到 ${publication.expectedDate} 的可见公开推荐。请检查 Daily Workflow 和候选池。` });
      // Date-specific evidence only: never claim that an earlier missing date was backfilled.
      if (publication.component.status === "ok") await resolveHealthAlert(env, "publication", key, check.id);
    });
    await diagnose("cleanup", async () => {
      const cleanup = await cleanupExpiredObjects(env, 100);
      check.observations.cleanup = cleanup;
      check.components.cleanup = { status: cleanup.failed ? "error" : "ok", reason: cleanup.failed ? "cleanup_failed" : "cleanup_completed" };
      if (cleanup.failed) {
        await sendOperationalAlert(env, { dedupeKey: "health:cleanup", managedCondition: "cleanup", healthCheckId: check.id, type: "cleanup_failed", severity: "warning", subject: "R2 生命周期清理失败", message: `${cleanup.failed} 个过期对象删除失败；已成功删除 ${cleanup.deleted} 个。` });
        throw new Error(`${cleanup.failed} expired objects could not be deleted`);
      }
      const remaining = await env.DB.prepare("SELECT count(*) count FROM stored_objects WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')").first<{ count: number }>();
      check.observations.cleanup.remaining = remaining?.count ?? 0;
      if (remaining?.count) check.components.cleanup = { status: "warning", reason: "cleanup_backlog_remaining" };
      else await resolveHealthAlert(env, "cleanup", "health:cleanup", check.id);
    });
    await diagnose("storage", async () => {
      const usage = await storageUsage(env);
      check.observations.storage = usage;
      check.components.storage = { status: usage.level, reason: `tracked_storage_${usage.level}` };
      if (usage.level !== "ok") await sendOperationalAlert(env, { dedupeKey: "health:storage", managedCondition: "storage", healthCheckId: check.id, type: "storage_pressure", severity: usage.level, subject: `R2 存储达到 ${(usage.ratio * 100).toFixed(1)}%`, message: `已跟踪 ${usage.objectCount} 个对象，占用 ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}。仅跟踪用量，不是实时 R2 可达性测试。` });
      else await resolveHealthAlert(env, "storage", "health:storage", check.id);
    });
    const finishedAt = new Date().toISOString();
    check.status = failures.length ? "failed" : "completed";
    if (failures.length) check.failedAt = finishedAt; else check.completedAt = finishedAt;
    const writes = [timestampStatement(env, failures.length ? "operational_health_failed" : "operational_health_completed", finishedAt, check.id), env.DB.prepare(`UPDATE system_state SET value=?,updated_at=CURRENT_TIMESTAMP
      WHERE key='operational_health' AND json_extract(value,'$.id')=?`).bind(JSON.stringify(check), check.id)];
    if (!failures.length && Object.values(check.components).every((component) => component.status === "ok")) {
      writes.push(timestampStatement(env, "operational_health_success", finishedAt, check.id));
    }
    await env.DB.batch(writes);
    if (failures.length) throw failures[0]; // Workflow retries; a failed cleanup cannot suppress publication diagnosis.
    return check;
  } catch (error) {
    check.status = "failed"; check.completedAt = null; check.failedAt = new Date().toISOString();
    check.error = error instanceof Error ? error.message : String(error);
    try {
      await env.DB.batch([env.DB.prepare(`INSERT INTO system_state (key,value,updated_at) VALUES ('operational_health',?,CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
        WHERE json_extract(system_state.value,'$.id')=? OR json_extract(system_state.value,'$.startedAt')<json_extract(excluded.value,'$.startedAt')`)
        .bind(JSON.stringify(check), check.id), timestampStatement(env, "operational_health_failed", check.failedAt, check.id)]);
    } catch { console.error(JSON.stringify({ event: "health_failure_record_unavailable", checkId: check.id })); }
    throw error;
  }
}
function timestampStatement(env: Env, key: string, timestamp: string, healthCheckId: string) {
  return env.DB.prepare(`INSERT INTO system_state (key,value,updated_at)
    SELECT ?,?,CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM system_state WHERE key='operational_health' AND json_extract(value,'$.id')=?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP WHERE system_state.value<excluded.value`).bind(key, timestamp, healthCheckId);
}
function formatBytes(value: number): string { return `${(value / 1024 / 1024).toFixed(1)} MiB`; }

interface BackfillMonitorState { ready: number; failed: number; checkedAt: string; lastProgressAt: string; lastAnalysisAt?: string | null; }

export interface AnalysisHealthWindow { failed24h: number; processed24h: number; analyses48h: number; pending: number; }
export interface AnalysisHealthVerdict { failureRateAlert: boolean; stallAlert: boolean; }

/** Recent-window analysis health. The all-time failure ratio dilutes sustained outages (a few days of
 * 100% failures stay under a cumulative 10% threshold), and reservoir-target suppression hides a dead
 * pipeline while the pool is above target — both blind spots from the 2026-09 AI outage. */
export function evaluateAnalysisHealth(input: AnalysisHealthWindow): AnalysisHealthVerdict {
  const failureRateAlert = input.processed24h >= 5 && input.failed24h / input.processed24h >= 0.5;
  const stallAlert = input.analyses48h === 0 && (input.pending > 0 || input.failed24h > 0);
  return { failureRateAlert, stallAlert };
}

export async function runBackfillHealthCheck(env: Env): Promise<BackfillMonitorState> {
  const now = new Date();
  await env.DB.prepare("UPDATE sources SET backfill_locked_until=NULL WHERE backfill_locked_until IS NOT NULL AND datetime(backfill_locked_until) <= datetime('now')").run();
  const cleanup = await cleanupExpiredObjects(env, 25);
  if (cleanup.failed) await sendOperationalAlert(env, { dedupeKey: `backfill-cleanup-failed:${now.toISOString().slice(0, 10)}`, type: "cleanup_failed", severity: "warning", subject: "回填期间 R2 生命周期清理失败", message: `${cleanup.failed} 个过期对象删除失败；已成功删除 ${cleanup.deleted} 个。` });
  const [counts, previousRow, reservoirRow] = await Promise.all([
    env.DB.prepare(`SELECT sum(CASE WHEN status='ready' THEN 1 ELSE 0 END) ready,sum(CASE WHEN status='analysis_failed' THEN 1 ELSE 0 END) failed,sum(CASE WHEN status IN ('ready','rejected','analysis_failed') THEN 1 ELSE 0 END) processed FROM articles`).first<{ ready: number; failed: number; processed: number }>(),
    env.DB.prepare("SELECT value FROM system_state WHERE key='backfill_monitor'").first<{ value: string }>(),
    env.DB.prepare("SELECT updated_at FROM system_state WHERE key='reservoir_status'").first<{ updated_at: string }>(),
  ]);
  const previous = parseMonitor(previousRow?.value);
  const state = nextBackfillMonitorState(previous, counts?.ready ?? 0, counts?.failed ?? 0, now);
  const [windowCounts, analysisWindow, pendingRow] = await Promise.all([
    env.DB.prepare(`SELECT sum(CASE WHEN status='analysis_failed' THEN 1 ELSE 0 END) failed24h, sum(CASE WHEN status IN ('ready','rejected','analysis_failed') THEN 1 ELSE 0 END) processed24h FROM articles WHERE datetime(updated_at) >= datetime('now','-24 hours')`).first<{ failed24h: number | null; processed24h: number | null }>(),
    env.DB.prepare("SELECT count(*) n, max(created_at) latest FROM analyses WHERE datetime(created_at) >= datetime('now','-48 hours')").first<{ n: number; latest: string | null }>(),
    env.DB.prepare("SELECT count(*) n FROM articles WHERE status IN ('discovered','analysis_failed')").first<{ n: number }>(),
  ]);
  const analysisWindowInput: AnalysisHealthWindow = { failed24h: windowCounts?.failed24h ?? 0, processed24h: windowCounts?.processed24h ?? 0, analyses48h: analysisWindow?.n ?? 0, pending: pendingRow?.n ?? 0 };
  const verdict = evaluateAnalysisHealth(analysisWindowInput);
  const day = now.toISOString().slice(0, 10);
  // Windowed checks are independent of the reservoir target: a full pool must not hide a dead analysis pipeline.
  if (verdict.failureRateAlert) {
    await sendOperationalAlert(env, { dedupeKey: `analysis-failure-window:${day}`, type: "analysis_failure_window", severity: "warning", subject: "近24小时文章分析失败率超过50%", message: `近24小时已处理 ${analysisWindowInput.processed24h} 篇，其中 ${analysisWindowInput.failed24h} 篇失败。请检查中转站 5xx/429 与结构化输出。` });
  }
  if (verdict.stallAlert) {
    await sendOperationalAlert(env, { dedupeKey: `analysis-stalled:${day}`, type: "analysis_stalled", severity: "critical", subject: "分析管线近48小时零产出", message: `近48小时没有成功分析，但仍有 ${analysisWindowInput.pending} 篇待处理（discovered/analysis_failed）。候选池停止补充，请立即检查 AI 依赖。` });
  }
  const target = Number(env.RESERVOIR_TARGET);
  if (state.ready < target) {
    const reservoirUpdatedAt = parseSqliteDate(reservoirRow?.updated_at);
    if (!reservoirUpdatedAt || now.getTime() - reservoirUpdatedAt.getTime() > 2 * 60 * 60 * 1_000) {
      await sendOperationalAlert(env, { dedupeKey: `reservoir-stale:${now.toISOString().slice(0, 13)}`, type: "reservoir_stale", severity: "critical", subject: "Reservoir 超过两小时没有运行记录", message: `当前候选 ${state.ready}/${target}。请检查小时 Cron、Reservoir Workflow 和 Backfill Workflow。` });
    }
    if (now.getTime() - new Date(state.lastProgressAt).getTime() > 6 * 60 * 60 * 1_000) {
      await sendOperationalAlert(env, { dedupeKey: `backfill-stalled:${now.toISOString().slice(0, 10)}`, type: "backfill_stalled", severity: "warning", subject: "候选池连续六小时没有增长", message: `当前候选 ${state.ready}/${target}，analysis_failed=${state.failed}。协调器会继续运行，但需要检查来源耗尽、质量通过率或 AI 错误。` });
    }
  }
  const processed = counts?.processed ?? 0;
  if (state.failed >= 10 && processed > 0 && state.failed / processed >= .1) {
    await sendOperationalAlert(env, { dedupeKey: `analysis-failure-rate:${now.toISOString().slice(0, 10)}`, type: "analysis_failure_rate", severity: "warning", subject: "文章分析失败率超过 10%", message: `已处理 ${processed} 篇，其中 ${state.failed} 篇 analysis_failed。请检查中转站 5xx、超时与结构化输出。` });
  }
  await env.DB.prepare("INSERT INTO system_state (key,value,updated_at) VALUES ('backfill_monitor',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP")
    .bind(JSON.stringify({ ...state, lastAnalysisAt: analysisWindow?.latest ?? null })).run();
  return state;
}

export function nextBackfillMonitorState(previous: BackfillMonitorState | undefined, ready: number, failed: number, now: Date): BackfillMonitorState {
  const checkedAt = now.toISOString();
  return { ready, failed, checkedAt, lastProgressAt: !previous || ready > previous.ready ? checkedAt : previous.lastProgressAt };
}
function parseMonitor(value: string | undefined): BackfillMonitorState | undefined { if (!value) return undefined; try { return JSON.parse(value) as BackfillMonitorState; } catch { return undefined; } }
function parseSqliteDate(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`); return Number.isNaN(date.getTime()) ? undefined : date; }
