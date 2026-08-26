import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { adapterIds, backfillMissingEmbeddings, ingestSource, runDailySelection } from "./pipeline";

export interface DailyWorkflowParams { date: string; scan?: boolean; deferPublication?: boolean; }

export class DailyReadingWorkflow extends WorkflowEntrypoint<Env, DailyWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<DailyWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    const summaries = [];
    if (event.payload.scan !== false) {
      for (const sourceId of adapterIds()) {
        const summary = await step.do(`scan-${sourceId}`, { retries: { limit: 2, delay: "10 minutes", backoff: "exponential" }, timeout: "2 hours" }, async () => ingestSource(this.env, sourceId, 5));
        summaries.push(summary);
      }
    }
    await step.do("backfill-embeddings", { retries: { limit: 2, delay: "10 minutes", backoff: "exponential" }, timeout: "2 hours" }, async () => backfillMissingEmbeddings(this.env, 5));
    let publishAt: string | undefined;
    if (event.payload.deferPublication) {
      const selectionTime = new Date(`${event.payload.date}T05:30:00+08:00`);
      if (selectionTime.getTime() > Date.now()) await step.sleepUntil("wait-for-selection-window", selectionTime);
      publishAt = new Date(`${event.payload.date}T06:00:00+08:00`).toISOString();
    }
    const selection = await step.do("select-and-publish", { retries: { limit: 2, delay: "15 minutes", backoff: "exponential" }, timeout: "1 hour" }, async () => runDailySelection(this.env, event.payload.date, publishAt));
    return { summaries, selection };
  }
}
