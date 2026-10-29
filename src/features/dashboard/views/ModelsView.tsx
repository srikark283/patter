import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Download, Loader2, Trash2, RefreshCw, ArrowRight, Zap, Languages, HardDrive } from "lucide-react";
import { downloadModel, setEngine, deleteModel, ModelState } from "../../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

import openaiLogo from "@/assets/openai-logo.png";
import nvidiaLogo from "@/assets/nvidia-logo-mono.png";

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
  /** 1–5, relative across the lineup (same ratings as the landing page) */
  speed: number;
  accuracy: number;
}

const MODELS: ModelSpec[] = [
  { id: "whisper-tiny", name: "Tiny", fullName: "Whisper Tiny", size: "78 MB", vendor: "openai", multilingual: false, description: "Fastest, lowest accuracy — quick notes", speed: 4, accuracy: 2 },
  { id: "whisper-base", name: "Base", fullName: "Whisper Base", size: "148 MB", vendor: "openai", multilingual: false, description: "Balanced speed and accuracy", speed: 4, accuracy: 3 },
  { id: "whisper-small", name: "Small", fullName: "Whisper Small", size: "488 MB", vendor: "openai", multilingual: false, description: "More accurate, slower", speed: 3, accuracy: 4 },
  { id: "parakeet-v2", name: "Parakeet V2", fullName: "Parakeet TDT 0.6B v2", size: "660 MB", vendor: "nvidia", multilingual: false, description: "English only — fastest streaming", speed: 4, accuracy: 5 },
  { id: "whisper-tiny-multi", name: "Tiny", fullName: "Whisper Tiny (99 languages)", size: "78 MB", vendor: "openai", multilingual: true, description: "Fastest multilingual — quick notes", speed: 4, accuracy: 2 },
  { id: "whisper-base-multi", name: "Base", fullName: "Whisper Base (99 languages)", size: "148 MB", vendor: "openai", multilingual: true, description: "Balanced multilingual pick", speed: 4, accuracy: 3 },
  { id: "whisper-small-multi", name: "Small", fullName: "Whisper Small (99 languages)", size: "488 MB", vendor: "openai", multilingual: true, description: "More accurate across languages", speed: 3, accuracy: 4 },
  { id: "whisper-medium-multi", name: "Medium", fullName: "Whisper Medium (99 languages)", size: "1.5 GB", vendor: "openai", multilingual: true, description: "Strong non-English accuracy", speed: 2, accuracy: 4 },
  { id: "whisper-large-v3-turbo", name: "Large v3 Turbo", fullName: "Whisper Large v3 Turbo", size: "1.6 GB", vendor: "openai", multilingual: true, description: "Best quality, needs Metal GPU", speed: 2, accuracy: 5 },
  { id: "parakeet-v3", name: "Parakeet V3", fullName: "Parakeet TDT 0.6B v3", size: "670 MB", vendor: "nvidia", multilingual: true, description: "25 languages", speed: 4, accuracy: 4 },
];

const VENDOR_LOGOS: Record<ModelSpec["vendor"], string> = {
  openai: openaiLogo,
  nvidia: nvidiaLogo,
};

export const ALL_MODEL_IDS = MODELS.map((m) => m.id);

export const MODEL_NAMES: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.fullName])
);

/// Whether each model can transcribe anything other than English — drives the
/// language picker, which is inert on `.en` weights.
export const MODEL_MULTILINGUAL: Record<string, boolean> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.multilingual])
);

interface Props {
  activeEngine: string | null;
  setActiveEngine: (engine: string) => void;
  modelStatus: Record<string, ModelState>;
  modelStray: Record<string, number>;
  modelStatusLoading: boolean;
  downloadingId: string | null;
  setDownloadingId: (id: string | null) => void;
  downloadProgress: number;
  onModelDeleted?: () => void;
  statusError?: string;
  onRetry?: () => void;
}

