const KOREA_OFFSET = 9 * 60 * 60 * 1000;

export function isZonedIso(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return false;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return false;
  const calendarDay = new Date(match[1] + "T00:00:00Z");
  return Number.isFinite(calendarDay.getTime()) && calendarDay.toISOString().slice(0, 10) === match[1];
}

export function toKoreaLocal(value: string): string {
  if (!isZonedIso(value)) return "";
  return new Date(Date.parse(value) + KOREA_OFFSET).toISOString().slice(0, 16);
}

export function fromKoreaLocal(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const iso = value + ":00+09:00";
  return toKoreaLocal(iso) === value ? iso : "";
}

export function formatKoreaTime(value: string): string {
  return toKoreaLocal(value).replace("T", " ") || "시각 확인 필요";
}
