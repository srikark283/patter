import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Mic, Keyboard, ShieldCheck, KeyRound, Accessibility, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Settings,
  getSettings,
  updateSettings,
  downloadModel,
  setEngine,
  onDbUpdated,
  getPermissionStatus,
  PermissionStatus,
  openAccessibilitySettings,
  requestAccessibilityPermission,
  openInputMonitoringSettings,
  requestInputMonitoringPermission,
  openMicrophoneSettings,
  requestMicrophonePermission,
} from "../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import icon from "@/assets/logohq.png";

const RECOMMENDED_MODEL = "whisper-base";
const RECOMMENDED_MODEL_NAME = "Whisper Base";
const RECOMMENDED_MODEL_SIZE = "148 MB";

interface Props {
  modelStatus: Record<string, boolean>;
  downloadingId: string | null;
  setDownloadingId: (id: string | null) => void;
  downloadProgress: number;
  activeEngine: string | null;
  setActiveEngine: (engine: string) => void;
  onModelDownloaded: () => void;
  onDone: () => void;
}

function OnboardingPermissionRow({
  icon: Icon,
  title,
  description,
  granted,
  onRequest,
  onOpen,
}: {
  icon: any;
  title: string;
  description: string;
  granted?: boolean;
  onRequest?: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/4 border border-white/8">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-steel/10 flex items-center justify-center shrink-0">
          <Icon size={14} className="text-steelIce" />
        </div>
        <div>
          <p className="text-[12px] font-medium text-foreground/90">{title}</p>
          <p className="text-[10.5px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {granted ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <CheckCircle2 size={12} /> Granted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium">
            <AlertCircle size={12} /> Missing
          </span>
        )}
        {!granted && onRequest && (
          <button
            onClick={onRequest}
            className="text-[11px] px-2 py-1 rounded bg-steel/20 text-steelIce hover:bg-steel/30 font-medium transition-colors"
          >
            Grant
          </button>
        )}
        {!granted && (
          <button
            onClick={onOpen}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Settings
          </button>
        )}
      </div>
    </div>
  );
}

