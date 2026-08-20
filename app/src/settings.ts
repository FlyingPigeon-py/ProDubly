export interface AppSettings {
  micId: string | null;
  gain: number;
  dsp: boolean;
  lead: number;
  tail: number;
  ticks: boolean;
  backingGain: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  micId: null,
  gain: 1,
  dsp: false,
  lead: 2.1,
  tail: 0.5,
  ticks: true,
  backingGain: 0.85
};

const KEY = "dubl.settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
