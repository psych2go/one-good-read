export interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  ratio: number;
  level: "ok" | "warning" | "critical";
  objectCount: number;
}

export async function storageUsage(env: Env): Promise<StorageUsage> {
  const row = await env.DB.prepare("SELECT coalesce(sum(size_bytes),0) used_bytes,count(*) object_count FROM stored_objects WHERE deleted_at IS NULL")
    .first<{ used_bytes: number; object_count: number }>();
  const limitBytes = Number(env.R2_STORAGE_LIMIT_BYTES);
  const usedBytes = row?.used_bytes ?? 0;
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0;
  return { usedBytes, limitBytes, ratio, level: storageLevel(ratio), objectCount: row?.object_count ?? 0 };
}

export async function assertStorageAllowsBackfill(env: Env): Promise<void> {
  const usage = await storageUsage(env);
  if (usage.level === "critical") throw new Error(`R2 tracked storage is at ${(usage.ratio * 100).toFixed(1)}%; non-essential backfill is paused`);
}

export async function cleanupExpiredObjects(env: Env, limit = 100): Promise<{ deleted: number; bytesFreed: number; failed: number }> {
  const rows = await env.DB.prepare(`SELECT object_key,article_id,size_bytes FROM stored_objects WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now') ORDER BY expires_at ASC LIMIT ?`)
    .bind(limit).all<{ object_key: string; article_id: string | null; size_bytes: number }>();
  let deleted = 0;
  let bytesFreed = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      await env.CONTENT.delete(row.object_key);
      await env.DB.batch([
        env.DB.prepare("UPDATE stored_objects SET deleted_at=CURRENT_TIMESTAMP WHERE object_key=?").bind(row.object_key),
        env.DB.prepare("UPDATE articles SET body_key=NULL WHERE id=? AND body_key=?").bind(row.article_id, row.object_key),
      ]);
      deleted += 1;
      bytesFreed += row.size_bytes;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: "r2_cleanup_failed", key: row.object_key, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { deleted, bytesFreed, failed };
}

export function storageLevel(ratio: number): "ok" | "warning" | "critical" { return ratio >= .85 ? "critical" : ratio >= .7 ? "warning" : "ok"; }
