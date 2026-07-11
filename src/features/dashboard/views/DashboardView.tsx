import { useState, useEffect } from "react";
import { Copy, ArrowRight, AudioLines, Flame, WholeWord, Timer, Mic } from "lucide-react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { AppStats, TranscriptionRecord } from "../../../types";
import { getSettings, onHudState, isRecording, isMeetingRecording } from "../../../lib/ipc";
// import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

interface Props {
  stats: AppStats | null;
  history: TranscriptionRecord[] | null;
  onViewAll?: () => void;
}

const ACTIVITY_DAYS = 7;

const hour = new Date().getHours();
const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

function activitySeries(history: TranscriptionRecord[]): { label: string; words: number }[] {
  const days: { label: string; words: number }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const words = history
      .filter((r) => r.timestamp_ms >= day.getTime() && r.timestamp_ms < next.getTime())
      .reduce((sum, r) => sum + r.words, 0);
    days.push({ label: day.toLocaleDateString(undefined, { weekday: "short" }), words });
  }
  return days;
}

function getTopWords(history: TranscriptionRecord[]): { word: string, count: number }[] {
  const words: Record<string, number> = {};
  const stopWords = new Set(["the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which", "go", "me", "is", "are", "was", "were", "like", "just", "can", "then", "very"]);
  
  history.forEach(r => {
    r.text.toLowerCase().split(/[\s.,!?]+/).forEach(w => {
      if (w.length > 2 && !stopWords.has(w)) {
        words[w] = (words[w] || 0) + 1;
      }
    });
  });

  return Object.entries(words)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));
}

