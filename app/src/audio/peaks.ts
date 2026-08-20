let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export async function decodeUrl(url: string): Promise<AudioBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`не смог загрузить аудио: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return await ctx().decodeAudioData(buf);
}
