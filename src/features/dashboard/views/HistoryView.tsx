import { useState, useMemo } from "react";
import { toast } from "sonner";
import { TranscriptionRecord } from "../../../types";
import { Trash2, Copy, Loader2, MicOff, Pencil, Check, X } from "lucide-react";
import { clearHistory, deleteHistoryRecord, updateHistoryRecord } from "../../../lib/ipc";
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
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  const handleDelete = async (id: string) => {
    try {
      await deleteHistoryRecord(id);
      setHistory(history ? history.filter(r => r.id !== id) : []);
      toast.success("Record deleted");
    } catch (e) {
      toast.error("Failed to delete record: " + e);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setIsSaving(true);
    try {
      await updateHistoryRecord(editingId, editValue);
      setHistory(history ? history.map(r => r.id === editingId ? { ...r, text: editValue } : r) : []);
      setEditingId(null);
      toast.success("Record updated");
    } catch (e) {
      toast.error("Failed to update record: " + e);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (record: TranscriptionRecord) => {
    setEditingId(record.id);
    setEditValue(record.text);
  };

  const formatTime = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const groupedHistory = useMemo(() => {
    if (!history) return null;
    const groups: { date: string, records: TranscriptionRecord[] }[] = [];
    const map = new Map<string, TranscriptionRecord[]>();

    const formatDateGroup = (ms: number) => {
      const date = new Date(ms);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (date.toDateString() === today.toDateString()) {
        return "Today";
      }
      if (date.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
      }
      return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    };

    history.forEach(record => {
      const groupStr = formatDateGroup(record.timestamp_ms);
      if (!map.has(groupStr)) {
        map.set(groupStr, []);
        groups.push({ date: groupStr, records: map.get(groupStr)! });
      }
      map.get(groupStr)!.push(record);
    });

    return groups;
  }, [history]);

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
        <div className="space-y-6 pb-6">
          {groupedHistory?.map((group) => (
            <div key={group.date} className="space-y-3">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                {group.date}
              </h3>
              <Card className="py-0 overflow-hidden">
                <div className="divide-y divide-border">
                  {group.records.map((record) => (
                    <div key={record.id} className="group relative flex gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
                      {/* Left metadata */}
                      <div className="w-20 shrink-0 relative flex items-center pt-[1px]">
                        <div className="absolute left-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity -ml-1 gap-0.5 z-10">
                          <button
                            onClick={() => handleDelete(record.id)}
                            title="Delete"
                            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground transition-colors hover:text-red-400 hover:bg-white/[0.06] cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                          <button
                            onClick={() => startEdit(record)}
                            title="Edit"
                            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground transition-colors hover:text-blue-400 hover:bg-white/[0.06] cursor-pointer"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => handleCopy(record.text)}
                            title="Copy text"
                            className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground transition-colors hover:text-steelIce hover:bg-white/[0.06] cursor-pointer"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground/80 group-hover:opacity-0 transition-opacity">{formatTime(record.timestamp_ms)}</span>
                      </div>

                      {/* Main Text */}
                      <div className="flex-1 min-w-0 pr-4">
                        {editingId === record.id ? (
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-full bg-white/[0.05] border border-border/50 rounded-md p-2 text-[13px] text-foreground/90 leading-relaxed min-h-[60px] focus:outline-none focus:ring-1 focus:ring-steelIce/50 resize-y"
                              disabled={isSaving}
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={() => setEditingId(null)}
                                disabled={isSaving}
                              >
                                <X size={12} className="mr-1" /> Cancel
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={handleSaveEdit}
                                disabled={isSaving || editValue === record.text}
                              >
                                {isSaving ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Check size={12} className="mr-1" />}
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[13px] leading-relaxed text-foreground/90 break-words">{record.text}</p>
                        )}
                      </div>

                      {/* Right Actions/Stats */}
                      <div className="flex shrink-0 items-start justify-end w-12">
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums pt-[2px]">
                          {record.duration_seconds.toFixed(1)}s
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
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
