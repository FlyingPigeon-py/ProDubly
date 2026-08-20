export interface IndexPack {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  modType: string;
  creator: string;
  thumbnail: string;
  tags: string[];
  language: string;
  fileSize: string;
  mature: boolean;
  summaryValue: string;
  updatedAt: string;
}

export interface ImportReport {
  video: string;
  video_duration: number;
  backing: string | null;
  icon: string | null;
  cover: string | null;
  pack_info: string;
  lines: {
    base: string;
    audio: string;
    duration: number;
    image: string | null;
    meta: string;
  }[];
}

export interface PackLine {
  id: string;
  num: number;
  who: string;
  color: string;
  text: string;
  start: number;
  end: number;
  orig: string;
  image: string | null;
}

export interface PackCharacter {
  name: string;
  color: string;
  image: string | null;
}

export interface PackMeta {
  slug: string;
  title: string;
  authors: string[];
  icon: string | null;
  cover: string | null;
  video: string;
  videoDuration: number;
  backing: string | null;
  characters: PackCharacter[];
  lines: PackLine[];
}

export interface TakeInfo {
  file: string;
  duration: number;
  recordedAt: number;
  takeCount?: number;
  analysis?: {
    score: number;
    verdict: "в точку" | "поздно" | "коротко" | "за окном" | "тишина";
    startOffset: number;
    speechDur: number;
    fill: number;
    overrun: number;
  };
}

export type TakesMap = Record<string, TakeInfo>;

export interface DownloadProgress {
  slug: string;
  received: number;
  total: number;
}

export interface ImportProgressEvent {
  slug: string;
  step: string;
  done: number;
  total: number;
}
