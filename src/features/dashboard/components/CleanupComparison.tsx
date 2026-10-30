import { useMemo, useState } from "react";
import { cleanupDiff } from "@/lib/cleanup-diff";
export function CleanupComparison({ original, result }: { original: string; result: string }) {
  const [view, setView] = useState("changes");
  const diff = useMemo(() => cleanupDiff(original, result), [original, result]);
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1" role="group" aria-label="Cleanup comparison view">{[{ id: "changes", label: "Changes" }, { id: "clean", label: "Clean text" }, { id: "original", label: "Original" }].map(item => <button key={item.id} type="button" className="comparison-tab" aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
    <div className="cleanup-result whitespace-pre-wrap break-words text-sm leading-7">
      {view === "original" ? original : view === "clean" ? result || "No text remaining after filler removal." : <>
        {diff.original.some(part => part.changed) && <div className="mb-3 border-b border-border pb-3"><p className="mb-1 text-xs text-muted-foreground">Original · removed words are struck through</p>{diff.original.map((part, index) => part.changed ? <del key={index} className="diff-removed">{part.text}</del> : <span key={index}>{part.text}</span>)}</div>}
        <p className="mb-1 text-xs text-muted-foreground">Polished · changes highlighted</p>
        {result ? diff.result.map((part, index) => part.changed ? <mark key={index} className="diff-added">{part.text}</mark> : <span key={index}>{part.text}</span>) : "No text remaining after filler removal."}
      </>}
    </div>
  </div>;
}
