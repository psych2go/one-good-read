import type { DiscoveredArticle, ExtractedArticle, SourceId } from "../domain/types";

export interface DiscoveryOptions { pages?: number; }

export interface SourceAdapter {
  readonly sourceId: SourceId;
  readonly supportsDeferredExtraction?: boolean;
  discover(options?: DiscoveryOptions): Promise<DiscoveredArticle[]>;
  extract(article: DiscoveredArticle): Promise<ExtractedArticle>;
}

export class PermanentArticleError extends Error {
  constructor(message: string) { super(message); this.name = "PermanentArticleError"; }
}
