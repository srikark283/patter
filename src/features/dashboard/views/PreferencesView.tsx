import { useState, useEffect, KeyboardEvent } from "react";
import { toast } from "sonner";
import { Zap, Keyboard, Mic, Command, Languages, Timer, Power, Sparkles, Monitor, Volume2, AudioWaveform, ShieldCheck } from "lucide-react";
import { getSettings, updateSettings, getMicrophones, checkUpdate, Settings } from "../../../lib/ipc";
import { promptUpdateInstall } from "../../../lib/update";
import { getVersion } from "@tauri-apps/api/app";
import { PageHeader } from "../components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODES = [
  {
    id: "paste",
    icon: Zap,
    tint: "text-amber-400",
    label: "Instant Paste",
    detail: "Copies to clipboard and simulates Cmd+V — fastest",
  },
  {
    id: "type",
    icon: Keyboard,
    tint: "text-blue-400",
    label: "Simulate Typing",
    detail: "Injects keystrokes sequentially — best for remote desktop",
  },
];

export function PreferencesView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    getMicrophones().then(setMics).catch(console.error);
    getVersion().then(setAppVersion).catch(console.error);
  }, []);

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const version = await checkUpdate();
      if (version) {
        promptUpdateInstall(version);
      } else {
        toast.success("You're on the latest version");
      }
    } catch (e) {
      toast.error("Update check failed: " + e);
    } finally {
      setCheckingUpdate(false);
    }
  };

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

  const handleHotkeyRecord = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (!recordingHotkey) return;
    
    // Ignore standalone modifiers
    if (["Meta", "Shift", "Control", "Alt"].includes(e.key)) return;
    
    let key = e.key;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();

    const parts = [];
    if (e.metaKey) parts.push("Super");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(key);

    const combo = parts.join("+");
    setRecordingHotkey(false);
    update({ hotkey: combo });
  };

  if (!settings) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <PageHeader title="Preferences" description="Configure Patter's behavior." />

      <section>
        <span className="t-label block px-1 pb-2.5">Output</span>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map(({ id, icon: Icon, tint, label, detail }) => {
            const selected = settings.output_mode === id;
            return (
              <button
                key={id}
                onClick={() => update({ output_mode: id })}
                className={cn(
                  "group relative rounded-xl p-5 text-left ring-1 transition-all duration-150 cursor-pointer",
                  selected
                    ? "bg-steel/8 ring-steel/40 shadow-[0_0_20px_rgba(91,155,209,0.12)]"
                    : "bg-card ring-border hover:ring-white/15 hover:bg-white/3"
                )}
              >
                <span
                  className={cn(
                    "absolute top-4 right-4 w-2 h-2 rounded-full transition-all",
                    selected ? "bg-steelIce shadow-[0_0_8px_var(--color-steel)]" : "bg-white/10"
                  )}
                />
                <Icon
                  size={17}
                  strokeWidth={1.8}
                  className={selected ? tint : "text-muted-foreground"}
                />
                <p className={cn("mt-3 text-[13px] font-semibold", selected ? "text-foreground" : "text-foreground/85")}>
                  {label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Hardware & System</span>
        
        <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">
          {/* Global Hotkey */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center">
                <Command size={14} className="text-violet-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Global Hotkey</p>
                <p className="text-[11px] text-muted-foreground">Press to start/stop recording anywhere</p>
              </div>
            </div>
            <input
              readOnly
              value={recordingHotkey ? "Listening..." : settings.hotkey}
              onClick={() => setRecordingHotkey(true)}
              onBlur={() => setRecordingHotkey(false)}
              onKeyDown={handleHotkeyRecord}
              className={cn(
                "w-32 bg-background border border-white/10 rounded-md text-xs font-sans text-center px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel cursor-pointer transition-colors",
                recordingHotkey ? "border-steel/50 bg-steel/10 text-steelIce" : "hover:border-white/20 text-muted-foreground"
              )}
            />
          </div>

          {/* Push to Talk */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <Keyboard size={14} className="text-blue-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Push to Talk</p>
                <p className="text-[11px] text-muted-foreground">Hold the hotkey to record, release to transcribe</p>
              </div>
            </div>
            <Switch
              checked={settings.push_to_talk}
              onCheckedChange={(checked) => update({ push_to_talk: checked })}
            />
          </div>

          {/* Microphone Selection */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center">
                <Mic size={14} className="text-rose-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Microphone</p>
                <p className="text-[11px] text-muted-foreground">Select audio input device</p>
              </div>
            </div>
            <Select
              value={settings.microphone ?? "none"}
              onValueChange={(val) => update({ microphone: val === "none" ? null : val })}
            >
              <SelectTrigger className="w-48 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel">
                <SelectValue placeholder="System Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">System Default</SelectItem>
                {mics.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Autostart */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                <Power size={14} className="text-green-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Launch at Login</p>
                <p className="text-[11px] text-muted-foreground">Start Patter automatically on boot</p>
              </div>
            </div>
            <Switch
              checked={settings.autostart}
              onCheckedChange={(checked) => update({ autostart: checked })}
            />
          </div>

          {/* Updates */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-fuchsia-500/10 flex items-center justify-center">
                <Sparkles size={14} className="text-fuchsia-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Updates</p>
                <p className="text-[11px] text-muted-foreground">
                  {appVersion ? `Patter v${appVersion} · ` : ""}Notify about new versions on launch
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdate}
                className="text-[12px] text-steelIce/80 hover:text-steelIce disabled:opacity-50 transition-colors"
              >
                {checkingUpdate ? "Checking…" : "Check for Updates"}
              </button>
              <Switch
                checked={settings.auto_update}
                onCheckedChange={(checked) => update({ auto_update: checked })}
              />
            </div>
          </div>

          {/* HUD Position */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center">
                <Monitor size={14} className="text-cyan-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">HUD Position</p>
                <p className="text-[11px] text-muted-foreground">Where the recording pill appears</p>
              </div>
            </div>
            <Select
              value={settings.hud_position ?? "bottom"}
              onValueChange={(val) => update({ hud_position: val })}
            >
              <SelectTrigger className="w-32 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* UI Sounds */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                <Volume2 size={14} className="text-orange-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">UI Sounds</p>
                <p className="text-[11px] text-muted-foreground">Play a sound when recording starts/stops</p>
              </div>
            </div>
            <Switch
              checked={settings.play_sounds !== false}
              onCheckedChange={(checked) => update({ play_sounds: checked })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Transcription</span>
        
        <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">
          {/* Language Selection */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-sky-500/10 flex items-center justify-center">
                <Languages size={14} className="text-sky-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Language</p>
                <p className="text-[11px] text-muted-foreground">For Whisper models only</p>
              </div>
            </div>
            <Select
              value={settings.language}
              onValueChange={(val) => update({ language: val })}
            >
              <SelectTrigger className="w-32 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="de">German</SelectItem>
                <SelectItem value="ja">Japanese</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Silence Timeout */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Timer size={14} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Silence Timeout</p>
                <p className="text-[11px] text-muted-foreground">Auto-stop after pausing for</p>
              </div>
            </div>
            <Select
              value={settings.silence_timeout_ms.toString()}
              onValueChange={(val) => update({ silence_timeout_ms: parseInt(val, 10) })}
            >
              <SelectTrigger className="w-32 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="500">0.5s (Fast)</SelectItem>
                <SelectItem value="1000">1.0s (Normal)</SelectItem>
                <SelectItem value="1500">1.5s (Relaxed)</SelectItem>
                <SelectItem value="2500">2.5s (Slow)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Trim Silence (Silero VAD) */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center">
                <AudioWaveform size={14} className="text-teal-400" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Trim Silence</p>
                <p className="text-[11px] text-muted-foreground">
                  Remove silence and noise before transcribing (Silero VAD) — prevents hallucinations
                </p>
              </div>
            </div>
            <Switch
              checked={settings.trim_silence}
              onCheckedChange={(checked) => update({ trim_silence: checked })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Privacy</span>
        <div className="bg-card ring-1 ring-border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <ShieldCheck size={14} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-foreground/90">Everything stays on your Mac</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Audio is captured, transcribed, and cleaned up entirely on-device. Whisper and Parakeet
                run locally; Ollama runs on localhost. Nothing is ever uploaded — the only network
                traffic Patter makes is downloading models you explicitly request.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
