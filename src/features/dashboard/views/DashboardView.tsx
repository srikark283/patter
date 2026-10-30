import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo } from "react";
import { Copy, Check, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { AppStats, TranscriptionRecord } from "../../../types";
import { onHudState, isRecording, isMeetingRecording } from "../../../lib/ipc";
// import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, Tooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid } from "recharts";
import { dailyActivity } from "@/lib/activity";
import { PageHeader } from "../components/PageHeader";
import { ReadinessPanel } from "../components/ReadinessPanel";
import { RecoveryNotice, needsRecovery } from "../components/RecoveryNotice";

interface Props {
  stats: AppStats | null;
  history: TranscriptionRecord[] | null;
  onViewAll?: () => void;
  onPreferences?: () => void;
  activeEngine?: string | null;
  onIntelligence?: () => void;
  onHistoryChange?: React.Dispatch<React.SetStateAction<TranscriptionRecord[] | null>>;
  onModels?: () => void;
}

const hour = new Date().getHours();
const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";

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

function getTopApps(history: TranscriptionRecord[]): { app: string, count: number }[] {
  const apps: Record<string, number> = {};

  history.forEach(r => {
    if (r.app_name) {
      apps[r.app_name] = (apps[r.app_name] || 0) + 1;
    }
  });

  return Object.entries(apps)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([app, count]) => ({ app, count }));
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

/// The decorative glyph bleeding out of each stat card's corner. It is clipped
/// by the card's overflow-hidden, which is fine for organic shapes but sliced
/// LayoutGrid squares and WholeWord letterforms into what looked like render
/// artifacts. The mask fades the glyph out before it reaches the cut edge, so
/// there is no hard boundary regardless of the icon's internal structure.
export function DashboardView({ stats, history, onViewAll, onPreferences, activeEngine, onModels, onIntelligence, onHistoryChange }: Props) {
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const recentCount = Math.min(15, Math.max(5, Math.ceil((viewportHeight - 340) / 96)));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedId]);
  const [timeframe, setTimeframe] = useState<7 | 30>(7);

  // Rolls into hours. The headline figure grows without bound, and a heavy
  // user's "27400s saved" rendered as "456m 40s" — technically right, and
  // nobody reads minutes past about ninety of them.
  const formatTime = (seconds: number) => {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m ${total % 60}s`;
    return `${total}s`;
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

  // Seven full passes over every record you have ever dictated. This component
  // re-renders on each patter://state event, so without the memo the whole
  // history got word-split and re-tallied every time recording started or
  // stopped — work that grows with the log and never changed the answer.
  const series = useMemo(() => (history ? dailyActivity(history, timeframe) : null), [history, timeframe]);
  const { topWords, topApps, longestStreak, uniqueAppsCount, weekWords, weekDictations } = useMemo(() => {
    if (!history) {
      return { topWords: [], topApps: [], longestStreak: 0, uniqueAppsCount: 0, weekWords: 0, weekDictations: 0 };
    }
    // Same 7-day calendar window the Activity chart uses.
    const last7DaysStart = new Date();
    last7DaysStart.setHours(0, 0, 0, 0);
    last7DaysStart.setDate(last7DaysStart.getDate() - 6);
    const weekStartMs = last7DaysStart.getTime();
    const thisWeek = history.filter(r => r.timestamp_ms >= weekStartMs);
    return {
      topWords: getTopWords(history),
      topApps: getTopApps(history),
      longestStreak: calculateStreak(history),
      uniqueAppsCount: new Set(history.filter(r => r.app_name && r.app_name.trim() !== "").map(r => r.app_name)).size,
      weekWords: thisWeek.reduce((a, r) => a + r.words, 0),
      weekDictations: thisWeek.length,
    };
  }, [history]);

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

  let statusText = activeEngine ? "Ready to dictate" : "Choose a speech model";
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
    <div className="space-y-5 workspace-enter">

      <PageHeader
        title={`${greeting}!`}
        description="Your voice, ready for whatever comes next."
      />

      <ReadinessPanel activity={isRecordingActive ? statusText : null} onPreferences={onPreferences} onModels={onModels} onIntelligence={onIntelligence} />
      {history?.find(needsRecovery) && (() => {
        const record = history.find(needsRecovery)!;
        return <RecoveryNotice record={record} onResolved={() => onHistoryChange?.(current => current?.map(item => item.id === record.id ? { ...item, recovery_dismissed: true } : item) ?? null)} />;
      })()}
      {history?.length === 0 && <div className="py-6 text-sm leading-relaxed text-muted-foreground">Your first transcript will appear here. Try a short dictation in any text field.</div>}

      <section aria-label="Usage overview" className="usage-overview">
        {[
          { label: "Words dictated", value: stats?.total_words.toLocaleString(), detail: `+${weekWords.toLocaleString()} this week` },
          { label: "Dictations", value: stats?.transcriptions_count.toLocaleString(), detail: `+${weekDictations} this week` },
          { label: "Time saved", value: stats ? formatTime(stats.time_saved_seconds) : null, detail: "Estimated typing time" },
          { label: "Longest streak", value: history ? `${longestStreak} ${longestStreak === 1 ? "day" : "days"}` : null, detail: "Consecutive days" },
          { label: "Apps used", value: history ? uniqueAppsCount.toLocaleString() : null, detail: "Across your dictations" },
        ].map(metric => <div key={metric.label} className={cn("usage-metric", metric.label === "Time saved" && "usage-metric-featured")}>
          <p className="text-xs text-muted-foreground">{metric.label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{metric.value ?? <Skeleton className="h-8 w-16" />}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{metric.detail}</p>
        </div>)}
      </section>
      {/* Insights Section */}
      <div className="space-y-3 min-w-0">
        <h2 className="text-base font-medium text-foreground px-1">Insights</h2>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Activity Chart */}
          <div className="min-w-0 lg:col-span-2 surface-raised rounded-xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Activity</h3>
                <p className="text-[11px] text-muted-foreground">Words dictated per day</p>
              </div>
              <div className="flex items-center gap-1 bg-foreground/5 rounded-lg p-1">
                {[
                  { label: "7 days", value: 7 as const },
                  { label: "30 days", value: 30 as const },
                ].map((t) => (
                  <button
                    key={t.value}
                    aria-pressed={timeframe === t.value}
                    onClick={() => setTimeframe(t.value)}
                    className={`px-3 py-1 text-[11px] font-medium rounded-md transition-colors ${
                      timeframe === t.value
                        ? "bg-foreground/15 text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {series === null ? (
              <Skeleton className="h-[180px] w-full mt-auto" />
            ) : (
              <div className="h-[180px] w-full mt-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} accessibilityLayer margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={timeframe === 7 ? "28%" : "18%"}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="dateStr"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickMargin={8}
                      minTickGap={16}
                      interval={timeframe === 7 ? 0 : "preserveStartEnd"}
                    />
                    <YAxis
                      width={44}
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickCount={4}
                      allowDecimals={false}
                      // 1200 -> "1.2k": four digits of axis label crowd a panel
                      // this size, and the exact figure lives in the tooltip.
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `${v}`
                      }
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="rounded-lg border border-border/50 bg-popover/90 backdrop-blur-sm p-3 shadow-xl">
                              <p className="text-[11px] font-medium text-muted-foreground mb-1">{data.fullDate}</p>
                              <p className="text-sm font-bold text-foreground">
                                {data.words.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">words</span>
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                      cursor={false}
                    />
                    <Bar dataKey="words" name="Words" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={32} activeBar={{ fill: "var(--accent-foreground)" }} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="sr-only"><caption>Words dictated each day in the last {timeframe} days</caption><thead><tr><th scope="col">Date</th><th scope="col">Words</th></tr></thead><tbody>{series.map(day => <tr key={day.fullDate}><th scope="row">{day.fullDate}</th><td>{day.words}</td></tr>)}</tbody></table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
            {/* Top Words */}
            <div className="flex-1 surface-raised rounded-xl p-4 flex flex-col">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Top Words</h3>
              {!history ? (
                <Skeleton className="h-full w-full" />
              ) : topWords.length === 0 ? (
                <div className="h-full flex items-center text-sm text-muted-foreground">Not enough data.</div>
              ) : (
                <div className="flex flex-wrap gap-2 mt-auto">
                  {topWords.slice(0, 6).map((w) => (
                    <div key={w.word} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/4 border border-foreground/5">
                      <span className="text-[12px] text-foreground/90 font-medium">{w.word}</span>
                      {/* accent pair, not a fixed blue-300: the pale step reads on
                          the dark theme and disappears on the light one. */}
                      <span className="text-[10px] text-accent-foreground bg-accent px-1.5 py-0.5 rounded-full font-sans">{w.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top Apps */}
            <div className="flex-1 surface-raised rounded-xl p-4 flex flex-col">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Top Apps</h3>
              {!history ? (
                <Skeleton className="h-full w-full" />
              ) : topApps.length === 0 ? (
                <div className="h-full flex items-center text-sm text-muted-foreground">Not enough data.</div>
              ) : (
                <div className="flex flex-wrap gap-2 mt-auto">
                  {topApps.slice(0, 6).map((a) => (
                    <div key={a.app} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-foreground/4 border border-foreground/5">
                      <span className="text-[12px] text-foreground/90 font-medium">{a.app}</span>
                      <span className="text-[10px] text-accent-foreground bg-accent px-1.5 py-0.5 rounded-full font-sans">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Recent Transcripts */}
      {history && history.length > 0 && (
        <div className="space-y-3 min-w-0">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-base font-medium text-foreground">
              Recent transcripts
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
          <div className="flex flex-col gap-2">
            {history.slice(0, recentCount).map((record) => (
              <div
                key={record.id}
                className="group list-row relative flex flex-col gap-2 px-4 py-3"
              >
                <p className="text-[14px] leading-relaxed text-foreground/90 wrap-break-word line-clamp-2 pr-8">
                  {record.text}
                </p>
                <div className="flex items-center gap-2.5">
                  <span className="font-sans text-[11px] text-muted-foreground">{timeAgo(record.timestamp_ms)}</span>
                  <span className="text-muted-foreground/30 text-[10px]">·</span>
                  <span className="font-sans text-[11px] text-muted-foreground tabular-nums">
                    {record.duration_seconds.toFixed(1)}s
                  </span>
                </div>
                {/* Copy button on hover */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(record.text).then(() => setCopiedId(record.id)).catch(() => toast.error("Could not copy text. Try again."));
                  }}
                  title={copiedId === record.id ? "Copied" : "Copy text"} aria-label={copiedId === record.id ? "Copied to clipboard" : "Copy text"}
                  className="absolute right-3 top-3 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:text-steelIce bg-background/80 backdrop-blur-sm"
                >
                  <span role="status">{copiedId === record.id ? <Check size={13} className="action-confirm text-success" /> : <Copy size={13} />}</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
