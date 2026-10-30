import { ShortcutKeys } from "../components/ShortcutKeys";
import { useState, useEffect, KeyboardEvent, createContext, useContext, ReactNode, ComponentType } from "react";
import { toast } from "sonner";
import { Search, SunMoon, Zap, Mic, Command, Languages, Timer, Power, Monitor, Volume2, AudioWaveform, Ear, ShieldCheck, X, Accessibility, KeyRound, Bell, CheckCircle2, AlertCircle, Download, Upload, Loader2, Users, Hand, ClipboardPaste, Type, Wand2 } from "lucide-react";
import { PackageIcon } from '@phosphor-icons/react'
import { getSettings, updateSettings, getMicrophones, checkUpdate, Settings, getPermissionStatus, PermissionStatus, openAccessibilitySettings, requestAccessibilityPermission, openInputMonitoringSettings, requestInputMonitoringPermission, openMicrophoneSettings, requestMicrophonePermission, openNotificationSettings, exportData, importData } from "../../../lib/ipc";
import { promptUpdateInstall } from "../../../lib/update";
import { getVersion } from "@tauri-apps/api/app";
import { PageHeader } from "../components/PageHeader";
import { SettingIcon } from "../components/SettingIcon";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGES, LANGUAGE_NAMES, COMMON_LANGUAGE_CODES } from "@/lib/languages";
import { MODEL_MULTILINGUAL } from "./ModelsView";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatHotkey, IS_MAC } from "@/lib/hotkey";
import { useTheme, setTheme, type Theme } from "@/lib/theme";

