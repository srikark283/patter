import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, Lock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { onHudState, onLevels, cancelDictation } from "../../lib/ipc";
import RecordingVisualizer from "./RecordingVisualizer";

type Phase = "idle" | "recording" | "processing" | "notice";

const BARS = 28;

function phaseFor(status: string): Phase {
  if (status === "Idle") return "idle";
  if (status === "Listening...") return "recording";
  if (status === "Transcribing...") return "processing";
  return "notice";
}

export default function Hud() {
  const [status, setStatus] = useState("Idle");
  const [phase, setPhase] = useState<Phase>("idle");
  const targets = useRef<number[]>(new Array(BARS).fill(0));
  const heights = useRef<number[]>(new Array(BARS).fill(0));
  const phaseRef = useRef<Phase>("idle");

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = onHudState((state) => {
      const next = phaseFor(state);
      setStatus(state);
      
      if (phaseRef.current === "idle" && next !== "idle") {
        win.show();
      }

      if (next === "recording") {
        targets.current.fill(0);
        heights.current.fill(0);
      }
      
      phaseRef.current = next;
      setPhase(next);

      // Toggle click-through: when idle, pass clicks through to the OS.
      // When visible, capture clicks so cancel button and drag handle work.
      if (next === "idle") {
        win.setIgnoreCursorEvents(true).catch(console.error);
      } else {
        win.setIgnoreCursorEvents(false).catch(console.error);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlisten = onLevels((levels) => {
      if (phaseRef.current !== "recording") return;
      const level = Math.max(...levels);
      targets.current.push(Math.min(1, Math.sqrt(level * 6)));
      targets.current.shift();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleExitComplete = () => {
    if (phaseRef.current === "idle") {
      getCurrentWindow().hide();
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <AnimatePresence onExitComplete={handleExitComplete}>
        {phase !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, scale: 0.96, filter: "blur(4px)" }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 30,
              mass: 1.5,
            }}
            className={`hud-pill ${phase}`}
          >
            <div 
              onPointerDown={(e) => {
                if (e.buttons === 1) {
                  getCurrentWindow().startDragging();
                }
              }}
              className="hud-drag-handle"
            >
              <span className={`hud-dot ${phase}`} />
              
              {phase === "recording" && (
                <RecordingVisualizer phase={phase} targets={targets} heights={heights} />
              )}
              
              {phase === "processing" && (
                <div className="flex items-center gap-1.5 text-white/60">
                  <Lock size={10} className="opacity-60" />
                  <span className="hud-label">Transcribing…</span>
                </div>
              )}
              {phase === "notice" && <span className="hud-label">{status}</span>}
            </div>
            
            {(phase === "recording" || phase === "processing") && (
              <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
                <button className="hud-cancel-btn text-white/40 hover:text-white/80" onClick={() => cancelDictation().catch(console.error)}>
                  <X size={12} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

