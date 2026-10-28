import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from "react";
import { Home as HomeIcon, UsersRound as MeetingsIcon, CaseSensitive as DictionaryIcon, Cog as SettingsIcon, Brain as MemoryIcon, AudioLines as ModelsIcon, Sparkles as AIIcon, History as HistoryIcon, Zap as SnippetsIcon, ChevronRight } from "lucide-react";

import { AppStats, TranscriptionRecord } from "../../types";
import { getStats, getHistory, getSettings, onDownloadProgress, onDbUpdated, getModelStates, ModelState, getActiveEngine, accessibilityTrusted, openAccessibilitySettings, onAccessibilityMissing, onUpdateAvailable, onNavigate, onCleanupError } from "../../lib/ipc";
import { promptUpdateInstall } from "../../lib/update";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Onboarding } from "../onboarding/Onboarding";
import { cn } from "@/lib/utils";
import { DashboardView } from "./views/DashboardView";
const MeetingsView = lazy(() => import("./views/MeetingsView").then(module => ({ default: module.MeetingsView })));
const HistoryView = lazy(() => import("./views/HistoryView").then(module => ({ default: module.HistoryView })));
const DictionaryView = lazy(() => import("./views/DictionaryView").then(module => ({ default: module.DictionaryView })));
const SnippetsView = lazy(() => import("./views/SnippetsView").then(module => ({ default: module.SnippetsView })));
const MemoryView = lazy(() => import("./views/MemoryView").then(module => ({ default: module.MemoryView })));
import { ModelsView, MODEL_NAMES } from "./views/ModelsView";
const AIView = lazy(() => import("./views/AIView").then(module => ({ default: module.AIView })));
const PreferencesView = lazy(() => import("./views/PreferencesView").then(module => ({ default: module.PreferencesView })));
import { CleanupStatus } from "./components/CleanupStatus";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
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
  const mainRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<AppStats | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[] | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  // Settings State
  const [activeEngine, setActiveEngine] = useState<string | null>(null);

  // Download State
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<Record<string, ModelState>>({});
  const [modelStray, setModelStray] = useState<Record<string, number>>({});
  const [modelStatusError, setModelStatusError] = useState("");
  const [modelStatusLoading, setModelStatusLoading] = useState(true);

  // One call for the whole catalog, and a three-state answer: a boolean could
  // not distinguish "not downloaded" from "half a model sitting on your disk".
  const refreshModelStatus = () => {
    setModelStatusLoading(true);
    setModelStatusError("");
    getModelStates()
      .then((rows) => {
        setModelStatus(Object.fromEntries(rows.map(([id, state]) => [id, state])));
        setModelStray(Object.fromEntries(rows.map(([id, , stray]) => [id, stray])));
        setModelStatusLoading(false);
      })
      .catch(error => { setModelStatusError(String(error)); setModelStatusLoading(false); });
  };

  useEffect(() => {
    // Load data
    const refreshData = () => {
      getStats().then(setStats).catch(console.error);
      getActiveEngine().then(setActiveEngine).catch(console.error);
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

    const unlistenCleanup = onCleanupError(message => toast.error(message));
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
      unlistenCleanup.then((f) => f());
      unlistenUpdate.then((f) => f());
      unlistenNav.then((f) => f());
    };
  }, []);

  const tabs = [
    { id: "dashboard", label: "Home", icon: HomeIcon },
    { id: "meetings", label: "Meetings", icon: MeetingsIcon },
    { id: "history", label: "Transcripts", icon: HistoryIcon },
    { id: "memory", label: "Memory", icon: MemoryIcon },
    { id: "dictionary", label: "Dictionary", icon: DictionaryIcon },
    { id: "snippets", label: "Voice Macros", icon: SnippetsIcon },
    { id: "models", label: "Speech Models", icon: ModelsIcon },
    { id: "ai", label: "Intelligence", icon: AIIcon },
    { id: "preferences", label: "Preferences", icon: SettingsIcon },
  ];

  return (
    <SidebarProvider style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
      <div className="relative flex h-screen w-full bg-background text-foreground overflow-hidden">
        <div 
          onPointerDown={(e) => {
            if (e.buttons === 1) {
              getCurrentWindow().startDragging();
            }
          }}
          className="absolute top-0 left-20 right-0 h-12 z-50 cursor-default" 
        />

        {/* Sidebar — instrument rail */}
        <Sidebar className="border-r border-border bg-foreground/[0.015] text-foreground">
          {/* Traffic Lights spacing */}
          <div className="w-full h-10 shrink-0" />

          <SidebarHeader>
            <div className="flex items-center gap-1 px-3 pb-4 pt-2">
              <img src={icon} alt="Patter Logo" className="w-9 h-9 rounded-md pointer-events-none" />

              <div className="leading-none pointer-events-none">
                <h1 className="font-display text-[22px] font-normal tracking-[1px]">Patter</h1>
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
                        "group w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[14px] font-medium transition-colors duration-150 cursor-pointer h-auto",
                        isActive
                          // accent-foreground, not white: --accent is a pale blue
                          // tint, so white ink on it disappears in light mode.
                          // The token is steelIce on dark, steelDeep on light.
                          ? "bg-accent text-accent-foreground shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] hover:bg-accent hover:text-accent-foreground"
                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
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
            <div className="px-3 pt-2 pb-1"><ThemeSwitcher /></div>
            <div className="space-y-2 px-3 pt-2 pb-2">
              <div className="flex items-center justify-between px-1 text-[11px]">
                <span className="text-muted-foreground">Speech model</span>
                <span className={cn("inline-flex items-center gap-1.5 text-[10px]", activeEngine ? "text-success" : "text-muted-foreground")}>
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", activeEngine ? "bg-success" : "bg-muted-foreground/50")} />
                  {activeEngine ? "Active" : "Not selected"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("models")}
                aria-label={activeEngine ? `Change speech model: ${MODEL_NAMES[activeEngine] ?? activeEngine}` : "Choose a speech model"}
                title={activeEngine ? `Change model · ${MODEL_NAMES[activeEngine] ?? activeEngine}` : "Choose a speech model"}
                className="group flex min-h-11 w-full items-center gap-2 rounded-lg bg-foreground/[0.025] px-2.5 py-2.5 text-left ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:ring-primary/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ModelsIcon size={16} strokeWidth={1.7} className="shrink-0 text-accent-foreground" />
                <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-foreground break-words">{activeEngine ? MODEL_NAMES[activeEngine] ?? activeEngine : "Choose a model"}</span>
                <ChevronRight size={13} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-accent-foreground" />
              </button>
              <CleanupStatus page={activeTab} onClick={() => setActiveTab("ai")} />
              {appVersion && <p className="mt-2 text-center text-[10px] tabular-nums text-muted-foreground">Patter v{appVersion}</p>}
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Main Content */}
      <main ref={mainRef} className="relative z-10 min-w-0 flex-1 overflow-y-auto">
        <div className="px-5 py-9 lg:px-10 max-w-5xl mx-auto">
          <Suspense fallback={<div role="status" className="py-12 text-sm text-muted-foreground">Opening workspace…</div>}>
          {activeTab === "dashboard" && <DashboardView stats={stats} history={history} onViewAll={() => setActiveTab("history")} onPreferences={() => setActiveTab("preferences")} activeEngine={activeEngine} onModels={() => setActiveTab("models")} onIntelligence={() => setActiveTab("ai")} onHistoryChange={setHistory} />}
          {activeTab === "meetings" && <MeetingsView modelStatus={modelStatus} />}
          {activeTab === "history" && <HistoryView history={history} setHistory={setHistory} />}
          {activeTab === "memory" && <MemoryView />}
          {activeTab === "dictionary" && <DictionaryView />}
          {activeTab === "snippets" && <SnippetsView />}
          {activeTab === "models" && (
            <ModelsView
              activeEngine={activeEngine}
              setActiveEngine={setActiveEngine}
              modelStatus={modelStatus}
              modelStray={modelStray}
              modelStatusLoading={modelStatusLoading}
              downloadingId={downloadingId}
              setDownloadingId={setDownloadingId}
              downloadProgress={downloadProgress}
              onModelDeleted={refreshModelStatus}
              statusError={modelStatusError}
              onRetry={refreshModelStatus}
            />
          )}
          {activeTab === "ai" && <AIView />}
          {activeTab === "preferences" && <PreferencesView activeEngine={activeEngine} />}
          </Suspense>
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
