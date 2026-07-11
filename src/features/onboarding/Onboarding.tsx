import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Mic, Keyboard, ShieldCheck } from "lucide-react";
import {
  Settings,
  getSettings,
  updateSettings,
  downloadModel,
  setEngine,
  onDbUpdated,
} from "../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import icon from "@/assets/icon.png";

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
  const [triedIt, setTriedIt] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const hasAnyModel = Object.values(modelStatus).some(Boolean);
  const downloading = downloadingId === RECOMMENDED_MODEL;

  useEffect(() => {
    getSettings().then(setSettings).catch(console.error);
  }, []);

  // Try-it detection: a new transcription lands in the DB while on the hotkey step.
  useEffect(() => {
    if (step !== 2) return;
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
      title: "Welcome to Patter",
      body: (
        <>
          <p>
            Patter is local-first dictation: audio is captured, transcribed, and cleaned up
            entirely on your Mac. Nothing is ever uploaded.
          </p>
          <p className="mt-3">
            macOS will ask for <span className="text-foreground/90 font-medium">microphone access</span> the
            first time you dictate — that prompt comes from the system, and Patter only listens
            while you're recording.
          </p>
        </>
      ),
      cta: (
        <Button onClick={() => setStep(1)}>Continue</Button>
      ),
    },
    {
      icon: Download,
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
        <Button onClick={() => setStep(2)}>Continue</Button>
      ) : downloading ? (
        <Button disabled>
          <Loader2 size={14} className="animate-spin" /> Downloading…
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button onClick={handleDownload}>
            <Download size={14} /> Download {RECOMMENDED_MODEL_NAME}
          </Button>
          <Button variant="ghost" className="text-muted-foreground" onClick={() => setStep(2)}>
            Skip
          </Button>
        </div>
      ),
    },
    {
      icon: Keyboard,
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
            <div className="w-8 h-8 shrink-0 rounded-full bg-steel/10 flex items-center justify-center">
              <Icon size={15} className="text-steelIce" />
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
