import { AppStats } from "../types";

interface Props {
  stats: AppStats | null;
}

export function DashboardView({ stats }: Props) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold">Dashboard</h2>
      
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#2a2a2a]">
          <p className="text-sm text-gray-400 mb-1">Time Saved</p>
          <p className="text-4xl font-bold text-green-400">{stats ? formatTime(stats.time_saved_seconds) : "0m 0s"}</p>
        </div>
        <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#2a2a2a]">
          <p className="text-sm text-gray-400 mb-1">Total Words</p>
          <p className="text-4xl font-bold text-blue-400">{stats ? stats.total_words : 0}</p>
        </div>
        <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#2a2a2a]">
          <p className="text-sm text-gray-400 mb-1">Transcriptions</p>
          <p className="text-4xl font-bold text-indigo-400">{stats ? stats.transcriptions_count : 0}</p>
        </div>
      </div>

      <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#2a2a2a] mt-8">
        <h3 className="text-lg font-semibold mb-4">How it works</h3>
        <p className="text-gray-400 text-sm leading-relaxed">
          Patter calculates your time saved assuming an average typing speed of 40 words per minute.
          Whenever you dictate, Patter compares the time it took you to speak versus the expected time it would have taken to type the resulting text manually.
        </p>
      </div>
    </div>
  );
}