const MODES = [
  {
    id: "paste",
    icon: ClipboardPaste,
    label: "Instant Paste",
    detail: "Copies to clipboard and simulates Cmd+V — fastest",
  },
  {
    id: "type",
    icon: Type,
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
  title: string;
  description: string;
  /** Extra search terms — what someone would type looking for this row. */
  keywords?: string;
  /** The setting a section is really about. Gets more room and a heavier
   *  title, so a page of rows has a shape instead of one flat rhythm. */
  primary?: boolean;
}

/** Every row's metadata in one place, so the filter and the markup can never
 *  disagree about what a row says. Sections search the same objects they render. */
type HotkeyField = "hotkey" | "meeting_hotkey" | "command_hotkey";
type CommandMode = "off" | "hotkey" | "phrase";

/// Bare-modifier bindings (rdev key codes) mapped to the name the same
/// modifier carries inside a combo, so the two can be compared.
const MODIFIER_AS_COMBO_PART: Record<string, string> = {
  ControlLeft: "Control",
  ControlRight: "Control",
  Alt: "Alt",
  AltGr: "Alt",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  MetaLeft: "Super",
  MetaRight: "Super",
};

/// Doubles as the list of bindings `applyHotkey` checks for collisions.
const HOTKEY_LABELS: Record<HotkeyField, string> = {
  hotkey: "dictation",
  meeting_hotkey: "meeting",
  command_hotkey: "command",
};

const ROWS = {
  hotkey: { icon: Command,
    title: "Global Hotkey", description: "Press to start/stop recording anywhere",
    keywords: "shortcut keybinding trigger record", primary: true },
  meetingHotkey: { icon: Users,
    title: "Meeting Hotkey", description: "Press to start/stop meeting recording",
    keywords: "shortcut keybinding trigger" },
  // The hotkey and the phrase are configuration *of* this row, not rows of
  // their own — so their search terms live here too.
  commandMode: { icon: Wand2,
    title: "Command Mode", description: "Select text and say how to rewrite it",
    keywords: "rewrite edit selection voice command hotkey phrase trigger keyword wake word shortcut keybinding", primary: true },
  pushToTalk: { icon: Hand,
    title: "Push to Talk", description: "Hold the hotkey to record, release to transcribe",
    keywords: "hold ptt" },
  language: { icon: Languages,
    title: "Language", description: "For Whisper models only", keywords: "locale english spanish" },
  silence: { icon: Timer,
    title: "Silence Timeout", description: "Auto-stop after pausing for",
    keywords: "pause auto stop vad" },
  trimSilence: { icon: AudioWaveform,
    title: "Trim Silence",
    description: "Remove silence and noise before transcribing (Silero VAD) — prevents hallucinations",
    keywords: "vad silero noise hallucination" },
  whisperMode: { icon: Ear,
    title: "Whisper Mode",
    description: "For dictating quietly in shared spaces — boosts quiet audio, tracks the room's noise floor, and keeps speech the VAD would discard",
    keywords: "quiet shared office library gain" },
  microphone: { icon: Mic,
    title: "Microphone", description: "Select audio input device",
    keywords: "input device audio mic", primary: true },
  appearance: { icon: SunMoon,
    title: "Appearance", description: "Light or dark, or follow the system",
    keywords: "theme dark light mode colour color", primary: true },
  hudPosition: { icon: Monitor,
    title: "HUD Position", description: "Where the recording pill appears",
    keywords: "overlay pill top bottom" },
  sounds: { icon: Volume2,
    title: "UI Sounds", description: "Play a sound when recording starts/stops",
    keywords: "audio feedback chime pop volume" },
  autostart: { icon: Power,
    title: "Launch at Login", description: "Start Patter automatically on boot",
    keywords: "startup autostart boot login" },
  outputMode: { icon: Zap,
    title: "Text Output", description: "How finished text reaches your cursor",
    keywords: "paste type insert clipboard keystroke" },
  updates: { icon: PackageIcon,
    title: "Updates", description: "Notify about new versions on launch",
    keywords: "version upgrade release" },
} satisfies Record<string, RowMeta>;

/** One settings row: icon bubble, label, description, and its control. */
/** `expansion` renders inside the same cell, under the row and aligned with the
 *  title — for a control that only exists because of what this row is set to.
 *  A sibling row would sit past a divider and read as an unrelated setting. */
function Setting({ icon: Icon, title, description, keywords, primary, active, children, expansion }: RowMeta & {
  children: ReactNode;
  /** Whether this setting is actually doing something — configured, enabled,
   *  chosen. The only thing that earns accent colour on this page. */
  active?: boolean;
  expansion?: ReactNode;
}) {
  const query = useContext(FilterContext);
  if (!matches(query, title, description, keywords)) return null;
  return (
    <div className={cn("group/row transition-colors", primary ? "p-5" : "p-4", "hover:bg-accent-subtle")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <SettingIcon icon={Icon} active={active} size={primary ? "lg" : "sm"} />
          <div>
            <p className={cn(
              "font-medium text-foreground/90",
              primary ? "text-[14px] tracking-tight" : "text-[13px]"
            )}>{title}</p>
            <p className="text-[11px] text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
      {/* Clears the icon and its gap, so this lines up with the title rather
          than the icon. */}
      {expansion && <div className={cn("pt-3", primary ? "pl-12" : "pl-11")}>{expansion}</div>}
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
      <div className="surface-raised rounded-xl divide-y divide-border overflow-hidden">{children}</div>
    </section>
  );
}

interface PermissionRowProps {
  icon: typeof Mic;
  title: string;
  description: string;
  /** Omit when the OS gives no reliable way to query the live status. */
  granted?: boolean;
  onRequestAccess?: () => Promise<boolean | void>;
  onOpenSettings: () => Promise<void>;
}

function PermissionRow({ icon: Icon, title, description, granted, onRequestAccess, onOpenSettings }: PermissionRowProps) {
  return (
    <div className="flex items-center justify-between p-4 transition-colors hover:bg-accent-subtle">
      <div className="flex items-center gap-3">
        {/* The chip states whether the permission is granted. Which permission
            it is was never worth a colour of its own. */}
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors",
            granted
              ? "bg-success/15 text-success"
              : granted === false
                ? "bg-warning/15 text-warning"
                : "bg-foreground/[0.05] text-muted-foreground"
          )}
        >
          <Icon size={14} />
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
          <span className="inline-flex items-center gap-1 text-[11px] text-success font-medium">
            <CheckCircle2 size={12} /> Granted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-warning font-medium">
            <AlertCircle size={12} /> Not granted
          </span>
        )}
        {granted !== true && onRequestAccess && (
          <button
            onClick={() => onRequestAccess().catch(console.error)}
            className="text-[11px] px-2 py-1 rounded bg-steel/15 text-accent-foreground hover:bg-steel/25 transition-colors font-medium"
          >
            Request Access
          </button>
        )}
        {granted !== true && (
          <button
            onClick={() => onOpenSettings().catch(console.error)}
            className="text-[11px] text-primary hover:text-primary/80 transition-colors"
          >
            Open Settings
          </button>
        )}
      </div>
    </div>
  );
}

