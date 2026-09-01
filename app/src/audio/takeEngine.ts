import { Recorder } from "./recorder";
import { accumulate, binsFromSamples, emptyBins, type WaveBins } from "./bins";
import { encodeWav16 } from "./wav";
import { analyzeTake, type TakeAnalysis } from "./score";
import type { AppSettings } from "../settings";
import type { PackLine } from "../types";

export type TakePhase = "orig" | "idle" | "lead" | "rec" | "done" | "take";

export interface LineWindow {
  from: number;
  to: number;
  dur: number;
  lineFrom: number;
  lineTo: number;
}

export interface TakeResult {
  wav: Uint8Array;
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  analysis: TakeAnalysis;
}

export interface TakeEngineHooks {
  onPhase: (phase: TakePhase) => void;
  onTakeReady: (take: TakeResult) => void;
  onLeadCount: (n: number) => void;
  onPlayhead: (pos: number | null) => void;
  onRecBins: (bins: WaveBins | null) => void;
  onError: (message: string) => void;
}

export interface TakeEngineDeps {
  video: () => HTMLVideoElement | null;
  audio: () => HTMLAudioElement | null;
  settings: () => AppSettings;
  bars: number;
  hooks: TakeEngineHooks;
}

export function lineWindow(line: PackLine | null, lead: number): LineWindow {
  if (!line) return { from: 0, to: 1, dur: 1, lineFrom: 0, lineTo: 1 };
  const dur = line.end - line.start;
  const from = Math.max(0, line.start - lead - 0.2);
  const to = line.end + Math.max(0.4, dur * 0.15);
  return {
    from,
    to,
    dur: to - from,
    lineFrom: (line.start - from) / (to - from),
    lineTo: (line.end - from) / (to - from)
  };
}

export class TakeEngine {
  private deps: TakeEngineDeps;
  private recorder: Recorder | null = null;
  private timers: number[] = [];
  private raf = 0;
  private clock = { samples: 0, rate: 48000 };
  private recActive = false;
  private correcting = 0;
  private line: PackLine | null = null;
  private win: LineWindow = lineWindow(null, 0);
  private currentPhase: TakePhase = "idle";
  private bins: WaveBins | null = null;

  constructor(deps: TakeEngineDeps) {
    this.deps = deps;
  }

  get phase(): TakePhase {
    return this.currentPhase;
  }

  get window(): LineWindow {
    return this.win;
  }

  get recording(): boolean {
    return this.recActive;
  }

  setLine(line: PackLine | null): void {
    this.line = line;
    this.win = lineWindow(line, this.deps.settings().lead);
  }

  resetRecorder(): void {
    this.recorder?.destroy();
    this.recorder = null;
  }

  livePlayhead(): number | null {
    if (!this.recActive || !this.line) return null;
    return (this.line.start + this.clock.samples / this.clock.rate - this.win.from) / this.win.dur;
  }

  private setPhase(phase: TakePhase): void {
    this.currentPhase = phase;
    this.deps.hooks.onPhase(phase);
  }

