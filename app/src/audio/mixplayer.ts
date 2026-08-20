export class MixPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startCtx = 0;
  private startOff = 0;
  private playing = false;
  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
  }

  async load(url: string): Promise<void> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`дорожка не загрузилась: ${resp.status}`);
    this.buffer = await this.ctx.decodeAudioData(await resp.arrayBuffer());
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  pos(): number {
    if (!this.playing) return this.startOff;
    return Math.min(this.duration, this.startOff + this.ctx.currentTime - this.startCtx);
  }

  async play(from?: number): Promise<void> {
    if (!this.buffer) return;
    await this.ctx.resume();
    this.stopSource();
    const off = Math.min(Math.max(0, from ?? this.startOff), Math.max(0, this.duration - 0.01));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.onended = () => {
      if (this.src !== src) return; // остановили вручную
      this.playing = false;
      this.startOff = this.duration;
      this.src = null;
      this.onEnded?.();
    };
    src.start(0, off);
    this.src = src;
    this.startCtx = this.ctx.currentTime;
    this.startOff = off;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.startOff = this.pos();
    this.playing = false;
    this.stopSource();
  }

  seek(t: number): void {
    const clamped = Math.min(Math.max(0, t), this.duration);
    if (this.playing) {
      void this.play(clamped);
    } else {
      this.startOff = clamped;
    }
  }

  private stopSource(): void {
    const src = this.src;
    if (!src) return;
    this.src = null;
    try {
      src.onended = null;
      src.stop();
      src.disconnect();
    } catch {
      /* уже остановлен */
    }
  }

  destroy(): void {
    this.stopSource();
    this.playing = false;
    void this.ctx.close();
  }
}
