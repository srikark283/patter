import { useState, useEffect, KeyboardEvent, createContext, useContext, ReactNode, ComponentType } from "react";
import { toast } from "sonner";
import { Search, Zap, Mic, Command, Languages, Timer, Power, Monitor, Volume2, AudioWaveform, Ear, ShieldCheck, X, Accessibility, KeyRound, Bell, CheckCircle2, AlertCircle, Download, Upload, Loader2, Users, Hand, ClipboardPaste, Type } from "lucide-react";
import { PackageIcon } from '@phosphor-icons/react'
import { getSettings, updateSettings, getMicrophones, checkUpdate, Settings, getPermissionStatus, PermissionStatus, openAccessibilitySettings, requestAccessibilityPermission, openInputMonitoringSettings, requestInputMonitoringPermission, openMicrophoneSettings, requestMicrophonePermission, openNotificationSettings, exportData, importData } from "../../../lib/ipc";
import { promptUpdateInstall } from "../../../lib/update";
import { getVersion } from "@tauri-apps/api/app";
import { PageHeader } from "../components/PageHeader";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatHotkey } from "@/lib/hotkey";

const MODES = [
  {
    id: "paste",
    icon: ClipboardPaste,
    tint: "text-amber-400",
    label: "Instant Paste",
    detail: "Copies to clipboard and simulates Cmd+V — fastest",
  },
  {
    id: "type",
    icon: Type,
    tint: "text-blue-400",
    label: "Simulate Typing",
    detail: "Injects keystrokes sequentially — best for remote desktop",
  },
];

/** The filter box's text, so a row can hide itself without every call site
 *  threading a prop down. Empty string means "show everything". */
const FilterContext = createContext("");

function matches(query: string, ...text: (string | undefined)[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.filter(Boolean).join(" ").toLowerCase().includes(q);
}

interface RowMeta {
  icon: ComponentType<{ size?: number; className?: string }>;
  tint: string;
  bg: string;
  title: string;
  description: string;
  /** Extra search terms — what someone would type looking for this row. */
  keywords?: string;
}

/** Every row's metadata in one place, so the filter and the markup can never
 *  disagree about what a row says. Sections search the same objects they render. */
const ROWS = {
  hotkey: { icon: Command, tint: "text-violet-400", bg: "bg-violet-500/10",
    title: "Global Hotkey", description: "Press to start/stop recording anywhere",
    keywords: "shortcut keybinding trigger record" },
  meetingHotkey: { icon: Users, tint: "text-indigo-400", bg: "bg-indigo-500/10",
    title: "Meeting Hotkey", description: "Press to start/stop meeting recording",
    keywords: "shortcut keybinding trigger" },
  pushToTalk: { icon: Hand, tint: "text-blue-400", bg: "bg-blue-500/10",
    title: "Push to Talk", description: "Hold the hotkey to record, release to transcribe",
    keywords: "hold ptt" },
  language: { icon: Languages, tint: "text-sky-400", bg: "bg-sky-500/10",
    title: "Language", description: "For Whisper models only", keywords: "locale english spanish" },
  silence: { icon: Timer, tint: "text-amber-400", bg: "bg-amber-500/10",
    title: "Silence Timeout", description: "Auto-stop after pausing for",
    keywords: "pause auto stop vad" },
  trimSilence: { icon: AudioWaveform, tint: "text-teal-400", bg: "bg-teal-500/10",
    title: "Trim Silence",
    description: "Remove silence and noise before transcribing (Silero VAD) — prevents hallucinations",
    keywords: "vad silero noise hallucination" },
  whisperMode: { icon: Ear, tint: "text-amber-400", bg: "bg-amber-500/10",
    title: "Whisper Mode",
    description: "For dictating quietly in shared spaces — boosts quiet audio, tracks the room's noise floor, and keeps speech the VAD would discard",
    keywords: "quiet shared office library gain" },
  microphone: { icon: Mic, tint: "text-rose-400", bg: "bg-rose-500/10",
    title: "Microphone", description: "Select audio input device",
    keywords: "input device audio mic" },
  hudPosition: { icon: Monitor, tint: "text-cyan-400", bg: "bg-cyan-500/10",
    title: "HUD Position", description: "Where the recording pill appears",
    keywords: "overlay pill top bottom" },
  sounds: { icon: Volume2, tint: "text-orange-400", bg: "bg-orange-500/10",
    title: "UI Sounds", description: "Play a sound when recording starts/stops",
    keywords: "audio feedback chime pop volume" },
  autostart: { icon: Power, tint: "text-green-400", bg: "bg-green-500/10",
    title: "Launch at Login", description: "Start Patter automatically on boot",
    keywords: "startup autostart boot login" },
  outputMode: { icon: Zap, tint: "text-steelIce", bg: "bg-steel/10",
    title: "Text Output", description: "How finished text reaches your cursor",
    keywords: "paste type insert clipboard keystroke" },
  updates: { icon: PackageIcon, tint: "text-fuchsia-400", bg: "bg-fuchsia-500/10",
    title: "Updates", description: "Notify about new versions on launch",
    keywords: "version upgrade release" },
} satisfies Record<string, RowMeta>;

/** One settings row: icon bubble, label, description, and its control. */
function Setting({ icon: Icon, tint, bg, title, description, keywords, children }: RowMeta & { children: ReactNode }) {
  const query = useContext(FilterContext);
  if (!matches(query, title, description, keywords)) return null;
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", bg)}>
          <Icon size={14} className={tint} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-foreground/90">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A titled group of rows. Hides itself when the filter empties it, so the
 *  filter never leaves a bare header over an empty card. */
function SettingsSection({ label, rows, children }: {
  label: string; rows: RowMeta[]; children: ReactNode;
}) {
  const query = useContext(FilterContext);
  if (!rows.some((r) => matches(query, r.title, r.description, r.keywords))) return null;
  return (
    <section className="space-y-4">
      <span className="t-label block px-1 pb-1">{label}</span>
      <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">{children}</div>
    </section>
  );
}

interface PermissionRowProps {
  icon: typeof Mic;
  tint: string;
  bg: string;
  title: string;
  description: string;
  /** Omit when the OS gives no reliable way to query the live status. */
  granted?: boolean;
  onRequestAccess?: () => Promise<boolean | void>;
  onOpenSettings: () => Promise<void>;
}

function PermissionRow({ icon: Icon, tint, bg, title, description, granted, onRequestAccess, onOpenSettings }: PermissionRowProps) {
  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", bg)}>
          <Icon size={14} className={tint} />
        </div>
        <div>
          <p className="text-[13px] font-medium text-foreground/90">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        {granted === undefined ? (
          <span className="text-[11px] text-muted-foreground">Check in System Settings</span>
        ) : granted ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <CheckCircle2 size={12} /> Granted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
            <AlertCircle size={12} /> Not granted
          </span>
        )}
        {granted !== true && onRequestAccess && (
          <button
            onClick={() => onRequestAccess().catch(console.error)}
            className="text-[11px] px-2 py-1 rounded bg-steel/15 text-steelIce hover:bg-steel/25 transition-colors font-medium"
          >
            Request Access
          </button>
        )}
        {granted !== true && (
          <button
            onClick={() => onOpenSettings().catch(console.error)}
            className="text-[11px] text-steelIce/80 hover:text-steelIce transition-colors"
          >
            Open Settings
          </button>
        )}
      </div>
    </div>
  );
}

