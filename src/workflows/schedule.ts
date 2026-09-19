import { reservoirInstanceId } from "../domain/cron";
import { shanghaiDate } from "../domain/date";
import { launchWorkflow } from "./launch";
import { adapterIds } from "./pipeline";

export function scheduleWorkflows(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
  const retention = { successRetention: "3 days", errorRetention: "3 days" } as const;
  if (["15 * * * *", "45 * * * *"].includes(controller.cron)) {
    if (String(env.BACKFILL_ENABLED) === "true") ctx.waitUntil(launchWorkflow(env.RESERVOIR_WORKFLOW, { id: reservoirInstanceId(controller.scheduledTime), params: {}, retention }));
    return;
  }
  if (controller.cron === "30 22 * * *") {
    if (String(env.AUTOMATION_ENABLED) === "true") ctx.waitUntil(launchWorkflow(env.BACKFILL_WORKFLOW, { id: `health-${shanghaiDate(new Date(controller.scheduledTime))}`, params: { healthCheck: true }, retention }));
    return;
  }
  if (controller.cron !== "30 16 * * *") return;
  const date = shanghaiDate(new Date(controller.scheduledTime));
  // Independent waitUntil tasks: neither workflow creation nor replenishment is a publication prerequisite.
  if (String(env.AUTOMATION_ENABLED) === "true") {
    ctx.waitUntil(launchWorkflow(env.DAILY_WORKFLOW, { id: `daily-${date}`, params: { date, scan: false, deferPublication: true }, retention }));
  } else if (String(env.SIMULATION_ENABLED) === "true") {
    ctx.waitUntil(launchWorkflow(env.SIMULATION_WORKFLOW, { id: `simulation-${date}`, params: { date, deferSelection: true }, retention: { successRetention: "10 days", errorRetention: "10 days" } }));
  }
  // Runs above the reservoir target too, so a full historical pool does not suppress fresh discovery.
  // Each source gets its own instance: a single serial instance exhausted its subrequest budget partway
  // through the source list and silently skipped the remaining sources every day (observed 2026-09).
  if (String(env.BACKFILL_ENABLED) === "true") {
    ctx.waitUntil((async () => {
      try {
        const rows = await env.DB.prepare("SELECT id FROM sources WHERE status='active' ORDER BY id").all<{ id: string }>();
        const ids = rows.results.map((row) => row.id).filter((id) => adapterIds().includes(id));
        const failures: string[] = [];
        for (const sourceId of ids) {
          try {
            await launchWorkflow(env.BACKFILL_WORKFLOW, { id: `refresh-${date}-${sourceId}`, params: { sourceId, limit: 5, pages: 1, scheduledRefresh: true }, retention });
          } catch (error) {
            failures.push(`${sourceId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        try {
          await launchWorkflow(env.BACKFILL_WORKFLOW, { id: `refresh-${date}-embeddings`, params: { embeddingsOnly: true, limit: 10 }, retention });
        } catch (error) {
          failures.push(`embeddings: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (failures.length) console.error(JSON.stringify({ event: "scheduled_refresh_launch_failed", date, failures }));
      } catch (error) {
        console.error(JSON.stringify({ event: "scheduled_refresh_sources_unavailable", date, message: error instanceof Error ? error.message : String(error) }));
      }
    })());
  }
}
