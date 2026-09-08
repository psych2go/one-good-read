import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { adapterIds, backfillMissingEmbeddings, ingestSource } from "./pipeline";
import { assertStorageAllowsBackfill } from "../operations/storage";
import { runOperationalHealthCheck } from "../operations/health";
import { probeProductionAi } from "../operations/ai-probe";

export interface BackfillWorkflowParams { healthCheck?: boolean; sourceId?: string; limit?: number; pages?: number; embeddingsOnly?: boolean; aiProbe?: boolean; managed?: boolean; scheduledRefresh?: boolean; }

export class BackfillWorkflow extends WorkflowEntrypoint<Env, BackfillWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<BackfillWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    if (event.payload.healthCheck) {
      if (String(this.env.AUTOMATION_ENABLED) !== "true") return { status: "disabled" };
      return step.do("operational-health-check", { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
        if (String(this.env.AUTOMATION_ENABLED) !== "true") return { status: "disabled" };
        return runOperationalHealthCheck(this.env);
      });
    }
    if (event.payload.scheduledRefresh && String(this.env.BACKFILL_ENABLED) !== "true") return { status: "disabled" };
    if (event.payload.aiProbe) return step.do("production-ai-probe", { timeout: "5 minutes" }, async () => probeProductionAi(this.env));
    await step.do("storage-safety-check", async () => assertStorageAllowsBackfill(this.env));
    if (event.payload.embeddingsOnly) return step.do("backfill-embeddings", { retries: { limit: 2, delay: "10 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => backfillMissingEmbeddings(this.env, Math.min(event.payload.limit ?? 10, 20)));
    const ids = event.payload.sourceId ? [event.payload.sourceId] : await step.do("active-sources", async () => {
      const rows = await this.env.DB.prepare("SELECT id FROM sources WHERE status='active' ORDER BY id").all<{ id: string }>();
      return rows.results.map((row) => row.id).filter((id) => adapterIds().includes(id));
    });
    const results = [];
    for (const sourceId of ids) {
      try {
        results.push(await step.do(`backfill-${sourceId}`, { retries: { limit: event.payload.scheduledRefresh ? 0 : 2, delay: "30 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => {
          // Recheck pause state at execution, including managed/manual source-specific runs.
          const source = await this.env.DB.prepare("SELECT status FROM sources WHERE id=?").bind(sourceId).first<{ status: string }>();
          if (source?.status !== "active") return { sourceId, status: "paused" };
          return ingestSource(this.env, sourceId, Math.min(event.payload.limit ?? 25, 50), Math.min(event.payload.pages ?? 1, 100), event.payload.scheduledRefresh);
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ event: "backfill_source_failed", sourceId, message }));
        results.push({ sourceId, error: message });
      } finally {
        if (event.payload.managed) await step.do(`unlock-${sourceId}`, async () => { await this.env.DB.prepare("UPDATE sources SET backfill_locked_until=NULL WHERE id=?").bind(sourceId).run(); return { unlocked: true }; });
      }
    }
    if (event.payload.sourceId) return { sources: results };
    const embeddings = await step.do("backfill-embeddings", { retries: { limit: 2, delay: "10 minutes", backoff: "exponential" }, timeout: "4 hours" }, async () => backfillMissingEmbeddings(this.env, 5));
    return { sources: results, embeddings };
  }
}
