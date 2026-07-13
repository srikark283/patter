import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateSettings, getSettings, Settings, Snippet } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { Search, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SnippetsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newContent, setNewContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [editingTrigger, setEditingTrigger] = useState<string | null>(null);
  const [editTriggerValue, setEditTriggerValue] = useState("");
  const [editContentValue, setEditContentValue] = useState("");

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setSnippets(s.snippets || []);
    }).catch(console.error);
  }, []);

  const save = async (newSnippets: Snippet[]) => {
    setSnippets(newSnippets);
    if (!settings) return;
    
    const newSettings = { ...settings, snippets: newSnippets };
    setSettings(newSettings);
    
    try {
      await updateSettings(newSettings);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save snippet: " + e);
      setSettings(settings); // revert
    }
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trigger = newTrigger.trim();
    const content = newContent.trim();
    if (trigger && content && !snippets.some(s => s.trigger === trigger)) {
      save([...snippets, { trigger, content }]);
    } else if (snippets.some(s => s.trigger === trigger)) {
      toast.error("A snippet with this trigger already exists");
      return;
    }
    setNewTrigger("");
    setNewContent("");
    setIsAdding(false);
  };

  const removeSnippet = (trigger: string) => {
    save(snippets.filter(s => s.trigger !== trigger));
  };

  const startEditing = (snippet: Snippet) => {
    setEditingTrigger(snippet.trigger);
    setEditTriggerValue(snippet.trigger);
    setEditContentValue(snippet.content);
  };

  const handleEditSubmit = (e: React.FormEvent, oldTrigger: string) => {
    e.preventDefault();
    const trigger = editTriggerValue.trim();
    const content = editContentValue.trim();
    if (trigger && content) {
      // Check if trying to rename trigger to one that already exists
      if (trigger !== oldTrigger && snippets.some(s => s.trigger === trigger)) {
        toast.error("A snippet with this trigger already exists");
        return;
      }
      
      const newSnippets = snippets.map(s => (s.trigger === oldTrigger ? { trigger, content } : s));
      save(newSnippets);
    }
    setEditingTrigger(null);
  };

  const filteredSnippets = snippets.filter(s => 
    s.trigger.toLowerCase().includes(searchQuery.toLowerCase()) || 
    s.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const headerAction = (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center bg-white/[0.03] border border-border rounded-full px-3 transition-colors focus-within:border-steelIce focus-within:bg-white/[0.05]">
        <Search size={14} className="text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search snippets..." 
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
        title="Voice Macros"
        description="Expand short spoken phrases into larger blocks of text automatically."
        action={headerAction}
      />

      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium px-1">
        <span>{snippets.length} snippets</span>
      </div>

      <div className="flex flex-col gap-2">
        {isAdding && (
          <form onSubmit={handleAdd} className="flex flex-col gap-3 bg-white/[0.03] px-5 py-4 rounded-xl border border-steel/40 ring-1 ring-steel/20 shadow-inner">
            <input 
              autoFocus
              type="text" 
              placeholder="Trigger phrase (e.g., 'insert standup template')"
              value={newTrigger}
              onChange={e => setNewTrigger(e.target.value)}
              className="bg-background/50 border border-white/10 rounded-md text-foreground outline-none text-[14px] font-medium px-3 py-2 focus:border-steel"
            />
            <textarea 
              placeholder="Expanded content..."
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={4}
              className="bg-background/50 border border-white/10 rounded-md text-foreground outline-none text-[14px] px-3 py-2 focus:border-steel resize-none"
            />
            <div className="flex gap-2 items-center justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setIsAdding(false); setNewTrigger(""); setNewContent(""); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newTrigger.trim() || !newContent.trim()}>Save Macro</Button>
            </div>
          </form>
        )}

        {snippets.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center gap-4 py-14 px-8 text-center bg-white/[0.015] border border-border/50 rounded-2xl mt-2">
            <h2 className="text-xl font-semibold tracking-tight">Create your first macro!</h2>
            <p className="text-muted-foreground text-[14px] max-w-[500px] leading-relaxed">
              Macros let you say a short phrase and have Patter expand it into a pre-defined text block. Perfect for templates, signatures, and repetitive text.
            </p>
            <Button onClick={() => setIsAdding(true)} className="rounded-full mt-2">
              <Plus size={16} /> Create macro
            </Button>
          </div>
        ) : (
          filteredSnippets.map(snippet => (
            editingTrigger === snippet.trigger ? (
              <form key={snippet.trigger} onSubmit={(e) => handleEditSubmit(e, snippet.trigger)} className="flex flex-col gap-3 bg-white/[0.03] px-5 py-4 rounded-xl border border-steel/40 ring-1 ring-steel/20 shadow-inner">
                <input 
                  autoFocus
                  type="text" 
                  value={editTriggerValue}
                  onChange={e => setEditTriggerValue(e.target.value)}
                  className="bg-background/50 border border-white/10 rounded-md text-foreground outline-none text-[14px] font-medium px-3 py-2 focus:border-steel"
                />
                <textarea 
                  value={editContentValue}
                  onChange={e => setEditContentValue(e.target.value)}
                  rows={4}
                  className="bg-background/50 border border-white/10 rounded-md text-foreground outline-none text-[14px] px-3 py-2 focus:border-steel resize-none font-mono text-sm"
                />
                <div className="flex gap-2 items-center justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingTrigger(null)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={!editTriggerValue.trim() || !editContentValue.trim()}>Save Changes</Button>
                </div>
              </form>
            ) : (
              <div key={snippet.trigger} className="group flex flex-col gap-2 bg-white/[0.015] hover:bg-white/[0.03] px-5 py-4 rounded-xl border border-border transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[14px] text-steelIce/90">"{snippet.trigger}"</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => startEditing(snippet)}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeSnippet(snippet.trigger)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                <div className="text-sm text-foreground/80 whitespace-pre-wrap font-mono bg-black/20 p-3 rounded-lg border border-white/5">
                  {snippet.content}
                </div>
              </div>
            )
          ))
        )}
        
        {snippets.length > 0 && filteredSnippets.length === 0 && !isAdding && (
          <div className="text-center text-muted-foreground py-10 text-sm">No macros match your search.</div>
        )}
      </div>
    </div>
  );
}
