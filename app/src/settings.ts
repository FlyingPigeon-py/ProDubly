export interface AppSettings {
  micId: string | null;
  gain: number;
  dsp: boolean;
  lead: number;
  tail: number;
  ticks: boolean;
  backingGain: number;
  deeplKey: string;
  showTranslation: boolean;
  playerId: string;
  playerName: string;
  signalingUrl: string;
  turnUrl: string;
  turnUser: string;
  turnPass: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  micId: null,
  gain: 1,
  dsp: false,
  lead: 2.1,
  tail: 0.5,
  ticks: true,
  backingGain: 0.85,
  deeplKey: "",
  showTranslation: true,
  playerId: "",
  playerName: "",
  signalingUrl: "wss://choicervoicer.com/dub-rooms",
  turnUrl: "",
  turnUser: "",
  turnPass: ""
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

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}

export function ensurePlayer(): { id: string; name: string } {
  const s = loadSettings();
  const id = s.playerId || `p-${Math.random().toString(36).slice(2, 10)}`;
  const name = s.playerName || "Игрок";
  if (id !== s.playerId) updateSettings({ playerId: id });
  return { id, name };
}

export const DEFAULT_STUN = [
  "stun:stun.cloudflare.com:3478",
  "stun:global.stun.twilio.com:3478",
  "stun:stun.sipnet.ru:3478"
];

export function iceServers(s: AppSettings): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: DEFAULT_STUN }];
  if (s.turnUrl.trim()) {
    servers.push({ urls: s.turnUrl.trim(), username: s.turnUser, credential: s.turnPass });
  }
  return servers;
}
