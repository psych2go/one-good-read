export interface ReservoirSourceCandidate {
  id: string;
  pending: number;
  ready: number;
  rejected: number;
  lastScannedAt?: string;
}

export function nextHistoryPages(currentPages: number, pending: number): number { return pending < 10 ? Math.min(currentPages + 2, 100) : currentPages; }

export function selectReservoirSources(candidates: ReservoirSourceCandidate[], count: number, now = new Date()): ReservoirSourceCandidate[] {
  if (count <= 0) return [];
  const available = candidates.filter((candidate) => candidate.pending > 0);
  const exploitCount = Math.max(1, count - 1);
  const byYield = [...available].sort((left, right) => reservoirScore(right, now) - reservoirScore(left, now) || left.id.localeCompare(right.id));
  const selected = byYield.slice(0, exploitCount);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));

  // Exploration must consider every unselected source, including a source whose
  // current discovery window is empty. Selecting it increases history_pages;
  // excluding it here would permanently freeze its historical depth while a
  // large queue from another source remains.
  const explorationPool = candidates
    .filter((candidate) => !selectedIds.has(candidate.id))
    .sort((left, right) => scannedTime(left.lastScannedAt) - scannedTime(right.lastScannedAt) || left.id.localeCompare(right.id));
  if (selected.length < count && explorationPool[0]) {
    selected.push(explorationPool[0]);
    selectedIds.add(explorationPool[0].id);
  }
  for (const candidate of byYield) {
    if (selected.length >= count) break;
    if (!selectedIds.has(candidate.id)) { selected.push(candidate); selectedIds.add(candidate.id); }
  }
  for (const candidate of explorationPool) {
    if (selected.length >= count) break;
    if (!selectedIds.has(candidate.id)) { selected.push(candidate); selectedIds.add(candidate.id); }
  }
  return selected.slice(0, count);
}

export function smoothedAcceptance(candidate: Pick<ReservoirSourceCandidate, "ready" | "rejected">): number {
  return (candidate.ready + 1) / (candidate.ready + candidate.rejected + 2);
}

function reservoirScore(candidate: ReservoirSourceCandidate, now: Date): number {
  const recencyHours = candidate.lastScannedAt ? Math.max(0, (now.getTime() - new Date(candidate.lastScannedAt).getTime()) / 3_600_000) : 72;
  return smoothedAcceptance(candidate) + Math.min(72, recencyHours) / 72 * .08;
}
function scannedTime(value: string | undefined): number { if (!value) return 0; const time = new Date(value).getTime(); return Number.isNaN(time) ? 0 : time; }
