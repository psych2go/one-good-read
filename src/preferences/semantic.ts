import { cosineSimilarity } from "../embeddings/math";

export function semanticSignals(candidate: number[] | undefined, recent: number[][]): { connectionBonus: number; explorationBonus: number; maxSimilarity: number } {
  if (!candidate || !recent.length) return { connectionBonus: 0, explorationBonus: candidate ? .2 : 0, maxSimilarity: 0 };
  const maxSimilarity = Math.max(...recent.map((vector) => cosineSimilarity(candidate, vector)));
  const connectionBonus = maxSimilarity >= .25 && maxSimilarity <= .82 ? Math.min(.35, (maxSimilarity - .25) * .65) : 0;
  const explorationBonus = maxSimilarity < .2 ? .3 : maxSimilarity < .35 ? .15 : 0;
  return { connectionBonus, explorationBonus, maxSimilarity };
}