  private clearTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    cancelAnimationFrame(this.raf);
  }

  stop(): void {
    this.clearTimers();
    const v = this.deps.video();
    const a = this.deps.audio();
    if (v) v.pause();
    if (a) {
      a.pause();
      a.onended = null;
    }
    this.deps.hooks.onPlayhead(null);
  }

  showFrame(): void {
    this.stop();
    this.setPhase("idle");
    const v = this.deps.video();
    if (v && this.line) {
      v.pause();
      v.currentTime = this.line.start;
    }
  }

  private trackPlayhead(): void {
    const step = () => {
      const v = this.deps.video();
      const line = this.line;
      if (v && line) {
        let t: number;
        if (this.recActive) {
          t = line.start + this.clock.samples / this.clock.rate;
          const drift = v.currentTime - t;
          // гистерезис вместо перекрута скорости каждый кадр — иначе видео дрожит
          if (Math.abs(drift) > 0.25) {
            v.currentTime = t;
            v.playbackRate = 1;
            this.correcting = 0;
          } else if (this.correcting === 0) {
            if (drift > 0.05) {
              v.playbackRate = 0.96;
              this.correcting = -1;
            } else if (drift < -0.05) {
              v.playbackRate = 1.04;
              this.correcting = 1;
            }
          } else if ((this.correcting === -1 && drift < 0.01) || (this.correcting === 1 && drift > -0.01)) {
            v.playbackRate = 1;
            this.correcting = 0;
          }
        } else {
          if (v.playbackRate !== 1) v.playbackRate = 1;
          t = v.currentTime;
        }
        this.deps.hooks.onPlayhead(Math.min(1, Math.max(0, (t - this.win.from) / this.win.dur)));
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  playOrig(url: string): void {
    const line = this.line;
    if (!line) return;
    this.stop();
    this.setPhase("orig");
    const v = this.deps.video()!;
    const a = this.deps.audio()!;
    v.muted = true;
    v.currentTime = line.start;
    a.src = url;
    a.currentTime = 0;
    v.play().catch(() => {});
    a.play().catch(() => {
      v.pause();
      if (this.currentPhase === "orig") this.setPhase("idle");
    });
    a.onended = () => {
      v.pause();
      if (this.currentPhase === "orig") this.setPhase("idle");
    };
    this.trackPlayhead();
  }

  playTake(url: string): void {
    const line = this.line;
    if (!line) return;
    this.stop();
    this.setPhase("take");
    const v = this.deps.video()!;
    const a = this.deps.audio()!;
    v.muted = true;
    v.currentTime = line.start;
    a.src = url;
    a.currentTime = 0;
    Promise.all([v.play(), a.play()]).catch(() => {});
    a.onended = () => {
      v.pause();
      if (this.currentPhase === "take") this.setPhase("done");
    };
    this.trackPlayhead();
  }

  watchOthers(): void {
    const line = this.line;
    if (!line) return;
    this.stop();
    this.setPhase("orig");
    const v = this.deps.video();
    if (!v) return;
    v.muted = true;
    v.currentTime = Math.max(0, line.start - this.deps.settings().lead);
    v.play().catch(() => {});
    this.trackPlayhead();
    this.timers.push(
      window.setTimeout(
        () => {
          v.pause();
          if (this.currentPhase === "orig") this.setPhase("idle");
        },
        (line.end - line.start + this.deps.settings().lead) * 1000
      )
    );
  }

  async startRec(onBeep?: (freq: number) => void): Promise<void> {
    const line = this.line;
    if (!line) return;
    const s = this.deps.settings();
    this.stop();
    try {
      if (!this.recorder) this.recorder = new Recorder();
      await this.recorder.init({ deviceId: s.micId, dsp: s.dsp, gain: s.gain });
    } catch (e) {
      this.deps.hooks.onError(`Микрофон недоступен: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    this.setPhase("lead");
    const v = this.deps.video()!;
    v.muted = true;
    v.currentTime = Math.max(0, line.start - s.lead);
    v.play().catch(() => {});
    this.trackPlayhead();
    const tick = s.lead / 3;
    for (let i = 0; i < 3; i++) {
      this.timers.push(
        window.setTimeout(() => {
          this.deps.hooks.onLeadCount(3 - i);
          if (s.ticks) onBeep?.(i === 2 ? 880 : 660);
        }, i * tick * 1000)
      );
    }

    const rec = this.recorder!;
    const bins = emptyBins(this.deps.bars);
    this.bins = bins;
    this.deps.hooks.onRecBins(bins);
    const w = this.win;
    rec.onChunk = (chunk, startSample) => {
      this.clock.samples = startSample + chunk.length;
      this.clock.rate = rec.sampleRate;
      accumulate(bins, chunk, startSample, rec.sampleRate, line.start, w.from, w.dur);
    };
    let began = false;
    const begin = async () => {
      if (began) return;
      began = true;
      this.clock = { samples: 0, rate: rec.sampleRate };
      this.correcting = 0;
      await rec.start();
      this.recActive = true;
      this.setPhase("rec");
      this.timers.push(window.setTimeout(() => void this.stopRec(), (line.end - line.start) * 1000));
    };
    const watcher = window.setInterval(() => {
      const vv = this.deps.video();
      if (!vv) return;
      if (vv.currentTime >= line.start - 0.005) {
        window.clearInterval(watcher);
        void begin();
      }
    }, 8);
    this.timers.push(watcher);
    this.timers.push(
      window.setTimeout(() => {
        window.clearInterval(watcher);
        void begin();
      }, s.lead * 1000 + 1500)
    );
  }

  async stopRec(): Promise<TakeResult | null> {
    const line = this.line;
    if (this.currentPhase !== "rec" || !line) return null;
    this.recActive = false;
    this.setPhase("done");
    this.stop();
    const rec = this.recorder!;
    rec.onChunk = null;
    const result = rec.stop();
    const maxSamples = Math.round((line.end - line.start) * result.sampleRate);
    const samples =
      result.samples.length > maxSamples ? result.samples.subarray(0, maxSamples) : result.samples;
    const wav = samples === result.samples ? result.wav : encodeWav16([samples], result.sampleRate);
    const analysis = analyzeTake(samples, result.sampleRate, line);
    this.bins = binsFromSamples(samples, result.sampleRate, line.start, this.win.from, this.win.dur, this.deps.bars);
    this.deps.hooks.onRecBins(this.bins);
    const take: TakeResult = {
      wav,
      samples,
      sampleRate: result.sampleRate,
      duration: samples.length / result.sampleRate,
      analysis
    };
    this.deps.hooks.onTakeReady(take);
    return take;
  }

  setPhaseDone(): void {
    this.setPhase("done");
  }

  setPhaseIdle(): void {
    this.setPhase("idle");
  }

  destroy(): void {
    this.stop();
    this.recorder?.destroy();
    this.recorder = null;
  }
}
