import type { SourceAdapter } from "./adapter";
import { HowardMarksAdapter } from "./howard-marks";
import { CollabFundAdapter, COLLAB_FUND_CONFIGS } from "./collab-fund";
import { MarginalRevolutionAdapter } from "./marginal-revolution";
import { PaulGrahamAdapter } from "./paul-graham";
import { RssSourceAdapter } from "./rss";
import { RSS_SOURCE_CONFIGS } from "./rss-config";
import { SubstackArchiveAdapter, SUBSTACK_CONFIGS } from "./substack";

export function sourceAdapters(): SourceAdapter[] {
  return [new PaulGrahamAdapter(), new MarginalRevolutionAdapter(), new HowardMarksAdapter(), ...RSS_SOURCE_CONFIGS.map((config) => new RssSourceAdapter(config)), ...COLLAB_FUND_CONFIGS.map((config) => new CollabFundAdapter(config)), ...SUBSTACK_CONFIGS.map((config) => new SubstackArchiveAdapter(config))];
}

export function sourceAdapter(id: string): SourceAdapter {
  const adapter = sourceAdapters().find((item) => item.sourceId === id);
  if (!adapter) throw new Error(`Unknown source adapter: ${id}`);
  return adapter;
}