export function Onboarding({
  modelStatus,
  downloadingId,
  setDownloadingId,
  downloadProgress,
  activeEngine,
  setActiveEngine,
  onModelDownloaded,
  onDone,
}: Props) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [triedIt, setTriedIt] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const hasAnyModel = Object.values(modelStatus).some(Boolean);
  const downloading = downloadingId === RECOMMENDED_MODEL;

  const refreshPermissions = () => {
    getPermissionStatus().then(setPermissions).catch(console.error);
  };

  const handleRequestAll = async () => {
    if (!permissions?.microphone) {
      await requestMicrophonePermission();
    }
    if (!permissions?.input_monitoring) {
      await requestInputMonitoringPermission();
    }
    if (!permissions?.accessibility) {
      await requestAccessibilityPermission();
    }
    refreshPermissions();
  };

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
    refreshPermissions();
    window.addEventListener("focus", refreshPermissions);
    return () => window.removeEventListener("focus", refreshPermissions);
  }, []);

  // Try-it detection: a new transcription lands in the DB while on the hotkey step.
  useEffect(() => {
    if (step !== 3) return;
    const unlisten = onDbUpdated(() => setTriedIt(true));
    return () => {
      unlisten.then((f) => f());
    };
  }, [step]);

  const handleDownload = async () => {
    setDownloadingId(RECOMMENDED_MODEL);
    try {
      await downloadModel(RECOMMENDED_MODEL);
      await setEngine(RECOMMENDED_MODEL);
      setActiveEngine(RECOMMENDED_MODEL);
      onModelDownloaded();
      toast.success(`${RECOMMENDED_MODEL_NAME} ready`);
    } catch (e) {
      console.error(e);
      toast.error(`Download failed: ${e}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const latest = await getSettings();
      await updateSettings({ ...latest, onboarding_done: true });
      onDone();
    } catch (e) {
      console.error(e);
      toast.error(`Failed to save: ${e}`);
      setFinishing(false);
    }
  };

  const hotkey = settings?.hotkey ?? "…";
  const modelReady = hasAnyModel || !!activeEngine;

  const steps = [
    {
      icon: ShieldCheck,
      tint: "bg-emerald-500/10 text-emerald-400",
      title: "Welcome to Patter",
      body: (
        <>
          <p>
            Patter is local-first dictation: audio is captured, transcribed, and cleaned up
            entirely on your Mac. Nothing is ever uploaded.
          </p>
          <p className="mt-3">
            In the next step, we'll quickly set up your system permissions (Microphone, Input Monitoring, and Accessibility) so dictation works seamlessly.
          </p>
        </>
      ),
      cta: (
        <Button onClick={() => setStep(1)}>Setup Permissions</Button>
      ),
    },
    {
      icon: KeyRound,
      tint: "bg-amber-500/10 text-amber-400",
      title: "System Permissions",
      body: (
        <div className="space-y-2.5 my-1">
          <p className="text-[12px] text-muted-foreground mb-3">
            Patter needs system permissions to capture dictation, register your global hotkey, and type into active apps.
          </p>
          <OnboardingPermissionRow
            icon={Mic}
            title="Microphone Access"
            description="Captures dictation and meeting audio"
            granted={permissions?.microphone}
            onRequest={() => requestMicrophonePermission().then(() => refreshPermissions())}
            onOpen={openMicrophoneSettings}
          />
          <OnboardingPermissionRow
            icon={KeyRound}
            title="Input Monitoring"
            description="Registers global hotkey shortcut anywhere"
            granted={permissions?.input_monitoring}
            onRequest={() => requestInputMonitoringPermission().then(() => refreshPermissions())}
            onOpen={openInputMonitoringSettings}
          />
          <OnboardingPermissionRow
            icon={Accessibility}
            title="Accessibility"
            description="Types/pastes finished text at cursor"
            granted={permissions?.accessibility}
            onRequest={() => requestAccessibilityPermission().then(() => refreshPermissions())}
            onOpen={openAccessibilitySettings}
          />
        </div>
      ),
      cta: (
        <div className="flex gap-2">
          {(!permissions?.microphone || !permissions?.input_monitoring || !permissions?.accessibility) && (
            <Button variant="outline" onClick={handleRequestAll}>
              Grant All
            </Button>
          )}
          <Button onClick={() => setStep(2)}>Continue</Button>
        </div>
      ),
    },
    {
      icon: Download,
      tint: "bg-blue-500/10 text-blue-400",
      title: "Get a speech model",
      body: modelReady ? (
        <p>
          You already have a model installed{activeEngine ? " and active" : ""} — you're set. You
          can manage models anytime from the Models tab.
        </p>
      ) : (
        <>
          <p>
            Transcription runs on-device, so Patter needs a model. We recommend{" "}
            <span className="text-foreground/90 font-medium">{RECOMMENDED_MODEL_NAME}</span> (
            {RECOMMENDED_MODEL_SIZE}) — balanced speed and accuracy. You can switch models later in
            the Models tab.
          </p>
          {downloading && (
            <div className="mt-4">
              <Progress value={downloadProgress} />
              <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {downloadProgress.toFixed(0)}%
              </p>
            </div>
          )}
        </>
      ),
      cta: modelReady ? (
        <Button onClick={() => setStep(3)}>Continue</Button>
      ) : downloading ? (
        <Button disabled>
          <Loader2 size={14} className="animate-spin" /> Downloading…
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button onClick={handleDownload}>
            <Download size={14} /> Download {RECOMMENDED_MODEL_NAME}
          </Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setStep(3)}>
            Skip
          </Button>
        </div>
      ),
    },
    {
      icon: Keyboard,
      tint: "bg-violet-500/10 text-violet-400",
      title: "Try it",
      body: (
        <>
          <p>
            Press{" "}
            <kbd className="px-2 py-1 rounded-md bg-white/8 ring-1 ring-border font-sans text-[12px] text-foreground/90">
              {hotkey}
            </kbd>{" "}
            in any app, speak, and Patter types what you said right where your cursor is.
          </p>
          <div
            className={cn(
              "mt-4 flex items-center gap-2 text-[12px]",
              triedIt ? "text-success" : "text-muted-foreground"
            )}
          >
            {triedIt ? (
              <>
                <Check size={14} /> Nice — your first dictation landed. It's in History.
              </>
            ) : (
              <>
                <Mic size={14} /> Waiting for your first dictation… (or finish and try later)
              </>
            )}
          </div>
        </>
      ),
      cta: (
        <Button onClick={handleFinish} disabled={finishing}>
          {finishing && <Loader2 size={14} className="animate-spin" />}
          {triedIt ? "Finish" : "Finish anyway"}
        </Button>
      ),
    },
  ];

  const current = steps[step];
  const Icon = current.icon;

  return (
    <div className="absolute inset-0 z-100 flex items-center justify-center bg-background">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-240 h-128 rounded-full bg-steel/[0.07] blur-[140px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.025]" />
      </div>

      <div className="relative w-[440px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-8">
          <img src={icon} alt="Patter" className="w-10 h-10" />
          <h1 className="text-[28px] font-semibold tracking-[1px] font-['Nave']">Patter</h1>
        </div>

        <div className="bg-card ring-1 ring-border rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={cn("w-8 h-8 shrink-0 rounded-full flex items-center justify-center", current.tint)}>
              <Icon size={15} />
            </div>
            <h2 className="text-[16px] font-medium text-foreground/90">{current.title}</h2>
          </div>
          <div className="text-[12.5px] leading-relaxed text-muted-foreground">{current.body}</div>
          <div className="mt-6 flex items-center justify-between">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-1.5 h-1.5 rounded-full transition-colors",
                    i === step ? "bg-steelIce" : "bg-white/15"
                  )}
                />
              ))}
            </div>
            {current.cta}
          </div>
        </div>
      </div>
    </div>
  );
}
