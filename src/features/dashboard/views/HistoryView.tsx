import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { toast } from "sonner";
import { TranscriptionRecord } from "../../../types";
import { Trash2, Copy, MicOff, Pencil, Check, X, Search, Filter, Loader2 } from "lucide-react";
import { clearHistory, deleteHistoryRecord, updateHistoryRecord, } from "../../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { NativeAppIcon } from "../components/NativeAppIcon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { GroupedVirtuoso } from "react-virtuoso";
import { cn } from "@/lib/utils";

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

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [appFilter, setAppFilter] = useState<string | null>(null);
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

  // Unique Apps for Filter
  const uniqueApps = useMemo(() => {
    if (!history) return [];
    const apps = new Set(history.map(r => r.app_name).filter(Boolean) as string[]);
    return Array.from(apps).sort();
  }, [history]);

  // Filtered History
  const filteredHistory = useMemo(() => {
    if (!history) return null;
    
    let filtered = history;
    
    if (searchQuery) {
      // Fallback to local exact match if semantic search is disabled
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r => r.text.toLowerCase().includes(q));
    }

    if (appFilter) {
      filtered = filtered.filter(r => r.app_name === appFilter);
    }
    return filtered;
  }, [history, searchQuery, appFilter]);

  // Grouped for Virtuoso
  const { groups, flatRecords, groupCounts } = useMemo(() => {
    if (!filteredHistory) return { groups: [], flatRecords: [], groupCounts: [] };
    const groupsObj: { date: string, records: TranscriptionRecord[] }[] = [];
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

    filteredHistory.forEach(record => {
      const groupStr = formatDateGroup(record.timestamp_ms);
      if (!map.has(groupStr)) {
        map.set(groupStr, []);
        groupsObj.push({ date: groupStr, records: map.get(groupStr)! });
      }
      map.get(groupStr)!.push(record);
    });

    const flat: TranscriptionRecord[] = [];
    const counts: number[] = [];
    groupsObj.forEach(g => {
      flat.push(...g.records);
      counts.push(g.records.length);
    });

    return { groups: groupsObj, flatRecords: flat, groupCounts: counts };
  }, [filteredHistory]);

  // Virtuoso renders rows as flat siblings, so each day's card outline has to
  // be reassembled from where a row sits inside its group.
  const edges = useMemo(() => {
    const out: { first: boolean; last: boolean }[] = [];
    for (const n of groupCounts) {
      for (let i = 0; i < n; i++) out.push({ first: i === 0, last: i === n - 1 });
    }
    return out;
  }, [groupCounts]);

  // The page scrolls in <main>, not in the list. Handing Virtuoso that element
  // keeps one scrollbar and keeps PageHeader's stick-on-scroll working.
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScrollParent(rootRef.current?.closest("main") ?? null);
  }, []);

  /** One row. Virtuoso mounts only what's on screen, so this is called for a
   *  couple of dozen records rather than every record you have ever dictated.
   *  Plain <div>, not a laid-out motion.div: framer's `layout` re-measures every
   *  mounted sibling on each render, which is exactly what made a long history
   *  crawl. The edit/read swap inside still animates. */
  const renderRow = (record: TranscriptionRecord, edge: { first: boolean; last: boolean }) => (
    <div
      className={cn(
        "group relative flex gap-4 px-5 py-4 bg-card border-x border-border transition-colors hover:bg-accent-subtle",
        edge.first ? "border-t border-border rounded-t-xl" : "border-t border-border/20",
        edge.last && "border-b border-border rounded-b-xl"
      )}
    >
      {/* Left: Timestamp & App */}
      <div className="w-24 shrink-0 flex flex-col items-start gap-1.5 mt-0.5">
        <span className="font-sans text-[11px] text-muted-foreground/80 font-medium">
          {formatTime(record.timestamp_ms)}
        </span>
        {record.app_name && (
          <Badge variant="secondary" className="px-1.5 py-0 h-4.5 text-[9px] bg-foreground/[0.04] border-transparent text-muted-foreground/70 flex items-center gap-1" title={`Pasted in ${record.app_name}`}>
            <NativeAppIcon appName={record.app_name} />
            <span className="truncate max-w-[80px]">{record.app_name}</span>
          </Badge>
        )}
      </div>

      {/* Main: Text Content */}
      <div className="flex-1 min-w-0 pr-2">
        <AnimatePresence mode="wait" initial={false}>
        {editingId === record.id ? (
          <motion.div
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex flex-col gap-2 relative"
          >
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-lg p-3 text-[13px] text-foreground/90 leading-relaxed min-h-[80px] focus:outline-none focus-visible:ring-focusIce/50 resize-y shadow-inner backdrop-blur-md"
              disabled={isSaving}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2.5 rounded-full"
                onClick={() => setEditingId(null)}
                disabled={isSaving}
              >
                <X size={12} className="mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs px-3 rounded-full"
                onClick={handleSaveEdit}
                disabled={isSaving || editValue === record.text}
              >
                {isSaving ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Check size={12} className="mr-1" />}
                Save
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="read"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="text-[13px] leading-relaxed text-foreground/90 break-words group-hover:text-foreground transition-colors cursor-text selection:bg-steelIce/30"
            onDoubleClick={() => startEdit(record)}
            title="Double-click to edit"
          >
            {record.text}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Right: Stats & Hover Actions */}
      <div className="shrink-0 flex items-center gap-3 relative">
        {/* Floating Actions (visible on hover) */}
        {/* Hidden while this row is being edited: it kept
            reacting to hover and slid in over Cancel/Save. */}
        <div className={cn(
          "flex items-center gap-0.5 bg-card/80 backdrop-blur-md px-1 py-0.5 rounded-md shadow-sm border border-border/30 transition-all duration-200",
          editingId === record.id
            ? "opacity-0 pointer-events-none"
            : "opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0"
        )}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => handleCopy(record.text)}
            title="Copy text"
            className="h-6 w-6 text-muted-foreground hover:text-steelIce"
          >
            <Copy size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => startEdit(record)}
            title="Edit"
            className="h-6 w-6 text-muted-foreground hover:text-blue-400"
          >
            <Pencil size={12} />
          </Button>
          <div className="w-[1px] h-3 bg-border/50 mx-0.5" />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => handleDelete(record.id)}
            title="Delete"
            className="h-6 w-6 text-muted-foreground hover:text-red-400"
          >
            <Trash2 size={12} />
          </Button>
        </div>

        {/* Default visible stats */}
        <div className="flex items-center gap-2">
          <span className="font-sans text-[11px] text-muted-foreground/60 tabular-nums">
            {record.words} w
          </span>
          <Tooltip>
              <TooltipTrigger className="cursor-default">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-sans tabular-nums border-border/40 text-muted-foreground/80 bg-transparent hover:bg-foreground/[0.05] transition-colors">
                  {record.duration_seconds.toFixed(1)}s
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">
                <p>Transcription: {(record.transcribe_ms / 1000).toFixed(1)}s</p>
                {record.cleanup_ms > 0 && (
                  <p>Cleanup: {(record.cleanup_ms / 1000).toFixed(1)}s</p>
                )}
                {record.total_ms > 0 && (
                  <p className="opacity-70">Total: {(record.total_ms / 1000).toFixed(1)}s</p>
                )}
              </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
    <div ref={rootRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Transcripts"
        description="Every transcription Patter has pasted for you."
        action={
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)} disabled={!history?.length}>
            <Trash2 size={16} />
            <span>Clear History</span>
          </Button>
        }
      />

      {/* Search and Filters */}
      {history && history.length > 0 && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input 
              placeholder="Search transcripts..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9 bg-foreground/[0.02] border-border/50 focus-visible:ring-focusIce/50" 
            />
            
          </div>
          
          {uniqueApps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={14} className="text-muted-foreground mr-1" />
              <Badge 
                variant={appFilter === null ? "default" : "secondary"} 
                className={cn("cursor-pointer transition-colors px-2", appFilter === null ? "bg-primary text-primary-foreground" : "bg-foreground/[0.05] hover:bg-foreground/[0.1]")}
                onClick={() => setAppFilter(null)}
              >
                All
              </Badge>
              {uniqueApps.map(app => (
                <Badge 
                  key={app}
                  variant={appFilter === app ? "default" : "secondary"}
                  className={cn("cursor-pointer transition-colors flex items-center gap-1.5 px-2", appFilter === app ? "bg-primary text-primary-foreground" : "bg-foreground/[0.05] hover:bg-foreground/[0.1]")}
                  onClick={() => setAppFilter(app)}
                >
                  <NativeAppIcon appName={app} />
                  {app}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {history === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : history.length === 0 ? (
        <EmptyState
          icon={MicOff}
          title="No dictation yet"
          description="Hold your shortcut and speak — transcripts land here."
        />
      ) : filteredHistory?.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No results found"
          description="Try adjusting your search or filters."
        />
      ) : (
        <GroupedVirtuoso
          customScrollParent={scrollParent ?? undefined}
          groupCounts={groupCounts}
          groupContent={(i) => (
            <h3 className="pt-6 pb-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              {groups[i].date}
            </h3>
          )}
          itemContent={(index) => renderRow(flatRecords[index], edges[index])}
        />
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
    </TooltipProvider>
  );
}
