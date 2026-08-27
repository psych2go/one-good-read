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