export function PreferencesView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [recordingField, setRecordingField] = useState<"hotkey" | "meeting_hotkey" | null>(null);
  const [query, setQuery] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    getMicrophones().then(setMics).catch(console.error);
    getVersion().then(setAppVersion).catch(console.error);

    const refreshPermissions = () => getPermissionStatus().then(setPermissions).catch(console.error);
    refreshPermissions();
    // Re-check on window focus — the natural moment after coming back from
    // System Settings, so the page reflects reality without a manual refresh.
    window.addEventListener("focus", refreshPermissions);
    return () => window.removeEventListener("focus", refreshPermissions);
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

  const handleExport = async () => {
    setExporting(true);
    try {
      const saved = await exportData();
      if (saved) toast.success("Data exported");
    } catch (e) {
      toast.error("Export failed: " + e);
    } finally {
      setExporting(false);
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const imported = await importData();
      setConfirmImportOpen(false);
      if (imported) {
        toast.success("Data imported — reloading");
        window.location.reload();
      }
    } catch (e) {
      toast.error("Import failed: " + e);
    } finally {
      setImporting(false);
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

  const applyHotkey = (field: "hotkey" | "meeting_hotkey", combo: string) => {
    setRecordingField(null);
    const other = field === "hotkey" ? settings?.meeting_hotkey : settings?.hotkey;
    if (other && other === combo) {
      toast.error(`"${formatHotkey(combo)}" is already the ${field === "hotkey" ? "meeting" : "dictation"} hotkey`);
      return;
    }
    update({ [field]: combo });
  };

  const handleHotkeyRecord = (field: "hotkey" | "meeting_hotkey") => (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (recordingField !== field) return;

    if (e.key === "Escape") {
      setRecordingField(null);
      return;
    }

    // If standalone modifier, just use the exact modifier code
    if (["Meta", "Shift", "Control", "Alt"].includes(e.key)) {
      // Map JS code to rdev keys
      let key = e.code;
      if (key === "AltLeft") key = "Alt";
      if (key === "AltRight") key = "AltGr";
      applyHotkey(field, key);
      return;
    }

    let key = e.key;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();

    const parts = [];
    if (e.metaKey) parts.push("Super");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(key);

    applyHotkey(field, parts.join("+"));
  };

  if (!settings) return null;

  // Falls back to the first mode so the row still renders if a stored value
  // ever stops matching a known id.
  const activeMode = MODES.find((m) => m.id === settings.output_mode) ?? MODES[0];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <PageHeader title="Preferences" description="Configure Patter's behavior." />

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter settings…"
          className="w-full bg-card ring-1 ring-border rounded-xl pl-9 pr-9 py-2.5 text-[13px] text-foreground/90 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-steel transition-shadow"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            title="Clear filter"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <FilterContext.Provider value={query}>
        {/* Shortcuts: every way of starting a recording, together. These used to
            sit in a "Hardware & System" group alongside updates and autostart. */}
        <SettingsSection label="Shortcuts" rows={[ROWS.hotkey, ROWS.meetingHotkey, ROWS.pushToTalk]}>
          <Setting {...ROWS.hotkey}>
            <input
              readOnly
              value={recordingField === "hotkey" ? "Listening..." : formatHotkey(settings.hotkey)}
              onClick={() => setRecordingField("hotkey")}
              onBlur={() => setRecordingField(null)}
              onKeyDown={handleHotkeyRecord("hotkey")}
              className={cn(
                "w-32 bg-background border border-white/10 rounded-md text-xs font-sans text-center px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel cursor-pointer transition-colors",
                recordingField === "hotkey" ? "border-steel/50 bg-steel/10 text-steelIce" : "hover:border-white/20 text-muted-foreground"
              )}
            />
          </Setting>

          <Setting {...ROWS.meetingHotkey}>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={recordingField === "meeting_hotkey" ? "Listening..." : (settings.meeting_hotkey ? formatHotkey(settings.meeting_hotkey) : "Not set")}
                onClick={() => setRecordingField("meeting_hotkey")}
                onBlur={() => setRecordingField(null)}
                onKeyDown={handleHotkeyRecord("meeting_hotkey")}
                className={cn(
                  "w-32 bg-background border border-white/10 rounded-md text-xs font-sans text-center px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-steel cursor-pointer transition-colors",
                  recordingField === "meeting_hotkey" ? "border-steel/50 bg-steel/10 text-steelIce" : "hover:border-white/20 text-muted-foreground"
                )}
              />
              {settings.meeting_hotkey && (
                <button
                  onClick={() => update({ meeting_hotkey: "" })}
                  className="text-muted-foreground/50 hover:text-destructive transition-colors p-1"
                  title="Clear meeting hotkey"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </Setting>

          <Setting {...ROWS.pushToTalk}>
            <Switch
              checked={settings.push_to_talk}
              onCheckedChange={(checked) => update({ push_to_talk: checked })}
            />
          </Setting>
        </SettingsSection>

        {/* How dictation behaves once it is running. Previously split between
            "Hardware & System" and a separate "Transcription" group. */}
        <SettingsSection label="Dictation" rows={[ROWS.outputMode, ROWS.language, ROWS.silence, ROWS.trimSilence, ROWS.whisperMode]}>
          {/* Was a pair of oversized cards in its own section. It is a two-way
              choice like any other row, so it reads as one — the bubble and the
              description follow the selection, which is what the cards were
              really there to explain. */}
          <Setting
            {...ROWS.outputMode}
            icon={activeMode.icon}
            tint={activeMode.tint}
            description={activeMode.detail}
          >
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
              {MODES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => update({ output_mode: id })}
                  className={cn(
                    "px-3 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                    settings.output_mode === id
                      ? "bg-white/15 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Setting>

          <Setting {...ROWS.language}>
            <Select value={settings.language} onValueChange={(val) => update({ language: val })}>
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
          </Setting>

          <Setting {...ROWS.silence}>
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
          </Setting>

          <Setting {...ROWS.trimSilence}>
            <Switch
              checked={settings.trim_silence}
              onCheckedChange={(checked) => update({ trim_silence: checked })}
            />
          </Setting>

          <Setting {...ROWS.whisperMode}>
            <Switch
              checked={settings.whisper_mode}
              onCheckedChange={(checked) => update({ whisper_mode: checked })}
            />
          </Setting>
        </SettingsSection>

        <SettingsSection label="Audio" rows={[ROWS.microphone]}>
          <Setting {...ROWS.microphone}>
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
          </Setting>
        </SettingsSection>

        <SettingsSection label="Feedback" rows={[ROWS.hudPosition, ROWS.sounds]}>
          <Setting {...ROWS.hudPosition}>
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
          </Setting>

          <Setting {...ROWS.sounds}>
            <div className="flex items-center gap-3">
              {settings.play_sounds && (
                <Select
                  value={settings.sound_theme ?? "pop"}
                  onValueChange={(val) => update({ sound_theme: val })}
                >
                  <SelectTrigger className="w-28 bg-background border-white/10 text-[13px] text-foreground/80 focus-visible:ring-1 focus-visible:ring-steel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pop">Pop</SelectItem>
                    <SelectItem value="chime">Chime</SelectItem>
                    <SelectItem value="wood">Wood</SelectItem>
                    <SelectItem value="pluck">Pluck</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Switch
                checked={settings.play_sounds !== false}
                onCheckedChange={(checked) => update({ play_sounds: checked })}
              />
            </div>
          </Setting>
        </SettingsSection>

        <SettingsSection label="Application" rows={[ROWS.autostart, ROWS.updates]}>
          <Setting {...ROWS.autostart}>
            <Switch
              checked={settings.autostart}
              onCheckedChange={(checked) => update({ autostart: checked })}
            />
          </Setting>

          <Setting
            {...ROWS.updates}
            description={`${appVersion ? `Patter v${appVersion} · ` : ""}Notify about new versions on launch`}
          >
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
          </Setting>
        </SettingsSection>

        {matches(query, "Permissions accessibility input monitoring microphone notifications access") && (
        <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Permissions</span>

        <div className="bg-card ring-1 ring-border rounded-xl divide-y divide-white/5">
          <PermissionRow
            icon={Accessibility}
            tint="text-violet-400"
            bg="bg-violet-500/10"
            title="Accessibility"
            description="Lets Patter type finished text into other apps"
            granted={permissions?.accessibility ?? true}
            onRequestAccess={requestAccessibilityPermission}
            onOpenSettings={openAccessibilitySettings}
          />
          <PermissionRow
            icon={KeyRound}
            tint="text-blue-400"
            bg="bg-blue-500/10"
            title="Input Monitoring"
            description="Needed for the global hotkey to work anywhere"
            granted={permissions?.input_monitoring ?? true}
            onRequestAccess={requestInputMonitoringPermission}
            onOpenSettings={openInputMonitoringSettings}
          />
          <PermissionRow
            icon={Mic}
            tint="text-rose-400"
            bg="bg-rose-500/10"
            title="Microphone"
            description="Required to capture dictation and meeting audio"
            granted={permissions?.microphone ?? true}
            onRequestAccess={requestMicrophonePermission}
            onOpenSettings={openMicrophoneSettings}
          />
          <PermissionRow
            icon={Bell}
            tint="text-amber-400"
            bg="bg-amber-500/10"
            title="Notifications"
            description="Used to alert you when a new version is available"
            onOpenSettings={openNotificationSettings}
          />
        </div>
      </section>
        )}

        {matches(query, "Data backup restore export import") && (
        <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Data</span>
        <div className="bg-card ring-1 ring-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-foreground/90">Backup &amp; restore</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Export settings, dictionary, snippets, memory, history, and meetings to a single file — or restore from one.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmImportOpen(true)}>
                <Upload size={14} />
                Import
              </Button>
            </div>
          </div>
        </div>
      </section>
        )}

      <Dialog open={confirmImportOpen} onOpenChange={setConfirmImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace all data with a backup?</DialogTitle>
            <DialogDescription>
              You'll be asked to pick a backup file. Its contents overwrite your current settings, dictionary, snippets, memory, history, and meetings. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmImportOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmImport} disabled={importing}>
              {importing && <Loader2 size={14} className="animate-spin" />}
              Choose File &amp; Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        {matches(query, "Privacy on-device local telemetry") && (
        <section className="space-y-4">
        <span className="t-label block px-1 pb-1">Privacy</span>
        <div className="bg-card ring-1 ring-border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <ShieldCheck size={14} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-foreground/90">Everything stays on your machine</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Audio is captured, transcribed, and cleaned up entirely on-device. Whisper and Parakeet
                run locally; Ollama runs on localhost. Nothing is ever uploaded — the only network
                traffic Patter makes is downloading models you explicitly request.
              </p>
            </div>
          </div>
        </div>
      </section>
        )}

        {query.trim() && !Object.values(ROWS).some((r) => matches(query, r.title, r.description, r.keywords)) && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No settings match “{query.trim()}”.
          </p>
        )}
      </FilterContext.Provider>
    </div>
  );
}
