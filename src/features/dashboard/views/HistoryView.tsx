import { AppContextBadge } from "../components/AppContextBadge";
import { useNewTranscript } from "@/hooks/use-new-transcript";
import { useEffect, useState, useMemo, useRef, useLayoutEffect } from "react";
import { toast } from "sonner";
import { TranscriptionRecord } from "../../../types";
import { Trash2, Copy, MicOff, Pencil, Check, X, Search, Loader2, Star, SlidersHorizontal, ChevronDown, Clock3, CalendarDays } from "lucide-react";
import { clearHistory, deleteHistoryRecord, updateHistoryRecord, setHistoryFlags, getSettings, type Settings } from "../../../lib/ipc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from "react-virtuoso";
import { filterTranscripts } from "@/lib/transcript-filters";
import { RecoveryNotice, needsRecovery } from "../components/RecoveryNotice";
import { cn } from "@/lib/utils";

interface Props {
  history: TranscriptionRecord[] | null;
  setHistory: React.Dispatch<React.SetStateAction<TranscriptionRecord[] | null>>;
}

export function HistoryView({ history, setHistory }: Props) {
  const freshId = useNewTranscript(history);
  const [profileSettings, setProfileSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void getSettings().then(settings => { if (!disposed) setProfileSettings(settings); }).catch(() => { if (!disposed) setProfileSettings(null); }); };
    refresh(); window.addEventListener("focus", refresh);
    return () => { disposed = true; window.removeEventListener("focus", refresh); };
  }, []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TranscriptionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [clearing, setClearing] = useState(false);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ id: string; kind: "copied" | "saved" } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 1800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useRef<GroupedVirtuosoHandle>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());
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

  const handleCopy = (record: TranscriptionRecord) => {
    navigator.clipboard.writeText(record.text).then(() => setFeedback({ id: record.id, kind: "copied" })).catch(() => toast.error("Could not copy. Select the text and copy manually."));
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleting(true);
      if (!await deleteHistoryRecord(id)) throw new Error("Transcript no longer exists");
      setHistory(current => current ? current.filter(r => r.id !== id) : []);
      toast.success("Transcript deleted");
      setDeleteTarget(null);
    } catch (e) {
      toast.error("Failed to delete record: " + e);
    } finally { setDeleting(false); }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editValue.trim() || isSaving) return;
    setIsSaving(true);
    try {
      if (!await updateHistoryRecord(editingId, editValue)) throw new Error("Transcript no longer exists");
      setHistory(current => current ? current.map(r => r.id === editingId ? { ...r, text: editValue } : r) : []);
      setFeedback({ id: editingId, kind: "saved" });
      setEditingId(null);
    } catch (e) {
      toast.error("Failed to update record: " + e);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (record: TranscriptionRecord) => {
    if (editingId && editingId !== record.id && editValue !== history?.find(item => item.id === editingId)?.text) {
      toast.info("Save or cancel your current edit first");
      return;
    }
    setEditingId(record.id);
    setEditValue(record.text);
  };

  const toggleFavorite = async (record: TranscriptionRecord) => {
    setPendingFavorites(current => new Set(current).add(record.id));
    try {
      await setHistoryFlags(record.id, { favorite: !record.favorite });
      setHistory(current => current?.map(item => item.id === record.id ? { ...item, favorite: !record.favorite } : item) ?? null);
    } catch { toast.error("Could not update favorite"); }
    finally { setPendingFavorites(current => { const next = new Set(current); next.delete(record.id); return next; }); }
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
    
    const result = filterTranscripts(history, { query: searchQuery, app: appFilter, favorites: favoritesOnly, recovery: recoveryOnly, from: dateFrom, through: dateTo });
    return result.sort((a, b) => oldestFirst ? a.timestamp_ms - b.timestamp_ms : b.timestamp_ms - a.timestamp_ms);
  }, [history, searchQuery, appFilter, favoritesOnly, recoveryOnly, dateFrom, dateTo, oldestFirst]);

  const counts = useMemo(() => ({ all: history?.length ?? 0, favorites: history?.filter(record => record.favorite).length ?? 0, recovery: history?.filter(needsRecovery).length ?? 0 }), [history]);
  const advancedCount = Number(!!appFilter) + Number(!!dateFrom || !!dateTo);
  const hasFilters = !!(searchQuery || appFilter || dateFrom || dateTo || favoritesOnly || recoveryOnly);
  const resetFilters = () => { setSearchQuery(""); setAppFilter(null); setDateFrom(""); setDateTo(""); setFavoritesOnly(false); setRecoveryOnly(false); };

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
        year: "numeric",
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
  const renderRow = (record: TranscriptionRecord) => (
    <div className="pb-3">
    <div
      tabIndex={0}
      data-transcript-id={record.id}
      aria-label={`Transcript from ${new Date(record.timestamp_ms).toLocaleString()}${record.favorite ? ", favorite" : ""}`}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const index = flatRecords.findIndex(item => item.id === record.id);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? flatRecords.length - 1 : Math.max(0, Math.min(flatRecords.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
          listRef.current?.scrollIntoView({ index: next, align: "center", calculateViewLocation: params => {
            const headerHeight = rootRef.current?.querySelector(".sticky")?.getBoundingClientRect().height ?? 0;
            return params.itemTop < params.viewportTop + headerHeight || params.itemBottom > params.viewportBottom ? { ...params.locationParams, align: "center" } : null;
          }, done: () => {
            const row = rootRef.current?.querySelectorAll<HTMLElement>("[data-transcript-id]");
            row?.forEach(element => { if (element.dataset.transcriptId === flatRecords[next]?.id) element.focus({ preventScroll: true }); });
          } });
        } else if (event.key === "Enter") { event.preventDefault(); startEdit(record); }
      }}
      className={cn(
        "group relative focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 flex flex-col gap-2.5 rounded-xl border border-border bg-card px-5 py-3.5 transition-colors hover:border-input",
        needsRecovery(record) && "bg-warning/5",
        freshId === record.id && "transcript-arrived"
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 size={13} />{formatTime(record.timestamp_ms)}</span>
        {record.app_name && <AppContextBadge app={record.app_name} settings={profileSettings} />}
        {needsRecovery(record) && <span className="rounded-md bg-warning/10 px-2 py-1 text-warning">Needs recovery</span>}
      </div>

      {/* Main: Text Content */}
      <div className="min-w-0">
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
              aria-label="Edit transcript"
              onKeyDown={event => {
                if (event.key === "Escape" && !isSaving) { event.preventDefault(); setEditingId(null); }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !isSaving) { event.preventDefault(); void handleSaveEdit(); }
              }}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full bg-background border border-border/50 rounded-lg p-3 text-sm text-foreground leading-relaxed min-h-[140px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
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
                disabled={isSaving || !editValue.trim() || editValue === record.text}
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
            className={cn("text-[15px] leading-7 text-foreground whitespace-pre-wrap break-words cursor-text", expandedId !== record.id && "line-clamp-4")}
            onDoubleClick={() => startEdit(record)}
            title="Double-click to edit"
          >
            {record.text}
          </motion.div>
        )}
        </AnimatePresence>
        {editingId !== record.id && (record.text.length > 260 || record.text.split("\n").length > 4) && <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-foreground" aria-expanded={expandedId === record.id} onClick={() => setExpandedId(value => value === record.id ? null : record.id)}>{expandedId === record.id ? "Show less" : "Read full transcript"}<ChevronDown size={13} className={expandedId === record.id ? "rotate-180" : ""} /></button>}
      </div>
      {needsRecovery(record) && <RecoveryNotice compact record={record} onResolved={() => setHistory(current => current?.map(item => item.id === record.id ? { ...item, recovery_dismissed: true } : item) ?? null)} />}

      <span role="status" className="sr-only">{feedback?.id === record.id ? feedback.kind === "copied" ? "Copied to clipboard" : "Transcript saved" : ""}</span>
      {feedback?.id === record.id && feedback.kind === "saved" && <span className="action-confirm inline-flex items-center gap-1 text-xs text-success"><Check size={12} />Saved</span>}
      {/* Actions and recording details */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
        <div style={editingId === record.id ? { display: "none" } : undefined} className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label={record.favorite ? "Remove favorite" : "Add favorite"} title={record.favorite ? "Remove favorite" : "Add favorite"} aria-pressed={!!record.favorite} disabled={pendingFavorites.has(record.id)} onClick={() => void toggleFavorite(record)} className={cn("h-7 w-7", record.favorite ? "text-warning hover:text-warning hover:bg-warning/10" : "text-muted-foreground hover:text-warning")}><Star key={String(!!record.favorite)} className={record.favorite ? "favorite-confirm" : undefined} size={14} fill={record.favorite ? "currentColor" : "none"} /></Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCopy(record)}
            title="Copy text"
            className="h-7 px-2 text-muted-foreground hover:text-accent-foreground"
          >
            {feedback?.id === record.id && feedback.kind === "copied" ? <Check size={14} className="action-confirm text-success" /> : <Copy size={14} />}<span className="text-xs">{feedback?.id === record.id && feedback.kind === "copied" ? "Copied" : "Copy"}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => startEdit(record)}
            title="Edit"
            className="h-7 w-7 text-muted-foreground hover:text-accent-foreground"
          >
            <Pencil size={12} />
          </Button>
          <div className="w-[1px] h-3 bg-border/50 mx-0.5" />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDeleteTarget(record)}
            title="Delete"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={12} />
          </Button>
        </div>

        <dl className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Transcript statistics">
          {[
            { label: "Words", value: (record.text.trim() ? record.text.trim().split(/\s+/).length : 0).toLocaleString() },
            { label: "Recording", value: `${record.duration_seconds.toFixed(1)}s` },
            ...(record.transcribe_ms > 0 ? [{ label: "Transcription", value: `${(record.transcribe_ms / 1000).toFixed(1)}s` }] : []),
            ...(record.cleanup_ms > 0 ? [{ label: "Cleanup", value: `${(record.cleanup_ms / 1000).toFixed(1)}s` }] : []),
            ...(record.total_ms > 0 ? [{ label: "Processing total", value: `${(record.total_ms / 1000).toFixed(1)}s` }] : []),
          ].map(stat => <div key={stat.label} className="flex items-baseline gap-1.5">
            <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
            <dd className={cn("text-xs font-medium tabular-nums", ["Words", "Recording", "Cleanup"].includes(stat.label) ? "text-accent-foreground" : "text-foreground")}>{stat.value}</dd>
          </div>)}
        </dl>
      </div>
    </div>
    </div>
  );

  return (
    <div ref={rootRef} className="space-y-5 workspace-enter">
      <PageHeader
        title="Transcripts"
        description="Find, refine, and reuse your dictations."
        action={
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmOpen(true)} disabled={!history?.length}>
            <Trash2 size={16} />
            <span>Clear History</span>
          </Button>
        }
      />

      {history && history.length > 0 && <section aria-label="Transcript tools" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1" aria-label="Transcript views">
            {[
              { label: "All", count: counts.all, active: !favoritesOnly && !recoveryOnly, select: () => { setFavoritesOnly(false); setRecoveryOnly(false); } },
              { label: "Favorites", count: counts.favorites, active: favoritesOnly, select: () => { setFavoritesOnly(true); setRecoveryOnly(false); } },
              { label: "Recovery", count: counts.recovery, active: recoveryOnly, select: () => { setFavoritesOnly(false); setRecoveryOnly(true); } },
            ].map(view => <Button key={view.label} variant={view.active ? "secondary" : "ghost"} size="sm" aria-pressed={view.active} onClick={view.select} className={cn("gap-2", view.active && (view.label === "All" ? "bg-accent text-accent-foreground hover:bg-accent-strong" : "bg-warning/10 text-warning hover:bg-warning/15"))}><span>{view.label}</span><span className={cn("rounded px-1.5 py-0.5 text-xs tabular-nums", view.active ? "bg-background/50 text-inherit" : "text-muted-foreground")}>{view.count}</span></Button>)}
          </div>
          <select aria-label="Sort transcripts" className="h-9 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground" value={oldestFirst ? "oldest" : "newest"} onChange={event => setOldestFirst(event.target.value === "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} /><Input aria-label="Search transcripts" placeholder="Search your words…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="h-10 pl-9 pr-9 bg-card focus-visible:border-primary/50 focus-visible:ring-primary/20" />{searchQuery && <button aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearchQuery("")}><X size={14} /></button>}</div>
          <Button variant={advancedCount ? "secondary" : "outline"} aria-expanded={filtersOpen} aria-controls="transcript-filters" className="h-10" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={15} />Filters{advancedCount > 0 && <span className="text-xs tabular-nums">{advancedCount}</span>}</Button>
        </div>
        {filtersOpen && <div id="transcript-filters" className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
          <label className="space-y-1 text-xs text-muted-foreground">App<select aria-label="Filter by app" className="block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={appFilter ?? ""} onChange={event => setAppFilter(event.target.value || null)}><option value="">All apps</option>{uniqueApps.map(app => <option key={app} value={app}>{app}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">From<Input aria-label="From date" type="date" value={dateFrom} max={dateTo || undefined} onChange={event => setDateFrom(event.target.value)} className="w-auto" /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Through<Input aria-label="Through date" type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)} className="w-auto" /></label>
        </div>}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><p role="status">{filteredHistory?.length ?? 0} {(filteredHistory?.length ?? 0) === 1 ? "transcript" : "transcripts"}{hasFilters ? " found" : " saved"}</p>{hasFilters && <button className="text-accent-foreground" onClick={resetFilters}>Reset filters</button>}<details className="ml-auto"><summary className="cursor-pointer">Keyboard shortcuts</summary><p className="mt-2 max-w-sm leading-relaxed">↑ / ↓ to browse · Home / End to jump · Enter to edit · ⌘ / Ctrl + Enter to save · Esc to cancel editing</p></details></div>
      </section>}

      {history === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : history.length === 0 ? (
        <EmptyState
          icon={MicOff}
          voice
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
          ref={listRef}
          computeItemKey={index => flatRecords[index]?.id ?? `pending-${index}`}
          customScrollParent={scrollParent ?? undefined}
          groupCounts={groupCounts}
          groupContent={(i) => (
            <h3 className="flex items-center gap-2 pt-6 pb-3 text-sm font-medium text-accent-foreground px-1">
              <CalendarDays size={14} />{groups[i]?.date}<span className="rounded-md bg-accent px-1.5 py-0.5 text-xs tabular-nums">{groupCounts[i]}</span>
            </h3>
          )}
          itemContent={(index) => flatRecords[index] ? renderRow(flatRecords[index]) : null}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Delete this transcript?</DialogTitle><DialogDescription>This permanently removes the saved text. Your usage statistics stay unchanged.</DialogDescription></DialogHeader><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{deleteTarget?.text}</p><DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>Keep transcript</Button><Button variant="destructive" disabled={deleting} onClick={() => deleteTarget && void handleDelete(deleteTarget.id)}>{deleting && <Loader2 size={14} className="animate-spin" />}Delete transcript</Button></DialogFooter></DialogContent>
      </Dialog>

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