interface PreferencesProps {
  /// Active ASR engine id, hoisted in Dashboard. Only needed to tell the user
  /// when the language picker can't take effect.
  activeEngine: string | null;
}

export function PreferencesView({ activeEngine }: PreferencesProps) {
  // Unknown engine (nothing selected yet) is not "English-only" — don't warn
  // about a model the user hasn't picked.
  const englishOnlyModel = !!activeEngine && MODEL_MULTILINGUAL[activeEngine] === false;

  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [recordingField, setRecordingField] = useState<HotkeyField | null>(null);
  /// Which trigger command mode uses. Held locally as well as derived, because
  /// picking "Hotkey" before recording one leaves both fields empty — a purely
  /// derived value would snap the picker straight back to Off.
  const [commandMode, setCommandMode] = useState<CommandMode>("off");
  const [query, setQuery] = useState("");
  const theme = useTheme();
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

  // Re-derives whenever a trigger is actually set or cleared — including on
  // first load. Depends on the two values rather than the settings object, so
  // choosing a mode before configuring it doesn't get reverted.
  useEffect(() => {
    if (!settings) return;
    setCommandMode(
      settings.command_hotkey ? "hotkey" : settings.command_phrase ? "phrase" : "off"
    );
  }, [settings?.command_hotkey, settings?.command_phrase]);

  /// Switching trigger clears the other one: two live triggers for one feature
  /// is a setting that contradicts itself.
  const changeCommandMode = (mode: CommandMode) => {
    setCommandMode(mode);
    if (mode === "off") update({ command_hotkey: "", command_phrase: "" });
    else if (mode === "hotkey") update({ command_phrase: "" });
    else update({ command_hotkey: "" });
  };

  const applyHotkey = (field: HotkeyField, combo: string) => {
    setRecordingField(null);
    // Command mode opens by synthesizing Cmd/Ctrl+C into the target app. A
    // modifier the user is still physically holding turns that into a
    // different chord and the selection comes back empty, so the whole feature
    // silently degrades to plain dictation. Refuse the binding instead.
    if (field === "command_hotkey" && combo in MODIFIER_AS_COMBO_PART) {
      toast.error("Command mode needs a key or combo, not a bare modifier — it holds Cmd+C to read your selection");
      return;
    }
    // Every binding is global, so a collision means one of them silently never
    // fires — check the combo against all the others, not just one.
    const taken = (Object.keys(HOTKEY_LABELS) as HotkeyField[]).find(
      (f) => f !== field && settings?.[f] === combo
    );
    if (taken) {
      toast.error(`"${formatHotkey(combo)}" is already the ${HOTKEY_LABELS[taken]} hotkey`);
      return;
    }
    // A bare-modifier binding fires on the modifier's own key-down, so any
    // combo built on that modifier triggers the other hotkey first and this one
    // never gets a clean press. Warn rather than block — the user may be about
    // to rebind the other one.
    if (combo.includes("+")) {
      const parts = combo.split("+");
      const shadowing = (Object.keys(HOTKEY_LABELS) as HotkeyField[]).find((f) => {
        const other = settings?.[f];
        return f !== field && other && parts.includes(MODIFIER_AS_COMBO_PART[other]);
      });
      if (shadowing) {
        toast.warning(
          `"${formatHotkey(combo)}" starts with the ${HOTKEY_LABELS[shadowing]} hotkey — that one will fire first`
        );
      }
    }
    update({ [field]: combo });
  };

  const handleHotkeyRecord = (field: HotkeyField) => (e: KeyboardEvent<HTMLElement>) => {
    if (recordingField !== field) return;
    e.preventDefault();

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
          className="w-full surface-raised rounded-xl pl-9 pr-9 py-2.5 text-[13px] text-foreground/90 placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-focus transition-shadow"
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
        <SettingsSection
          label="Shortcuts"
          rows={[
            ROWS.hotkey,
            ROWS.meetingHotkey,
            ROWS.commandMode,
            ROWS.pushToTalk,
          ]}
        >
          <Setting {...ROWS.hotkey} active={!!settings.hotkey}>
            <button type="button" aria-label="Change dictation shortcut" onClick={() => setRecordingField("hotkey")} onBlur={() => setRecordingField(null)} onKeyDown={handleHotkeyRecord("hotkey")} className="shortcut-capture" data-recording={recordingField === "hotkey" || undefined}>
                {recordingField === "hotkey" ? "Press a key…" : settings.hotkey ? <ShortcutKeys combo={settings.hotkey} interactive /> : "Not set"}
              </button>
          </Setting>

          <Setting {...ROWS.meetingHotkey} active={!!settings.meeting_hotkey}>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Change meeting shortcut" onClick={() => setRecordingField("meeting_hotkey")} onBlur={() => setRecordingField(null)} onKeyDown={handleHotkeyRecord("meeting_hotkey")} className="shortcut-capture" data-recording={recordingField === "meeting_hotkey" || undefined}>
                {recordingField === "meeting_hotkey" ? "Press a key…" : settings.meeting_hotkey ? <ShortcutKeys combo={settings.meeting_hotkey} interactive /> : "Not set"}
              </button>
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

          <Setting
            {...ROWS.commandMode}
            active={commandMode !== "off"}
            expansion={
              commandMode === "hotkey" ? (
                <div className="rounded-lg bg-foreground/[0.03] ring-1 ring-border/60 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[12px] text-foreground/80">Hotkey</span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" aria-label="Change command shortcut" onClick={() => setRecordingField("command_hotkey")} onBlur={() => setRecordingField(null)} onKeyDown={handleHotkeyRecord("command_hotkey")} className="shortcut-capture" data-recording={recordingField === "command_hotkey" || undefined}>
                {recordingField === "command_hotkey" ? "Press a key…" : settings.command_hotkey ? <ShortcutKeys combo={settings.command_hotkey} interactive /> : "Not set"}
              </button>
                      {settings.command_hotkey && (
                        <button
                          onClick={() => update({ command_hotkey: "" })}
                          className="text-muted-foreground/50 hover:text-destructive transition-colors p-1"
                          title="Clear command hotkey"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Press it, then say how to rewrite the selection. Not a bare modifier — reading
                    your selection holds {IS_MAC ? "⌘C" : "Ctrl+C"}, which a held modifier would turn into a
                    different shortcut.
                  </p>
                </div>
              ) : commandMode === "phrase" ? (
                <div className="rounded-lg bg-foreground/[0.03] ring-1 ring-border/60 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[12px] text-foreground/80">Phrase</span>
                    <input
                      type="text"
                      spellCheck={false}
                      placeholder="e.g. patter"
                      defaultValue={settings.command_phrase}
                      // Committed on blur/Enter rather than per keystroke: every
                      // save round-trips the whole settings object to disk.
                      onBlur={(e) => {
                        const phrase = e.target.value.trim();
                        if (phrase !== settings.command_phrase) update({ command_phrase: phrase });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="w-40 bg-background border border-input rounded-md text-xs font-sans text-center px-2 py-1.5 text-muted-foreground focus:outline-none focus-visible:ring-focus hover:border-foreground/25 transition-colors"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Say it first in a normal dictation — “{settings.command_phrase || "patter"}, make this
                    formal”. Only counts at the very start, and with nothing selected it just dictates.
                  </p>
                </div>
              ) : undefined
            }
          >
            <Select value={commandMode} onValueChange={(value) => changeCommandMode(value as CommandMode)}>
              <SelectTrigger className="w-40 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="hotkey">Separate hotkey</SelectItem>
                <SelectItem value="phrase">Spoken phrase</SelectItem>
              </SelectContent>
            </Select>
          </Setting>

          <Setting {...ROWS.pushToTalk} active={settings.push_to_talk}>
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
            description={activeMode.detail}
            primary
            active
          >
            <div className="flex items-center gap-1 bg-foreground/5 rounded-lg p-1">
              {MODES.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => update({ output_mode: id })}
                  className={cn(
                    "px-3 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap",
                    settings.output_mode === id
                      ? "bg-foreground/10 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Setting>

          <Setting {...ROWS.language}>
            <div className="flex items-center gap-2">
              {englishOnlyModel && (
                <span
                  className="text-[11px] text-warning"
                  title="English-only weights ignore this setting. Install a multilingual model from Speech Models to use another language."
                >
                  English-only model
                </span>
              )}
              <Select value={settings.language} onValueChange={(val) => update({ language: val })}>
                <SelectTrigger className="w-40 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {/* Common picks first so a 100-item scroll isn't the only route. */}
                  {COMMON_LANGUAGE_CODES.map((c) => (
                    <SelectItem key={`common-${c}`} value={c}>{LANGUAGE_NAMES[c]}</SelectItem>
                  ))}
                  <SelectSeparator />
                  {LANGUAGES.filter((l) => !COMMON_LANGUAGE_CODES.includes(l.code)).map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Setting>

          <Setting {...ROWS.silence}>
            <Select
              value={settings.silence_timeout_ms.toString()}
              onValueChange={(val) => update({ silence_timeout_ms: parseInt(val, 10) })}
            >
              <SelectTrigger className="w-32 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
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

          <Setting {...ROWS.trimSilence} active={settings.trim_silence}>
            <Switch
              checked={settings.trim_silence}
              onCheckedChange={(checked) => update({ trim_silence: checked })}
            />
          </Setting>

          <Setting {...ROWS.whisperMode} active={settings.whisper_mode}>
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
              <SelectTrigger className="w-48 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
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

        <SettingsSection label="Feedback" rows={[ROWS.appearance, ROWS.hudPosition, ROWS.sounds]}>
          <Setting {...ROWS.appearance}>
            <div className="flex items-center gap-1 bg-foreground/5 rounded-lg p-1">
              {(["system", "light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "px-3 py-1 text-[11px] font-medium rounded-md capitalize transition-colors",
                    theme === t
                      ? "bg-foreground/10 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </Setting>

          <Setting {...ROWS.hudPosition}>
            <Select
              value={settings.hud_position ?? "bottom"}
              onValueChange={(val) => update({ hud_position: val })}
            >
              <SelectTrigger className="w-32 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
              </SelectContent>
            </Select>
          </Setting>

          <Setting {...ROWS.sounds} active={settings.play_sounds}>
            <div className="flex items-center gap-3">
              {settings.play_sounds && (
                <Select
                  value={settings.sound_theme ?? "pop"}
                  onValueChange={(val) => update({ sound_theme: val })}
                >
                  <SelectTrigger className="w-28 bg-background border-input text-[13px] text-foreground/80 focus-visible:ring-focus">
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
          <Setting {...ROWS.autostart} active={settings.autostart}>
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
                className="text-[12px] text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
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

        <div className="surface-raised rounded-xl divide-y divide-border">
          <PermissionRow
            icon={Accessibility}
            title="Accessibility"
            description="Lets Patter type finished text into other apps"
            granted={permissions?.accessibility ?? true}
            onRequestAccess={requestAccessibilityPermission}
            onOpenSettings={openAccessibilitySettings}
          />
          <PermissionRow
            icon={KeyRound}
            title="Input Monitoring"
            description="Needed for the global hotkey to work anywhere"
            granted={permissions?.input_monitoring ?? true}
            onRequestAccess={requestInputMonitoringPermission}
            onOpenSettings={openInputMonitoringSettings}
          />
          <PermissionRow
            icon={Mic}
            title="Microphone"
            description="Required to capture dictation and meeting audio"
            granted={permissions?.microphone ?? true}
            onRequestAccess={requestMicrophonePermission}
            onOpenSettings={openMicrophoneSettings}
          />
          <PermissionRow
            icon={Bell}
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
        <div className="surface-raised rounded-xl p-4">
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
        <div className="surface-raised rounded-xl p-4">
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
