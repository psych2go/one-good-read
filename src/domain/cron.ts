/**
 * Builds an idempotency key for a scheduled Reservoir run.
 *
 * The configured cron schedule runs twice per hour, so the minute must be
 * included. Using only the hour would cause the :45 run to collide with the
 * already-completed :15 instance and silently skip half of the backfill work.
 */
export function reservoirInstanceId(scheduledTime: number): string {
  const timestamp = new Date(scheduledTime);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Invalid scheduled time");
  const minute = timestamp.toISOString().slice(0, 16).replace(/[-T:]/g, "");
  return `reservoir-${minute}`;
}
