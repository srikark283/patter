import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, AudioLines, WandSparkles, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { onHudState, onMeetingState, onLevels, cancelDictation, stopMeetingRecording, cancelMeetingRecording } from "../../lib/ipc";
import RecordingVisualizer from "./RecordingVisualizer";

type Phase = "idle" | "recording" | "processing" | "cleanup" | "notice" | "meeting";

const BARS = 28;

function phaseFor(status: string): Phase {
  if (status === "Idle") return "idle";
  if (status === "Listening...") return "recording";
  if (status === "Transcribing...") return "processing";
  if (status === "Cleaning up…") return "cleanup";
  return "notice";
}

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function Hud() {
  const [status, setStatus] = useState("Idle");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const targets = useRef<number[]>(new Array(BARS).fill(0));
  const heights = useRef<number[]>(new Array(BARS).fill(0));
  const phaseRef = useRef<Phase>("idle");
  const meetingActive = useRef(false);
  const meetingPipeline = useRef(false);
  const meetingStart = useRef(0);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applyPhase = (next: Phase) => {
    const win = getCurrentWindow();
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
    // When visible, capture clicks so buttons and drag handle work.
    win.setIgnoreCursorEvents(next === "idle").catch(console.error);
  };

  useEffect(() => {
    const unlisten = onHudState((state) => {
      const next = phaseFor(state);
      if (meetingActive.current) {
        // Dictation-channel messages during a meeting (mic reconnect, blocked
        // hotkey) show as a transient notice, then the meeting pill returns.
        if (next === "idle") return;
        setStatus(state);
        applyPhase("notice");
        clearTimeout(revertTimer.current);
        revertTimer.current = setTimeout(() => {
          if (meetingActive.current) applyPhase("meeting");
        }, 2500);
        return;
      }
      setStatus(state);
      applyPhase(next);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unlisten = onMeetingState((state) => {
      clearTimeout(revertTimer.current);
      if (state === "recording") {
        meetingActive.current = true;
        meetingPipeline.current = false;
        meetingStart.current = Date.now();
        setElapsed(0);
        applyPhase("meeting");
      } else if (state === "idle") {
        meetingActive.current = false;
        meetingPipeline.current = false;
        applyPhase("idle");
      } else {
        // transcribing / summarizing / error — post-recording progress.
        meetingActive.current = false;
        meetingPipeline.current = true;
        setStatus(state.charAt(0).toUpperCase() + state.slice(1));
        applyPhase("notice");
        // Errors never get a follow-up "idle" event; auto-dismiss.
        if (state.startsWith("error")) {
          revertTimer.current = setTimeout(() => {
            meetingPipeline.current = false;
            applyPhase("idle");
          }, 5000);
        }
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (phase !== "meeting") return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - meetingStart.current) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [phase]);

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

              {phase === "meeting" && (
                <span className="hud-label tabular-nums">{fmtElapsed(elapsed)}</span>
              )}

              {phase === "processing" && (
                <AudioLines size={15} className="hud-icon-anim hud-icon-scan" strokeWidth={2} />
              )}
              {phase === "cleanup" && (
                <WandSparkles size={15} className="hud-icon-anim hud-icon-sweep" strokeWidth={2} />
              )}
              {phase === "notice" && <span className="hud-label">{status}</span>}
            </div>

            {(phase === "recording" || phase === "processing" || phase === "cleanup" || phase === "meeting" || (phase === "notice" && meetingPipeline.current)) && (
              <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10">
                {phase === "meeting" ? (
                  <button
                    className="hud-cancel-btn text-white/40 hover:text-white/80"
                    title="Stop meeting recording"
                    onClick={() => stopMeetingRecording().catch(console.error)}
                  >
                    <Square size={10} strokeWidth={2.5} fill="currentColor" />
                  </button>
                ) : phase === "notice" && meetingPipeline.current ? (
                  <button
                    className="hud-cancel-btn text-white/40 hover:text-white/80"
                    title="Cancel meeting processing"
                    onClick={() => cancelMeetingRecording().catch(console.error)}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                ) : (
                  <button className="hud-cancel-btn text-white/40 hover:text-white/80" onClick={() => cancelDictation().catch(console.error)}>
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
