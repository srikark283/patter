import { useEffect, useRef } from "react";

const SAMPLES = 28;
const STEPS = 64;
const WIDTH = 96;
const HEIGHT = 26;

interface Props {
  phase: "idle" | "recording" | "processing" | "notice";
  targets: React.MutableRefObject<number[]>;
  heights: React.MutableRefObject<number[]>;
}

export default function RecordingVisualizer({ phase, targets, heights }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    const steel = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-steel").trim() || "#5b9bd1";
    const ink = ctx.createLinearGradient(0, 0, WIDTH, 0);
    ink.addColorStop(0, "transparent");
    ink.addColorStop(.15, steel);
    ink.addColorStop(.85, steel);
    ink.addColorStop(1, "transparent");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let lastFrame = 0;
    let flow = 0;
    const centers = new Float32Array(STEPS + 1);
    const widths = new Float32Array(STEPS + 1);

    const tick = (timestamp: number) => {
      raf = requestAnimationFrame(tick);
      const interval = reducedMotion.matches ? 150 : 1000 / 30;
      if (timestamp - lastFrame < interval) return;
      const delta = Math.min(timestamp - lastFrame, 64);
      lastFrame = timestamp;

      let energy = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const target = phase === "recording" ? Math.max(0, Math.min(1, targets.current[i] || 0)) : 0;
        const previous = heights.current[i] || 0;
        const smoothing = 1 - Math.exp(-delta / (target > previous ? 55 : 190));
        const level = reducedMotion.matches ? target : previous + (target - previous) * smoothing;
        heights.current[i] = level;
        energy += level;
      }
      energy /= SAMPLES;
      // The newest sample leads; recent speech gives the ribbon a soft trailing shape.
      const rawStrength = Math.min(1, energy * .55 + heights.current[SAMPLES - 1] * .7);
      const strength = Math.pow(rawStrength, .65);
      const presence = Math.min(1, rawStrength / .12);
      if (!reducedMotion.matches) flow += delta * .002 * strength;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      ctx.lineCap = "round";
      // Fine companion ribbons separate during speech and disappear into the resting line.
      for (let ribbon = 0; ribbon < 4; ribbon++) {
        const offset = (ribbon - 1.5) * .95;
        ctx.globalAlpha = presence * (ribbon === 1 || ribbon === 2 ? .75 : .55);
        ctx.lineWidth = ribbon === 1 || ribbon === 2 ? 1.1 : .85;
        ctx.beginPath();
        for (let point = 0; point <= STEPS; point++) {
          const t = point / STEPS;
          const envelope = Math.sin(Math.PI * t);
          const wave = .8 * Math.sin(t * Math.PI * 2 - flow + offset)
            + .2 * Math.sin(t * Math.PI * 4 - flow * .7 - offset);
          const x = 2 + t * (WIDTH - 4);
          const y = HEIGHT / 2 + envelope * strength * (wave * 7 + offset * 2.2);
          if (point === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = .65 + strength * .35;
      // The thicker foreground ribbon stays the visual anchor.
      for (let point = 0; point <= STEPS; point++) {
        const t = point / STEPS;
        const envelope = Math.sin(Math.PI * t);
        const wave = .8 * Math.sin(t * Math.PI * 2 - flow)
          + .2 * Math.sin(t * Math.PI * 4 - flow * .7);
        centers[point] = HEIGHT / 2 + wave * envelope * strength * 9;
        widths[point] = envelope * (.6 + strength * 1.25);
      }
      ctx.beginPath();
      for (let point = 0; point <= STEPS; point++) {
        const x = 2 + point / STEPS * (WIDTH - 4);
        const y = centers[point] - widths[point];
        if (point === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let point = STEPS; point >= 0; point--) {
        ctx.lineTo(2 + point / STEPS * (WIDTH - 4), centers[point] + widths[point]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const syncVisibility = () => {
      cancelAnimationFrame(raf);
      lastFrame = 0;
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [phase, heights, targets]);

  return <canvas aria-hidden="true" ref={canvasRef} className="hud-wave-canvas" style={{ width: WIDTH, height: HEIGHT }} />;
}
