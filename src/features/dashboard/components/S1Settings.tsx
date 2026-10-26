import { useState } from "react";
import { toast } from "sonner";
import { testS1Cleanup, type Settings, type S1Status } from "@/lib/ipc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  settings: Settings;
  status: S1Status | null;
  error: string;
  busy: boolean;
  onEnable: () => Promise<void>;
  onRefresh: () => void;
}

export function S1Settings({ settings, status, error, busy, onEnable, onRefresh }: Props) {
  const [profile, setProfile] = useState("none");
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState("so um send the report by friday no wait thursday");
  const [result, setResult] = useState<string | null>(null);
  const ready = !!status?.supported && status.installed && status.runtime_ready;
  const active = settings.cleanup_provider === "built_in" && settings.llm_cleanup_enabled;
  const downloading = busy || !!status?.downloading;
  const test = async () => {
    setTesting(true); setResult(null);
    try { setResult(await testS1Cleanup(sample, profile === "none" ? null : profile)); }
    catch (e) { toast.error(String(e)); }
    finally { setTesting(false); }
  };
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p id="built-in-model-label" className="text-[13px] font-medium">Cleanup Model</p>
        <p className="text-xs text-muted-foreground mt-1">English dictation cleanup. Download once, then use offline.</p>
      </div>
      <Select value="s1_mini" disabled={downloading}>
        <SelectTrigger aria-labelledby="built-in-model-label" className="w-48 bg-background border-foreground/10 text-[13px]"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="s1_mini">S1-mini</SelectItem></SelectContent>
      </Select>
    </div>
    <p className="text-xs text-muted-foreground">S1-mini by Superwhisper · beta</p>
    <p role="status" className="text-sm">
      {!status ? "Checking availability…" : !status.supported ? "Requires Apple Silicon and macOS 14 or newer. Use Ollama on this device."
        : !status.runtime_ready ? "S1-mini runtime missing. Reinstall Patter, then retry."
        : status.downloading ? `Downloading S1-mini… ${status.progress}%`
        : busy ? "Preparing S1-mini…"
        : active ? "S1-mini cleanup is enabled."
        : status.installed ? "Downloaded · ready to enable" : `One-time download · ${Math.ceil(status.download_bytes / 1_000_000)} MB`}
    </p>
    {!active && status?.supported && status.runtime_ready && <>
      <p className="text-xs text-muted-foreground">
        Enabling S1-mini sets the transcription language to English and turns on dictation cleanup.
        Your current cleanup stays unchanged until setup succeeds.
      </p>
      <button onClick={onEnable} disabled={downloading || testing}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-50 focus-visible:ring-focus">
        {downloading ? "Setting up S1-mini…" : !status.installed ? "Download & enable S1-mini" : settings.language !== "en" ? "Use English & enable S1-mini" : "Enable S1-mini"}
      </button>
    </>}
    {status?.downloading && <progress aria-label="S1-mini model download" value={status.progress} max={100} className="w-full" />}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive break-words">
      <p>{error}</p>
      <button onClick={onRefresh} disabled={busy} className="rounded-md underline underline-offset-4 focus-visible:ring-focus">Check again</button>
    </div>}
    <p className="text-xs text-muted-foreground">
      App Profiles set supported tone, list, and email formatting hints. Code and terminal dictation stays verbatim.
      Free-form instructions and personal memory require Ollama cleanup. Long transcripts are cleaned in chunks.
    </p>
    {ready && <details className="text-sm">
      <summary className="cursor-pointer rounded-md py-1 focus-visible:ring-focus">Try a transcript</summary>
      <div className="space-y-3 pt-3">
        <label id="cleanup-preview-profile" className="block text-xs text-muted-foreground">Preview app profile</label>
        <Select value={profile} onValueChange={value => { setProfile(value); setResult(null); }} disabled={testing}>
          <SelectTrigger aria-labelledby="cleanup-preview-profile"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">General dictation</SelectItem>
            {[...new Set(settings.app_profiles.map(p => p.app).filter(Boolean))].map(app => <SelectItem key={app} value={app}>{app}</SelectItem>)}
          </SelectContent>
        </Select>
        <label htmlFor="s1-sample" className="block text-xs text-muted-foreground">Transcript</label>
        <textarea id="s1-sample" value={sample} onChange={e => setSample(e.target.value)} maxLength={128000} rows={3}
          className="w-full rounded-md border border-foreground/10 bg-background p-3 text-sm focus-visible:ring-focus" />
        <button onClick={test} disabled={testing || busy || !sample.trim() || settings.language !== "en"}
          className="rounded-md bg-foreground/10 px-3 py-2 text-sm hover:bg-foreground/15 disabled:opacity-50 focus-visible:ring-focus">
          {testing ? "Cleaning up…" : "Test S1-mini cleanup"}
        </button>
        {settings.language !== "en" && <p className="text-xs text-muted-foreground">Enable S1-mini above to use English and try this transcript.</p>}
        {result !== null && <div role="status" className="text-sm whitespace-pre-wrap break-words"><span className="block text-xs text-muted-foreground mb-1">Result</span>{result || "Empty transcript (filler removed)"}</div>}
      </div>
    </details>}
  </div>;
}
