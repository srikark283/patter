import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
export function EmptyDemo({ kind }: { kind: "dictionary" | "macro" }) {
  const [expanded, setExpanded] = useState(false);
  const dictionary = kind === "dictionary";
  return <div className="empty-demo">
    <p className="mb-3 text-xs text-muted-foreground">Example · {dictionary ? "Teach a preferred spelling" : "Expand a spoken phrase"}</p>
    <div className="flex flex-wrap items-center justify-center gap-3 text-sm"><span>{dictionary ? "“pat her”" : "“My sign-off”"}</span><ArrowRight size={14} className="text-muted-foreground" /><span className={expanded ? "demo-result" : "text-muted-foreground"}>{expanded ? dictionary ? "Patter" : "Best regards,\nAlex" : dictionary ? "Your preferred spelling" : "Your full signature"}</span></div>
    <Button variant="ghost" size="sm" className="mt-3" onClick={() => setExpanded(value => !value)}>{expanded && <RotateCcw size={12} />}{expanded ? "Reset example" : dictionary ? "Preview correction" : "Preview expansion"}</Button>
  </div>;
}
