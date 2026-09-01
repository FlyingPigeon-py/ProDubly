import type { PackLine } from "../types";

export interface TakeAnalysis {
  score: number;
  verdict: "в точку" | "поздно" | "коротко" | "за окном" | "тишина";
  startOffset: number;
  speechDur: number;
  fill: number;
  overrun: number;
}

const VERDICT_LABEL: Record<TakeAnalysis["verdict"], string> = {
  "в точку": "в точку",
  "поздно": "поздно",
  "коротко": "коротко",
  "за окном": "длинно",
  "тишина": "тишина"
};

export function verdictLabel(v: TakeAnalysis["verdict"]): string {
  return VERDICT_LABEL[v] ?? v;
}

export function verdictColor(v: TakeAnalysis["verdict"]): string {
  if (v === "в точку") return "var(--green)";
  if (v === "тишина") return "var(--red)";
  return "var(--amber)";
}

// Запись стартует ровно в line.start, поэтому время в семплах = время от начала окна реплики.
export function analyzeTake(samples: Float32Array, rate: number, line: PackLine): TakeAnalysis {
  const win = line.end - line.start;
  const frame = Math.round(rate * 0.01);
  const nFrames = Math.floor(samples.length / frame);

  const rmsArr = new Float32Array(nFrames);
  let maxRms = 0;
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    const off = f * frame;
    for (let i = 0; i < frame; i++) sum += samples[off + i] * samples[off + i];
    const r = Math.sqrt(sum / frame);
    rmsArr[f] = r;
    if (r > maxRms) maxRms = r;
  }

  const th = Math.max(0.012, maxRms * 0.18);
  let first = -1;
  let last = -1;
  let voicedInWin = 0;
  for (let f = 0; f < nFrames; f++) {
    if (rmsArr[f] > th) {
      const t = f * 0.01;
      if (first < 0) first = t;
      last = t + 0.01;
      if (t < win) voicedInWin += 0.01;
    }
  }

  if (first < 0 || last - first < 0.08) {
    return { score: 0, verdict: "тишина", startOffset: 0, speechDur: 0, fill: 0, overrun: 0 };
  }

  const startOffset = first;
  const speechDur = last - first;
  const fill = Math.min(1, voicedInWin / Math.max(0.2, win));
  const overrun = Math.max(0, last - win);

  let score = 100;
  if (startOffset > 0.15) score -= Math.min(45, (startOffset - 0.15) * 130);
  score -= Math.min(35, overrun * 90);
  if (fill < 0.55) score -= Math.min(40, (0.55 - fill) * 90);
  score = Math.max(1, Math.round(score));

  let verdict: TakeAnalysis["verdict"] = "в точку";
  if (overrun > 0.3) verdict = "за окном";
  else if (startOffset > 0.3) verdict = "поздно";
  else if (fill < 0.5) verdict = "коротко";

  return { score, verdict, startOffset, speechDur, fill, overrun };
}
