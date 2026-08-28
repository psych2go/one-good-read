/**
 * Returns a bounded set of archive pages for a source whose persisted value is
 * the deepest page reached. Page 1 is always refreshed for new posts; the
 * remaining slots form an overlapping window at the historical frontier.
 */
export function discoveryPageWindow(depth: number, maxRequests = 5): number[] {
  const safeDepth = Math.max(1, Math.floor(depth));
  const safeMax = Math.max(1, Math.floor(maxRequests));
  if (safeDepth <= safeMax) return Array.from({ length: safeDepth }, (_, index) => index + 1);
  if (safeMax === 1) return [1];
  const start = safeDepth - (safeMax - 2);
  return [1, ...Array.from({ length: safeMax - 1 }, (_, index) => start + index)];
}
