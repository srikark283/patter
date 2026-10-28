import type { TranscriptionRecord } from "../types";

export const needsRecovery = (record: TranscriptionRecord) => !record.recovery_dismissed && (record.output_status === "failed" || record.output_status === "copied");

export function filterTranscripts(history: TranscriptionRecord[], options: { query: string; app: string | null; favorites: boolean; recovery: boolean; from: string; through: string }) {
  const query = options.query.trim().toLowerCase();
  const from = options.from ? new Date(`${options.from}T00:00:00`).getTime() : -Infinity;
  const through = options.through ? new Date(`${options.through}T00:00:00`) : null;
  through?.setDate(through.getDate() + 1);
  const until = through?.getTime() ?? Infinity;
  return history.filter(record => (!query || record.text.toLowerCase().includes(query))
    && (!options.app || record.app_name === options.app)
    && (!options.favorites || record.favorite)
    && (!options.recovery || needsRecovery(record))
    && record.timestamp_ms >= from && record.timestamp_ms < until);
}
