import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateSettings, getSettings, Settings, MemoryFact, getEmbedding } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { Search, Plus, Trash2, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MemoryView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setMemories(s.memories || []);
    }).catch(console.error);
  }, []);

  const save = async (newMemories: MemoryFact[]) => {
    setMemories(newMemories);
    if (!settings) return;
    
    const newSettings = { ...settings, memories: newMemories };
    setSettings(newSettings);
    
    try {
      await updateSettings(newSettings);
    } catch (e) {
      console.error(e);
      toast.error("Failed to save memory: " + e);
      setSettings(settings); // revert
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newContent.trim();
    if (content) {
      setIsAdding(false);
      const toastId = toast.loading("Embedding memory...");
      try {
        const embedding = await getEmbedding("nomic-embed-text", content);
        await save([...memories, { id: crypto.randomUUID(), content, embedding }]);
        setNewContent("");
        toast.success("Fact remembered!", { id: toastId });
      } catch (e) {
        toast.error("Failed to embed fact. Do you have nomic-embed-text installed?", { id: toastId });
      }
    }
  };

  const removeMemory = (id: string) => {
    save(memories.filter(m => m.id !== id));
  };

  const filteredMemories = memories.filter(m => 
    m.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const headerAction = (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center bg-white/[0.03] border border-border rounded-full px-3 transition-colors focus-within:border-steelIce focus-within:bg-white/[0.05]">
        <Search size={14} className="text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search memories..." 
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
        title="Personal Memory"
        description="Add facts about yourself or your work. Patter will use them to write more accurate transcriptions."
        action={headerAction}
      />

      <div className="flex items-center justify-between text-muted-foreground text-sm font-medium px-1">
        <span>{memories.length} facts remembered</span>
      </div>

      <div className="flex flex-col gap-2">
        {isAdding && (
          <form onSubmit={handleAdd} className="flex flex-col gap-3 bg-white/[0.03] px-5 py-4 rounded-xl border border-steel/40 ring-1 ring-steel/20 shadow-inner">
            <textarea 
              autoFocus
              placeholder="E.g., 'My manager's name is John Doe' or 'Project Phoenix is a secret design system rewrite'"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={3}
              className="bg-background/50 border border-white/10 rounded-md text-foreground outline-none text-[14px] px-3 py-2 focus:border-steel resize-none"
            />
            <div className="flex gap-2 items-center justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setIsAdding(false); setNewContent(""); }}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newContent.trim()}>Remember Fact</Button>
            </div>
          </form>
        )}

        {memories.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center gap-4 py-14 px-8 text-center bg-white/[0.015] border border-border/50 rounded-2xl mt-2">
            <h2 className="text-xl font-semibold tracking-tight">Teach Patter about you!</h2>
            <p className="text-muted-foreground text-[14px] max-w-[500px] leading-relaxed">
              Add specific details, names, or context that you want Patter to remember. It will use this knowledge to intelligently clean up your transcriptions.
            </p>
            <Button onClick={() => setIsAdding(true)} className="rounded-full mt-2">
              <Plus size={16} /> Add a memory
            </Button>
          </div>
        ) : (
          filteredMemories.map(memory => (
            <div key={memory.id} className="group flex items-center justify-between bg-white/[0.015] hover:bg-white/[0.03] px-5 py-3.5 rounded-xl border border-border transition-colors">
              <div className="flex items-center gap-3">
                <Brain size={16} className="text-steelIce/60" />
                <span className="font-medium text-[15px] text-foreground/90">{memory.content}</span>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => removeMemory(memory.id)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
          ))
        )}
        
        {memories.length > 0 && filteredMemories.length === 0 && !isAdding && (
          <div className="text-center text-muted-foreground py-10 text-sm">No memories match your search.</div>
        )}
      </div>
    </div>
  );
}
