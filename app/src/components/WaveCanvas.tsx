import { useEffect, useRef } from "react";
import type { WaveBins } from "../audio/bins";

const RED = "oklch(0.70 0.21 25)";

export default function WaveCanvas(props: {
  orig: WaveBins | null;
  recRef: React.MutableRefObject<WaveBins | null>;
  recVersion: number;
  live: boolean;
  recColor: string;
  lineFrom: number;
  lineTo: number;
  getLivePlayhead?: () => number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const parent = canvas.parentElement!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cy = h / 2;
    const amp = h * 0.42;

    // ось
    ctx.fillStyle = "#2a2f34";
    ctx.fillRect(0, cy - 0.5, w, 1);

    // оригинал — сглаженный силуэт
    const orig = props.orig;
    if (orig) {
      const n = orig.peak.length;
      const scale = 1 / Math.max(0.06, orig.max);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * w;
        ctx.lineTo(x, cy - Math.max(1, orig.peak[i] * scale * amp));
      }
      ctx.lineTo(w, cy);
      for (let i = n - 1; i >= 0; i--) {
        const x = ((i + 0.5) / n) * w;
        ctx.lineTo(x, cy + Math.max(1, orig.peak[i] * scale * amp));
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(139, 146, 152, 0.26)";
      ctx.fill();
    }

    // дубль — пик (прозрачный) + rms (плотный), красным за окном реплики
    const rec = props.recRef.current;
    if (rec) {
      const n = rec.peak.length;
      const bw = w / n;
      const scale = 1 / Math.max(0.3, rec.max);
      for (let i = 0; i < n; i++) {
        const p = rec.peak[i];
        if (p <= 0.004) continue;
        const frac = (i + 0.5) / n;
        const out = frac < props.lineFrom || frac > props.lineTo;
        const color = out ? RED : props.recColor;
        const x = i * bw + bw * 0.22;
        const ww = Math.max(1, bw * 0.56);

        const ph = Math.max(1.2, p * scale * amp);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.fillRect(x, cy - ph, ww, ph * 2);

        const rh = Math.max(1.2, rec.rms[i] * scale * amp * 1.35);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillRect(x, cy - Math.min(ph, rh), ww, Math.min(ph, rh) * 2);
      }
      ctx.globalAlpha = 1;
    }

    // живая каретка: рисуется тем же проходом, что и глифы — рассинхрон исключён
    if (props.live && props.getLivePlayhead) {
      const frac = props.getLivePlayhead();
      if (frac !== null) {
        const px = Math.min(1, Math.max(0, frac)) * w;
        ctx.fillStyle = RED;
        ctx.fillRect(px - 1, 0, 2, h);
      }
    }
  };

  // статичная перерисовка при смене данных
  useEffect(() => {
    if (!props.live) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.orig, props.recVersion, props.recColor, props.lineFrom, props.lineTo, props.live]);

  // живой цикл во время записи
  useEffect(() => {
    if (!props.live) return;
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.live]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />;
}
