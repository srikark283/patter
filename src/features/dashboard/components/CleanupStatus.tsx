import { useEffect, useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { getSettings, getS1Status, listOllamaModels, onSettingsChanged, onCleanupError } from "@/lib/ipc";
import { cn } from "@/lib/utils";

type Status = { mode: "checking" | "off" | "enabled" | "attention"; detail: string };

export function CleanupStatus({ page, onClick }: { page: string; onClick: () => void }) {
  const [status, setStatus] = useState<Status>({ mode: "checking", detail: "Checking setup…" });

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      let next: Status;
      try {
        const settings = await getSettings();
        if (!settings.llm_cleanup_enabled) next = { mode: "off", detail: "Original transcription" };
        else if (settings.cleanup_provider === "built_in") {
          const model = await getS1Status(settings.built_in_model);
          next = { mode: model.supported && model.installed && model.runtime_ready ? "enabled" : "attention", detail: "S1-mini" };
        } else {
          const models = await listOllamaModels();
          const available = !!settings.ollama_model && models.some(model => model === settings.ollama_model || model === `${settings.ollama_model}:latest`);
          next = { mode: available ? "enabled" : "attention", detail: settings.ollama_model ? `Ollama · ${settings.ollama_model}` : "Choose an Ollama model" };
        }
      } catch { next = { mode: "attention", detail: "Review cleanup setup" }; }
      if (!disposed && current === generation) setStatus(next);
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    const unlistenSettings = onSettingsChanged(onFocus);
    const unlistenErrors = onCleanupError(() => {
      generation++;
      if (!disposed) setStatus(current => current.mode === "off" ? current : { mode: "attention", detail: "Cleanup failed · review settings" });
    });
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unlistenSettings();
      window.removeEventListener("focus", onFocus);
      void unlistenErrors.then(unlisten => unlisten());
    };
  }, [page]);

  const label = { checking: "Checking", off: "Off", enabled: "Enabled", attention: "Needs attention" }[status.mode];
  return <div className="space-y-2 pt-2">
    <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
      <span className="text-muted-foreground">Dictation cleanup</span>
      <span role="status" className={cn("inline-flex items-center gap-1.5 text-[10px]", status.mode === "enabled" ? "text-success" : status.mode === "attention" ? "text-warning" : "text-muted-foreground")}><span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", status.mode === "enabled" ? "bg-success" : status.mode === "attention" ? "bg-warning" : "bg-muted-foreground/50")} />{label}</span>
    </div>
    <button type="button" onClick={onClick} aria-label={`Dictation cleanup ${label}: ${status.detail}. Open Intelligence settings`} title={`${status.detail} · Open Intelligence settings`} className="group flex min-h-11 w-full items-center gap-2 rounded-lg bg-foreground/[0.025] px-2.5 py-2.5 text-left ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:ring-primary/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <Sparkles size={16} strokeWidth={1.7} className={cn("shrink-0", status.mode === "off" ? "text-muted-foreground" : "text-accent-foreground")} />
      <span className="min-w-0 flex-1 break-words text-xs font-medium leading-snug text-foreground">{status.detail}</span>
      <ChevronRight size={13} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent-foreground" />
    </button>
  </div>;
}
