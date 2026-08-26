import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { adapterIds, ingestSource } from "./pipeline";

export interface BackfillWorkflowParams { sourceId?: string; limit?: number; }

export class BackfillWorkflow extends WorkflowEntrypoint<Env, BackfillWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<BackfillWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    const ids = event.payload.sourceId ? [event.payload.sourceId] : adapterIds();
    const results = [];
    for (const sourceId of ids) {
      results.push(await step.do(`backfill-${sourceId}`, { retries: { limit: 2, delay: "30 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => ingestSource(this.env, sourceId, Math.min(event.payload.limit ?? 25, 50))));
    }
    return results;
  }
}
