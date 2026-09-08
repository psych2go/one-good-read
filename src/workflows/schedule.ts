import { reservoirInstanceId } from "../domain/cron";
import { shanghaiDate } from "../domain/date";
import { launchWorkflow } from "./launch";

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
  if (String(env.BACKFILL_ENABLED) === "true") ctx.waitUntil(launchWorkflow(env.BACKFILL_WORKFLOW, { id: `refresh-${date}`, params: { limit: 5, pages: 1, scheduledRefresh: true }, retention }));
}
