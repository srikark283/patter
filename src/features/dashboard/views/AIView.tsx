import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, SparkleIcon, Clock, WandSparkles, Zap, Check, Plus, Loader2 } from "lucide-react";
import { NativeAppIcon } from "../components/NativeAppIcon";
import { Button } from "@/components/ui/button";
import { getSettings, updateSettings, listOllamaModels, getS1Status, enableS1, builtInModelName, Settings, S1Status } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { S1Settings } from "../components/S1Settings";
import { SettingIcon } from "../components/SettingIcon";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const APP_PROFILE_TEMPLATES = [
  {
    name: "Coding",
    app: "VS Code, Xcode, Cursor, Antigravity, IntelliJ, Claude Code, Codex, Windsurf, Zed",
    prompt: "Format code blocks and syntax correctly. Do not use markdown lists for code. Prefer camelCase or snake_case if dictating variables. Do not fix grammar inside code."
  },
  {
    name: "AI Chat",
    app: "ChatGPT, Gemini, Claude, Copilot, Perplexity",
    prompt: "Format as a clear prompt or question for an AI assistant. Use markdown backticks for any technical terms or code snippets. Keep the intent direct."
  },
  {
    name: "Email",
    app: "Mail, Outlook, Spark, Gmail",
    prompt: "Format as a professional email. Use standard paragraphs and clear bullet points. Fix grammar thoroughly. Be polite and concise."
  },
  {
    name: "Chat",
    app: "Slack, Discord, Messages, WhatsApp, Teams",
    prompt: "Format casually. Do not be overly formal. Add line breaks naturally. Do not end short messages with a period."
  },
  {
    name: "Terminal",
    app: "Terminal, iTerm, Alacritty, Ghostty",
    prompt: "This is a terminal command line. Do not use punctuation like periods or capital letters at the start. Output exactly what should be typed into a bash shell."
  },
  {
    name: "Notes",
    app: "Obsidian, Sublime Text, Apple Notes, Goodnotes, Notion",
    prompt: "Format as clear, structured notes. Use markdown headers and bullet points where appropriate."
  }
];

