import type { SourceAdapter } from "./adapter";
import { HowardMarksAdapter } from "./howard-marks";
import { MarginalRevolutionAdapter } from "./marginal-revolution";
import { PaulGrahamAdapter } from "./paul-graham";

export function sourceAdapters(): SourceAdapter[] {
  return [new PaulGrahamAdapter(), new MarginalRevolutionAdapter(), new HowardMarksAdapter()];
}

export function sourceAdapter(id: string): SourceAdapter {
  const adapter = sourceAdapters().find((item) => item.sourceId === id);
  if (!adapter) throw new Error(`Unknown source adapter: ${id}`);
  return adapter;
}
