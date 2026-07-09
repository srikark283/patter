import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppStats, TranscriptionRecord } from "../types";

export function getStats() {
  return invoke<AppStats>("get_stats");
}

export function getHistory() {
  return invoke<TranscriptionRecord[]>("get_history");
}

export function clearHistory() {
  return invoke<void>("clear_history");
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

export function setOutputMode(mode: string) {
  return invoke<void>("set_output_mode", { mode });
}

export function setCustomPrompt(prompt: string) {
  return invoke<void>("set_custom_prompt", { prompt });
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
