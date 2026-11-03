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

/** 列表先帮助辨认记录；完整时间由详情或提示提供。 */
export function formatListDate(value: number | Date, locale: string, now = Date.now()): string {
  const date = calendarDate(value), today = calendarDate(now);
  if (!date || !today) return '—';
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
}
