import { concatFloat32, encodeWav16 } from "./wav";

export interface RecorderResult {
  wav: Uint8Array;
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

export interface RecorderOptions {
  deviceId?: string | null;
  dsp?: boolean;
  gain?: number;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private recording = false;
  onChunk: ((chunk: Float32Array, startSample: number) => void) | null = null;

  async init(opts?: RecorderOptions): Promise<void> {
    if (this.ctx) return;
    const dsp = opts?.dsp ?? false;
    const base: MediaTrackConstraints = {
      echoCancellation: dsp,
      noiseSuppression: dsp,
      autoGainControl: dsp
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: opts?.deviceId ? { ...base, deviceId: { exact: opts.deviceId } } : base
      });
    } catch {
      // выбранное устройство могло пропасть — падаем на дефолтное
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: base });
    }
    // без принудительных 48к: ресемплинг микрофонного потока в WebKit трещит,
    // пишем на нативной частоте устройства, частота уходит в WAV-заголовок
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = opts?.gain ?? 1;
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.recording) return;
      const data = e.data;
      const start = this.totalSamples;
      this.chunks.push(data);
      this.totalSamples += data.length;
      this.onChunk?.(data, start);
    };
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.node);
    // worklet должен быть подключён к графу, но звук в колонки не отдаём
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  async start(): Promise<void> {
    await this.init();
    await this.ctx!.resume();
    this.chunks = [];
    this.totalSamples = 0;
    this.recording = true;
  }

  stop(): RecorderResult {
    this.recording = false;
    const samples = concatFloat32(this.chunks);
    this.chunks = [];
    const rate = this.sampleRate;
    return {
      wav: encodeWav16([samples], rate),
      samples,
      sampleRate: rate,
      duration: samples.length / rate
    };
  }

  destroy(): void {
    this.recording = false;
    this.node?.disconnect();
    this.gainNode?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}
