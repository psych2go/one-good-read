export function shanghaiDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function formatPublicDate(value: string): { month: string; day: string; year: string; weekday: string } {
  const date = new Date(`${value}T12:00:00+08:00`);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "Asia/Shanghai" }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit", timeZone: "Asia/Shanghai" }).format(date),
    year: new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Shanghai" }).format(date),
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Asia/Shanghai" }).format(date).toUpperCase(),
  };
}