export function ModelsView({ activeEngine, setActiveEngine, modelStatus, modelStray, modelStatusLoading, downloadingId, setDownloadingId, downloadProgress, onModelDeleted, statusError, onRetry }: Props) {
  const [operation, setOperation] = useState<{ id: string; kind: "download" | "select" | "delete" } | null>(null);
  const operationLock = useRef(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelSpec | null>(null);
  const [language, setLanguage] = useState("english");
  const [search, setSearch] = useState("");
  const [browsingId, setBrowsingId] = useState("");
  const visibleModels = MODELS.filter(model => (language === "all" || model.multilingual === (language === "multi")) && model.fullName.toLowerCase().includes(search.toLowerCase()));
  const rankedModels = visibleModels;
  const featuredIds = language === "multi" ? ["parakeet-v3", "whisper-base-multi", "whisper-large-v3-turbo"] : ["parakeet-v2", "whisper-base", "whisper-small"];
  const featured = featuredIds.map(id => MODELS.find(model => model.id === id)!);
  const busy = !!operation || !!downloadingId;

  const run = async (model: ModelSpec, kind: "download" | "select" | "delete", activate = false) => {
    if (operationLock.current || downloadingId) return;
    operationLock.current = true;
    setOperation({ id: model.id, kind }); setError(null);
    try {
      if (kind === "download") {
        setDownloadingId(model.id);
        await downloadModel(model.id);
        onModelDeleted?.();
        if (activate) {
          setOperation({ id: model.id, kind: "select" });
          await setEngine(model.id);
          setActiveEngine(model.id);
          toast.success(`${model.fullName} is now active`);
        } else toast.success(`${model.fullName} downloaded`);
      } else if (kind === "select") {
        await setEngine(model.id); setActiveEngine(model.id);
        toast.success(`${model.fullName} selected for dictation`);
      } else {
        await deleteModel(model.id); onModelDeleted?.(); setDeleteTarget(null);
        toast.success(`${model.fullName} removed from this device`);
      }
    } catch (failure) {
      const message = String(failure);
      setError({ id: model.id, message });
      toast.error(`Could not finish ${model.fullName} setup. ${String(failure)}`);
    } finally {
      if (kind === "download") { setDownloadingId(null); onModelDeleted?.(); }
      operationLock.current = false; setOperation(null);
    }
  };

  const renderCard = (model: ModelSpec) => {
    const complete = modelStatus[model.id] === "complete";
    const partial = modelStatus[model.id] === "partial";
    const selected = activeEngine === model.id;
    const currentOperation = operation?.id === model.id ? operation.kind : null;
    const downloading = downloadingId === model.id || currentOperation === "download";
    const status = downloading ? "Downloading" : currentOperation === "select" ? "Loading model" : currentOperation === "delete" ? "Removing" : selected ? "Selected" : complete ? "Downloaded" : partial ? "Incomplete download" : "Not downloaded";
    return <article key={model.id} className={cn("speech-choice", selected && "is-active")} aria-label={model.fullName}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04]"><img src={VENDOR_LOGOS[model.vendor]} alt={model.vendor === "nvidia" ? "NVIDIA" : "OpenAI"} className={cn("invert dark:invert-0 opacity-80", model.vendor === "nvidia" ? "w-7" : "w-5")} /></div>
        <div className="min-w-0 flex-1"><h3 className="text-base font-semibold leading-snug">{model.fullName}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{model.description}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{model.size} download</span><span>{model.multilingual ? model.id === "parakeet-v3" ? "25 languages" : "99 languages" : "English only"}</span></div>
      <dl className="model-tradeoffs">
        {[{ label: "Speed", value: model.speed }, { label: "Accuracy", value: model.accuracy }].map(rating => <div key={rating.label}><dt>{rating.label}</dt><dd className="model-rating" aria-label={`${rating.value} out of 5, relative ${rating.label.toLowerCase()} rating`}><span className="rating-dots" aria-hidden="true">{[1, 2, 3, 4, 5].map(dot => <span key={dot} className={dot <= rating.value ? "is-filled" : ""} />)}</span><span aria-hidden="true" className="tabular-nums">{rating.value}<span className="text-muted-foreground">/5</span></span></dd></div>)}
      </dl>
      {model.id === "whisper-large-v3-turbo" && <p className="text-xs text-warning">Requires a Metal GPU. Choose a smaller model if your device does not support it.</p>}
      {partial && !downloading && <p className="text-xs leading-relaxed text-warning">Interrupted download · {Math.round((modelStray[model.id] ?? 0) / 1_048_576)} MB on disk. Retry the download or remove these files.</p>}
      {downloading && <div className="space-y-2"><div className="flex justify-between text-xs text-muted-foreground"><span>{downloadProgress >= 100 ? "Verifying download…" : "Downloading model…"}</span><span className="tabular-nums">{Math.min(100, Math.max(0, downloadProgress)).toFixed(0)}%</span></div><Progress aria-label={`Downloading ${model.fullName}`} value={downloadProgress} /></div>}
      {error?.id === model.id && <p role="alert" className="break-words text-xs leading-relaxed text-destructive">{error.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span role="status" className={cn("inline-flex items-center gap-1.5 text-xs", selected ? "text-success" : partial ? "text-warning" : "text-muted-foreground")}>{selected && <Check size={13} />}{status}</span>
        <div className="flex flex-wrap items-center gap-1">
          {!complete && !selected && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(model, "download")}>Download only</Button>}
          {(complete || partial) && !selected && <Button variant="ghost" size="icon-sm" disabled={busy} title={`Remove ${model.fullName}`} aria-label={`Remove ${model.fullName}`} onClick={() => setDeleteTarget(model)}><Trash2 size={14} /></Button>}
          <Button variant={selected ? "secondary" : complete ? "default" : "outline"} size="sm" disabled={busy || selected} onClick={() => void run(model, complete ? "select" : "download", !complete)}>
            {currentOperation || downloading ? <Loader2 size={14} className="animate-spin" /> : selected ? <Check size={14} /> : !complete ? <Download size={14} /> : null}
            {downloading ? "Downloading…" : currentOperation === "select" ? "Loading…" : currentOperation === "delete" ? "Removing…" : selected ? "Selected" : complete ? "Use model" : partial ? "Retry & use" : "Download & use"}
          </Button>
        </div>
      </div>
    </article>;
  };

  return <div className="space-y-5 workspace-enter pb-6">
    <PageHeader title="Speech Models" description="Choose how Patter hears you. Download once, transcribe on your device." />

    {downloadingId && <div role="status" className="space-y-2 rounded-xl bg-accent-subtle p-4"><div className="flex justify-between gap-3 text-sm"><span>{downloadProgress >= 100 ? "Verifying" : "Downloading"} {MODEL_NAMES[downloadingId]}</span><span>{Math.min(100, Math.max(0, downloadProgress)).toFixed(0)}%</span></div><Progress value={downloadProgress} aria-label="Speech model download" /></div>}
    <div className="speech-language"><div><h2>What languages do you speak?</h2><p>Multilingual models also understand English.</p></div><div className="choice-segments" aria-label="Language coverage">{[{ id: "english", label: "English" }, { id: "multi", label: "Multiple languages" }].map(item => <button key={item.id} type="button" aria-pressed={(language === "all" ? "english" : language) === item.id} onClick={() => { setLanguage(item.id); setBrowsingId(""); }}>{item.label}</button>)}</div></div>
    {statusError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"><p className="text-sm text-destructive">Could not check downloaded models. {statusError}</p><Button variant="outline" onClick={onRetry}><RefreshCw size={14} />Retry</Button></div> : modelStatusLoading ? <div role="status" aria-label="Loading speech models" className="grid grid-cols-1 gap-3 xl:grid-cols-2">{MODELS.map(model => <Skeleton key={model.id} className="h-52 rounded-xl" />)}</div> : <>
      <section className="space-y-4"><div className="section-heading"><h2>Start with one of these</h2><span>Relative scale: 5 is highest · varies by device</span></div><div className="speech-shortlist">{featured.map((model, index) => <div key={model.id} className="featured-model"><div className="model-purpose">{index === 0 ? <Zap size={15} /> : index === 1 ? <HardDrive size={15} /> : <Languages size={15} />}<span>{index === 0 ? "For fast everyday dictation" : index === 1 ? "For a smaller download" : "For more detail"}</span></div>{renderCard(model)}</div>)}</div></section>
      <section className="speech-catalog"><div className="section-heading"><div><h2>Explore every model</h2><p>Compare language support, download size, and strengths.</p></div><input type="search" aria-label="Search speech models" placeholder="Find a model…" value={search} onChange={event => setSearch(event.target.value)} className="model-search" /></div>
      <div className="catalog-head"><span>Model</span><span>Languages</span><span>Download</span><span>Status</span></div>
      {rankedModels.map(model => <div key={model.id}><button type="button" className="catalog-row" aria-expanded={browsingId === model.id} onClick={() => setBrowsingId(browsingId === model.id ? "" : model.id)}><span><strong>{model.fullName}</strong><small>{model.description}</small></span><span>{model.multilingual ? model.id === "parakeet-v3" ? "25 languages" : "99 languages" : "English"}</span><span>{model.size}</span><span>{activeEngine === model.id ? <><Check size={13} /> Active</> : modelStatus[model.id] === "complete" ? "Installed" : "View model"}<ArrowRight size={14} /></span></button>{browsingId === model.id && <div className="catalog-detail">{renderCard(model)}</div>}</div>)}
      {!rankedModels.length && <p className="p-6 text-sm text-muted-foreground">No matching models. Try another search.</p>}
      <p className="catalog-note">Download size is disk space, not memory usage. Selecting a model keeps your current setup active until the new model is ready.</p></section>
    </>}
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !operation) setDeleteTarget(null); }}><DialogContent><DialogHeader><DialogTitle>Remove {deleteTarget?.fullName}?</DialogTitle><DialogDescription>This removes the downloaded files from your device. You can download the model again later. Your transcripts are kept.</DialogDescription></DialogHeader>{deleteTarget && error?.id === deleteTarget.id && <p role="alert" className="text-sm text-destructive">{error.message}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleteTarget(null)}>Keep model</Button><Button variant="destructive" disabled={busy} onClick={() => deleteTarget && void run(deleteTarget, "delete")}>{operation?.kind === "delete" && <Loader2 size={14} className="animate-spin" />}Remove model</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
