import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppStats, TranscriptionRecord, MeetingRecord } from "../types";

export interface AppProfile {
  app: string;
  prompt: string;
}

export interface Settings {
  hotkey: string;
  microphone: string | null;
  output_mode: string;
  custom_prompt: string;
  autostart: boolean;
  language: string;
  silence_timeout_ms: number;
  llm_cleanup_enabled: boolean;
  ollama_model: string | null;
  meeting_ollama_model: string | null;
  trim_silence: boolean;
  hud_position: string;
  play_sounds: boolean;
  onboarding_done: boolean;
  push_to_talk: boolean;
  diarize_meetings: boolean;
  app_profiles: AppProfile[];
}

export function getStats() {
  return invoke<AppStats>("get_stats");
}

export function getHistory() {
  return invoke<TranscriptionRecord[]>("get_history");
}

export async function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export async function deleteHistoryRecord(id: string): Promise<boolean> {
  return invoke("delete_history_record", { id });
}

export async function updateHistoryRecord(id: string, text: string): Promise<boolean> {
  return invoke("update_history_record", { id, text });
}

export function isRecording() {
  return invoke<boolean>("is_recording");
}

export function downloadModel(id: string) {
  return invoke<void>("download_model", { id });
}

export function deleteModel(id: string) {
  return invoke<void>("delete_model", { id });
}

export function setEngine(id: string) {
  return invoke<void>("set_engine", { id });
}

export function getActiveEngine() {
  return invoke<string | null>("get_active_engine");
}

export function startMeetingRecording() {
  return invoke<void>("start_meeting_recording");
}

export function stopMeetingRecording() {
  return invoke<void>("stop_meeting_recording");
}

export function isMeetingRecording() {
  return invoke<boolean>("is_meeting_recording");
}

export function getMeetings() {
  return invoke<MeetingRecord[]>("get_meetings");
}

export function deleteMeeting(id: string) {
  return invoke<boolean>("delete_meeting", { id });
}

export function listOllamaModels() {
  return invoke<string[]>("list_ollama_models");
}

export function getSettings() {
  return invoke<Settings>("get_settings");
}

export function updateSettings(settings: Settings) {
  return invoke<void>("update_settings", { settings });
}

export function getMicrophones() {
  return invoke<string[]>("get_microphones");
}

export function onDownloadProgress(callback: (id: string, pct: number) => void) {
  return listen<{ id: string; pct: number }>("download_progress", (event) =>
    callback(event.payload.id, event.payload.pct * 100)
  );
}

export function isModelDownloaded(id: string) {
  return invoke<boolean>("is_model_downloaded", { id });
}

export function onDbUpdated(callback: () => void) {
  return listen("patter://db_updated", () => callback());
}

export function onHudState(callback: (state: string) => void) {
  return listen<string>("patter://state", (event) => callback(event.payload));
}

export function onLevels(callback: (levels: number[]) => void) {
  return listen<number[]>("levels", (event) => callback(event.payload));
}

export function cancelDictation() {
  return invoke<void>("cancel_dictation");
}

export function accessibilityTrusted() {
  return invoke<boolean>("accessibility_trusted");
}

export function openAccessibilitySettings() {
  return invoke<void>("open_accessibility_settings");
}

export function onAccessibilityMissing(callback: () => void) {
  return listen("patter://accessibility_missing", () => callback());
}
