import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateSettings, getSettings, Settings } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { Search, Plus, ArrowUpDown, Settings as SettingsIcon, Trash2, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DictionaryView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [editingTerm, setEditingTerm] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "alpha">("newest");
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

  const save = async (newTerms: string[]) => {
    setTerms(newTerms);
    const value = newTerms.join(", ");
    if (!settings) return;
    
    const newSettings = { ...settings, custom_prompt: value };
    setSettings(newSettings);
    
    try {
      await updateSettings(newSettings);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save term: " + e);
      setSettings(settings); // revert
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newTerm.trim();
    if (clean && !terms.includes(clean)) {
      save([...terms, clean]);
    }
    setNewTerm("");
    setIsAdding(false);
  };

  const removeTerm = (term: string) => {
    save(terms.filter(t => t !== term));
  };

  const startEditing = (term: string) => {
    setEditingTerm(term);
    setEditValue(term);
  };

  const handleEditSubmit = (e: React.FormEvent, oldTerm: string) => {
    e.preventDefault();
    const clean = editValue.trim();
    if (clean && clean !== oldTerm) {
      const newTerms = terms.map(t => (t === oldTerm ? clean : t));
      const unique = Array.from(new Set(newTerms));
      save(unique);
    }
    setEditingTerm(null);
  };

  const sortedTerms = [...terms].sort((a, b) => {
    if (sortOrder === "alpha") return a.localeCompare(b);
    return 0; 
  });
  if (sortOrder === "newest") {
    sortedTerms.reverse();
  }

  const filteredTerms = sortedTerms.filter(t => t.toLowerCase().includes(searchQuery.toLowerCase()));

  const headerAction = (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center bg-white/[0.03] border border-border rounded-full px-3 transition-colors focus-within:border-steelIce focus-within:bg-white/[0.05]">
        <Search size={14} className="text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="bg-transparent border-none text-foreground outline-none py-1.5 pl-2.5 w-32 md:w-40 text-sm placeholder:text-muted-foreground"
        />
      </div>
      <Button onClick={() => setIsAdding(true)} className="rounded-full shadow-sm">
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

      {/* Toolbar */}
      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium px-1">
        <span>{terms.length} terms</span>
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
                    sortOrder === val ? "bg-accent text-accent-foreground font-medium" : "hover:bg-white/5 text-muted-foreground hover:text-foreground"
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

          <Button variant="ghost" size="icon-sm">
            <SettingsIcon size={16} />
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col gap-2">
        {isAdding && (
          <form onSubmit={handleAdd} className="flex items-center gap-3 bg-white/[0.03] px-4 py-3 rounded-xl border border-steel/40 ring-1 ring-steel/20 shadow-inner">
            <input 
              autoFocus
              type="text" 
              placeholder="Enter a new term..."
              value={newTerm}
              onChange={e => setNewTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setNewTerm("");
                }
              }}
              className="flex-1 bg-transparent border-none text-foreground outline-none text-[15px] font-medium"
            />
            <div className="flex gap-2 items-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setIsAdding(false); setNewTerm(""); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newTerm.trim()}>Add</Button>
            </div>
          </form>
        )}

        {terms.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center gap-4 py-14 px-8 text-center bg-white/[0.015] border border-border/50 rounded-2xl mt-2">
            <h2 className="text-xl font-semibold tracking-tight">Add a term to the Dictionary!</h2>
            <p className="text-muted-foreground text-[14px] max-w-[500px] leading-relaxed">
              Add words you want Patter to recognize. It can be particular spellings, names, and slang that you often use.
            </p>
            <Button onClick={() => setIsAdding(true)} className="rounded-full mt-2">
              <Plus size={16} /> Add new
            </Button>
          </div>
        ) : (
          filteredTerms.map(term => (
            editingTerm === term ? (
              <form key={term} onSubmit={(e) => handleEditSubmit(e, term)} className="flex items-center gap-3 bg-white/[0.03] px-4 py-3 rounded-xl border border-steel/40 ring-1 ring-steel/20 shadow-inner">
                <input 
                  autoFocus
                  type="text" 
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Escape") setEditingTerm(null);
                  }}
                  className="flex-1 bg-transparent border-none text-foreground outline-none text-[15px] font-medium"
                />
                <div className="flex gap-2 items-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingTerm(null)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={!editValue.trim() || editValue.trim() === term}>Save</Button>
                </div>
              </form>
            ) : (
              <div key={term} className="group flex items-center justify-between bg-white/[0.015] hover:bg-white/[0.03] px-5 py-3.5 rounded-xl border border-border transition-colors">
                <span className="font-medium text-[15px] text-foreground/90">{term}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => startEditing(term)}>
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeTerm(term)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            )
          ))
        )}
        
        {terms.length > 0 && filteredTerms.length === 0 && !isAdding && (
          <div className="text-center text-muted-foreground py-10 text-sm">No terms match your search.</div>
        )}
      </div>
    </div>
  );
}
