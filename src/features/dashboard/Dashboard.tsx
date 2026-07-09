import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { 
  Activity, 
  History as HistoryIcon, 
  BookA, 
  Settings as SettingsIcon, 
  Database 
} from "lucide-react";

import { AppStats, TranscriptionRecord } from "./types";
import { DashboardView } from "./views/DashboardView";
import { HistoryView } from "./views/HistoryView";
import { DictionaryView } from "./views/DictionaryView";
import { ModelsView } from "./views/ModelsView";
import { PreferencesView } from "./views/PreferencesView";

export default function DashboardApp() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<AppStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  
  // Settings State
  const [activeEngine, setActiveEngine] = useState("whisper");
  const [outputMode, setOutputMode] = useState("paste");
  const [customPrompt, setCustomPrompt] = useState("");
  
  // Download State
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    // Load data
    const refreshData = () => {
      invoke<AppStats>("get_stats").then(setStats).catch(console.error);
      invoke<TranscriptionRecord[]>("get_history").then(setHistory).catch(console.error);
    };
    
    refreshData();
    
    const unlistenProgress = listen("download_progress", (event: any) => {
      const progress = event.payload;
      setDownloadProgress(progress);
      setIsDownloading(progress < 100);
    });

    const unlistenDb = listen("patter://db_updated", () => {
      refreshData();
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenDb.then((f) => f());
    };
  }, []);

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: Activity },
    { id: "history", label: "History", icon: HistoryIcon },
    { id: "dictionary", label: "Dictionary", icon: BookA },
    { id: "models", label: "Models", icon: Database },
    { id: "preferences", label: "Preferences", icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen bg-[#111111] text-gray-100 font-sans">
      {/* Sidebar */}
      <div className="w-56 bg-[#1a1a1a] border-r border-[#2a2a2a] flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent flex items-center gap-2">
            Patter
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-blue-500/10 text-blue-400" 
                    : "text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-200"
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-10 max-w-4xl mx-auto">
          {activeTab === "dashboard" && <DashboardView stats={stats} />}
          {activeTab === "history" && <HistoryView history={history} setHistory={setHistory} />}
          {activeTab === "dictionary" && <DictionaryView customPrompt={customPrompt} setCustomPrompt={setCustomPrompt} />}
          {activeTab === "models" && (
            <ModelsView 
              activeEngine={activeEngine} 
              setActiveEngine={setActiveEngine} 
              isDownloading={isDownloading} 
              setIsDownloading={setIsDownloading} 
              downloadProgress={downloadProgress} 
            />
          )}
          {activeTab === "preferences" && <PreferencesView outputMode={outputMode} setOutputMode={setOutputMode} />}
        </div>
      </div>
    </div>
  );
}
