import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Info, Server, Clock, WandSparkles, Zap, Check, Plus, Loader2 } from "lucide-react";
import { NativeAppIcon } from "../components/NativeAppIcon";
import { Button } from "@/components/ui/button";
import { getSettings, updateSettings, listOllamaModels, getBuiltInStatus, enableBuiltInModel, deleteBuiltInModel, builtInModelName, Settings, BuiltInStatus } from "../../../lib/ipc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "../components/PageHeader";
import { CleanupPlayground } from "../components/CleanupPlayground";
import { BuiltInModelSettings } from "../components/BuiltInModelSettings";
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
    prompt: "Clean up grammar, fillers, and punctuation in the natural-language request. Preserve literal code, commands, file paths, and identifiers exactly. Do not rewrite code or change its meaning."
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
  const [deleteTarget, setDeleteTarget] = useState<{ model: Settings["built_in_model"]; bytes: number } | null>(null);
  const [removingModel, setRemovingModel] = useState<Settings["built_in_model"] | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [managedProvider, setManagedProvider] = useState<Settings["cleanup_provider"] | null>(null);
  const [modelStatuses, setModelStatuses] = useState<Partial<Record<Settings["built_in_model"], BuiltInStatus>>>({});
  const [modelSearch, setModelSearch] = useState("");
  const [section, setSection] = useState("dictation");
  const [editingProfile, setEditingProfile] = useState<number | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [profileDraft, setProfileDraft] = useState<Settings["app_profiles"] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [providerChoice, setProviderChoice] = useState<Settings["cleanup_provider"]>("ollama");
  const [modelChoice, setModelChoice] = useState<Settings["built_in_model"]>("patter-1-nano");
  const modelChoiceRef = useRef(modelChoice);
  modelChoiceRef.current = modelChoice;
  const statusGeneration = useRef(0);
  const [builtInStatus, setBuiltInStatus] = useState<BuiltInStatus | null>(null);
  const [builtInError, setBuiltInError] = useState("");
  const [builtInStatusError, setBuiltInStatusError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const setupLock = useRef(false);
  const refreshBuiltIn = async () => {
    const current = ++statusGeneration.current;
    const model = modelChoiceRef.current;
    try {
      const status = await getBuiltInStatus(model);
      setModelStatuses(previous => ({ ...previous, [model]: status }));
      if (current === statusGeneration.current && model === modelChoiceRef.current) { setBuiltInStatus(status); setBuiltInStatusError(""); }
    } catch (error) { if (current === statusGeneration.current && model === modelChoiceRef.current) { setBuiltInStatus(null); setBuiltInStatusError(String(error)); } }
  };
  useEffect(() => {
    void refreshBuiltIn();
    if (providerChoice !== "built_in" || (!setupBusy && !builtInStatus?.downloading)) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refreshBuiltIn(); }, 1000);
    return () => window.clearInterval(timer);
  }, [providerChoice, modelChoice, setupBusy, builtInStatus?.downloading]);
  const setUpBuiltIn = async (source?: string, model = modelChoice) => {
    if (setupLock.current || savingRef.current) return;
    setupLock.current = true;
    setSetupBusy(true); setBuiltInError("");
    try {
      const saved = await enableBuiltInModel(model, source);
      setSettings(saved); setProviderChoice("built_in");
      await refreshBuiltIn();
      setManagedProvider(null);
      toast.success(`${builtInModelName(model)} cleanup enabled in English`);
    } catch (error) { setBuiltInError(String(error)); setManagedProvider("built_in"); }
    finally { setupLock.current = false; setSetupBusy(false); }
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
    for (const model of ["patter-1-nano", "patter-1-mini"] as const) {
      getBuiltInStatus(model).then(status => setModelStatuses(previous => ({ ...previous, [model]: status }))).catch(() => {});
    }
    const onFocus = () => { void refreshBuiltIn(); refreshOllama(); };
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

  const removeDownload = async () => {
    if (!deleteTarget || setupLock.current || savingRef.current) return;
    setupLock.current = true;
    const model = deleteTarget.model;
    setRemovingModel(model); setDeleteError("");
    try {
      await deleteBuiltInModel(model);
      const status = await getBuiltInStatus(model);
      setModelStatuses(previous => ({ ...previous, [model]: status }));
      if (model === modelChoiceRef.current) setBuiltInStatus(status);
      setDeleteTarget(null);
      toast.success(`${builtInModelName(model)} removed from storage`);
    } catch (error) { setDeleteError(String(error)); }
    finally { setupLock.current = false; setRemovingModel(null); }
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
  const builtInReady = !!builtInStatus?.supported && builtInStatus.installed && builtInStatus.runtime_ready;
  const profiles = profileDraft ?? settings.app_profiles;
  const profilesDirty = JSON.stringify(profiles) !== JSON.stringify(settings.app_profiles);
  const ollamaReady = !!settings.ollama_model && !!ollamaModels?.some(model => model === settings.ollama_model || model === `${settings.ollama_model}:latest`);
  const selectBuiltIn = (model: Settings["built_in_model"]) => {
    if (model !== modelChoice) { setBuiltInStatus(modelStatuses[model] ?? null); setBuiltInError(""); setBuiltInStatusError(""); }
    setModelChoice(model); setProviderChoice("built_in");
  };

  return (
    <div className="intelligence-workspace space-y-6 workspace-enter pb-6">
      <PageHeader
        title="Intelligence"
        description="Choose how Patter refines your words, with everything processed locally."
        action={<span role="status" className={cn("inline-flex items-center gap-1.5 text-xs", saveMessage === "Saved" ? "text-success" : saveMessage.startsWith("Could") ? "text-destructive" : "text-muted-foreground")}>{saving ? <Loader2 size={13} className="animate-spin" /> : saveMessage === "Saved" ? <Check size={13} /> : null}{saveMessage}</span>}
      />
      <nav className="intelligence-sections" aria-label="Intelligence sections">{[{ id: "dictation", label: "Dictation" }, { id: "meetings", label: "Meetings" }, { id: "profiles", label: "App profiles" }].map(item => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>{item.label}{item.id === "profiles" && profilesDirty ? " · Unsaved" : ""}</button>)}</nav>
      <fieldset disabled={saving || setupBusy || !!removingModel} className="min-w-0 space-y-5">

      {/* Ollama status */}
      {section === "meetings" && <div className="surface-raised rounded-xl p-4 flex items-center justify-between">
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
      <section hidden={section !== "dictation"} className="space-y-4">
        <header className="provider-section-heading"><div><h2>Patter Intelligence</h2><p>Polish your words. Privately, on your Mac.</p></div><div className="provider-cleanup-toggle"><span>Dictation cleanup</span><Switch checked={settings.llm_cleanup_enabled} disabled={!settings.llm_cleanup_enabled && (providerChoice !== settings.cleanup_provider || (builtInSelected ? !builtInReady || modelChoice !== settings.built_in_model || settings.language !== "en" : !ollamaReady))} aria-label="Enable dictation cleanup" onCheckedChange={checked => update({ llm_cleanup_enabled: checked })} /></div></header>
        <div className="intelligence-configuration">
          <div className="patter-model-gallery" aria-label="Patter models">
            {[{ id: "patter-1-nano" as const, title: "Patter 1 Nano", lead: "A lighter footprint", description: "For short, everyday dictation with grammar fixes and custom app instructions.", family: "Gemma 270M · 4-bit", detail: "Best suited to short dictation. Longer inputs are split into chunks; if generation is truncated, the original transcript is kept." }, { id: "patter-1-mini" as const, title: "Patter 1 Mini", lead: "More model capacity", description: "A larger model for instruction-based cleanup and app-specific formatting.", family: "Qwen3 0.6B · 4-bit", detail: "Accepts the same custom app instructions as nano. Comparative quality and speed have not yet been benchmarked." }].map(option => {
              const status = modelStatuses[option.id];
              const isDefault = settings.cleanup_provider === "built_in" && settings.built_in_model === option.id;
              const selected = builtInSelected && modelChoice === option.id;
              return <article key={option.id} className={cn("patter-model-card", selected && "is-selected")}>
                <button type="button" className="patter-model-select" disabled={!!builtInStatus?.downloading} aria-pressed={selected} onClick={() => selectBuiltIn(option.id)}>
                  <span className="patter-card-state">{isDefault && status?.installed ? <><Check size={13} /> Current default</> : status?.installed ? "Downloaded" : (status?.storage_bytes ?? 0) > 0 ? "Incomplete download" : "Available to download"}</span>
                  <span className="patter-card-title">{option.title}</span><span className="patter-card-lead">{option.lead}</span><span className="patter-card-description">{option.description}</span>
                </button>
                <details className="patter-model-info"><summary aria-label={`About ${option.title}`}><Info size={16} /></summary><p>{option.detail}</p></details>
                <div className="patter-card-specs"><span>{option.family}</span><span>English · On-device</span></div>
                <footer><div><Button variant={selected ? "default" : "outline"} size="sm" disabled={status?.supported === false || !!builtInStatus?.downloading || isDefault && settings.llm_cleanup_enabled && option.id === "patter-1-mini"} onClick={() => { selectBuiltIn(option.id); if (isDefault && settings.llm_cleanup_enabled) setManagedProvider(managedProvider === "built_in" && modelChoice === option.id ? null : "built_in"); else void setUpBuiltIn(undefined, option.id); }}>{status?.supported === false ? "Unavailable" : setupBusy && modelChoice === option.id ? <><Loader2 size={13} className="animate-spin" />{builtInStatus?.downloading ? `Downloading ${builtInStatus.progress}%` : "Preparing…"}</> : isDefault && settings.llm_cleanup_enabled && option.id === "patter-1-mini" ? "In use" : isDefault && settings.llm_cleanup_enabled ? managedProvider === "built_in" && modelChoice === option.id ? "Close" : "Manage" : status?.installed ? "Use model" : "Download & use"}</Button><span className="patter-download-size">{status ? `${Math.ceil((status.storage_bytes || status.download_bytes) / 1_000_000)} MB${status.installed ? " on disk" : status.storage_bytes > 0 ? " stored" : " download"}` : "Checking size…"}</span></div><div className="flex items-center gap-2"><span className="patter-card-footnote">App-aware cleanup<br />Custom instructions</span>{(status?.installed || (status?.storage_bytes ?? 0) > 0) && <Button variant="ghost" size="icon-sm" disabled={!!builtInStatus?.downloading || isDefault && settings.llm_cleanup_enabled} title={isDefault && settings.llm_cleanup_enabled ? "Turn cleanup off or choose another model before removing" : "Remove download"} aria-label={`Remove ${option.title} download`} onClick={() => { setDeleteError(""); setDeleteTarget({ model: option.id, bytes: status?.storage_bytes ?? status?.download_bytes ?? 0 }); }}><Trash2 size={14} /></Button>}</div></footer>
                {option.id === "patter-1-nano" && !status?.installed && <p className="px-6 pb-4 text-[11px] leading-relaxed text-muted-foreground">Downloading accepts the <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">Gemma Terms</a> and <a href="https://ai.google.dev/gemma/prohibited_use_policy" target="_blank" rel="noreferrer" className="underline underline-offset-2">use restrictions</a>.</p>}
              </article>;
            })}
          </div>
          <p className="patter-model-requirements">Requires Apple Silicon and macOS 14+. Built-in cleanup uses English. Download & use activates the model and enables English cleanup once it is ready.</p>
          {managedProvider === "built_in" && <section className="provider-management" aria-label="Patter model maintenance"><div className="provider-management-heading"><h3>{builtInModelName(modelChoice)}</h3><Button variant="ghost" size="sm" onClick={() => setManagedProvider(null)}>Close</Button></div>
          {builtInStatus && !builtInStatus.supported && <p className="px-4 pb-4 text-xs text-muted-foreground">Built-in cleanup requires Apple Silicon and macOS 14 or newer. Use Ollama on this device.</p>}
          {builtInStatusError && !builtInSelected && <div role="alert" className="p-4 text-sm text-destructive"><p>Could not check built-in availability: {builtInStatusError}</p><button onClick={refreshBuiltIn} className="rounded-md underline underline-offset-4 focus-visible:ring-focus">Retry</button></div>}
          {builtInSelected && <BuiltInModelSettings key={modelChoice} model={modelChoice} settings={settings} status={builtInStatus} error={builtInError || builtInStatusError} busy={setupBusy} onEnable={setUpBuiltIn} onRefresh={() => { setBuiltInError(""); void refreshBuiltIn(); }} />}

          </section>}
          <section className="other-providers"><h2>Other providers</h2><div className="provider-row"><span className="provider-symbol"><Server size={20} /></span><div className="provider-row-name"><h3>Ollama</h3><p>Your local models, personal memory, and meeting notes.</p></div><span className={cn("provider-connection", ollamaUp ? "text-success" : "text-warning")}>{checkingOllama ? "Checking…" : ollamaUp ? "Connected" : "Not running"}</span>{settings.cleanup_provider === "ollama" && <span className="provider-default"><Check size={12} /> Current default</span>}<Button variant="outline" size="sm" onClick={() => { setProviderChoice("ollama"); setManagedProvider(managedProvider === "ollama" ? null : "ollama"); }}>Manage</Button></div></section>
          {managedProvider === "ollama" && <section className="provider-management" aria-label="Ollama setup"><div className="provider-management-heading"><div><h3>Ollama setup</h3><p className="mt-1 text-xs text-muted-foreground">{ollamaUp ? "Choose an installed model for dictation cleanup." : "Start Ollama, then download a model with ollama pull <model>."}</p></div><Button variant="outline" size="sm" onClick={refreshOllama} disabled={checkingOllama}><RefreshCw size={13} />Refresh</Button></div>
          {providerChoice === "ollama" && <label className="block px-4 text-xs text-muted-foreground">Find an installed model<input type="search" value={modelSearch} onChange={event => setModelSearch(event.target.value)} placeholder="Search Ollama models…" className="model-search mt-2" /></label>}
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
                  {(ollamaModels ?? []).filter(m => m.toLowerCase().includes(modelSearch.toLowerCase())).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {providerChoice === "ollama" && (
            <details className="p-4"><summary className="cursor-pointer text-sm font-medium">Advanced · Memory usage</summary><div className="flex flex-wrap items-center justify-between gap-4 p-4">
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
            </details>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="text-xs text-muted-foreground">Memory and meeting notes use Ollama independently of your dictation provider.</p><Button disabled={!ollamaReady || settings.cleanup_provider === "ollama" && settings.llm_cleanup_enabled} onClick={() => update({ cleanup_provider: "ollama", llm_cleanup_enabled: true })}>{settings.cleanup_provider === "ollama" && settings.llm_cleanup_enabled ? "Current default" : "Set as default"}</Button></div>
          </section>}
          <CleanupPlayground settings={settings} statuses={modelStatuses} busy={setupBusy || !!removingModel} />
        </div>
      </section>

      {/* Meetings */}
      <section hidden={section !== "meetings"} className="space-y-4">
        <h2 className="px-1 text-base font-medium">Meeting intelligence</h2>
        <div className="surface-raised rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SettingIcon icon={WandSparkles} active={!!settings.meeting_ollama_model} />
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Meeting Notes Model</p>
                <p className="text-xs text-muted-foreground">
                  {ollamaUp ? "Generate minutes, decisions, and summaries with Ollama. Built-in dictation models do not generate meeting notes." : "Start Ollama to choose a meeting notes model. Dictation cleanup can use built-in models independently."}
                </p>
              </div>
            </div>
            <Select
              value={settings.meeting_ollama_model ?? "same"}
              disabled={!ollamaModels?.length}
              onValueChange={(val) => update({ meeting_ollama_model: val === "same" ? null : val })}
            >
              <SelectTrigger aria-label="Meeting notes model" className="w-full sm:w-48 bg-background border-input text-sm truncate disabled:opacity-50">
                <SelectValue placeholder="Choose an Ollama model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">{settings.ollama_model ? `Use Ollama default · ${settings.ollama_model}` : "No Ollama default configured"}</SelectItem>
                {(ollamaModels ?? []).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!ollamaUp && <div className="px-4 pb-4"><Button variant="outline" size="sm" disabled={checkingOllama} onClick={refreshOllama}><RefreshCw size={13} className={checkingOllama ? "animate-spin" : ""} />Check Ollama</Button></div>}
        </div>
      </section>

      <section hidden={section !== "profiles"} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-base font-medium">App profiles</h2><p className="mt-1 text-xs text-muted-foreground">Adjust the tone for each app. Changes apply when you save.</p></div>{profilesDirty && <span role="status" className="text-xs text-warning">Unsaved profile changes</span>}</div>
        <div className="surface-raised rounded-xl p-4 space-y-4">
          <p className="text-xs leading-relaxed text-muted-foreground">Ollama, patter-1-nano, and patter-1-mini accept profile instructions. Profiles guide formatting; they do not turn cleanup off.{!settings.llm_cleanup_enabled && " Enable dictation cleanup to use profiles."}</p>
          {!profiles.length && <p className="py-3 text-sm text-muted-foreground">No app profiles yet. Start with a template or add your own.</p>}
          <div className="space-y-3">{profiles.map((profile, index) => <div key={index} className="border-t border-border/50 pt-3"><button type="button" className="flex w-full items-center gap-3 py-2 text-left" aria-expanded={editingProfile === index} onClick={() => setEditingProfile(editingProfile === index ? null : index)}><NativeAppIcon appName={profile.app} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{profile.app || "New profile"}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{profile.prompt || "Add cleanup instructions"}</span></span><span className="text-xs text-accent-foreground">{editingProfile === index ? "Close" : "Edit"}</span></button><div className={cn("items-start gap-2", editingProfile === index ? "flex" : "hidden")}>
            <div className="mt-6 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"><NativeAppIcon appName={profile.app} /></div>
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <label className="text-xs text-muted-foreground">App names<input aria-label={`App names for profile ${index + 1}`} value={profile.app} placeholder="Mail, Outlook" onChange={event => setProfileDraft(profiles.map((item, i) => i === index ? { ...item, app: event.target.value } : item))} className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <label className="text-xs text-muted-foreground">Cleanup instructions<textarea aria-label={`Instructions for profile ${index + 1}`} value={profile.prompt} placeholder="Use a concise, professional tone" rows={2} onChange={event => setProfileDraft(profiles.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} className="mt-1 block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
            </div>
            <Button variant="ghost" size="icon-sm" className="mt-6 text-muted-foreground hover:text-destructive" aria-label={`Remove profile ${index + 1}`} title="Remove profile" onClick={() => setProfileDraft(profiles.filter((_, i) => i !== index))}><Trash2 size={14} /></Button>
          </div></div>)}</div>
          <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => { setProfileDraft([...profiles, { app: "", prompt: "" }]); setEditingProfile(profiles.length); }}><Plus size={14} />Add profile</Button><span className="text-xs text-muted-foreground">Templates</span>{APP_PROFILE_TEMPLATES.map(template => <Button key={template.name} variant="ghost" size="sm" onClick={() => { setProfileDraft([...profiles, { app: template.app, prompt: template.prompt }]); setEditingProfile(profiles.length); }}>{template.name}</Button>)}</div>
          {profilesDirty && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3"><Button variant="ghost" onClick={() => setProfileDraft(null)}>Discard changes</Button>{profiles.some(profile => !profile.app.trim()) && <p className="mr-auto text-xs text-warning">Add an app name to each profile before saving.</p>}<Button disabled={profiles.some(profile => !profile.app.trim())} onClick={async () => { if (await update({ app_profiles: profiles })) setProfileDraft(null); }}>Save profiles</Button></div>}
        </div>
      </section>
      </fieldset>
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !removingModel) setDeleteTarget(null); }}><DialogContent><DialogHeader><DialogTitle>Remove {deleteTarget ? builtInModelName(deleteTarget.model) : "model"}?</DialogTitle><DialogDescription>Remove this model’s downloaded files, previous versions, and incomplete downloads from this device{deleteTarget ? ` (about ${Math.ceil(deleteTarget.bytes / 1_000_000)} MB)` : ""}. Your transcripts and app profiles are kept. You can download the model again later.</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={!!removingModel} onClick={() => setDeleteTarget(null)}>Keep model</Button><Button variant="destructive" disabled={!!removingModel} onClick={() => void removeDownload()}>{removingModel && <Loader2 size={14} className="animate-spin" />}{removingModel ? "Removing…" : "Remove download"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
