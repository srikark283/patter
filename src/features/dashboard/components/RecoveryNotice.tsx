import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setHistoryFlags } from "@/lib/ipc";
import type { TranscriptionRecord } from "@/types";

export { needsRecovery } from "@/lib/transcript-filters";

export function RecoveryNotice({ record, onResolved, compact = false }: { record: TranscriptionRecord; onResolved: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <section className={compact ? "space-y-2 border-b border-border pb-3" : "rounded-xl border border-border bg-accent-subtle p-5 space-y-3"} aria-label="Transcript recovery">
    <h3 className="text-base font-medium">{record.output_status === "copied" ? "Your dictation was copied instead" : "Your dictation needs recovery"}</h3>
    <p className="text-sm text-muted-foreground">{compact ? "Copy the saved text and paste into your intended app." : "The text is saved here. Copy it, then paste into your intended app. You can also recover any transcript if automatic output did not appear."}</p>
    {!compact && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words line-clamp-4">{record.text}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={async () => { try { await navigator.clipboard.writeText(record.text); toast.success("Copied. Paste into your intended app."); } catch { toast.error("Could not copy. Select the text in Transcripts and copy it manually."); } }}><Copy size={14} />Copy transcript</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await setHistoryFlags(record.id, { recoveryDismissed: true }); onResolved(); } catch { toast.error("Could not mark transcript as handled"); } finally { setBusy(false); } }}><Check size={14} />Mark as handled</Button>
    </div>
  </section>;
}
