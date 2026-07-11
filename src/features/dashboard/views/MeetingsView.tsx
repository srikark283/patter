import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  Mic,
  Square,
  Loader2,
  Trash2,
  ChevronDown,
  MessagesSquare,
  ListChecks,
  Gavel,
  ScrollText,
  AlignLeft,
  ClipboardCopy,
} from "lucide-react";
import { MeetingRecord } from "../../../types";
import {
  getMeetings,
  deleteMeeting,
  startMeetingRecording,
  stopMeetingRecording,
  isMeetingRecording,
} from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MeetingState = "idle" | "recording" | "transcribing" | "summarizing";

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toMarkdown(m: MeetingRecord): string {
  const lines = [`# ${m.title}`, "", `${new Date(m.timestamp_ms).toLocaleString()} · ${formatDuration(m.duration_seconds)}`];
  if (m.summary) lines.push("", "## Summary", "", m.summary);
  if (m.minutes.length) lines.push("", "## Minutes", "", ...m.minutes.map((x) => `- ${x}`));
  if (m.decisions.length) lines.push("", "## Decisions", "", ...m.decisions.map((x) => `- ${x}`));
  if (m.action_items.length) lines.push("", "## Action Items", "", ...m.action_items.map((x) => `- [ ] ${x}`));
  lines.push("", "## Transcript", "", m.transcript);
  return lines.join("\n");
}

function Section({ icon: Icon, title, children }: { icon: typeof ListChecks; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        <Icon size={13} /> {title}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/85">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-steelIce/70" />
          {item}
        </li>
      ))}
    </ul>
  );
}

export function MeetingsView() {
  const [meetings, setMeetings] = useState<MeetingRecord[] | null>(null);
  const [state, setState] = useState<MeetingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMeetings = () => getMeetings().then(setMeetings).catch(console.error);

  useEffect(() => {
    loadMeetings();
    isMeetingRecording().then((rec) => rec && setState("recording")).catch(console.error);

    const unlistenState = listen<string>("patter://meeting_state", (e) => {
      const s = e.payload;
      if (s.startsWith("error:")) {
        toast.error("Meeting failed: " + s.slice(6).trim());
        setState("idle");
      } else {
        setState(s as MeetingState);
      }
    });
    const unlistenUpdated = listen("patter://meetings_updated", () => {
      loadMeetings();
      toast.success("Meeting notes ready");
    });

    return () => {
      unlistenState.then((fn) => fn());
      unlistenUpdated.then((fn) => fn());
    };
  }, []);

  // Elapsed timer while recording
  useEffect(() => {
    if (state === "recording") {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const handleStart = async () => {
    try {
      await startMeetingRecording();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleStop = async () => {
    try {
      await stopMeetingRecording();
    } catch (e) {
      toast.error(String(e));
      setState("idle");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMeeting(id);
      setMeetings((m) => m?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      toast.error("Failed to delete: " + e);
    }
  };

  const processing = state === "transcribing" || state === "summarizing";

  const headerAction =
    state === "recording" ? (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/5 px-3.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="font-sans text-[13px] text-foreground/80 tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
        <Button variant="destructive" className="rounded-full" onClick={handleStop}>
          <Square size={14} /> Stop &amp; Process
        </Button>
      </div>
    ) : processing ? (
      <div className="flex items-center gap-2 rounded-full border border-steel/20 bg-steel/5 px-3.5 py-2 text-[13px] text-foreground/80">
        <Loader2 size={14} className="animate-spin text-steelIce" />
        {state === "transcribing" ? "Transcribing…" : "Generating notes…"}
      </div>
    ) : (
      <Button className="rounded-full" onClick={handleStart}>
        <Mic size={15} /> Record Meeting
      </Button>
    );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <PageHeader
        title="Meetings"
        description="Record a meeting from your mic, get transcript, minutes, decisions, and to-dos."
        action={headerAction}
      />

      {meetings !== null && meetings.length === 0 && state === "idle" && !processing && (
        <Card className="flex flex-col items-center justify-center py-20 px-4 text-center border-dashed bg-white/[0.01]">
          <div className="w-12 h-12 rounded-xl bg-white/[0.04] ring-1 ring-border flex items-center justify-center mb-4">
            <MessagesSquare className="text-muted-foreground" size={24} />
          </div>
          <h3 className="text-lg font-medium text-foreground">No meetings yet</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-[320px]">
            Hit Record Meeting when your meeting starts. When you stop, Patter transcribes it and generates notes with your local Ollama model.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {meetings?.map((m) => {
          const expanded = expandedId === m.id;
          const hasNotes = m.summary || m.minutes.length > 0 || m.decisions.length > 0 || m.action_items.length > 0;
          return (
            <div
              key={m.id}
              className="group rounded-xl border border-border bg-white/[0.015] transition-colors hover:bg-white/[0.03]"
            >
              <button
                onClick={() => setExpandedId(expanded ? null : m.id)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-foreground/90 truncate">{m.title}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {formatDate(m.timestamp_ms)} · {formatDuration(m.duration_seconds)}
                    {!hasNotes && " · transcript only"}
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={cn("shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                />
              </button>

              {expanded && (
                <div className="space-y-6 border-t border-border/60 px-5 py-5">
                  {m.summary && (
                    <Section icon={AlignLeft} title="Summary">
                      <p className="text-[13px] leading-relaxed text-foreground/85">{m.summary}</p>
                    </Section>
                  )}
                  {m.minutes.length > 0 && (
                    <Section icon={ScrollText} title="Minutes">
                      <BulletList items={m.minutes} />
                    </Section>
                  )}
                  {m.decisions.length > 0 && (
                    <Section icon={Gavel} title="Decisions">
                      <BulletList items={m.decisions} />
                    </Section>
                  )}
                  {m.action_items.length > 0 && (
                    <Section icon={ListChecks} title="Action Items">
                      <BulletList items={m.action_items} />
                    </Section>
                  )}
                  <Section icon={MessagesSquare} title="Transcript">
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-[12.5px] leading-relaxed text-foreground/70">
                      {m.transcript}
                    </p>
                  </Section>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => {
                        navigator.clipboard.writeText(toMarkdown(m));
                        toast.success("Meeting copied as Markdown");
                      }}
                    >
                      <ClipboardCopy size={14} /> Copy as Markdown
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(m.id)}
                    >
                      <Trash2 size={14} /> Delete meeting
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
