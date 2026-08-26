import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";

export interface SourceAdapter {
  readonly sourceId: SourceId;
  discover(): Promise<DiscoveredArticle[]>;
  extract(article: DiscoveredArticle): Promise<ExtractedArticle>;
}
