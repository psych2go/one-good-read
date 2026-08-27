export function nextHistoryPages(currentPages: number, pending: number): number { return pending < 10 ? Math.min(currentPages + 2, 100) : currentPages; }
