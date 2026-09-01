import type { Participant } from "../session/state";
import type { PackMeta, TakeInfo } from "../types";

export function makeParticipant(id: string, over: Partial<Participant> = {}): Participant {
  return { id, name: `Игрок ${id}`, ready: true, connected: true, ...over };
}

export function makePack(over: Partial<PackMeta> = {}): PackMeta {
  return {
    slug: "pack",
    title: "Пак",
    authors: [],
    icon: null,
    cover: null,
    video: "video.mp4",
    videoDuration: 60,
    backing: null,
    characters: [
      { name: "ГЛЕБ", color: "#fff", image: null },
      { name: "МИРА", color: "#fff", image: null }
    ],
    lines: [
      { id: "l1", num: 1, who: "ГЛЕБ", color: "#fff", text: "раз", start: 1, end: 2, orig: "1.wav", image: null },
      { id: "l2", num: 2, who: "МИРА", color: "#fff", text: "два", start: 3, end: 4, orig: "2.wav", image: null }
    ],
    ...over
  };
}

export function makeTake(over: Partial<TakeInfo> = {}): TakeInfo {
  return {
    file: "takes/l1.wav",
    duration: 1,
    recordedAt: 1000,
    takeCount: 1,
    analysis: {
      score: 90,
      verdict: "в точку",
      startOffset: 0.1,
      speechDur: 0.9,
      fill: 0.9,
      overrun: 0
    },
    ...over
  };
}

export function bytesOf(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * seed) % 256;
  return out;
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
