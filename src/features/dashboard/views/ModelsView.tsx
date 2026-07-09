import { useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import { downloadModel, setEngine, deleteModel } from "../../../lib/ipc";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

import openaiLogo from "@/assets/openai-logo.png";
import nvidiaLogo from "@/assets/nvidia-logo.png";

interface ModelSpec {
  id: string;
  name: string;
  size: string;
  description: string;
}

interface EngineFamily {
  id: string;
  name: string;
  vendor: string;
  icon?: React.ReactNode;
  models: ModelSpec[];
}

const FAMILIES: EngineFamily[] = [
  {
    id: "whisper",
    name: "Whisper",
    vendor: "OpenAI",
    icon: <img src={openaiLogo} alt="OpenAI" className="w-5" />,
    models: [
      { id: "whisper-tiny", name: "Tiny", size: "78 MB", description: "Fastest, lowest accuracy — quick notes" },
      { id: "whisper-base", name: "Base", size: "148 MB", description: "Balanced speed and accuracy" },
      { id: "whisper-small", name: "Small", size: "488 MB", description: "More accurate, slower" },
      { id: "whisper-large-v3-turbo", name: "Large v3 Turbo", size: "1.6 GB", description: "Best quality, needs Metal GPU" },
    ],
  },
  {
    id: "parakeet",
    name: "Parakeet",
    vendor: "Nvidia",
    icon: <img src={nvidiaLogo} alt="Nvidia" className="w-16"/>,
    models: [
      { id: "parakeet-v2", name: "TDT 0.6B v2", size: "660 MB", description: "English only — fastest streaming" },
      { id: "parakeet-v3", name: "TDT 0.6B v3", size: "670 MB", description: "25 languages" },
    ],
  },
];

export const ALL_MODEL_IDS = FAMILIES.flatMap((f) => f.models.map((m) => m.id));

export const MODEL_NAMES: Record<string, string> = Object.fromEntries(
  FAMILIES.flatMap((f) => f.models.map((m) => [m.id, `${f.name} ${m.name}`]))
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader
        title="Models"
        description="Transcription engines run fully on-device. Download once, use offline."
      />

      {modelStatusLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-2xl bg-white/5" />
          <Skeleton className="h-32 w-full rounded-2xl bg-white/5" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {FAMILIES.map((family) => (
            <section key={family.id} className="space-y-3">
              {/* Family Header */}
              <div className="flex items-center gap-2.5 px-2 mb-2">
                <div className="flex items-center justify-center">
                  {family.icon}
                </div>
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/50 ml-1">
                  -
                </span>
                <h3 className="text-[15px] font-semibold tracking-tight text-foreground/90">{family.name}</h3>
                {/* <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/50 ml-1">
                  {family.vendor}
                </span> */}
              </div>
              
              {/* Models List */}
              <div className="flex flex-col gap-2.5">
                {family.models.map((model) => {
                  const isDownloaded = modelStatus[model.id] ?? false;
                  const isActive = activeEngine === model.id;
                  const isDownloading = downloadingId === model.id;
                  const isSettingActive = settingEngineId === model.id;
                  const isDeleting = deletingId === model.id;

                  return (
                    <div
                      key={model.id}
                      className={cn(
                        "group relative flex items-center justify-between gap-4 p-4 rounded-2xl border transition-all duration-300",
                        isActive
                          ? "bg-steel/[0.04] border-steel/30 shadow-[0_0_30px_rgba(91,155,209,0.06)]"
                          : "bg-white/[0.015] border-border/40 hover:bg-white/[0.03] hover:border-border/60"
                      )}
                    >
                      {/* Subtle Active Glow Background */}
                      {isActive && (
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-steel/[0.05] to-transparent pointer-events-none" />
                      )}

                      <div className="relative min-w-0 flex-1">
                        <div className="flex items-center gap-3 mb-1.5">
                          <h4 className={cn(
                            "text-[15px] font-semibold tracking-tight transition-colors", 
                            isActive ? "text-steelIce drop-shadow-sm" : "text-foreground/90 group-hover:text-foreground"
                          )}>
                            {model.name}
                          </h4>
                          <span className="font-mono text-[10px] font-medium text-muted-foreground/70 px-2 py-0.5 rounded-md bg-black/20 border border-white/5 shadow-inner">
                            {model.size}
                          </span>
                        </div>
                        <p className="text-[13.5px] text-muted-foreground/70 leading-relaxed max-w-[80%]">
                          {model.description}
                        </p>
                      </div>

                      <div className="relative flex-none flex items-center justify-end min-w-[100px]">
                        {isActive ? (
                          <div className="flex items-center gap-1.5 text-[13px] font-medium text-steelIce bg-steel/[0.12] px-3.5 py-1.5 rounded-full ring-1 ring-steel/20 shadow-[0_0_15px_rgba(91,155,209,0.15)] animate-in zoom-in duration-300">
                            <Check size={14} strokeWidth={3} />
                            <span>Active</span>
                          </div>
                        ) : isDownloaded ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSetEngine(model.id, model.name)}
                              disabled={isSettingActive || isDeleting}
                              className="flex items-center gap-1.5 text-[13px] font-medium bg-white/5 hover:bg-white/10 text-foreground/80 hover:text-foreground px-4 py-1.5 rounded-full border border-white/5 hover:border-white/10 transition-all opacity-60 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                            >
                              {isSettingActive && <Loader2 size={13} className="animate-spin" />}
                              Use Model
                            </button>
                            <button
                              onClick={() => handleDelete(model.id, model.name)}
                              disabled={isDeleting}
                              className="p-1.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                              title="Delete model"
                            >
                              {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                            </button>
                          </div>
                        ) : isDownloading ? (
                          <div className="flex flex-col items-end gap-1.5 w-32 bg-black/20 p-2.5 rounded-xl border border-white/5">
                            <div className="flex items-center justify-between w-full">
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Downloading</span>
                              <span className="font-mono text-[11px] text-steelIce font-semibold">
                                {downloadProgress.toFixed(0)}%
                              </span>
                            </div>
                            <Progress value={downloadProgress} className="h-1.5 bg-white/10" />
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleDownload(model.id, model.name)}
                            className="flex items-center gap-1.5 text-[13px] font-semibold bg-steel hover:bg-steelIce text-white px-4 py-1.5 rounded-full transition-all shadow-sm hover:shadow-[0_0_15px_rgba(91,155,209,0.3)] opacity-90 group-hover:opacity-100 scale-95 group-hover:scale-100"
                          >
                            <Download size={14} strokeWidth={2.5} />
                            Download
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
