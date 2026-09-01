import type { TakeAnalysis } from "./audio/score";
import type { TakeInfo, TakesMap } from "./types";

const LEGACY_VERDICTS: Record<string, TakeAnalysis["verdict"]> = {
  accurate: "в точку",
  late: "поздно",
  short: "коротко",
  long: "за окном",
  silence: "тишина"
};

function normalizeAnalysis(analysis: Partial<TakeAnalysis> | undefined): TakeAnalysis | undefined {
  if (!analysis) return undefined;
  return {
    score: analysis.score ?? 0,
    verdict: LEGACY_VERDICTS[analysis.verdict as string] ?? analysis.verdict ?? "тишина",
    startOffset: analysis.startOffset ?? 0,
    speechDur: analysis.speechDur ?? 0,
    fill: analysis.fill ?? 0,
    overrun: analysis.overrun ?? 0
  };
}

export function normalizeTake(take: TakeInfo): TakeInfo {
  const analysis = normalizeAnalysis(take.analysis);
  return analysis ? { ...take, duration: take.duration ?? 0, analysis } : { ...take, duration: take.duration ?? 0 };
}

export function normalizeTakes(takes: TakesMap): TakesMap {
  const out: TakesMap = {};
  for (const [id, take] of Object.entries(takes)) out[id] = normalizeTake(take);
  return out;
}
