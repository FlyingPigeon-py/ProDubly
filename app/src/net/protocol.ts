import type { Participant, SessionCommand, SessionState } from "../session/state";
import type { PackMeta, TakeInfo } from "../types";

export const PROTOCOL_VERSION = 1;

export interface TakeHeader {
  kind: "take";
  lineId: string;
  authorId: string;
  take: TakeInfo;
}

export type NetMessage =
  | { t: "hello"; version: number; participant: Participant; packSlug: string; linesHash: string }
  | { t: "state"; state: SessionState }
  | { t: "cmd"; cmd: SessionCommand }
  | { t: "request-takes"; lineIds: string[] }
  | { t: "error"; message: string };

export function linesHash(meta: PackMeta): string {
  const source = meta.lines.map((l) => `${l.id}:${l.start.toFixed(3)}:${l.end.toFixed(3)}:${l.who}`).join("|");
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function roomCode(): string {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXYZ2345679";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
