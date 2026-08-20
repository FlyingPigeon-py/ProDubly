export interface WaveBins {
  peak: Float32Array;
  rms: Float32Array;
  sumsq: Float64Array;
  count: Uint32Array;
  max: number;
}

export function emptyBins(n: number): WaveBins {
  return {
    peak: new Float32Array(n),
    rms: new Float32Array(n),
    sumsq: new Float64Array(n),
    count: new Uint32Array(n),
    max: 0
  };
}

export function accumulate(
  bins: WaveBins,
  chunk: Float32Array,
  startSample: number,
  rate: number,
  lineStart: number,
  winFrom: number,
  winDur: number
): void {
  const n = bins.peak.length;
  const binsPerSec = n / winDur;
  for (let i = 0; i < chunk.length; i++) {
    const t = lineStart + (startSample + i) / rate - winFrom;
    const b = Math.floor(t * binsPerSec);
    if (b < 0 || b >= n) continue;
    const s = chunk[i];
    const a = Math.abs(s);
    if (a > bins.peak[b]) bins.peak[b] = a;
    bins.sumsq[b] += s * s;
    bins.count[b]++;
    bins.rms[b] = Math.sqrt(bins.sumsq[b] / bins.count[b]);
    if (a > bins.max) bins.max = a;
  }
}

export function binsFromSamples(
  samples: Float32Array,
  rate: number,
  lineStart: number,
  winFrom: number,
  winDur: number,
  n: number
): WaveBins {
  const bins = emptyBins(n);
  accumulate(bins, samples, 0, rate, lineStart, winFrom, winDur);
  return bins;
}
