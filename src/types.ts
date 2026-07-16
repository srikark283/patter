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
  transcribe_ms: number;
  app_name?: string | null;
}

export interface MeetingRecord {
  id: string;
  timestamp_ms: number;
  title: string;
  duration_seconds: number;
  transcript: string;
  summary: string;
  minutes: string[];
  decisions: string[];
  action_items: string[];
}
