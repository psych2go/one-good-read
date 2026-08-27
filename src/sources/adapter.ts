import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";

export interface DiscoveryOptions { pages?: number; }

export interface SourceAdapter {
  readonly sourceId: SourceId;
  discover(options?: DiscoveryOptions): Promise<DiscoveredArticle[]>;
  extract(article: DiscoveredArticle): Promise<ExtractedArticle>;
}
