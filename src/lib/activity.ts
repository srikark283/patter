import type { TranscriptionRecord } from "../types";

export function dailyActivity(history: TranscriptionRecord[], days: 7 | 30, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - days + index + 1);
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    const words = history.reduce((sum, record) => record.timestamp_ms >= date.getTime() && record.timestamp_ms < next.getTime() ? sum + record.words : sum, 0);
    return {
      dateStr: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      fullDate: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      words,
    };
  });
}
