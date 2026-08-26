export const PROJECTION_DIMENSIONS = 64;

export function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return values.map(() => 0);
  return values.map((value) => value / norm);
}

export function cosineSimilarity(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function projectVector(values: number[], dimensions = PROJECTION_DIMENSIONS): number[] {
  const projected = Array.from({ length: dimensions }, () => 0);
  for (let index = 0; index < values.length; index += 1) {
    const bucket = hashInt(index) % dimensions;
    const sign = (hashInt(index + 17_171) & 1) === 0 ? 1 : -1;
    projected[bucket] = (projected[bucket] ?? 0) + (values[index] ?? 0) * sign;
  }
  return normalizeVector(projected);
}

function hashInt(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
