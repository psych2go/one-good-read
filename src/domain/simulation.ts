export function consecutiveDateStreak(dates: string[]): number {
  const unique = [...new Set(dates)].sort().reverse();
  if (!unique.length) return 0;
  let streak = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const newer = parseDate(unique[index - 1]);
    const older = parseDate(unique[index]);
    if (!newer || !older || newer.getTime() - older.getTime() !== 86_400_000) break;
    streak += 1;
  }
  return streak;
}
function parseDate(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? undefined : date; }
