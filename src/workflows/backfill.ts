import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { adapterIds, backfillMissingEmbeddings, ingestSource } from "./pipeline";
import { assertStorageAllowsBackfill } from "../operations/storage";
import { probeProductionAi } from "../operations/ai-probe";

export interface BackfillWorkflowParams { sourceId?: string; limit?: number; pages?: number; embeddingsOnly?: boolean; aiProbe?: boolean; }

export class BackfillWorkflow extends WorkflowEntrypoint<Env, BackfillWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<BackfillWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    if (event.payload.aiProbe) return step.do("production-ai-probe", { timeout: "5 minutes" }, async () => probeProductionAi(this.env));
    await step.do("storage-safety-check", async () => assertStorageAllowsBackfill(this.env));
    if (event.payload.embeddingsOnly) return step.do("backfill-embeddings", { retries: { limit: 2, delay: "10 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => backfillMissingEmbeddings(this.env, Math.min(event.payload.limit ?? 10, 20)));
    const ids = event.payload.sourceId ? [event.payload.sourceId] : adapterIds();
    const results = [];
    for (const sourceId of ids) {
      results.push(await step.do(`backfill-${sourceId}`, { retries: { limit: 2, delay: "30 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => ingestSource(this.env, sourceId, Math.min(event.payload.limit ?? 25, 50), Math.min(event.payload.pages ?? 1, 100))));
    }
    return results;
  }
}
