import { useEffect, useRef } from "react";
import RecordingVisualizer from "../../hud/RecordingVisualizer";
import { onLevels } from "@/lib/ipc";

/** A brand motif at rest; only the live variant represents microphone levels. */
export function VoiceSignature({ live = false }: { live?: boolean }) {
  const targets = useRef<number[]>(new Array(28).fill(0));
  const heights = useRef<number[]>(new Array(28).fill(0));
  useEffect(() => {
    if (!live) return;
    const unlisten = onLevels(levels => {
      const peak = Math.max(0, ...levels);
      targets.current.push(Math.min(1, Math.sqrt(peak * 6)));
      targets.current.shift();
    });
    return () => { void unlisten.then(stop => stop()).catch(console.error); };
  }, [live]);
  return live ? <span className="voice-signature" aria-label="Live microphone level"><RecordingVisualizer phase="recording" targets={targets} heights={heights} /></span> : <svg className="voice-signature" width="96" height="26" viewBox="0 0 96 26" fill="none" aria-hidden="true"><path d="M2 13C16 13 20 4 33 6S59 24 72 18 86 13 94 13M2 13C18 13 22 9 34 10S58 19 72 15 86 13 94 13M2 13C17 13 22 16 35 15S58 7 72 11 86 13 94 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
}
