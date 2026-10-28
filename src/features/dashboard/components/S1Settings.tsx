import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, WandSparkles } from "lucide-react";
import { testS1Cleanup, builtInModelName, type Settings, type S1Status } from "@/lib/ipc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  settings: Settings;
  model: Settings["built_in_model"];
  status: S1Status | null;
  error: string;
  busy: boolean;
  onEnable: (source?: string) => Promise<void>;
  onRefresh: () => void;
}

export function S1Settings({ settings, model, status, error, busy, onEnable, onRefresh }: Props) {
  const name = builtInModelName(model);
  const flash = model === "patter_flash";
  const [profile, setProfile] = useState("none");
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState("so um send the report by friday no wait thursday");
  const [testError, setTestError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const ready = !!status?.supported && status.installed && status.runtime_ready;
  const active = settings.cleanup_provider === "built_in" && settings.built_in_model === model && settings.llm_cleanup_enabled;
  const downloading = busy || !!status?.downloading;
  const test = async () => {
    setTesting(true); setResult(null); setTestError("");
    try { setResult(await testS1Cleanup(sample, profile === "none" ? null : profile, model)); }
    catch (error) { setTestError(String(error)); }
    finally { setTesting(false); }
  };
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{name}</h3><p className="mt-1 text-xs text-muted-foreground">{flash ? "By Patter · Beta · English dictation" : "By Superwhisper · Beta · English dictation"}</p></div><span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">On-device</span></div>
    <p role="status" className="text-sm">
      {!status ? "Checking availability…" : !status.supported ? "Requires Apple Silicon and macOS 14 or newer. Use Ollama on this device."
        : !status.runtime_ready ? "Built-in runtime missing. Reinstall Patter, then retry."
        : status.downloading ? `Installing model… ${status.progress}%`
        : busy ? `Preparing ${name}…`
        : active ? `${name} cleanup is enabled.`
        : status.installed ? "Downloaded · ready to enable" : `One-time download · ${Math.ceil(status.download_bytes / 1_000_000)} MB`}
    </p>
    {!active && status?.supported && status.runtime_ready && <>
      <p className="text-xs text-muted-foreground">
        Enabling {name} sets the transcription language to English and turns on dictation cleanup.
        Your current cleanup stays unchanged until setup succeeds.
      </p>
      {flash && <p className="text-xs text-muted-foreground">By downloading and enabling Patter Flash, you agree to the <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer" className="underline">Gemma Terms of Use</a>, including the <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noreferrer" className="underline">use restrictions</a>.</p>}
      <Button onClick={() => onEnable()} disabled={downloading || testing}>
        {downloading && <Loader2 size={14} className="animate-spin" />}
        {downloading ? `Setting up ${name}…` : !status.installed ? `Download & enable ${name}` : settings.language !== "en" ? `Use English & enable ${name}` : `Enable ${name}`}
      </Button>
    </>}
    {status?.downloading && <Progress aria-label={`${name} installation`} value={status.progress} />}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive break-words">
      <p>{error}</p>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}>Check again</Button>
    </div>}
    <p className="text-xs text-muted-foreground">
      {flash ? "App Profiles supply cleanup instructions. Formatting results may vary with this beta model." : "App Profiles set supported tone, list, and email formatting hints."} Code and terminal dictation stays verbatim.
      Personal memory requires Ollama cleanup. Long transcripts are cleaned in chunks.
      {flash && " This beta works best with short dictation. If generation is truncated, Patter keeps the original transcript."}
    </p>
    {ready && <details open className="border-t border-border pt-4 text-sm">
      <summary className="cursor-pointer rounded-md py-1 font-medium text-accent-foreground">Preview cleanup</summary>
      <div className="space-y-3 pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">Compare your transcript with the cleaned result. This preview does not paste into another app.</p>
        <label id="cleanup-preview-profile" className="block text-xs text-muted-foreground">App profile</label>
        <Select value={profile} onValueChange={value => { setProfile(value); setResult(null); setTestError(""); }} disabled={testing}>
          <SelectTrigger aria-labelledby="cleanup-preview-profile"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">General dictation</SelectItem>{[...new Set(settings.app_profiles.map(item => item.app).filter(Boolean))].map(app => <SelectItem key={app} value={app}>{app}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="s1-sample" className="text-xs text-muted-foreground">Original transcript<textarea id="s1-sample" disabled={testing} value={sample} onChange={event => { setSample(event.target.value); setResult(null); setTestError(""); }} maxLength={128000} rows={5} className="mt-2 block w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
          <div><p className="text-xs text-muted-foreground">Cleaned result</p><div role="status" className="mt-2 min-h-36 whitespace-pre-wrap break-words rounded-lg bg-accent-subtle p-3 text-sm leading-relaxed">{testing ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin" />Cleaning up…</span> : result !== null ? result || "No text remaining after filler removal." : <span className="text-muted-foreground">Run a preview to see the result here.</span>}</div></div>
        </div>
        <Button variant="outline" onClick={test} disabled={testing || busy || !sample.trim() || settings.language !== "en"}>{testing ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}{testing ? "Cleaning up…" : "Test cleanup"}</Button>
        {testError && <p role="alert" className="break-words text-sm text-destructive">Preview failed. {testError} Try again when the model is available.</p>}
        {settings.language !== "en" && <p className="text-xs text-warning">Enable {name} above to use English before testing cleanup.</p>}
      </div>
    </details>}
  </div>;
}
