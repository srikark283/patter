import { CleanupComparison } from "./CleanupComparison";
import { CleanupSparkle } from "./CleanupSparkle";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, WandSparkles } from "lucide-react";
import { testBuiltInCleanup, builtInModelName, type Settings, type BuiltInStatus } from "@/lib/ipc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props { settings: Settings; statuses: Partial<Record<Settings["built_in_model"], BuiltInStatus>>; busy: boolean; }
export function CleanupPlayground({ settings, statuses, busy }: Props) {
  const [chosenModel, setModel] = useState<Settings["built_in_model"] | null>(null);
  const model = chosenModel ?? (statuses[settings.built_in_model]?.installed ? settings.built_in_model : statuses["patter-1-nano"]?.installed ? "patter-1-nano" : "patter-1-mini");
  const status = statuses[model];
  const ready = !!status?.supported && status.installed && status.runtime_ready && !status.downloading;
  const nano = model === "patter-1-nano";
  const [profile, setProfile] = useState("none");
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState("so um send the report by friday no wait thursday");
  const [testError, setTestError] = useState("");
  const [response, setResponse] = useState<{ model: Settings["built_in_model"]; text: string; original: string } | null>(null);
  const setResult = (value: null) => setResponse(value);
  const result = response?.model === model ? response.text : null;
  const test = async () => {
    setTesting(true); setResult(null); setTestError("");
    try { setResponse({ model, original: sample, text: await testBuiltInCleanup(sample, profile === "none" ? null : profile, model) }); }
    catch (error) { setTestError(String(error)); }
    finally { setTesting(false); }
  };
  return (
    <section className="cleanup-playground" aria-label="Try your text">
      <div className="section-heading"><div><h2>Try your text</h2><p>Compare cleanup using any downloaded Patter model. Your default stays unchanged.</p></div></div>
      <label className="mt-5 block text-xs text-muted-foreground">Test model<Select value={model} disabled={testing || busy} onValueChange={value => { setModel(value as Settings["built_in_model"]); setResult(null); setTestError(""); }}><SelectTrigger className="mt-2" aria-label="Test model"><SelectValue /></SelectTrigger><SelectContent>{(["patter-1-nano", "patter-1-mini"] as const).map(id => <SelectItem key={id} value={id} disabled={!statuses[id]?.installed}>{builtInModelName(id)}{!statuses[id]?.installed ? " · Download first" : ""}</SelectItem>)}</SelectContent></Select></label>
      <div className="space-y-3 pt-3">
        {nano && <p className="text-xs text-muted-foreground">If generation is truncated, Patter keeps the original transcript.</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">Compare your transcript with the cleaned result. This preview does not paste into another app.</p>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Try a sample</span>{[{ name: "Email", text: "hi alex um can you send the updated proposal by friday thanks" }, { name: "Chat", text: "hey so i will be there in like ten minutes" }, { name: "Correction", text: "send the report by friday no wait thursday" }].map(item => <Button key={item.name} variant="ghost" size="sm" disabled={testing} onClick={() => { setSample(item.text); setResult(null); setTestError(""); }}>{item.name}</Button>)}</div>
        <label id="cleanup-preview-profile" className="block text-xs text-muted-foreground">App profile</label>
        <Select value={profile} onValueChange={value => { setProfile(value); setResult(null); setTestError(""); }} disabled={testing}>
          <SelectTrigger aria-labelledby="cleanup-preview-profile"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">General dictation</SelectItem>{[...new Set(settings.app_profiles.map(item => item.app).filter(Boolean))].map(app => <SelectItem key={app} value={app}>{app}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="built-in-sample" className="text-xs leading-7 text-muted-foreground">Original transcript<textarea id="built-in-sample" disabled={testing} value={sample} onChange={event => { setSample(event.target.value); setResult(null); setTestError(""); }} maxLength={128000} rows={5} className="mt-2 block w-full resize-y rounded-lg border border-input bg-background p-3 text-sm leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
          <div><p className="flex h-7 items-center gap-1.5 text-xs text-muted-foreground">Cleaned result{result !== null && <CleanupSparkle key={result} complete />}</p><div className="mt-2 min-h-36 whitespace-pre-wrap break-words rounded-lg bg-accent-subtle p-3 text-sm leading-relaxed">{testing ? <span className="inline-flex items-center gap-2 text-muted-foreground"><CleanupSparkle />Cleaning up…</span> : result !== null ? <CleanupComparison key={result} original={response!.original} result={result} /> : <span className="text-muted-foreground">Run a preview to see the result here.</span>}</div></div>
        </div>
        <span role="status" className="sr-only">{testing ? "Cleaning up" : result !== null ? "Cleanup complete. Compare the result above." : ""}</span>
        <Button variant="outline" onClick={test} disabled={testing || busy || !ready || !sample.trim() || settings.language !== "en"}>{testing ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />}{testing ? "Cleaning up…" : "Test cleanup"}</Button>
        {testError && <p role="alert" className="break-words text-sm text-destructive">Preview failed. {testError} Try again when the model is available.</p>}
        {!ready && <p className="text-xs text-muted-foreground">Download this model from its card before testing.</p>}
        {settings.language !== "en" && <p className="text-xs text-warning">Select English as the transcription language before testing cleanup.</p>}
      </div>
    </section>
  );
}
