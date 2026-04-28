export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getStartOfLocalDay(date: Date = new Date()): Date {
  const localDay = new Date(date);
  localDay.setHours(0, 0, 0, 0);
  return localDay;
}

export function getStartOfLocalWeek(date: Date = new Date()): Date {
  const localWeek = getStartOfLocalDay(date);
  const day = localWeek.getDay();
  const diff = localWeek.getDate() - day + (day === 0 ? -6 : 1);
  localWeek.setDate(diff);
  localWeek.setHours(0, 0, 0, 0);
  return localWeek;
}

export function toLocalIsoTimestamp(date: Date): string {
  const local = new Date(date);
  const offsetMs = local.getTimezoneOffset() * 60_000;
  return new Date(local.getTime() - offsetMs).toISOString().slice(0, 19);
}
