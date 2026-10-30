import { EmptyDemo } from "../components/EmptyDemo";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateSettings, getSettings, Settings, dictionarySuggestions, dismissDictionarySuggestion, DictionarySuggestion } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { ListSkeleton } from "../components/ListSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Search, Plus, ArrowUpDown, Trash2, Check, AlertTriangle, BookOpen, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/// Whisper trims its initial prompt to n_text_ctx/2 - 1 tokens; see
/// MAX_PROMPT_TOKENS in src-tauri/src/asr/whisper.rs, which does the real,
/// tokenizer-accurate cut. This only warns before that happens, so a rough
/// ~4-chars-per-token estimate is enough.
/** Splits a typed or pasted blob into terms — commas or newlines, either way. */
function parseTerms(input: string): string[] {
  return input.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Merges `incoming` into `existing`, case-insensitively. The old check was
 * `terms.includes(clean)`, an exact match, so "Patter" and "patter" could both
 * live in the list and both burn prompt budget without adding anything.
 * Existing casing wins; the first spelling of a new term wins.
 */
function mergeTerms(existing: string[], incoming: string[]) {
  const seen = new Map(existing.map((t) => [t.toLowerCase(), t]));
  let added = 0;
  for (const term of incoming) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.set(key, term);
    added++;
  }
  return { merged: [...seen.values()], added, skipped: incoming.length - added };
}

const PROMPT_TOKEN_BUDGET = 223;
const CHARS_PER_TOKEN = 4;

