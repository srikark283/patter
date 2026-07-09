import { useState, useEffect } from "react";
import {
  Home,
  History as HistoryIcon,
  BookA,
  Cog as SettingsIcon,
  Sparkles,
} from "lucide-react";

import { AppStats, TranscriptionRecord } from "../../types";
import { getStats, getHistory, onDownloadProgress, onDbUpdated, isModelDownloaded, getActiveEngine } from "../../lib/ipc";
import { cn } from "@/lib/utils";
import { DashboardView } from "./views/DashboardView";
import { HistoryView } from "./views/HistoryView";
import { DictionaryView } from "./views/DictionaryView";
import { ModelsView, ALL_MODEL_IDS, MODEL_NAMES } from "./views/ModelsView";
import { PreferencesView } from "./views/PreferencesView";
import icon from "@/assets/icon.png";


export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<AppStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[] | null>(null);

  // Settings State
  const [activeEngine, setActiveEngine] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState("paste");
  const [customPrompt, setCustomPrompt] = useState("");

  // Download State
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
  const [modelStatusLoading, setModelStatusLoading] = useState(true);

  const refreshModelStatus = () => {
    Promise.all(ALL_MODEL_IDS.map((id) => isModelDownloaded(id).then((downloaded) => [id, downloaded] as const)))
      .then((entries) => {
        setModelStatus(Object.fromEntries(entries));
        setModelStatusLoading(false);
      })
      .catch(console.error);
  };

  useEffect(() => {
    // Load data
    const refreshData = () => {
      getStats().then(setStats).catch(console.error);
      getHistory().then(setHistory).catch(console.error);
    };

    refreshData();
    refreshModelStatus();
    getActiveEngine().then(setActiveEngine).catch(console.error);

    const unlistenProgress = onDownloadProgress((id, pct) => {
      setDownloadProgress(pct);
      if (pct >= 100) {
        setDownloadingId(null);
        refreshModelStatus();
      } else {
        setDownloadingId(id);
      }
    });

    const unlistenDb = onDbUpdated(refreshData);

    return () => {
      unlistenProgress.then((f) => f());
      unlistenDb.then((f) => f());
    };
  }, []);

  const tabs = [
    { id: "dashboard", label: "Home", icon: Home },
    { id: "history", label: "History", icon: HistoryIcon },
    { id: "dictionary", label: "Dictionary", icon: BookA },
    { id: "models", label: "Models", icon: Sparkles },
    { id: "preferences", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="relative flex h-screen bg-background text-foreground overflow-hidden">
      {/* Atmosphere: single cold top-glow + film grain */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[60rem] h-[32rem] rounded-full bg-steel/[0.07] blur-[140px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.025]" />
      </div>

      {/* Sidebar — instrument rail */}
      <aside className="relative z-10 w-56 flex flex-col border-r border-border bg-white/[0.015]">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          {/* <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-b from-steel to-steelDeep shadow-lg shadow-steel/25 ring-1 ring-white/15">
            <AudioLines size={15} className="text-white" />
          </div> */}
          <img src={icon} alt="Patter Logo" className="w-10 h-10" />

          <div className="leading-none">
            <h1 className="text-[15px] font-semibold tracking-tight">Patter</h1>
            <p className="t-label mt-1 text-[9px]">Voice · Local</p>
          </div>
        </div>

        <div className="px-5 pt-3 pb-2">
          <div className="w-full border-t border-gray-600"></div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "group relative w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[14px] font-medium transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-accent text-accent-foreground shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-0.5 rounded-full bg-steelIce transition-opacity",
                    isActive ? "opacity-100 shadow-[0_0_8px_var(--color-steel)]" : "opacity-0"
                  )}
                />
                <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Status footer: live engine readout */}
        <div className="px-5 py-4 border-t border-border">
          <span className="t-label">Engine</span>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full flex-none",
                activeEngine ? "bg-success shadow-[0_0_6px_var(--color-success)]" : "bg-muted-foreground/40"
              )}
            />
            <span className="font-mono text-[11px] text-foreground/80 truncate">
              {activeEngine ? MODEL_NAMES[activeEngine] ?? activeEngine : "No model loaded"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="px-10 py-9 max-w-5xl mx-auto">
          {activeTab === "dashboard" && <DashboardView stats={stats} history={history} />}
          {activeTab === "history" && <HistoryView history={history} setHistory={setHistory} />}
          {activeTab === "dictionary" && <DictionaryView customPrompt={customPrompt} setCustomPrompt={setCustomPrompt} />}
          {activeTab === "models" && (
            <ModelsView
              activeEngine={activeEngine}
              setActiveEngine={setActiveEngine}
              modelStatus={modelStatus}
              modelStatusLoading={modelStatusLoading}
              downloadingId={downloadingId}
              setDownloadingId={setDownloadingId}
              downloadProgress={downloadProgress}
            />
          )}
          {activeTab === "preferences" && <PreferencesView outputMode={outputMode} setOutputMode={setOutputMode} />}
        </div>
      </main>
    </div>
  );
}
