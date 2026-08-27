import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { nextHistoryPages, selectReservoirSources } from "../domain/reservoir";
import { runBackfillHealthCheck } from "../operations/health";

export interface ReservoirWorkflowParams { target?: number; batchSize?: number; sourcesPerRun?: number; monitor?: boolean; }
interface SourceBackfillRow { id: string; history_pages: number; pending: number; ready: number; rejected: number; last_scanned_at: string | null; }
interface ReservoirPlan { readyTotal: number; target: number; selected: Array<{ sourceId: string; pages: number; limit: number }>; }

export class ReservoirWorkflow extends WorkflowEntrypoint<Env, ReservoirWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<ReservoirWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    if (event.payload.monitor) return step.do("backfill-health-monitor", async () => runBackfillHealthCheck(this.env));
    await step.do("backfill-health-monitor", async () => runBackfillHealthCheck(this.env));
    const target = Math.max(1, event.payload.target ?? Number(this.env.RESERVOIR_TARGET));
    const batchSize = Math.max(1, Math.min(event.payload.batchSize ?? Number(this.env.RESERVOIR_BATCH_SIZE), 5));
    const sourcesPerRun = Math.max(1, Math.min(event.payload.sourcesPerRun ?? Number(this.env.RESERVOIR_SOURCES_PER_RUN), 8));
    const plan = await step.do("plan-reservoir-batch", async () => this.plan(target, batchSize, sourcesPerRun));
    if (!plan.selected.length) return { ...plan, instances: [], message: plan.readyTotal >= target ? "target_reached" : "no_available_sources" };
    const instances = await this.env.BACKFILL_WORKFLOW.createBatch(plan.selected.map((source) => ({
      id: `reservoir-${source.sourceId}-${crypto.randomUUID()}`,
      params: { sourceId: source.sourceId, limit: source.limit, pages: source.pages, managed: true },
      retention: { successRetention: "3 days", errorRetention: "3 days" },
    })));
    const result = { ...plan, instances: instances.map((instance) => instance.id), createdAt: new Date().toISOString() };
    await step.do("record-reservoir-batch", async () => {
      await this.env.DB.prepare("INSERT INTO system_state (key,value,updated_at) VALUES ('reservoir_status',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP")
        .bind(JSON.stringify(result)).run();
      return { recorded: true };
    });
    return result;
  }

  private async plan(target: number, batchSize: number, sourcesPerRun: number): Promise<ReservoirPlan> {
    const total = await this.env.DB.prepare("SELECT count(*) count FROM articles WHERE status='ready'").first<{ count: number }>();
    const readyTotal = total?.count ?? 0;
    if (readyTotal >= target) return { readyTotal, target, selected: [] };
    const rows = await this.env.DB.prepare(`
      SELECT s.id,s.history_pages,s.last_scanned_at,
        sum(CASE WHEN a.status IN ('discovered','analysis_failed') THEN 1 ELSE 0 END) pending,
        sum(CASE WHEN a.status='ready' THEN 1 ELSE 0 END) ready,
        sum(CASE WHEN a.status='rejected' THEN 1 ELSE 0 END) rejected
      FROM sources s LEFT JOIN articles a ON a.source_id=s.id
      WHERE s.status='active' AND (s.backfill_locked_until IS NULL OR datetime(s.backfill_locked_until) <= datetime('now'))
      GROUP BY s.id,s.history_pages,s.last_scanned_at
    `).all<SourceBackfillRow>();
    const chosen = selectReservoirSources(rows.results.map((row) => ({ id: row.id, pending: row.pending, ready: row.ready, rejected: row.rejected, lastScannedAt: row.last_scanned_at ?? undefined })), sourcesPerRun);
    const byId = new Map(rows.results.map((row) => [row.id, row]));
    const selected = chosen.map((choice) => { const row = byId.get(choice.id); if (!row) throw new Error(`Reservoir source ${choice.id} disappeared`); return { sourceId: row.id, pages: nextHistoryPages(row.history_pages, row.pending), limit: batchSize }; });
    if (selected.length) {
      await this.env.DB.batch(selected.map((source) => this.env.DB.prepare("UPDATE sources SET history_pages=max(history_pages,?),backfill_locked_until=datetime('now','+2 hours') WHERE id=?").bind(source.pages, source.sourceId)));
    }
    return { readyTotal, target, selected };
  }
}