export function AIView() {
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [profileDraft, setProfileDraft] = useState<Settings["app_profiles"] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [providerChoice, setProviderChoice] = useState<Settings["cleanup_provider"]>("ollama");
  const [modelChoice, setModelChoice] = useState<Settings["built_in_model"]>("s1_mini");
  const modelChoiceRef = useRef(modelChoice);
  modelChoiceRef.current = modelChoice;
  const statusGeneration = useRef(0);
  const [s1Status, setS1Status] = useState<S1Status | null>(null);
  const [s1Error, setS1Error] = useState("");
  const [s1StatusError, setS1StatusError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const refreshS1 = async () => {
    const current = ++statusGeneration.current;
    const model = modelChoiceRef.current;
    try {
      const status = await getS1Status(model);
      if (current === statusGeneration.current && model === modelChoiceRef.current) { setS1Status(status); setS1StatusError(""); }
    } catch (error) { if (current === statusGeneration.current && model === modelChoiceRef.current) { setS1Status(null); setS1StatusError(String(error)); } }
  };
  useEffect(() => {
    void refreshS1();
    if (providerChoice !== "built_in" || (!setupBusy && !s1Status?.downloading)) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refreshS1(); }, 1000);
    return () => window.clearInterval(timer);
  }, [providerChoice, modelChoice, setupBusy, s1Status?.downloading]);
  const setUpS1 = async (source?: string) => {
    setSetupBusy(true); setS1Error("");
    try {
      const saved = await enableS1(modelChoice, source);
      setSettings(saved); setProviderChoice("built_in");
      await refreshS1();
      toast.success(`${builtInModelName(modelChoice)} cleanup enabled in English`);
    } catch (error) { setS1Error(String(error)); }
    finally { setSetupBusy(false); }
  };
  const [checkingOllama, setCheckingOllama] = useState(false);
  
  const refreshOllama = () => {
    setCheckingOllama(true);
    listOllamaModels()
      .then(setOllamaModels)
      .catch(() => setOllamaModels(null))
      .finally(() => setCheckingOllama(false));
  };

  const load = async () => {
    setLoadError("");
    try {
      const saved = await getSettings(); setSettings(saved); setProviderChoice(saved.cleanup_provider); setModelChoice(saved.built_in_model);
    } catch (error) { setLoadError(String(error)); }
  };
  useEffect(() => {
    void load(); refreshOllama();
    const onFocus = () => { void refreshS1(); refreshOllama(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings || savingRef.current) return false;
    savingRef.current = true; setSaving(true); setSaveMessage("Saving…");
    const newSettings = { ...settings, ...patch };
    try {
      await updateSettings(newSettings);
      setSettings(newSettings); setSaveMessage("Saved");
      return true;
    } catch (error) {
      setSaveMessage("Could not save changes");
      toast.error(`Could not save changes. Previous settings are still in use. ${String(error)}`);
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  };

  // Returning null left the whole pane blank until settings resolved, which
  // read as the app hanging rather than loading.
  if (!settings) {
    return (
      <div className="space-y-6 pb-10">
        <PageHeader
          title="Intelligence"
          description="Local intelligence for dictation cleanup, meeting notes, and per-app tone."
        />
        {loadError ? <div role="alert" className="space-y-3 rounded-xl border border-border p-4"><p className="text-sm text-destructive">Could not load Intelligence settings. {loadError}</p><Button variant="outline" onClick={() => void load()}><RefreshCw size={14} />Retry</Button></div> : <div role="status" aria-label="Loading Intelligence settings">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="mb-3 h-[104px] w-full rounded-xl" />)}</div>}
      </div>
    );
  }

  const ollamaUp = ollamaModels !== null;
  const builtInSelected = providerChoice === "built_in";
  const s1Ready = !!s1Status?.supported && s1Status.installed && s1Status.runtime_ready;
  const profiles = profileDraft ?? settings.app_profiles;
  const profilesDirty = JSON.stringify(profiles) !== JSON.stringify(settings.app_profiles);
  const ollamaReady = !!settings.ollama_model && !!ollamaModels?.some(model => model === settings.ollama_model || model === `${settings.ollama_model}:latest`);
  const cleanupActive = settings.cleanup_provider === providerChoice && settings.llm_cleanup_enabled;
  const chooseProvider = async (value: Settings["cleanup_provider"]) => {
    const previous = providerChoice;
    setProviderChoice(value);
    if (value === "ollama" && !await update({ cleanup_provider: value })) setProviderChoice(previous);
  };

  return (
    <div className="space-y-5 workspace-enter pb-6">
      <PageHeader
        title="Intelligence"
        description="Choose how Patter refines your words, with everything processed locally."
        action={<span role="status" className={cn("inline-flex items-center gap-1.5 text-xs", saveMessage === "Saved" ? "text-success" : saveMessage.startsWith("Could") ? "text-destructive" : "text-muted-foreground")}>{saving ? <Loader2 size={13} className="animate-spin" /> : saveMessage === "Saved" ? <Check size={13} /> : null}{saveMessage}</span>}
      />
      <fieldset disabled={saving || setupBusy} className="min-w-0 space-y-5">

      {/* Ollama status */}
      {providerChoice === "ollama" && <div className="surface-raised rounded-xl p-4 flex items-center justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              "w-2 h-2 rounded-full flex-none",
              ollamaUp ? "bg-success " : "bg-warning "
            )}
          />
          <div>
            <p className="text-[13px] font-medium text-foreground/90">
              {checkingOllama ? "Checking Ollama…" : ollamaUp
                ? `Ollama running · ${ollamaModels.length} model${ollamaModels.length === 1 ? "" : "s"} available`
                : "Ollama not detected"}
            </p>
            <p className="text-xs text-muted-foreground">
              {ollamaUp
                ? "Everything below runs locally — nothing leaves your device."
                : "Start Ollama and download a model with ollama pull <model>, then refresh."}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm"
          onClick={refreshOllama}
          disabled={checkingOllama}
          className="flex items-center gap-1.5 text-[12px] text-steelIce hover:text-steelIce/80 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={checkingOllama ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>}

      {/* Dictation cleanup */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1"><h2 className="text-base font-medium">Dictation cleanup</h2><span role="status" className={cn("rounded-md px-2 py-1 text-xs", settings.llm_cleanup_enabled ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{settings.llm_cleanup_enabled ? `${settings.cleanup_provider === "built_in" ? builtInModelName(settings.built_in_model) : "Ollama"} · Enabled` : "Off · Original transcription"}</span></div>
        <div className="surface-raised rounded-xl divide-y divide-foreground/5">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SettingIcon icon={SparkleIcon} active={cleanupActive} />
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Clean up dictated text</p>
                <p className="text-xs text-muted-foreground">
                  Polish transcripts — fixes grammar, removes filler words
                </p>
              </div>
            </div>
            <Switch
              checked={cleanupActive}
              disabled={setupBusy || (builtInSelected && modelChoice !== settings.built_in_model) || (builtInSelected ? !s1Ready || settings.language !== "en" : !cleanupActive && !ollamaReady)}
              aria-label="Enable dictation cleanup"
              onCheckedChange={(checked) => builtInSelected && checked ? setUpS1() : update({ llm_cleanup_enabled: checked })}
            />
          </div>

          <div className="space-y-3 p-4">
            <h3 className="text-sm font-medium">Cleanup provider</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Cleanup provider">
              {[{ value: "built_in" as const, name: "Built-in", description: "English cleanup on Apple Silicon. No separate service needed." }, { value: "ollama" as const, name: "Ollama", description: "Your local models, custom instructions, and personal memory." }].map(provider => <button key={provider.value} type="button" aria-pressed={providerChoice === provider.value} disabled={setupBusy || (provider.value === "built_in" && !s1Status?.supported)} onClick={() => void chooseProvider(provider.value)} className={cn("rounded-xl p-4 text-left ring-1 transition-colors disabled:opacity-50", providerChoice === provider.value ? "bg-accent-subtle ring-primary/40" : "ring-border hover:bg-accent-subtle")}><span className="flex items-center justify-between gap-2 text-sm font-medium">{provider.name}{providerChoice === provider.value && <Check size={15} className="text-accent-foreground" />}</span><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{provider.description}</span></button>)}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">Meetings, voice commands, and memory embeddings use Ollama.</p>
            {providerChoice !== settings.cleanup_provider && <p role="status" className="text-xs leading-relaxed text-warning">Previewing built-in setup. Your current {settings.cleanup_provider === "ollama" ? "Ollama" : "built-in"} cleanup settings stay in use until setup succeeds.</p>}
          </div>
          {s1Status && !s1Status.supported && <p className="px-4 pb-4 text-xs text-muted-foreground">Built-in cleanup requires Apple Silicon and macOS 14 or newer. Use Ollama on this device.</p>}
          {s1StatusError && !builtInSelected && <div role="alert" className="p-4 text-sm text-destructive"><p>Could not check built-in availability: {s1StatusError}</p><button onClick={refreshS1} className="rounded-md underline underline-offset-4 focus-visible:ring-focus">Retry</button></div>}
          {builtInSelected && <div className="px-4 pt-4"><label id="built-in-model-label" className="mb-2 block text-xs text-muted-foreground">Built-in model</label>
            <Select value={modelChoice} disabled={setupBusy || !!s1Status?.downloading} onValueChange={(value) => { setS1Status(null); setS1Error(""); setS1StatusError(""); setModelChoice(value as Settings["built_in_model"]); }}>
              <SelectTrigger aria-labelledby="built-in-model-label"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="s1_mini">S1-mini · Superwhisper</SelectItem><SelectItem value="patter-1-nano">patter-1-nano · Patter</SelectItem></SelectContent>
            </Select>
            {modelChoice !== settings.built_in_model && <p role="status" className="mt-2 text-xs text-muted-foreground">Previewing {builtInModelName(modelChoice)}. Enable it below to switch cleanup models.</p>}
          </div>}
          {builtInSelected && <S1Settings key={modelChoice} model={modelChoice} settings={settings} status={s1Status} error={s1Error || s1StatusError} busy={setupBusy} onEnable={setUpS1} onRefresh={() => { setS1Error(""); void refreshS1(); }} />}

          {providerChoice === "ollama" && (
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SettingIcon icon={Zap} active={!!settings.ollama_model} />
                <div>
                  <p id="ollama-cleanup-label" className="text-sm font-medium">Cleanup model</p>
                  <p className="text-xs text-muted-foreground">
                    {ollamaModels === null
                      ? "Ollama not running — start it to list models"
                      : ollamaModels.length === 0
                      ? "No models downloaded — run `ollama pull <model>`"
                      : "Fast small models work best here"}
                  </p>
                </div>
              </div>
              <Select
                value={settings.ollama_model ?? "none"}
                disabled={!ollamaModels?.length}
                onValueChange={(val) => update({ ollama_model: val === "none" ? null : val })}
              >
                <SelectTrigger aria-label="Cleanup model" className="w-full sm:w-48 bg-background border-input text-sm truncate disabled:opacity-50">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a model</SelectItem>
                  {settings.ollama_model && !ollamaModels?.includes(settings.ollama_model) && <SelectItem value={settings.ollama_model} disabled>{settings.ollama_model} (unavailable)</SelectItem>}
                  {(ollamaModels ?? []).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {settings.llm_cleanup_enabled && providerChoice === "ollama" && (
            <div className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <SettingIcon icon={Clock} active={settings.ollama_keep_alive_minutes !== 0} />
                <div>
                  <p className="text-[13px] font-medium text-foreground/90">Keep Model Loaded</p>
                  <p className="text-xs text-muted-foreground">
                    How long Ollama holds the model in memory after a dictation. Longer
                    avoids a multi-second reload; shorter gives the RAM back sooner.
                  </p>
                </div>
              </div>
              <Select
                value={String(settings.ollama_keep_alive_minutes)}
                onValueChange={(val) => update({ ollama_keep_alive_minutes: Number(val) })}
              >
                <SelectTrigger aria-label="Keep model loaded" className="w-full sm:w-48 bg-background border-input text-sm truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Unload immediately</SelectItem>
                  <SelectItem value="5">5 minutes</SelectItem>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="240">4 hours</SelectItem>
                  <SelectItem value="-1">Until Ollama restarts</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </section>

      {/* Meetings */}
      <section className="space-y-4">
        <h2 className="px-1 text-base font-medium">Meeting intelligence</h2>
        <div className="surface-raised rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SettingIcon icon={WandSparkles} active={!!settings.meeting_ollama_model} />
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Meeting Notes Model</p>
                <p className="text-xs text-muted-foreground">
                  {ollamaUp ? "Generate minutes, decisions, and summaries with a local Ollama model." : "Start Ollama to choose a meeting notes model. Dictation cleanup can use built-in models independently."}
                </p>
              </div>
            </div>
            <Select
              value={settings.meeting_ollama_model ?? "same"}
              disabled={!ollamaModels?.length}
              onValueChange={(val) => update({ meeting_ollama_model: val === "same" ? null : val })}
            >
              <SelectTrigger aria-label="Meeting notes model" className="w-full sm:w-48 bg-background border-input text-sm truncate disabled:opacity-50">
                <SelectValue placeholder="Same as cleanup model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">Same as cleanup model</SelectItem>
                {(ollamaModels ?? []).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!ollamaUp && <div className="px-4 pb-4"><Button variant="outline" size="sm" disabled={checkingOllama} onClick={refreshOllama}><RefreshCw size={13} className={checkingOllama ? "animate-spin" : ""} />Check Ollama</Button></div>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-base font-medium">App profiles</h2><p className="mt-1 text-xs text-muted-foreground">Adjust the tone for each app. Changes apply when you save.</p></div>{profilesDirty && <span role="status" className="text-xs text-warning">Unsaved profile changes</span>}</div>
        <div className="surface-raised rounded-xl p-4 space-y-4">
          <p className="text-xs leading-relaxed text-muted-foreground">Ollama and patter-1-nano accept profile instructions. S1-mini uses supported tone, list, and email hints; code and terminal dictation stays verbatim.{!settings.llm_cleanup_enabled && " Enable dictation cleanup to use profiles."}</p>
          {!profiles.length && <p className="py-3 text-sm text-muted-foreground">No app profiles yet. Start with a template or add your own.</p>}
          <div className="space-y-3">{profiles.map((profile, index) => <div key={index} className="flex items-start gap-2 border-t border-border/50 pt-3">
            <div className="mt-6 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"><NativeAppIcon appName={profile.app} /></div>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="text-xs text-muted-foreground">App names<input aria-label={`App names for profile ${index + 1}`} value={profile.app} placeholder="Mail, Outlook" onChange={event => setProfileDraft(profiles.map((item, i) => i === index ? { ...item, app: event.target.value } : item))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <label className="text-xs text-muted-foreground">Cleanup instructions<textarea aria-label={`Instructions for profile ${index + 1}`} value={profile.prompt} placeholder="Use a concise, professional tone" rows={2} onChange={event => setProfileDraft(profiles.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} className="mt-1 block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
            </div>
            <Button variant="ghost" size="icon-sm" className="mt-6 text-muted-foreground hover:text-destructive" aria-label={`Remove profile ${index + 1}`} title="Remove profile" onClick={() => setProfileDraft(profiles.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>
          </div>)}</div>
          <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => setProfileDraft([...profiles, { app: "", prompt: "" }])}><Plus size={14} />Add profile</Button><span className="text-xs text-muted-foreground">Templates</span>{APP_PROFILE_TEMPLATES.map(template => <Button key={template.name} variant="ghost" size="sm" onClick={() => setProfileDraft([...profiles, { app: template.app, prompt: template.prompt }])}>{template.name}</Button>)}</div>
          {profilesDirty && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3"><Button variant="ghost" onClick={() => setProfileDraft(null)}>Discard changes</Button>{profiles.some(profile => !profile.app.trim()) && <p className="mr-auto text-xs text-warning">Add an app name to each profile before saving.</p>}<Button disabled={profiles.some(profile => !profile.app.trim())} onClick={async () => { if (await update({ app_profiles: profiles })) setProfileDraft(null); }}>Save profiles</Button></div>}
        </div>
      </section>
      </fieldset>
    </div>
  );
}
