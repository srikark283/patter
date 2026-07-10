import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { onHudState, onLevels, cancelDictation } from "../../lib/ipc";

type Phase = "idle" | "recording" | "processing" | "notice";

const BARS = 28;

function phaseFor(status: string): Phase {
  if (status === "Idle") return "idle";
  if (status === "Listening...") return "recording";
  if (status === "Transcribing...") return "processing";
  return "notice"; // "✓ Pasted · N words", "Audio too short", "No model loaded", etc.
}

export default function Hud() {
  const [status, setStatus] = useState("Idle");
  const [phase, setPhase] = useState<Phase>("idle");
  const [leaving, setLeaving] = useState(false);
  const [entryKey, setEntryKey] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targets = useRef<number[]>(new Array(BARS).fill(0));
  const heights = useRef<number[]>(new Array(BARS).fill(0));
  const phaseRef = useRef<Phase>("idle");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drive window visibility + pill state off patter://state.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = onHudState((state) => {
      const next = phaseFor(state);
      setStatus(state);
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
        setLeaving(false);
      }
      if (phaseRef.current === "idle" && next !== "idle") {
        setEntryKey((k) => k + 1); // replay entrance animation
        win.show();
      }

      if (next === "recording") {
        targets.current.fill(0);
        heights.current.fill(0);
      }
      if (next === "idle") {
        // Play the exit animation before the window actually hides.
        phaseRef.current = "idle";
        setLeaving(true);
        hideTimer.current = setTimeout(() => {
          win.hide();
          setPhase("idle");
          setLeaving(false);
          hideTimer.current = null;
        }, 180);
        return;
      }
      phaseRef.current = next;
      setPhase(next);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Real audio levels (5-band FFT from recording.rs) feed the waveform.
  useEffect(() => {
    const unlisten = onLevels((levels) => {
      if (phaseRef.current !== "recording") return;
      const level = Math.max(...levels);
      // Perceptual curve: sqrt lifts quiet speech into a visible range.
      targets.current.push(Math.min(1, Math.sqrt(level * 6)));
      targets.current.shift();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Spring-chase rAF loop: 3 overlapping glowing strands, Siri-style.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 96;
    const h = 26;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const waveformRgb =
      getComputedStyle(document.documentElement).getPropertyValue("--waveform-rgb").trim() ||
      "168, 199, 224";

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);

      let allIdle = true;
      for (let i = 0; i < BARS; i++) {
        const t = targets.current[i];
        const hVal = heights.current[i];
        const next = hVal + (t - hVal) * (t > hVal ? 0.5 : 0.18);
        heights.current[i] = next;
        if (next > 0.01) allIdle = false;
      }

      ctx.clearRect(0, 0, w, h);
      if (phaseRef.current !== "recording" && allIdle) return;

      const time = Date.now() / 1000;
      const opacities = [1.0, 0.65, 0.35];
      const gradients = opacities.map((opacity) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, `rgba(${waveformRgb}, 0)`);
        g.addColorStop(0.15, `rgba(${waveformRgb}, ${opacity})`);
        g.addColorStop(0.85, `rgba(${waveformRgb}, ${opacity})`);
        g.addColorStop(1, `rgba(${waveformRgb}, 0)`);
        return g;
      });

      for (let lineIndex = 0; lineIndex < 3; lineIndex++) {
        ctx.beginPath();
        const step = w / (BARS - 1);
        const maxAmp = h / 2 - 1;
        const points = [];
        for (let i = 0; i < BARS; i++) {
          const phase = i * 0.4 + time * 3.5 + lineIndex * 2;
          const wobble = Math.sin(phase);
          const windowFunc = Math.sin((i / (BARS - 1)) * Math.PI);
          const ampScale = 1.0 - lineIndex * 0.2;
          const rawAmp = Math.max(heights.current[i], 0.12);
          const amp = rawAmp * maxAmp * ampScale * windowFunc * wobble;
          points.push({ x: i * step, y: h / 2 + amp });
        }

        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 2; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        if (points.length > 2) {
          ctx.quadraticCurveTo(
            points[points.length - 2].x, points[points.length - 2].y,
            points[points.length - 1].x, points[points.length - 1].y
          );
        }

        ctx.strokeStyle = gradients[lineIndex];
        ctx.lineWidth = lineIndex === 0 ? 2.0 : lineIndex === 1 ? 1.5 : 1.0;
        if (lineIndex === 0) {
          ctx.shadowColor = `rgba(${waveformRgb}, 0.9)`;
          ctx.shadowBlur = 8;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  if (phase === "idle") return null;

  return (
    <div className="w-screen h-screen flex items-center justify-center">
      <div key={entryKey} className={`hud-pill ${phase}${leaving ? " leaving" : ""}`}>
        <div data-tauri-drag-region className="hud-drag-handle">
          <span className={`hud-dot ${phase}`} />
          {phase === "recording" && (
            <canvas ref={canvasRef} className="hud-wave-canvas" style={{ width: 96, height: 26 }} />
          )}
          {phase === "processing" && <span className="hud-label">Transcribing…</span>}
          {phase === "notice" && <span className="hud-label">{status}</span>}
        </div>
        {(phase === "recording" || phase === "processing") && (
          <button className="hud-cancel-btn" onClick={() => cancelDictation().catch(console.error)}>
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </div>
    </div>
  );
}