export function DictionaryView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [suggestions, setSuggestions] = useState<DictionarySuggestion[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [editingTerm, setEditingTerm] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [saving, setSaving] = useState(false);

  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "alpha">("newest");
  const [confirmClear, setConfirmClear] = useState(false);
  const budgetUsed = terms.join(", ").length / CHARS_PER_TOKEN / PROMPT_TOKEN_BUDGET;
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      const raw = s.custom_prompt || "";
      const parsed = raw.split(",").map(t => t.trim()).filter(Boolean);
      setTerms(parsed);
    }).catch(console.error);
  }, []);

  const save = async (
    newTerms: string[],
    aliases = settings?.dictionary_aliases ?? {},
  ): Promise<boolean> => {
    if (!settings || saving) return false;
    setSaving(true);
    try {
      const current = await getSettings();
      const next = {
        ...current,
        custom_prompt: newTerms.join(", "),
        dictionary_aliases: Object.fromEntries(
          Object.entries(aliases).filter(([term]) => newTerms.includes(term)),
        ),
      };
      await updateSettings(next);
      setSettings(next);
      setTerms(newTerms);
      return true;
    } catch (error) {
      toast.error("Could not save dictionary: " + error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const refreshSuggestions = () => {
    dictionarySuggestions().then(setSuggestions).catch(console.error);
  };

  // Recomputed on mount rather than cached: both history and the dictionary
  // move underneath it, and a stale list keeps offering terms already added.
  useEffect(refreshSuggestions, []);

  // Keep dismissed suggestions and the local settings snapshot in sync.
  const rememberDismissal = (key: string) => {
    setSettings((current) =>
      current
        ? { ...current, dismissed_suggestions: [...current.dismissed_suggestions, key] }
        : current
    );
    setSuggestions((current) => current.filter((s) => s.key !== key));
  };

  const acceptSuggestion = async (suggestion: DictionarySuggestion) => {
    const { merged } = mergeTerms(terms, [suggestion.term]);
    const term = merged.find(t => t.toLowerCase() === suggestion.term.toLowerCase())!;
    const aliases = {
      ...settings?.dictionary_aliases,
      [term]: mergeTerms(settings?.dictionary_aliases?.[term] ?? [], suggestion.replaces).merged,
    };
    if (await save(merged, aliases)) {
      refreshSuggestions();
      toast.success(`Remembered corrections for "${term}"`);
    }
  };

  const rejectSuggestion = async (suggestion: DictionarySuggestion) => {
    try {
      await dismissDictionarySuggestion(suggestion.key);
      rememberDismissal(suggestion.key);
    } catch (error) {
      toast.error("Could not dismiss suggestion: " + error);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const incoming = parseTerms(newTerm);
    if (!incoming.length) return;
    const { merged, added, skipped } = mergeTerms(terms, incoming);
    if (added && !await save(merged)) return;
    if (incoming.length > 1 || skipped) {
      toast.success(
        `Added ${added} term${added === 1 ? "" : "s"}` +
          (skipped ? ` · skipped ${skipped} already in the list` : ""),
      );
    }
    setNewTerm("");
    setIsAdding(false);
    refreshSuggestions();
  };

  const handleClearAll = async () => {
    if (await save([])) {
      setConfirmClear(false);
      setEditingTerm(null);
      refreshSuggestions();
      toast.success("Dictionary cleared");
    }
  };

  const removeTerm = async (term: string) => {
    if (await save(terms.filter(t => t !== term))) {
      if (editingTerm === term) setEditingTerm(null);
      refreshSuggestions();
    }
  };

  const startEditing = (term: string) => {
    setIsAdding(false);
    setEditingTerm(term);
    setEditValue(term);
    setEditAliases((settings?.dictionary_aliases?.[term] ?? []).join("\n"));
  };

  const commitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTerm) return;
    const clean = editValue.trim();
    if (!clean || parseTerms(clean).length !== 1) {
      toast.error("Enter one preferred spelling.");
      return;
    }
    const collision = terms.find(t => t !== editingTerm && t.toLowerCase() === clean.toLowerCase());
    const preferred = collision ?? clean;
    const aliases = { ...settings?.dictionary_aliases };
    delete aliases[editingTerm];
    const variants = parseTerms(editAliases).filter(t => t.toLowerCase() !== preferred.toLowerCase());
    const mergedAliases = mergeTerms(collision ? aliases[collision] ?? [] : [], variants).merged;
    if (mergedAliases.length) aliases[preferred] = mergedAliases;
    const nextTerms = collision
      ? terms.filter(t => t !== editingTerm)
      : terms.map(t => t === editingTerm ? preferred : t);
    if (await save(nextTerms, aliases)) {
      setEditingTerm(null);
      refreshSuggestions();
      toast.success(collision ? `Merged into "${collision}"` : "Dictionary entry saved");
    }
  };


  const sortedTerms = [...terms].sort((a, b) => {
    if (sortOrder === "alpha") return a.localeCompare(b);
    return 0; 
  });
  if (sortOrder === "newest") {
    sortedTerms.reverse();
  }

  const filteredTerms = sortedTerms.filter(term =>
    [term, ...(settings?.dictionary_aliases?.[term] ?? [])]
      .some(value => value.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const headerAction = (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center bg-foreground/[0.03] border border-border rounded-full px-3 transition-colors focus-within:border-steelIce focus-within:bg-foreground/[0.05]">
        <Search size={14} className="text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search..." 
          aria-label="Search words and corrections"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="bg-transparent border-none text-foreground outline-none py-1.5 pl-2.5 w-32 md:w-40 text-sm placeholder:text-muted-foreground"
        />
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="rounded-full"
        onClick={() => setConfirmClear(true)}
        disabled={saving || !terms.length}
      >
        <Trash2 size={15} /> Clear all
      </Button>
      <Button disabled={saving} onClick={() => { setEditingTerm(null); setIsAdding(true); }} className="rounded-full shadow-sm">
        <Plus size={16} /> Add new
      </Button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Dictionary"
        description="Add words you want the model to recognize (names, jargon, slang)."
        action={headerAction}
      />

      {suggestions.length > 0 && (
        <div className="rounded-lg ring-1 ring-steelIce/20 bg-steelIce/[0.04] p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/90">
            <Sparkles size={14} className="text-steelIce" />
            Learned from your edits
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            You corrected these in History. Remembering them saves the preferred spelling and
            these mishearings for next time — on any speech model, with or without cleanup.
          </p>
          <div className="space-y-2">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.key}
                className="flex items-center justify-between gap-3 rounded-md bg-background/60 ring-1 ring-border px-3 py-2"
              >
                <div className="min-w-0 text-[13px]">
                  <span className="text-muted-foreground line-through">
                    {suggestion.replaces.join(", ")}
                  </span>
                  <span className="text-muted-foreground mx-2">→</span>
                  <span className="text-foreground font-medium">{suggestion.term}</span>
                  <span className="text-muted-foreground ml-2 text-[11px]">
                    corrected {suggestion.count}×
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button disabled={saving} size="sm" className="rounded-full h-7" onClick={() => acceptSuggestion(suggestion)}>
                    <Check size={14} /> Remember
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Never suggest this"
                    aria-label={`Dismiss correction for ${suggestion.term}`}
                    disabled={saving}
                    onClick={() => rejectSuggestion(suggestion)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {budgetUsed >= 0.8 && (
        <div className={`flex items-start gap-2.5 rounded-lg p-3 text-[12px] leading-relaxed ring-1 ${
          budgetUsed >= 1
            ? "bg-warning/10 ring-warning/25 text-warning"
            : "bg-foreground/5 ring-foreground/10 text-muted-foreground"
        }`}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {budgetUsed >= 1 ? (
              <>
                This list is past the roughly {PROMPT_TOKEN_BUDGET} tokens Whisper accepts as a
                hint. Terms are dropped from the <strong>top</strong> of the list — reorder or
                remove entries so the ones you care about survive.
              </>
            ) : (
              <>Using about {Math.round(budgetUsed * 100)}% of Whisper's hint budget.</>
            )}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium px-1">
        <span>{terms.length} term{terms.length === 1 ? "" : "s"}</span>
        <div className="flex gap-2 relative" ref={sortRef}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsSortOpen(!isSortOpen)}
            className={cn(isSortOpen && "bg-muted text-foreground")}
          >
            <ArrowUpDown size={16} />
          </Button>
          
          {isSortOpen && (
            <div className="absolute top-full right-8 z-10 mt-2 bg-background border border-border rounded-xl p-2 flex flex-col gap-1 shadow-xl min-w-[160px]">
              {(
                [
                  ["newest", "Newest first"],
                  ["oldest", "Oldest first"],
                  ["alpha", "Alphabetical"]
                ] as const
              ).map(([val, label]) => (
                <button 
                  key={val} 
                  onClick={() => { setSortOrder(val as any); setIsSortOpen(false); }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                    sortOrder === val ? "bg-accent text-accent-foreground font-medium" : "hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="w-4 flex justify-center">
                    {sortOrder === val && <Check size={14} />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col gap-2">
        {isAdding && (
          <form onSubmit={handleAdd} className="edit-shell flex items-start gap-3 px-4 py-3">
            <textarea
              autoFocus
              rows={1}
              placeholder="Enter a term, or paste a list separated by commas or new lines..."
              value={newTerm}
              disabled={saving}
              onChange={e => setNewTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setNewTerm("");
                }
                // Enter commits; Shift+Enter is how you build a list by hand.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAdd(e);
                }
              }}
              className="flex-1 bg-transparent border-none text-foreground outline-none text-[15px] font-medium resize-none max-h-40 leading-relaxed placeholder:text-muted-foreground"
            />
            <div className="flex gap-2 items-center">
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { setIsAdding(false); setNewTerm(""); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={saving || !newTerm.trim()}>Add</Button>
            </div>
          </form>
        )}

        {settings === null ? (
          <ListSkeleton />
        ) : terms.length === 0 && !isAdding ? (
          <EmptyState
            className="mt-2"
            icon={BookOpen}
            title="Add a term to the Dictionary"
            preview={<EmptyDemo kind="dictionary" />}
            description="Add words you want Patter to recognize. It can be particular spellings, names, and slang that you often use."
            action={
              <Button disabled={saving} onClick={() => { setEditingTerm(null); setIsAdding(true); }} className="rounded-full">
                <Plus size={16} /> Add new
              </Button>
            }
          />
        ) : (
          /* Chips, not rows. These are single words — one per full-width row
             turned eight terms into three screens of scroll. Wrapping chips put
             the whole dictionary in view at once, which is the only way to see
             what Whisper is actually being primed with. Reading order is still
             list order, so the budget warning's "dropped from the top" holds. */
          <div className="flex flex-wrap gap-2">
            {filteredTerms.map(term => (
              <span
                key={term}
                className={cn(
                  "group inline-flex items-center rounded-full border border-border bg-foreground/[0.02] py-1 pl-3 pr-1 transition-colors hover:border-steelIce/40 hover:bg-accent-subtle",
                  editingTerm === term && "border-steelIce/40 bg-accent-subtle",
                )}
              >
                <button
                  onClick={() => startEditing(term)}
                  disabled={saving}
                  title="Edit spelling and corrections"
                  aria-label={`Edit ${term}`}
                  className="text-[13px] font-medium text-foreground/90 rounded-full focus-visible:ring-focus"
                >
                  {term}
                  {!!settings?.dictionary_aliases?.[term]?.length && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {settings.dictionary_aliases[term].length} correction{settings.dictionary_aliases[term].length === 1 ? "" : "s"}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => removeTerm(term)}
                  disabled={saving}
                  aria-label={`Remove ${term}`}
                  title="Remove"
                  className="ml-1.5 flex size-4 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive focus-visible:ring-focus"
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        )}
        
        {terms.length > 0 && filteredTerms.length === 0 && !isAdding && (
          <EmptyState
            icon={Search}
            title="No results found"
            description="No terms match your search. Try a different spelling."
          />
        )}
      </div>

      {editingTerm && (
        <form
          onSubmit={commitEdit}
          onKeyDown={event => { if (event.key === "Escape" && !saving) setEditingTerm(null); }}
          className="edit-shell space-y-4 p-4"
          aria-label={`Edit dictionary entry ${editingTerm}`}
        >
          <div className="space-y-2">
            <label htmlFor="dictionary-spelling" className="block text-sm font-medium">Preferred spelling</label>
            <input
              id="dictionary-spelling"
              autoFocus
              value={editValue}
              onChange={event => setEditValue(event.target.value)}
              disabled={saving}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-focus"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="dictionary-aliases" className="block text-sm font-medium">Correct these mishearings</label>
            <textarea
              id="dictionary-aliases"
              value={editAliases}
              onChange={event => setEditAliases(event.target.value)}
              disabled={saving}
              rows={3}
              aria-describedby="dictionary-aliases-help"
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-focus"
            />
            <p id="dictionary-aliases-help" className="text-xs leading-relaxed text-muted-foreground">
              One word or phrase per line. Exact matches are replaced with your preferred spelling, ignoring capitalization.
              Remove a line to stop that correction.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditingTerm(null)}>Cancel</Button>
            <Button type="submit" disabled={saving || !editValue.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear the dictionary?</DialogTitle>
            <DialogDescription>
              All {terms.length} term{terms.length === 1 ? "" : "s"} and their saved corrections will be removed.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button variant="destructive" disabled={saving} onClick={handleClearAll}>{saving ? "Clearing…" : "Clear all"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
