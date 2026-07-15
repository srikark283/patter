import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Trash2, RefreshCw } from "lucide-react";
import { MagicWandIcon, LightningAIcon, SparkleIcon } from '@phosphor-icons/react'
import { getSettings, updateSettings, listOllamaModels, Settings } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
  const [checkingOllama, setCheckingOllama] = useState(false);

  const refreshOllama = () => {
    setCheckingOllama(true);
    listOllamaModels()
      .then(setOllamaModels)
      .catch(() => setOllamaModels(null))
      .finally(() => setCheckingOllama(false));
  };

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    refreshOllama();
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...patch };
    setSettings(newSettings);
    try {
      await updateSettings(newSettings);
    } catch (e) {
      toast.error("Failed to save settings: " + e);
      setSettings(settings);
    }
  };

  if (!settings) return null;

  const ollamaUp = ollamaModels !== null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader
        title="Intelligence"
        description="Local LLM features powered by Ollama — cleanup, meeting notes, per-app tone."
      />

      {/* Ollama status */}
      <div className="bg-card ring-1 ring-border rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "w-2 h-2 rounded-full flex-none",
              ollamaUp ? "bg-success shadow-[0_0_6px_var(--color-success)]" : "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]"
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
          className="flex items-center gap-1.5 text-[12px] text-steelIce/80 hover:text-steelIce disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={checkingOllama ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Dictation cleanup */}
      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Dictation</span>
        <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-fuchsia-500/10 flex items-center justify-center">
                <SparkleIcon size={14} className="text-fuchsia-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Semantic Cleanup</p>
                <p className="text-[11px] text-muted-foreground">
                  Polish transcripts — fixes grammar, removes filler words
                </p>
              </div>
            </div>
            <Switch
              checked={settings.llm_cleanup_enabled}
              onCheckedChange={(checked) => update({ llm_cleanup_enabled: checked })}
            />
          </div>

          {settings.llm_cleanup_enabled && (
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center">
                  <LightningAIcon size={14} className="text-violet-400" />
                </div>
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
                <SelectTrigger className="w-48 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel truncate disabled:opacity-50">
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
        </div>
      </section>

      {/* Meetings */}
      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Meetings</span>
        <div className="bg-card ring-1 ring-border rounded-xl">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center">
                <MagicWandIcon size={14} className="text-sky-400" />
              </div>
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
              <SelectTrigger className="w-48 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel truncate disabled:opacity-50">
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
        <div className="bg-card ring-1 ring-border rounded-xl p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Extra cleanup instruction when dictating into a matching app (name substring, e.g.
            "slack"). {!settings.llm_cleanup_enabled && "Requires Semantic Cleanup to be enabled."}
          </p>
          {settings.app_profiles.map((profile, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={profile.app}
                placeholder="App name"
                onChange={(e) => {
                  const next = settings.app_profiles.map((p, j) =>
                    j === i ? { ...p, app: e.target.value } : p
                  );
                  update({ app_profiles: next });
                }}
                className="w-32 bg-background border border-white/10 rounded-md text-xs font-sans px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel text-foreground/80"
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
                className="flex-1 bg-background border border-white/10 rounded-md text-xs font-sans px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel text-foreground/80"
              />
              <button
                onClick={() =>
                  update({ app_profiles: settings.app_profiles.filter((_, j) => j !== i) })
                }
                className="text-muted-foreground hover:text-red-400 transition-colors p-1"
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
            <div className="w-px h-3 bg-white/10" />
            <span className="text-[11px] text-muted-foreground">Add template:</span>
            <div className="flex flex-wrap gap-2">
              {APP_PROFILE_TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() =>
                    update({ app_profiles: [...settings.app_profiles, { app: t.app, prompt: t.prompt }] })
                  }
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-md border border-white/5"
                >
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
