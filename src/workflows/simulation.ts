import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runDailySimulation } from "./pipeline";

export interface SimulationWorkflowParams { date: string; deferSelection?: boolean; }

export class SimulationWorkflow extends WorkflowEntrypoint<Env, SimulationWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<SimulationWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    const gate = await step.do("simulation-gate", async () => {
      const row = await this.env.DB.prepare("SELECT count(*) count FROM articles WHERE status='ready'").first<{ count: number }>();
      const ready = row?.count ?? 0;
      return { ready, target: Number(this.env.RESERVOIR_TARGET), enabled: String(this.env.SIMULATION_ENABLED) === "true" };
    });
    if (!gate.enabled || gate.ready < gate.target) return { status: "skipped", ...gate };
    if (event.payload.deferSelection !== false) {
      const selectionTime = new Date(`${event.payload.date}T05:30:00+08:00`);
      if (selectionTime.getTime() > Date.now()) await step.sleepUntil("wait-for-simulation-window", selectionTime);
    }
    return step.do("simulate-selection", { retries: { limit: 2, delay: "15 minutes", backoff: "exponential" }, timeout: "1 hour" }, async () => runDailySimulation(this.env, event.payload.date));
  }
}
