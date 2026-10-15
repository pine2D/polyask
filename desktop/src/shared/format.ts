function calendarDate(value: number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** 同步时钟可超出日历范围；显示降级，不改变原始排序与版本。 */
export function dateTimeAttribute(value: number | Date): string | undefined {
  return calendarDate(value)?.toISOString();
}

export function formatDateTime(value: number | Date, locale: string, timeZone?: string): string {
  const date = calendarDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {})
  }).format(date);
}
