import { useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2 } from "lucide-react";
import { downloadModel, setEngine } from "../../../lib/ipc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

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
  models: ModelSpec[];
}

const FAMILIES: EngineFamily[] = [
  {
    id: "whisper",
    name: "Whisper",
    vendor: "OpenAI",
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
}

export function ModelsView({
  activeEngine,
  setActiveEngine,
  modelStatus,
  modelStatusLoading,
  downloadingId,
  setDownloadingId,
  downloadProgress,
}: Props) {
  const [settingEngineId, setSettingEngineId] = useState<string | null>(null);

  const handleDownload = async (id: string, name: string) => {
    setDownloadingId(id);
    try {
      await downloadModel(id);
      toast.success(`${name} downloaded`);
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Models"
        description="Transcription engines run fully on-device. Download once, use offline."
      />

      {modelStatusLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        FAMILIES.map((family) => (
          <section key={family.id}>
            <div className="flex items-baseline gap-2 px-1 pb-2.5">
              <h3 className="text-sm font-semibold tracking-tight">{family.name}</h3>
              <span className="t-label">{family.vendor}</span>
            </div>
            <Card className="py-0">
              <div className="divide-y divide-border">
                {family.models.map((model) => {
                  const isDownloaded = modelStatus[model.id] ?? false;
                  const isActive = activeEngine === model.id;
                  const isDownloading = downloadingId === model.id;
                  const isSettingActive = settingEngineId === model.id;

                  return (
                    <div
                      key={model.id}
                      className={cn(
                        "flex items-center justify-between gap-4 px-5 py-4 transition-colors",
                        isActive && "bg-steel/[0.06] shadow-[2px_0_0_var(--color-steel)_inset]"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <h4 className="text-[13px] font-semibold">{model.name}</h4>
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{model.size}</span>
                          {isActive && (
                            <span className="t-label rounded-full px-2 py-0.5 text-[9px] !text-steelIce bg-steel/15 ring-1 ring-steel/30">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
                      </div>
                      <div className="flex-none">
                        {isActive ? (
                          <span className="flex items-center gap-1.5 font-mono text-[11px] text-steelIce">
                            <Check size={13} strokeWidth={2.5} />
                            In use
                          </span>
                        ) : isDownloaded ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetEngine(model.id, model.name)}
                            disabled={isSettingActive}
                          >
                            {isSettingActive && <Loader2 size={13} className="animate-spin" />}
                            Set Active
                          </Button>
                        ) : isDownloading ? (
                          <div className="flex flex-col items-end gap-1 w-24">
                            <span className="font-mono text-[10px] text-steelIce tabular-nums">
                              {downloadProgress.toFixed(0)}%
                            </span>
                            <Progress value={downloadProgress} className="h-1" />
                          </div>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => handleDownload(model.id, model.name)}>
                            <Download size={14} />
                            <span>Download</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