function calculateStreak(history: TranscriptionRecord[]) {
  if (history.length === 0) return 0;
  const dates = [...new Set(history.map(r => new Date(r.timestamp_ms).toDateString()))]
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  
  if (dates.length === 0) return 0;
  
  let maxStreak = 1;
  let currentStreak = 1;
  
  for (let i = 1; i < dates.length; i++) {
    const diff = new Date(dates[i]).getTime() - new Date(dates[i-1]).getTime();
    if (diff <= 86400000 + 3600000) { 
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  return maxStreak;
}

export function DashboardView({ stats, history, onViewAll }: Props) {
  const [hotkey, setHotkey] = useState<string>("");

  useEffect(() => {
    getSettings().then((s) => setHotkey(s.hotkey)).catch(console.error);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const timeAgo = (ms: number) => {
    const diff = Date.now() - ms;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const series = history ? activitySeries(history) : null;
  const maxWords = series ? Math.max(10, ...series.map((d) => d.words)) : 10;
  const topWords = history ? getTopWords(history) : [];
  const longestStreak = history ? calculateStreak(history) : 0;
  
  // Calculate this week's stats based on the exact same 7-day calendar window as the Activity chart
  const last7DaysStart = new Date();
  last7DaysStart.setHours(0, 0, 0, 0);
  last7DaysStart.setDate(last7DaysStart.getDate() - (ACTIVITY_DAYS - 1));
  
  const weekWords = history ? history.filter(r => r.timestamp_ms >= last7DaysStart.getTime()).reduce((a, r) => a + r.words, 0) : 0;
  const weekDictations = history ? history.filter(r => r.timestamp_ms >= last7DaysStart.getTime()).length : 0;

  const [dictationState, setDictationState] = useState("Idle");
  const [meetingState, setMeetingState] = useState("idle");

  useEffect(() => {
    isRecording().then(rec => rec && setDictationState("Listening...")).catch(console.error);
    isMeetingRecording().then(rec => rec && setMeetingState("recording")).catch(console.error);

    const u1 = onHudState(setDictationState);
    const u2 = listen<string>("patter://meeting_state", (e) => {
      if (!e.payload.startsWith("error:")) setMeetingState(e.payload);
      else setMeetingState("idle");
    });

    return () => {
      u1.then(f => f());
      u2.then(f => f());
    };
  }, []);

  let statusText = "Ready to dictate";
  let isRecordingActive = false;
  if (meetingState === "recording") {
    statusText = "Recording meeting...";
    isRecordingActive = true;
  } else if (meetingState === "transcribing" || meetingState === "processing") {
    statusText = "Processing meeting...";
    isRecordingActive = true;
  } else if (dictationState === "Listening...") {
    statusText = "Recording dictation...";
    isRecordingActive = true;
  } else if (dictationState === "Transcribing...") {
    statusText = "Transcribing dictation...";
    isRecordingActive = true;
  } else if (dictationState !== "Idle") {
    statusText = dictationState;
    isRecordingActive = true;
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      
      <PageHeader 
        title={`${greeting} 👋`} 
        description="Here's an overview of your dictations." 
        action={
          hotkey && (
            <div className="flex items-center gap-3 rounded-full border border-steel/20 bg-steel/3 px-3.5 py-2 shadow-[0_0_15px_rgba(91,155,209,0.05)]">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-4 w-4 items-center justify-center">
                  <Mic className={cn(
                    "relative z-10 h-4 w-4 stroke-[2.5px]",
                    isRecordingActive 
                      ? "text-red-400 animate-pulse" 
                      : "text-steelIce animate-[pulse_2.5s_ease-in-out_infinite]"
                  )} />
                </div>
                <span className={cn(
                  "text-[13px] font-medium",
                  isRecordingActive ? "text-foreground" : "text-foreground/80"
                )}>{statusText}</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1">
                {hotkey.split('+').map((key, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    <kbd className="rounded-[4px] border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-sans font-medium text-muted-foreground">
                      {key}
                    </kbd>
                    {i < arr.length - 1 && <span className="text-muted-foreground/40 text-[10px] font-medium">+</span>}
                  </span>
                ))}
              </div>
            </div>
          )
        }
      />
      
      {/* 4 Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Total Words */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-white/1.5 p-5 pt-4">
          {weekWords > 0 && <div className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold mb-3">+{weekWords} this week</div>}
          {weekWords === 0 && <div className="h-5 mb-3" />}
          <div className="text-[28px] font-semibold tracking-tight mb-0.5 text-foreground">{stats ? stats.total_words : <Skeleton className="h-8 w-16" />}</div>
          <div className="text-xs text-muted-foreground font-medium">Total Words</div>
          <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-foreground pointer-events-none"><WholeWord size={100} strokeWidth={1} /></div>
        </div>
        
        {/* Dictations */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-white/1.5 p-5 pt-4">
          {weekDictations > 0 && <div className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold mb-3">+{weekDictations} this week</div>}
          {weekDictations === 0 && <div className="h-5 mb-3" />}
          <div className="text-[28px] font-semibold tracking-tight mb-0.5 text-foreground">{stats ? stats.transcriptions_count : <Skeleton className="h-8 w-16" />}</div>
          <div className="text-xs text-muted-foreground font-medium">Dictations</div>
          <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-foreground pointer-events-none"><AudioLines size={100} strokeWidth={1} /></div>
        </div>

        {/* Time Saved */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-white/1.5 p-5 pt-4">
          <div className="h-5 mb-3" />
          <div className="text-[28px] font-semibold tracking-tight mb-0.5 text-foreground">{stats ? formatTime(stats.time_saved_seconds) : <Skeleton className="h-8 w-24" />}</div>
          <div className="text-xs text-muted-foreground font-medium">Time Saved</div>
          <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-foreground pointer-events-none"><Timer size={100} strokeWidth={1} /></div>
        </div>

        {/* Streak */}
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-white/1.5 p-5 pt-4">
          <div className="h-5 mb-3" />
          <div className="text-[28px] font-semibold tracking-tight mb-0.5 text-foreground">{history ? `${longestStreak} day${longestStreak === 1 ? '' : 's'}` : <Skeleton className="h-8 w-20" />}</div>
          <div className="text-xs text-muted-foreground font-medium">Longest Streak</div>
          <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-foreground pointer-events-none"><Flame size={100} strokeWidth={1} /></div>
        </div>
      </div>

      {/* Insights Section */}
      <div className="space-y-4">
        <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest px-1">Insights</h2>
        <div className="grid grid-cols-2 gap-4">
          
          {/* Activity Chart */}
          <div className="rounded-xl border border-border/60 bg-white/1.5 p-5 flex flex-col">
            <h3 className="text-sm font-medium text-muted-foreground mb-6">Activity (Last 7 Days)</h3>
            {series === null ? (
              <Skeleton className="h-32 w-full mt-auto" />
            ) : (
              <div className="flex h-32 items-end justify-between gap-3 px-2 mt-auto">
                {series.map((d) => (
                  <div key={d.label} className="group relative flex flex-col items-center flex-1 gap-3 h-full">
                    <div className="w-full relative flex-1 flex flex-col justify-end items-center">
                      <div
                        className={`w-full max-w-[24px] rounded-sm transition-all duration-300 ${
                          d.words > 0
                            ? "bg-linear-to-t from-blue-500/80 to-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                            : "bg-white/3"
                        }`}
                        style={{ height: d.words > 0 ? `${Math.max(15, (d.words / maxWords) * 100)}%` : "15%" }}
                      />
                      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 font-sans text-[10px] text-foreground opacity-0 ring-1 ring-border transition-opacity group-hover:opacity-100">
                        {d.words}w
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground/70 font-medium">{d.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Words */}
          <div className="rounded-xl border border-border/60 bg-white/1.5 p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Top Words</h3>
            {!history ? (
              <Skeleton className="h-32 w-full" />
            ) : topWords.length === 0 ? (
              <div className="h-32 flex items-center text-sm text-muted-foreground">Not enough data.</div>
            ) : (
              <div className="flex flex-wrap gap-2.5 mt-2">
                {topWords.map((w) => (
                  <div key={w.word} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/4 border border-white/5">
                    <span className="text-[13px] text-foreground/90 font-medium">{w.word}</span>
                    <span className="text-[10px] text-blue-300 bg-blue-500/20 px-1.5 py-0.5 rounded-full font-sans">{w.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Transcripts */}
      {history && history.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">
              Recent
            </h3>
            {onViewAll && (
              <Button
                variant="outline"
                size="xs"
                onClick={onViewAll}
                className="rounded-full text-muted-foreground hover:text-foreground"
              >
                View all <ArrowRight size={12} />
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {history.slice(0, 5).map((record) => (
              <div 
                key={record.id} 
                className="group relative flex flex-col gap-4 px-5 py-4 rounded-xl border border-border/60 bg-white/1.5 hover:bg-white/3 transition-colors"
              >
                <p className="text-[15px] leading-relaxed text-foreground/90 wrap-break-word line-clamp-2 pr-8">
                  {record.text}
                </p>
                <div className="flex items-center gap-2.5">
                  <span className="font-sans text-[11px] text-muted-foreground/50">{timeAgo(record.timestamp_ms)}</span>
                  <span className="text-muted-foreground/30 text-[10px]">·</span>
                  <span className="font-sans text-[11px] text-muted-foreground/50 tabular-nums">
                    {record.duration_seconds.toFixed(1)}s
                  </span>
                </div>
                {/* Copy button on hover */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(record.text);
                    toast.success("Copied to clipboard");
                  }}
                  title="Copy text"
                  className="absolute right-4 top-4 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-steelIce bg-background/80 backdrop-blur-sm"
                >
                  <Copy size={13} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
