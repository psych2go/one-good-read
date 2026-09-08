import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runDailySelection } from "./pipeline";

/** scan is retained for old/manual callers, but replenishment is always independent. */
export interface DailyWorkflowParams { date: string; scan?: boolean; deferPublication?: boolean; }

export class DailyReadingWorkflow extends WorkflowEntrypoint<Env, DailyWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<DailyWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    if (String(this.env.AUTOMATION_ENABLED) !== "true") return { status: "disabled" };
    let publishAt: string | undefined;
    if (event.payload.deferPublication) {
      const selectionTime = new Date(`${event.payload.date}T05:30:00+08:00`);
      if (selectionTime.getTime() > Date.now()) await step.sleepUntil("wait-for-selection-window", selectionTime);
      publishAt = new Date(`${event.payload.date}T06:00:00+08:00`).toISOString();
    }
    const selection = await step.do("select-and-publish", { retries: { limit: 2, delay: "15 minutes", backoff: "exponential" }, timeout: "1 hour" }, async () => runDailySelection(this.env, event.payload.date, publishAt));
    return { selection };
  }
}
