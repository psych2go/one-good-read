import { shanghaiDate } from "../domain/date";
import { sendOperationalAlert } from "./alerts";
import { cleanupExpiredObjects, storageUsage } from "./storage";

export async function runOperationalHealthCheck(env: Env): Promise<void> {
  const date = shanghaiDate();
  const recommendation = await env.DB.prepare("SELECT id FROM recommendations WHERE recommendation_date=? AND status='published' AND datetime(published_at) <= datetime('now')").bind(date).first<{ id: string }>();
  if (!recommendation) await sendOperationalAlert(env, { dedupeKey: `missing-publication:${date}`, type: "missing_publication", severity: "critical", subject: `${date} 尚未发布`, message: `北京时间 06:30 健康检查时仍未找到 ${date} 的公开推荐。请检查 Daily Workflow、候选池和 AI 服务。` });
  const cleanup = await cleanupExpiredObjects(env, 100);
  if (cleanup.failed) await sendOperationalAlert(env, { dedupeKey: `cleanup-failed:${date}`, type: "cleanup_failed", severity: "warning", subject: "R2 生命周期清理失败", message: `${cleanup.failed} 个过期对象删除失败；已成功删除 ${cleanup.deleted} 个。` });
  const usage = await storageUsage(env);
  if (usage.level !== "ok") await sendOperationalAlert(env, { dedupeKey: `storage-${usage.level}:${date}`, type: "storage_pressure", severity: usage.level, subject: `R2 存储达到 ${(usage.ratio * 100).toFixed(1)}%`, message: `已跟踪 ${usage.objectCount} 个对象，占用 ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}。${usage.level === "critical" ? "历史回填已暂停。" : "请关注增长速度。"}` });
}
function formatBytes(value: number): string { return `${(value / 1024 / 1024).toFixed(1)} MiB`; }

interface BackfillMonitorState { ready: number; failed: number; checkedAt: string; lastProgressAt: string; }

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
    .bind(JSON.stringify(state)).run();
  return state;
}

export function nextBackfillMonitorState(previous: BackfillMonitorState | undefined, ready: number, failed: number, now: Date): BackfillMonitorState {
  const checkedAt = now.toISOString();
  return { ready, failed, checkedAt, lastProgressAt: !previous || ready > previous.ready ? checkedAt : previous.lastProgressAt };
}
function parseMonitor(value: string | undefined): BackfillMonitorState | undefined { if (!value) return undefined; try { return JSON.parse(value) as BackfillMonitorState; } catch { return undefined; } }
function parseSqliteDate(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`); return Number.isNaN(date.getTime()) ? undefined : date; }
