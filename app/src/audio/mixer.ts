import { encodeWav16 } from "./wav";

export interface MixTake {
  start: number;
  url: string;
  gain?: number;
}

async function decodeInto(ctx: OfflineAudioContext, url: string): Promise<AudioBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`не смог загрузить ${url}: ${resp.status}`);
  return await ctx.decodeAudioData(await resp.arrayBuffer());
}

export async function renderMix(opts: {
  duration: number;
  backingUrl: string | null;
  backingGain: number;
  takes: MixTake[];
}): Promise<Uint8Array> {
  const rate = 48000;
  const length = Math.max(1, Math.ceil(opts.duration * rate));
  const ctx = new OfflineAudioContext(2, length, rate);

  if (opts.backingUrl) {
    const backing = await decodeInto(ctx, opts.backingUrl);
    const src = ctx.createBufferSource();
    src.buffer = backing;
    const gain = ctx.createGain();
    gain.gain.value = opts.backingGain;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
  }

  for (const take of opts.takes) {
    const buf = await decodeInto(ctx, take.url);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const g = take.gain ?? 1;
    const at = Math.max(0, take.start);
    const end = at + buf.duration;
    // микро-фейды по краям, чтобы стыки не щёлкали
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(g, at + 0.01);
    gain.gain.setValueAtTime(g, Math.max(at + 0.01, end - 0.015));
    gain.gain.linearRampToValueAtTime(0, end);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(at);
  }

  const rendered = await ctx.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return encodeWav16([left, right], rate);
}
