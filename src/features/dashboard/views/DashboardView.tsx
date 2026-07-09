import { Clock, Type, Sparkles, Info } from "lucide-react";
import { AppStats, TranscriptionRecord } from "../../../types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "../components/PageHeader";

interface Props {
  stats: AppStats | null;
  history: TranscriptionRecord[] | null;
}

const ACTIVITY_DAYS = 14;

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
    days.push({ label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }), words });
  }
  return days;
}

export function DashboardView({ stats, history }: Props) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const tiles = [
    { label: "Time Saved", icon: Clock, value: stats ? formatTime(stats.time_saved_seconds) : null, tone: "text-success" },
    { label: "Total Words", icon: Type, value: stats ? String(stats.total_words) : null, tone: "text-steelIce" },
    { label: "Transcriptions", icon: Sparkles, value: stats ? String(stats.transcriptions_count) : null, tone: "text-foreground" },
  ];

  const series = history ? activitySeries(history) : null;
  const maxWords = series ? Math.max(1, ...series.map((d) => d.words)) : 1;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader title={`${greeting} 👋`} description="Here’s what you’ve transcribed so far." />

      {/* Instrument cluster: one panel, three readouts */}
      <Card className="py-0">
        <div className="grid grid-cols-3 divide-x divide-border">
          {tiles.map(({ label, icon: Icon, value, tone }) => (
            <div key={label} className="px-5 py-5">
              <div className="flex items-center gap-2">
                <Icon size={12} className="text-muted-foreground" strokeWidth={1.8} />
                <span className="t-label">{label}</span>
              </div>
              {value !== null ? (
                <p className={`mt-3 font-mono text-[26px] font-medium tracking-tight tabular-nums whitespace-nowrap ${tone}`}>
                  {value}
                </p>
              ) : (
                <Skeleton className="mt-3 h-8 w-20" />
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Activity: words dictated, last 14 days */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="t-label">Activity · Last {ACTIVITY_DAYS} days</span>
            <span className="t-label">Words / Day</span>
          </div>
          {series === null ? (
            <Skeleton className="mt-4 h-24 w-full" />
          ) : (
            <div className="mt-4 flex items-end gap-1.5 h-24">
              {series.map((d) => (
                <div key={d.label} className="group relative flex-1 flex flex-col justify-end h-full">
                  <div
                    className={
                      d.words > 0
                        ? "rounded-sm bg-gradient-to-t from-steelDeep to-steel shadow-[0_0_10px_rgba(91,155,209,0.25)]"
                        : "rounded-sm bg-white/[0.05]"
                    }
                    style={{ height: d.words > 0 ? `${Math.max(8, (d.words / maxWords) * 100)}%` : "3px" }}
                  />
                  <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 font-mono text-[10px] text-foreground opacity-0 ring-1 ring-border transition-opacity group-hover:opacity-100">
                    {d.label} · {d.words}w
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2.5 items-start px-1 text-muted-foreground">
        <Info size={13} className="flex-none mt-0.5" strokeWidth={1.8} />
        <p className="text-xs leading-relaxed">
          Time saved assumes an average typing speed of 40 words per minute — the time you spent speaking versus
          the expected time to type the same text manually.
        </p>
      </div>
    </div>
  );
}
