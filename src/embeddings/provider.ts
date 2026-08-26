export interface EmbeddingResult {
  provider: string;
  model: string;
  dimensions: number;
  values: number[];
}

export interface EmbeddingProvider {
  embed(title: string, text: string): Promise<EmbeddingResult>;
}
