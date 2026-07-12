import { useState, useEffect } from "react";
import {
  // LayoutDashboard as HomeIcon,
  // ScrollText as HistoryIcon,
  CaseSensitive as DictionaryIcon,
  Cog as SettingsIcon,
  // BrainCircuit as ModelsIcon,
  // Sparkles as AIIcon,
  // UsersRound as MeetingsIcon,
} from "lucide-react";
import { 
  HomeIcon as HomeIcon,
  UsersIcon as MeetingsIcon,
  // SparklesIcon as AIIcon
} from '@heroicons/react/24/outline'

import {
  WaveformIcon as ModelsIcon, 
  SparkleIcon as AIIcon,
  ClockCounterClockwiseIcon as HistoryIcon,
} from '@phosphor-icons/react'



import { AppStats, TranscriptionRecord } from "../../types";
import { getStats, getHistory, getSettings, onDownloadProgress, onDbUpdated, isModelDownloaded, getActiveEngine, accessibilityTrusted, openAccessibilitySettings, onAccessibilityMissing, onUpdateAvailable, onNavigate } from "../../lib/ipc";
import { promptUpdateInstall } from "../../lib/update";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { Onboarding } from "../onboarding/Onboarding";
import { cn } from "@/lib/utils";
import { DashboardView } from "./views/DashboardView";
import { MeetingsView } from "./views/MeetingsView";
import { HistoryView } from "./views/HistoryView";
import { DictionaryView } from "./views/DictionaryView";
import { ModelsView, ALL_MODEL_IDS, MODEL_NAMES } from "./views/ModelsView";
import { AIView } from "./views/AIView";
import { PreferencesView } from "./views/PreferencesView";
import icon from "@/assets/logohq.png";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<AppStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[] | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  // Settings State
  const [activeEngine, setActiveEngine] = useState<string | null>(null);

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
    getSettings().then((s) => setShowOnboarding(!s.onboarding_done)).catch(console.error);
    getVersion().then(setAppVersion).catch(console.error);

    const warnAccessibility = () =>
      toast.warning("Patter can't type for you yet", {
        id: "ax-perm",
        description:
          "Grant Accessibility permission so dictation can type into other apps. Until then, text is copied to the clipboard.",
        action: { label: "Open Settings", onClick: () => openAccessibilitySettings() },
        duration: 10000,
      });

    accessibilityTrusted()
      .then((trusted) => {
        if (!trusted) warnAccessibility();
      })
      .catch(console.error);
    const unlistenAx = onAccessibilityMissing(warnAccessibility);

    const unlistenUpdate = onUpdateAvailable(promptUpdateInstall);
    const unlistenNav = onNavigate(setActiveTab);

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
      unlistenAx.then((f) => f());
      unlistenUpdate.then((f) => f());
      unlistenNav.then((f) => f());
    };
  }, []);

  const tabs = [
    { id: "dashboard", label: "Home", icon: HomeIcon },
    { id: "meetings", label: "Meetings", icon: MeetingsIcon },
    { id: "history", label: "History", icon: HistoryIcon },
    { id: "dictionary", label: "Dictionary", icon: DictionaryIcon },
    { id: "models", label: "Speech Models", icon: ModelsIcon },
    { id: "ai", label: "Intelligence", icon: AIIcon },
    { id: "preferences", label: "Preferences", icon: SettingsIcon },
  ];

  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
      <div className="relative flex h-screen w-full bg-background text-foreground overflow-hidden">
        <div 
          data-tauri-drag-region
          className="absolute top-0 left-0 right-0 h-12 z-50 cursor-grab" 
        />

        {/* Atmosphere: single cold top-glow + film grain */}
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-240 h-128 rounded-full bg-steel/[0.07] blur-[140px]" />
          <div className="absolute inset-0 bg-noise opacity-[0.025]" />
        </div>

        {/* Sidebar — instrument rail */}
        <Sidebar className="border-r border-border bg-white/1.5 text-foreground">
          {/* Traffic Lights spacing */}
          <div className="w-full h-10 shrink-0" />

          <SidebarHeader>
            <div className="flex items-center gap-1 px-3 pb-4 pt-2">
              <img src={icon} alt="Patter Logo" className="w-9 h-9 rounded-md pointer-events-none" />

              <div className="leading-none pointer-events-none">
                <h1 className="text-[24px] font-semibold tracking-[1px] font-['Nave']">Patter</h1>
              </div>
            </div>

            {/* <div className="px-3 pt-3 pb-4">
              <div className="w-full border-t border-gray-600"></div>
            </div> */}
          </SidebarHeader>

          <SidebarContent>
            <SidebarMenu className="px-3 space-y-0.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <SidebarMenuItem key={tab.id}>
                    <SidebarMenuButton
                      onClick={() => setActiveTab(tab.id)}
                      isActive={isActive}
                      className={cn(
                        "group w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[14px] font-medium transition-all duration-150 cursor-pointer h-auto",
                        isActive
                          ? "bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] hover:bg-accent hover:text-white"
                          : "text-muted-foreground hover:bg-white/4 hover:text-foreground"
                      )}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                      <span>{tab.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter>
            {/* Status footer: live engine readout */}
            <div className="px-3 py-4 border-t border-border">
              <span className="t-label">Engine</span>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full flex-none",
                    activeEngine ? "bg-success shadow-[0_0_6px_var(--color-success)]" : "bg-muted-foreground/40"
                  )}
                />
                <span className="font-sans text-[11px] text-foreground/80 truncate">
                  {activeEngine ? MODEL_NAMES[activeEngine] ?? activeEngine : "No model loaded"}
                </span>
              </div>
              {appVersion && (
                <p className="mt-2 font-sans text-[10px] text-muted-foreground/60 tabular-nums">
                  Patter v{appVersion}
                </p>
              )}
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="px-10 py-9 max-w-5xl mx-auto">
          {activeTab === "dashboard" && <DashboardView stats={stats} history={history} onViewAll={() => setActiveTab("history")} />}
          {activeTab === "meetings" && <MeetingsView />}
          {activeTab === "history" && <HistoryView history={history} setHistory={setHistory} />}
          {activeTab === "dictionary" && <DictionaryView />}
          {activeTab === "models" && (
            <ModelsView
              activeEngine={activeEngine}
              setActiveEngine={setActiveEngine}
              modelStatus={modelStatus}
              modelStatusLoading={modelStatusLoading}
              downloadingId={downloadingId}
              setDownloadingId={setDownloadingId}
              downloadProgress={downloadProgress}
              onModelDeleted={refreshModelStatus}
            />
          )}
          {activeTab === "ai" && <AIView />}
          {activeTab === "preferences" && <PreferencesView />}
        </div>
      </main>

      {showOnboarding && (
        <Onboarding
          modelStatus={modelStatus}
          downloadingId={downloadingId}
          setDownloadingId={setDownloadingId}
          downloadProgress={downloadProgress}
          activeEngine={activeEngine}
          setActiveEngine={setActiveEngine}
          onModelDownloaded={refreshModelStatus}
          onDone={() => setShowOnboarding(false)}
        />
      )}
      </div>
    </SidebarProvider>
  );
}
