import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, Code2, Mail, MessageSquare, TerminalSquare, FileText, Sparkles } from "lucide-react";

import { AppLogos } from "../components/AppLogos";

// Local cache to avoid re-fetching the same icon across component unmounts
const iconCache: Record<string, string | null> = {};

function getBrandedStaticIcon(appStr: string) {
  const s = appStr.toLowerCase();
  if (s.includes("chatgpt")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#f8fafa]">{AppLogos.chatgpt}</span>;
  if (s.includes("claude")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#D97757]">{AppLogos.claude}</span>;
  if (s.includes("gemini")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#8b5cf6]">{AppLogos.gemini}</span>;
  if (s.includes("slack")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#E01E5A]">{AppLogos.slack}</span>;
  if (s.includes("discord")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#5865F2]">{AppLogos.discord}</span>;
  if (s.includes("whatsapp")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#25D366]">{AppLogos.whatsapp}</span>;
  if (s.includes("teams")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#6264A7]">{AppLogos.teams}</span>;
  if (s.includes("notion")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-foreground">{AppLogos.notion}</span>;
  if (s.includes("sublime")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#FF9800]">{AppLogos.sublime}</span>;
  if (s.includes("xcode")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#157EFB]">{AppLogos.xcode}</span>;
  if (s.includes("code") && !s.includes("xcode")) return <span className="opacity-90 flex items-center justify-center w-full h-full text-[#007ACC]">{AppLogos.vscode}</span>;
  return null;
}

function getFallbackIcon(appStr: string) {
  const s = appStr.toLowerCase();
  if (s.includes("code") || s.includes("cursor") || s.includes("intellij") || s.includes("zed")) return <Code2 size={14} className="opacity-70" />;
  if (s.includes("perplexity") || s.includes("copilot") || s.includes("ai")) return <Sparkles size={14} className="opacity-70" />;
  if (s.includes("mail") || s.includes("outlook") || s.includes("spark") || s.includes("gmail")) return <Mail size={14} className="opacity-70" />;
  if (s.includes("message")) return <MessageSquare size={14} className="opacity-70" />;
  if (s.includes("terminal") || s.includes("iterm") || s.includes("alacritty") || s.includes("ghostty")) return <TerminalSquare size={14} className="opacity-70" />;
  if (s.includes("note") || s.includes("obsidian")) return <FileText size={14} className="opacity-70" />;
  return <AppWindow size={14} className="opacity-70" />;
}

export function NativeAppIcon({ appName }: { appName: string }) {
  const [validIcons, setValidIcons] = useState<React.ReactNode[]>([]);
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const apps = (appName || "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 4);

    if (apps.length === 0) {
      setValidIcons([]);
      setIsFetching(false);
      return;
    }

    setIsFetching(true);
    
    Promise.allSettled(
      apps.map(async (app) => {
        try {
          let url: string;
          if (iconCache[app] !== undefined) {
            if (iconCache[app] === null) throw new Error("Cached failure");
            url = iconCache[app] as string;
          } else {
            const bytes = await invoke<number[]>("get_app_icon", { appName: app });
            const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
            url = URL.createObjectURL(blob);
            iconCache[app] = url;
          }
          return <img src={url} alt="Icon" className="w-full h-full object-contain" />;
        } catch (e) {
          iconCache[app] = null;
          const branded = getBrandedStaticIcon(app);
          if (branded) return branded;
          throw e; // Neither native nor branded static icon found
        }
      })
    ).then((results) => {
      if (!isMounted) return;
      
      const nodes: React.ReactNode[] = [];
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value) nodes.push(r.value);
      });
      
      setValidIcons(nodes);
      setIsFetching(false);
    });

    return () => {
      isMounted = false;
    };
  }, [appName]);

  if (isFetching) {
    return <div className="w-[14px] h-[14px] rounded-[3.5px] bg-white/5 animate-pulse" />;
  }

  if (validIcons.length === 0) {
    return getFallbackIcon(appName || "");
  }

  if (validIcons.length === 1) {
    return (
      <div className="w-[14px] h-[14px] rounded-[3.5px] shadow-[0_1px_2px_rgba(0,0,0,0.2)] bg-background flex items-center justify-center overflow-hidden">
        {validIcons[0]}
      </div>
    );
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {validIcons.map((node, i) => (
        <div 
          key={i} 
          className="w-[14px] h-[14px] rounded-[3.5px] shadow-[0_1px_2px_rgba(0,0,0,0.2)] bg-background relative ring-1 ring-background flex items-center justify-center overflow-hidden"
          style={{ zIndex: validIcons.length - i }}
        >
          {node}
        </div>
      ))}
    </div>
  );
}
