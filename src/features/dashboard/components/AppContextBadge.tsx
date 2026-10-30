import { NativeAppIcon } from "./NativeAppIcon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Settings } from "@/lib/ipc";
export function AppContextBadge({ app, settings }: { app: string; settings: Settings | null }) {
  const profile = settings?.app_profiles.find(profile => profile.app.toLowerCase().split(",").some(name => name.trim() && app.toLowerCase().includes(name.trim())));
  const detail = !settings ? "Profile details unavailable." : !settings.llm_cleanup_enabled ? "Cleanup is currently off." : profile?.prompt || "General dictation · no custom instructions.";
  return <TooltipProvider delayDuration={300}><Tooltip><TooltipTrigger asChild><button type="button" aria-label={`Dictated for ${app}. Show current cleanup profile`} className="app-context-badge"><NativeAppIcon appName={app} /><span className="max-w-48 truncate">{app}</span></button></TooltipTrigger><TooltipContent className="block max-w-xs space-y-2 p-3 leading-relaxed"><p className="font-medium">{app} · Current cleanup profile</p><p className="whitespace-pre-wrap">{detail.slice(0, 600)}{detail.length > 600 ? "…" : ""}</p><p>These are your current settings, not a record of the instructions used for this transcript.</p></TooltipContent></Tooltip></TooltipProvider>;
}
