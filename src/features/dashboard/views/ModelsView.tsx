import { useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Trash2, Globe, Type } from "lucide-react";
import { downloadModel, setEngine, deleteModel } from "../../../lib/ipc";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

import openaiLogo from "@/assets/openai-logo.png";
import nvidiaLogo from "@/assets/nvidia-logo.png";

interface ModelSpec {
  id: string;
  /** Short card title ("Small") */
  name: string;
  /** Full name for sidebar/status ("Whisper Small") */
  fullName: string;
  size: string;
  vendor: "openai" | "nvidia";
  multilingual: boolean;
  description: string;
}

const MODELS: ModelSpec[] = [
  { id: "whisper-tiny", name: "Tiny", fullName: "Whisper Tiny", size: "78 MB", vendor: "openai", multilingual: false, description: "Fastest, lowest accuracy — quick notes" },
  { id: "whisper-base", name: "Base", fullName: "Whisper Base", size: "148 MB", vendor: "openai", multilingual: false, description: "Balanced speed and accuracy" },
  { id: "whisper-small", name: "Small", fullName: "Whisper Small", size: "488 MB", vendor: "openai", multilingual: false, description: "More accurate, slower" },
  { id: "parakeet-v2", name: "Parakeet V2", fullName: "Parakeet TDT 0.6B v2", size: "660 MB", vendor: "nvidia", multilingual: false, description: "English only — fastest streaming" },
  { id: "whisper-large-v3-turbo", name: "Large v3 Turbo", fullName: "Whisper Large v3 Turbo", size: "1.6 GB", vendor: "openai", multilingual: true, description: "Best quality, needs Metal GPU" },
  { id: "parakeet-v3", name: "Parakeet V3", fullName: "Parakeet TDT 0.6B v3", size: "670 MB", vendor: "nvidia", multilingual: true, description: "25 languages" },
];

const VENDOR_LOGOS: Record<ModelSpec["vendor"], string> = {
  openai: openaiLogo,
  nvidia: nvidiaLogo,
};

export const ALL_MODEL_IDS = MODELS.map((m) => m.id);

export const MODEL_NAMES: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.fullName])
);

interface Props {
  activeEngine: string | null;
  setActiveEngine: (engine: string) => void;
  modelStatus: Record<string, boolean>;
  modelStatusLoading: boolean;
  downloadingId: string | null;
  setDownloadingId: (id: string | null) => void;
  downloadProgress: number;
  onModelDeleted?: () => void;
}

export function ModelsView({
  activeEngine,
  setActiveEngine,
  modelStatus,
  modelStatusLoading,
  downloadingId,
  setDownloadingId,
  downloadProgress,
  onModelDeleted,
}: Props) {
  const [settingEngineId, setSettingEngineId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDownload = async (id: string, name: string) => {
    setDownloadingId(id);
    try {
      await downloadModel(id);
      toast.success(`${name} downloaded`);
      setDownloadingId(null);
      onModelDeleted?.(); // Reuse this callback to trigger refreshModelStatus in Dashboard
    } catch (e) {
      console.error(e);
      toast.error(`Failed to download ${name}: ${e}`);
      setDownloadingId(null);
    }
  };

  const handleSetEngine = async (id: string, name: string) => {
    setSettingEngineId(id);
    try {
      await setEngine(id);
      setActiveEngine(id);
      toast.success(`${name} is now active`);
    } catch (e) {
      console.error(e);
      toast.error(`Failed to set ${name} active: ${e}`);
    } finally {
      setSettingEngineId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      await deleteModel(id);
      toast.success(`${name} deleted`);
      onModelDeleted?.();
    } catch (e) {
      console.error(e);
      toast.error(`Failed to delete ${name}: ${e}`);
    } finally {
      setDeletingId(null);
    }
  };

  const renderCard = (model: ModelSpec) => {
    const isDownloaded = modelStatus[model.id] ?? false;
    const isActive = activeEngine === model.id;
    const isDownloading = downloadingId === model.id;
    const isSettingActive = settingEngineId === model.id;
    const isDeleting = deletingId === model.id;
    const clickable = !isActive && !isDownloading && !isSettingActive && !isDeleting;

    return (
      <div
        key={model.id}
        role="button"
        title={model.description}
        onClick={() => {
          if (!clickable) return;
          if (isDownloaded) handleSetEngine(model.id, model.fullName);
          else handleDownload(model.id, model.fullName);
        }}
        className={cn(
          "group relative flex items-center gap-3 p-3.5 rounded-xl ring-1 transition-all duration-200",
          isActive
            ? "bg-steel/[0.06] ring-steel/40 shadow-[0_0_20px_rgba(91,155,209,0.08)]"
            : "bg-card ring-border",
          clickable && "cursor-pointer hover:bg-white/[0.04] hover:ring-white/20"
        )}
      >
        <div className="w-9 h-9 shrink-0 rounded-lg bg-white/[0.04] ring-1 ring-white/5 flex items-center justify-center overflow-hidden">
          <img
            src={VENDOR_LOGOS[model.vendor]}
            alt={model.vendor}
            className={model.vendor === "nvidia" ? "w-7" : "w-5"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-medium truncate", isActive ? "text-steelIce" : "text-foreground/90")}>
            {model.name}
          </p>
          {isDownloading ? (
            <div className="mt-1.5 flex items-center gap-2">
              <Progress value={downloadProgress} className="h-1 flex-1 bg-white/10" />
              <span className="font-sans text-[10px] text-steelIce tabular-nums shrink-0">
                {downloadProgress.toFixed(0)}%
              </span>
            </div>
          ) : (
            <p className="font-sans text-[11px] text-muted-foreground">{model.size}</p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {isDownloaded && !isActive && !isDeleting && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(model.id, model.fullName);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive transition-all p-1"
              title="Delete model"
            >
              <Trash2 size={14} />
            </button>
          )}
          {isActive ? (
            <span className="w-6 h-6 rounded-full bg-success/15 ring-1 ring-success/30 flex items-center justify-center">
              <Check size={13} strokeWidth={3} className="text-success" />
            </span>
          ) : isSettingActive || isDeleting ? (
            <Loader2 size={15} className="animate-spin text-steelIce" />
          ) : isDownloaded ? (
            <span className="text-[11px] text-muted-foreground/60 group-hover:text-steelIce transition-colors">
              Use
            </span>
          ) : !isDownloading ? (
            <Download size={15} className="text-muted-foreground/50 group-hover:text-steelIce transition-colors" />
          ) : null}
        </div>
      </div>
    );
  };

  const englishModels = MODELS.filter((m) => !m.multilingual);
  const multilingualModels = MODELS.filter((m) => m.multilingual);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader
        title="Speech Models"
        description="Everything runs on-device. Download once, use offline."
      />

      <div className="bg-card ring-1 ring-border rounded-xl p-5">
        <h3 className="text-[15px] font-semibold text-foreground/90">
          Choose your transcription engine.
        </h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Smaller models are faster. Larger models are more accurate. Click a model to download it,
          click a downloaded model to make it active.
        </p>
      </div>

      {modelStatusLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {MODELS.map((m) => (
            <Skeleton key={m.id} className="h-16 w-full rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Type size={12} className="text-muted-foreground/60" />
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">
                English only
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">{englishModels.map(renderCard)}</div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Globe size={12} className="text-muted-foreground/60" />
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">
                Multilingual
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">{multilingualModels.map(renderCard)}</div>
          </section>
        </>
      )}
    </div>
  );
}
