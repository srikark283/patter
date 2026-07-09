import { useState, useEffect, KeyboardEvent } from "react";
import { toast } from "sonner";
import { Zap, Keyboard, Mic, Command, Languages, Timer, Power } from "lucide-react";
import { getSettings, updateSettings, getMicrophones, Settings } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

const MODES = [
  {
    id: "paste",
    icon: Zap,
    label: "Instant Paste",
    detail: "Copies to clipboard and simulates Cmd+V — fastest",
  },
  {
    id: "type",
    icon: Keyboard,
    label: "Simulate Typing",
    detail: "Injects keystrokes sequentially — best for remote desktop",
  },
];

export function PreferencesView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [recordingHotkey, setRecordingHotkey] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    getMicrophones().then(setMics).catch(console.error);
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
      <PageHeader title="Settings" description="Configure Patter's behavior." />

      <section>
        <span className="t-label block px-1 pb-2.5">Output Mode</span>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map(({ id, icon: Icon, label, detail }) => {
            const selected = settings.output_mode === id;
            return (
              <button
                key={id}
                onClick={() => update({ output_mode: id })}
                className={cn(
                  "group relative rounded-xl p-5 text-left ring-1 transition-all duration-150 cursor-pointer",
                  selected
                    ? "bg-steel/[0.08] ring-steel/40 shadow-[0_0_20px_rgba(91,155,209,0.12)]"
                    : "bg-card ring-border hover:ring-white/15 hover:bg-white/[0.03]"
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
                  className={selected ? "text-steelIce" : "text-muted-foreground"}
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
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Command size={14} className="text-muted-foreground" />
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
                "w-32 bg-background border border-white/10 rounded-md text-xs font-mono text-center px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel cursor-pointer transition-colors",
                recordingHotkey ? "border-steel/50 bg-steel/10 text-steelIce" : "hover:border-white/20 text-muted-foreground"
              )}
            />
          </div>

          {/* Microphone Selection */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Mic size={14} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Microphone</p>
                <p className="text-[11px] text-muted-foreground">Select audio input device</p>
              </div>
            </div>
            <select
              value={settings.microphone ?? ""}
              onChange={(e) => update({ microphone: e.target.value === "" ? null : e.target.value })}
              className="bg-background border border-white/10 rounded-md text-[13px] text-foreground/80 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel w-48 truncate"
            >
              <option value="">System Default</option>
              {mics.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Autostart */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Power size={14} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Launch at Login</p>
                <p className="text-[11px] text-muted-foreground">Start Patter automatically on boot</p>
              </div>
            </div>
            <button
              onClick={() => update({ autostart: !settings.autostart })}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                settings.autostart ? "bg-steelIce" : "bg-white/10"
              )}
            >
              <span 
                className={cn(
                  "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200",
                  settings.autostart ? "translate-x-5" : ""
                )} 
              />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Transcription</span>
        
        <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">
          {/* Language Selection */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Languages size={14} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Language</p>
                <p className="text-[11px] text-muted-foreground">For Whisper models only</p>
              </div>
            </div>
            <select
              value={settings.language}
              onChange={(e) => update({ language: e.target.value })}
              className="bg-background border border-white/10 rounded-md text-[13px] text-foreground/80 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel w-32"
            >
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
            </select>
          </div>

          {/* Silence Timeout */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                <Timer size={14} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground/90">Silence Timeout</p>
                <p className="text-[11px] text-muted-foreground">Auto-stop after pausing for</p>
              </div>
            </div>
            <select
              value={settings.silence_timeout_ms.toString()}
              onChange={(e) => update({ silence_timeout_ms: parseInt(e.target.value, 10) })}
              className="bg-background border border-white/10 rounded-md text-[13px] text-foreground/80 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel w-32"
            >
              <option value="500">0.5s (Fast)</option>
              <option value="1000">1.0s (Normal)</option>
              <option value="1500">1.5s (Relaxed)</option>
              <option value="2500">2.5s (Slow)</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
