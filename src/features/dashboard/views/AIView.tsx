import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, SparkleIcon, Clock } from "lucide-react";
import { NativeAppIcon } from "../components/NativeAppIcon";
import { MagicWandIcon, LightningAIcon } from '@phosphor-icons/react'
import { getSettings, updateSettings, listOllamaModels, getS1Status, enableS1, Settings, S1Status } from "../../../lib/ipc";
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [providerChoice, setProviderChoice] = useState<Settings["cleanup_provider"]>("ollama");
  const [s1Status, setS1Status] = useState<S1Status | null>(null);
  const [s1Error, setS1Error] = useState("");
  const [s1StatusError, setS1StatusError] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const refreshS1 = async () => {
    try { setS1Status(await getS1Status("s1_mini")); setS1StatusError(""); }
    catch (error) { setS1StatusError(String(error)); }
  };
  useEffect(() => {
    void refreshS1();
    if (providerChoice !== "built_in") return;
    const timer = window.setInterval(() => { void refreshS1(); }, 1000);
    return () => window.clearInterval(timer);
  }, [providerChoice]);
  const setUpS1 = async () => {
    setSetupBusy(true); setS1Error("");
    try {
      const saved = await enableS1();
      setSettings(saved); setProviderChoice("built_in");
      await refreshS1();
      toast.success("S1-mini cleanup enabled in English");
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

  useEffect(() => {
    getSettings().then(saved => { setSettings(saved); setProviderChoice(saved.cleanup_provider); }).catch(console.error);
    refreshOllama();
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...patch };
    setSettings(newSettings);
    try {
      await updateSettings(newSettings);
      return true;
    } catch (e) {
      toast.error("Failed to save settings: " + e);
      setSettings(settings);
      return false;
    }
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
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const ollamaUp = ollamaModels !== null;
  const builtInSelected = providerChoice === "built_in";
  const s1Ready = !!s1Status?.supported && s1Status.installed && s1Status.runtime_ready;
  const cleanupActive = settings.cleanup_provider === providerChoice && settings.llm_cleanup_enabled;
  const chooseProvider = async (value: Settings["cleanup_provider"]) => {
    const previous = providerChoice;
    setProviderChoice(value);
    if (value === "ollama" && !await update({ cleanup_provider: value })) setProviderChoice(previous);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader
        title="Intelligence"
        description="Local intelligence for dictation cleanup, meeting notes, and per-app tone."
      />

      {/* Ollama status */}
      {providerChoice === "ollama" && <div className="surface-raised rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "w-2 h-2 rounded-full flex-none",
              ollamaUp ? "bg-success shadow-[0_0_6px_var(--color-success)]" : "bg-warning shadow-[0_0_6px_var(--color-warning)]"
            )}
          />
          <div>
            <p className="text-[13px] font-medium text-foreground/90">
              {ollamaUp
                ? `Ollama running · ${ollamaModels.length} model${ollamaModels.length === 1 ? "" : "s"} available`
                : "Ollama not detected"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {ollamaUp
                ? "Everything below runs locally — nothing leaves your device."
                : "Install from ollama.com and pull a model (e.g. `ollama pull qwen2.5:7b`), then retry."}
            </p>
          </div>
        </div>
        <button
          onClick={refreshOllama}
          disabled={checkingOllama}
          className="flex items-center gap-1.5 text-[12px] text-steelIce hover:text-steelIce/80 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={checkingOllama ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>}

      {/* Dictation cleanup */}
      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Dictation</span>
        <div className="surface-raised rounded-xl divide-y divide-foreground/5">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <SettingIcon icon={SparkleIcon} active={cleanupActive} />
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Dictation Cleanup</p>
                <p className="text-[11px] text-muted-foreground">
                  Polish transcripts — fixes grammar, removes filler words
                </p>
              </div>
            </div>
            <Switch
              checked={cleanupActive}
              disabled={setupBusy || (builtInSelected && (!s1Ready || settings.language !== "en"))}
              aria-label="Enable dictation cleanup"
              onCheckedChange={(checked) => builtInSelected && checked ? setUpS1() : update({ llm_cleanup_enabled: checked })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-[13px] font-medium text-foreground/90" id="cleanup-provider-label">Dictation Cleanup Provider</p>
              <p className="text-[11px] text-muted-foreground">Meetings, voice commands, and memory embeddings use Ollama.</p>
            </div>
            <Select disabled={setupBusy} value={providerChoice} onValueChange={chooseProvider}>
              <SelectTrigger aria-labelledby="cleanup-provider-label" className="w-48 bg-background border-foreground/10 text-[13px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ollama">Ollama</SelectItem><SelectItem value="built_in" disabled={!s1Status?.supported}>Built-in</SelectItem></SelectContent>
            </Select>
          </div>
          {s1Status && !s1Status.supported && <p className="px-4 pb-4 text-xs text-muted-foreground">Built-in cleanup requires Apple Silicon and macOS 14 or newer. Use Ollama on this device.</p>}
          {s1StatusError && !builtInSelected && <div role="alert" className="p-4 text-sm text-destructive"><p>Could not check built-in availability: {s1StatusError}</p><button onClick={refreshS1} className="rounded-md underline underline-offset-4 focus-visible:ring-focus">Retry</button></div>}
          {builtInSelected && <S1Settings settings={settings} status={s1Status} error={s1Error || s1StatusError} busy={setupBusy} onEnable={setUpS1} onRefresh={() => { setS1Error(""); void refreshS1(); }} />}

          {providerChoice === "ollama" && (
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <SettingIcon icon={LightningAIcon} active={!!settings.ollama_model} />
                <div>
                  <p className="text-[13px] font-medium text-foreground/90">Cleanup Model</p>
                  <p className="text-[11px] text-muted-foreground">
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
                <SelectTrigger className="w-48 bg-background border-foreground/10 text-[13px] text-foreground/80 focus-visible:ring-focus truncate disabled:opacity-50">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select a model</SelectItem>
                  {(ollamaModels ?? []).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {settings.llm_cleanup_enabled && providerChoice === "ollama" && (
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <SettingIcon icon={Clock} active={settings.ollama_keep_alive_minutes !== 0} />
                <div>
                  <p className="text-[13px] font-medium text-foreground/90">Keep Model Loaded</p>
                  <p className="text-[11px] text-muted-foreground">
                    How long Ollama holds the model in memory after a dictation. Longer
                    avoids a multi-second reload; shorter gives the RAM back sooner.
                  </p>
                </div>
              </div>
              <Select
                value={String(settings.ollama_keep_alive_minutes)}
                onValueChange={(val) => update({ ollama_keep_alive_minutes: Number(val) })}
              >
                <SelectTrigger className="w-48 bg-background border-foreground/10 text-[13px] text-foreground/80 focus-visible:ring-focus truncate">
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
        <span className="t-label block px-1 pb-1">Meetings</span>
        <div className="surface-raised rounded-xl">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <SettingIcon icon={MagicWandIcon} active={!!settings.meeting_ollama_model} />
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Meeting Notes Model</p>
                <p className="text-[11px] text-muted-foreground">
                  Generates minutes, decisions, and summaries — larger models summarize better
                </p>
              </div>
            </div>
            <Select
              value={settings.meeting_ollama_model ?? "same"}
              disabled={!ollamaModels?.length}
              onValueChange={(val) => update({ meeting_ollama_model: val === "same" ? null : val })}
            >
              <SelectTrigger className="w-48 bg-background border-foreground/10 text-[13px] text-foreground/80 focus-visible:ring-focus truncate disabled:opacity-50">
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
        </div>
      </section>

      {/* App profiles */}
      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">App Profiles</span>
        <div className="surface-raised rounded-xl p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Ollama follows the full instruction. S1-mini uses supported tone, list, and email hints; code and terminal dictation stays verbatim. Match an app by name (e.g.
            "slack"). {!settings.llm_cleanup_enabled && "Requires Dictation Cleanup to be enabled."}
          </p>
          {settings.app_profiles.map((profile, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="min-w-7 h-7 px-1.5 rounded-md bg-foreground/5 border border-foreground/5 flex items-center justify-center flex-none text-muted-foreground" title="Category icon">
                <NativeAppIcon appName={profile.app} />
              </div>
              <input
                value={profile.app}
                placeholder="App name"
                onChange={(e) => {
                  const next = settings.app_profiles.map((p, j) =>
                    j === i ? { ...p, app: e.target.value } : p
                  );
                  update({ app_profiles: next });
                }}
                className="w-32 bg-background border border-foreground/10 rounded-md text-xs font-sans px-2 py-1.5 focus:outline-none focus-visible:ring-focus text-foreground/80"
              />
              <input
                value={profile.prompt}
                placeholder='Instruction, e.g. "casual tone, no punctuation fixes"'
                onChange={(e) => {
                  const next = settings.app_profiles.map((p, j) =>
                    j === i ? { ...p, prompt: e.target.value } : p
                  );
                  update({ app_profiles: next });
                }}
                className="flex-1 bg-background border border-foreground/10 rounded-md text-xs font-sans px-2 py-1.5 focus:outline-none focus-visible:ring-focus text-foreground/80"
              />
              <button
                onClick={() =>
                  update({ app_profiles: settings.app_profiles.filter((_, j) => j !== i) })
                }
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Remove profile"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() =>
                update({ app_profiles: [...settings.app_profiles, { app: "", prompt: "" }] })
              }
              className="text-[12px] font-medium text-steelIce hover:text-steelIce/80 transition-colors"
            >
              + Add blank
            </button>
            <div className="w-px h-3 bg-foreground/10" />
            <span className="text-[11px] text-muted-foreground">Add template:</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {APP_PROFILE_TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() =>
                    update({ app_profiles: [...settings.app_profiles, { app: t.app, prompt: t.prompt }] })
                  }
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors bg-foreground/5 hover:bg-foreground/10 px-2 py-1 rounded-md border border-foreground/5 [&>svg]:opacity-70"
                >
                  <NativeAppIcon appName={t.app} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
