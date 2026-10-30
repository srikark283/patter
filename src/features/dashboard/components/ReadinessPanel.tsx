import { useEffect, useState } from "react";
import { ArrowRight, Mic, RefreshCw, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShortcutKeys } from "./ShortcutKeys";
import { CleanupSparkle } from "./CleanupSparkle";
import { builtInModelName, getSettings, getPermissionStatus, getMicrophones, getActiveEngine, getBuiltInStatus, listOllamaModels, onDbUpdated, openMicrophoneSettings, openAccessibilitySettings, openInputMonitoringSettings, type Settings, type PermissionStatus } from "@/lib/ipc";
import { MODEL_NAMES } from "../views/ModelsView";
import { toast } from "sonner";

type Snapshot = { settings: Settings; permissions: PermissionStatus; microphones: string[]; engine: string | null; cleanup: string; cleanupIssue: boolean };
interface Props {
  activity: string | null;
  listening?: boolean;
  onPreferences?: () => void;
  onModels?: () => void;
  onIntelligence?: () => void;
}

export function ReadinessPanel({ activity, listening = false, onPreferences, onModels, onIntelligence }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      setChecking(true);
      try {
        const [settings, permissions, microphones, engine] = await Promise.all([getSettings(), getPermissionStatus(), getMicrophones(), getActiveEngine()]);
        let cleanup = "Off · original wording";
        let cleanupIssue = false;
        if (settings.llm_cleanup_enabled) {
          try {
            if (settings.cleanup_provider === "built_in") {
              const status = await getBuiltInStatus(settings.built_in_model);
              cleanupIssue = !status.supported || !status.installed || !status.runtime_ready;
              cleanup = `${builtInModelName(settings.built_in_model)} ${cleanupIssue ? "needs setup" : "· available"}`;
            } else {
              const models = await listOllamaModels();
              cleanupIssue = !settings.ollama_model || !models.some(model => model === settings.ollama_model || model === `${settings.ollama_model}:latest`);
              cleanup = cleanupIssue ? "Select an available Ollama model" : `${settings.ollama_model} · available`;
            }
          } catch { cleanup = "Cleanup unavailable"; cleanupIssue = true; }
        }
        if (!disposed && current === generation) {
          setSnapshot({ settings, permissions, microphones, engine, cleanup, cleanupIssue });
          setError(false);
        }
      } catch { if (!disposed && current === generation) setError(true); }
      finally { if (!disposed && current === generation) setChecking(false); }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const unlisten = onDbUpdated(onFocus);
    return () => { disposed = true; window.removeEventListener("focus", onFocus); void unlisten.then(fn => fn()); };
  }, [revision]);

  const issues: { text: string; label: string; action?: () => void }[] = [];
  if (snapshot && !error) {
    const { settings, permissions, microphones, engine, cleanupIssue } = snapshot;
    if (!permissions.microphone) issues.push({ text: "Microphone access is needed to record.", label: "Open microphone settings", action: () => { void openMicrophoneSettings().catch(() => toast.error("Could not open microphone settings")); } });
    if (!permissions.input_monitoring) issues.push({ text: "Input Monitoring is needed for your global shortcut.", label: "Open input settings", action: () => { void openInputMonitoringSettings().catch(() => toast.error("Could not open input settings")); } });
    if (!permissions.accessibility) issues.push({ text: "Automatic output needs Accessibility. Dictation can still be copied.", label: "Open Accessibility", action: () => { void openAccessibilitySettings().catch(() => toast.error("Could not open Accessibility settings")); } });
    if (!microphones.length || (settings.microphone && !microphones.includes(settings.microphone))) issues.push({ text: "Your microphone is unavailable. Choose a connected input.", label: "Choose microphone", action: onPreferences });
    if (!engine) issues.push({ text: "Select a speech model to start dictating.", label: "Choose model", action: onModels });
    if (!settings.hotkey) issues.push({ text: "Set a shortcut to dictate from any app.", label: "Set shortcut", action: onPreferences });
    if (cleanupIssue) issues.push({ text: "Cleanup needs attention. Original transcription remains available if cleanup fails.", label: "Review cleanup", action: onIntelligence });
  }
  const title = activity ?? (checking ? "Checking dictation setup…" : error ? "Could not check dictation setup" : issues.length ? "Your setup needs attention" : "Ready to dictate");
  return <details className="group readiness-panel rounded-xl bg-card px-5 py-4 shadow-[var(--surface-shadow)]" aria-label="Dictation readiness">
    <summary aria-label={`${title}${issues.length ? `, ${issues.length} setup issues` : ""}. Setup details`} className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 text-sm [&::-webkit-details-marker]:hidden">
      <Mic size={16} className={error || issues.length ? "text-warning" : "text-accent-foreground"} />
      <span className="font-medium" role="status">{title}</span>
      {issues.length > 0 && <span className="text-xs text-warning">{issues.length} {issues.length === 1 ? "issue" : "issues"}</span>}
      {/* {snapshot && !error && <span className="hidden min-w-0 max-w-48 truncate text-xs text-muted-foreground md:inline" title={snapshot.engine ? MODEL_NAMES[snapshot.engine] ?? snapshot.engine : "No speech model"}>{snapshot.engine ? MODEL_NAMES[snapshot.engine] ?? snapshot.engine : "No speech model"}</span>} */}
      <span className="ml-auto flex items-center gap-3">
        {activity === "Cleaning up…" && <CleanupSparkle />}
        {snapshot?.settings.hotkey && <ShortcutKeys combo={snapshot.settings.hotkey} pressed={listening} />}
        <span className="text-xs text-muted-foreground">Setup</span><ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" />
      </span>
    </summary>
    <div className="space-y-4 pt-4">
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><p>Microphone, models, and permissions</p><Button variant="ghost" size="icon-sm" title="Refresh readiness" aria-label="Refresh readiness" disabled={checking} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} className={checking ? "animate-spin" : ""} /></Button></div>
    {snapshot && !error && <>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-border pt-4 text-sm">
        <div><dt className="text-muted-foreground">Microphone</dt><dd className="mt-1 break-words">{snapshot.settings.microphone || "System default"}</dd></div>
        <div><dt className="text-muted-foreground">Speech model</dt><dd className="mt-1 break-words">{snapshot.engine ? MODEL_NAMES[snapshot.engine] ?? snapshot.engine : "Not selected"}</dd></div>
        <div><dt className="text-muted-foreground">Cleanup</dt><dd className="mt-1 break-words">{snapshot.cleanup}</dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        {snapshot.settings.hotkey && <ShortcutKeys combo={snapshot.settings.hotkey} pressed={listening} />}
        <span className="text-sm text-muted-foreground">{snapshot.settings.push_to_talk ? "Hold to talk" : "Press to start / stop"}</span>
        <Button variant="ghost" size="sm" onClick={onPreferences}>Dictation settings <ArrowRight size={14} /></Button>
      </div>
    </>}
    {error && <p role="alert" className="text-sm text-warning">Setup status is unavailable. Use refresh to try again.</p>}
    {issues.length > 0 && <ul className="divide-y divide-border border-t border-border">{issues.map(issue => <li key={issue.label} className="flex flex-wrap items-center justify-between gap-2 py-3"><p className="text-sm text-muted-foreground flex-1 min-w-48">{issue.text}</p><Button variant="outline" size="sm" onClick={issue.action}>{issue.label}</Button></li>)}</ul>}
    </div>
  </details>;
}
