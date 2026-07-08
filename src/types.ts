export interface AppStats {
  total_words: number;
  time_saved_seconds: number;
  transcriptions_count: number;
}

export interface TranscriptionRecord {
  id: string;
  timestamp_ms: number;
  text: string;
  duration_seconds: number;
  words: number;
}
