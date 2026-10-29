import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";
import { builtInModelName, checkNanoUpdate, installNanoUpdate, rollbackNanoUpdate, type NanoUpdate, type Settings, type BuiltInStatus } from "@/lib/ipc";

interface Props {
  settings: Settings;
  model: Settings["built_in_model"];
  status: BuiltInStatus | null;
  error: string;
  busy: boolean;
  onEnable: (source?: string) => Promise<void>;
  onRefresh: () => void;
}

export function BuiltInModelSettings({ settings, model, status, error, busy, onEnable, onRefresh }: Props) {
  const name = builtInModelName(model);
  const nano = model === "patter-1-nano";
  const restoreVersion = status?.previous_version?.startsWith("patter-1-nano-") ? status.previous_version : null;
  const [update, setUpdate] = useState<NanoUpdate | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const checkUpdate = async () => {
    setUpdateBusy(true); setUpdateError("");
    try { setUpdate(await checkNanoUpdate()); } catch (error) { setUpdateError(String(error)); }
    finally { setUpdateBusy(false); }
  };
  useEffect(() => { if (nano && status?.installed) void checkUpdate(); }, [nano, status?.installed]);
  useEffect(() => {
    if (!updateBusy) return;
    const timer = window.setInterval(onRefresh, 1000);
    return () => window.clearInterval(timer);
  }, [updateBusy, onRefresh]);
  const changeVersion = async (rollback = false) => {
    if (rollback ? !restoreVersion : !update) return;
    setUpdateBusy(true); setUpdateError("");
    try {
      if (rollback) await rollbackNanoUpdate(); else await installNanoUpdate(update!.latest_version);
      setUpdate(null); onRefresh();
    } catch (error) { setUpdateError(String(error)); }
    finally { setUpdateBusy(false); }
  };
  const ready = !!status?.supported && status.installed && status.runtime_ready;
  const active = settings.cleanup_provider === "built_in" && settings.built_in_model === model && settings.llm_cleanup_enabled;
  const downloading = busy || updateBusy || !!status?.downloading;
  return <div className="space-y-4 p-4">
    {(!active || !ready || downloading) && <p role="status" className="text-sm">
      {!status ? "Checking availability…" : !status.supported ? "Requires Apple Silicon and macOS 14 or newer. Use Ollama on this device."
        : !status.runtime_ready ? "Built-in runtime missing. Reinstall Patter, then retry."
        : status.downloading ? `Installing model… ${status.progress}%`
        : busy ? `Preparing ${name}…`
        : active ? `${name} cleanup is enabled.`
        : status.installed ? "Downloaded · ready to enable" : `One-time download · ${Math.ceil(status.download_bytes / 1_000_000)} MB`}
    </p>}
    {(!active || !status?.installed) && status?.supported && status.runtime_ready && <>
      <p className="text-xs text-muted-foreground">
        Enabling {name} sets the transcription language to English and turns on dictation cleanup.
        Your current cleanup stays unchanged until setup succeeds.
      </p>
      {nano && <p className="text-xs text-muted-foreground">By downloading and enabling patter-1-nano, you agree to the <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer" className="underline">Gemma Terms of Use</a>, including the <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noreferrer" className="underline">use restrictions</a>.</p>}
      <Button onClick={() => onEnable()} disabled={downloading}>
        {downloading && <Loader2 size={14} className="animate-spin" />}
        {downloading ? `Setting up ${name}…` : !status.installed ? `Download & enable ${name}` : settings.language !== "en" ? `Use English & enable ${name}` : `Enable ${name}`}
      </Button>
    </>}
    {nano && ready && <section aria-label="Model maintenance"><div className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">Model version: {status?.version?.replace(/^patter-nano-/, "") ?? "Checking…"}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={checkUpdate} disabled={downloading}>{updateBusy ? "Checking / preparing…" : "Check model updates"}</Button>
        {update?.update_available && <Button size="sm" disabled={downloading} onClick={() => changeVersion()}>Update to {update.latest_version.replace(/^patter-nano-/, "")} · {Math.ceil(update.download_bytes / 1_000_000)} MB</Button>}
        {restoreVersion && <Button variant="outline" size="sm" disabled={downloading} onClick={() => changeVersion(true)}>Restore {restoreVersion.replace(/^patter-1-nano-/, "")}</Button>}
      </div>
      {update && !update.update_available && <p role="status" className="text-xs text-muted-foreground">No newer model release is available.</p>}
      {updateError && <p role="alert" className="break-words text-xs text-destructive">{updateError} Your current model is kept.</p>}
    </div></section>}
    {status?.downloading && <Progress aria-label={`${name} installation`} value={status.progress} />}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive break-words">
      <p>{error}</p>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}>Check again</Button>
    </div>}

  </div>;
}
