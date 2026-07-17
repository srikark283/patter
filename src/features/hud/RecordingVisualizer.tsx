import { useEffect, useRef } from "react";

const BARS = 28;

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
      if (phase !== "recording" && allIdle) return;

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
          const ph = i * 0.4 + time * 3.5 + lineIndex * 2;
          const wobble = Math.sin(ph);
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
  }, [phase, heights, targets]);

  return <canvas ref={canvasRef} className="hud-wave-canvas" style={{ width: 96, height: 26 }} />;
}
