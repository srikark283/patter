import { useState } from "react";
import { toast } from "sonner";
import { TranscriptionRecord } from "../../../types";
import { Trash2, Copy, Loader2, MicOff } from "lucide-react";
import { clearHistory } from "../../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface Props {
  history: TranscriptionRecord[] | null;
  setHistory: (h: TranscriptionRecord[]) => void;
}

export function HistoryView({ history, setHistory }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      await clearHistory();
      setHistory([]);
      toast.success("History cleared");
    } catch (e) {
      console.error(e);
      toast.error("Failed to clear history: " + e);
    } finally {
      setClearing(false);
      setConfirmOpen(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const formatStamp = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="History"
        description="Every transcription Patter has pasted for you."
        action={
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)} disabled={!history?.length}>
            <Trash2 size={16} />
            <span>Clear History</span>
          </Button>
        }
      />

      {history === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : history.length === 0 ? (
        <Card className="py-14">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.04] ring-1 ring-border">
              <MicOff size={16} className="text-muted-foreground" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-sm font-medium">No dictation yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Hold your shortcut and speak — transcripts land here.</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="py-0">
          <div className="divide-y divide-border">
            {history.map((record) => (
              <div key={record.id} className="group relative px-5 py-4 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[11px] text-steelIce/70">{formatStamp(record.timestamp_ms)}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {record.words}w · {record.duration_seconds.toFixed(1)}s
                    </span>
                    <button
                      onClick={() => handleCopy(record.text)}
                      title="Copy text"
                      className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground opacity-0 ring-1 ring-transparent transition-all group-hover:opacity-100 hover:text-steelIce hover:ring-border hover:bg-white/[0.04] cursor-pointer"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-foreground/90">{record.text}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear transcription history?</DialogTitle>
            <DialogDescription>
              This deletes your transcript log. Stats (time saved, total words, transcription count) are preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearHistory} disabled={clearing}>
              {clearing && <Loader2 size={14} className="animate-spin" />}
              Clear History
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
