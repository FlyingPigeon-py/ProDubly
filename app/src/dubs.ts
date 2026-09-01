import { api } from "./api";
import { isTauri, mockMeta, mockTakes } from "./mock";
import type { DubInfo, TakesMap } from "./types";

export const SOLO_DUB = "solo";

export function dubRel(dubId: string, rel: string): string {
  return `dubs/${dubId}/${rel}`;
}

export function newCoopDubId(): string {
  return `coop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDub(id: string, kind: DubInfo["kind"]): DubInfo {
  const now = Date.now();
  return { id, kind, createdAt: now, updatedAt: now, participants: [], roles: {} };
}

export function dubTitle(dub: DubInfo): string {
  if (dub.kind === "solo") return "Соло";
  const names = dub.participants.map((p) => p.name).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Совместный дубль";
}

export async function listDubs(slug: string): Promise<DubInfo[]> {
  if (!isTauri) return [emptyDub(SOLO_DUB, "solo")];
  await api.migrateDubs(slug).catch(() => false);
  const ids = await api.listDubs(slug);
  const out: DubInfo[] = [];
  for (const id of ids) {
    const dub = await loadDub(slug, id);
    if (dub) out.push(dub);
  }
  out.sort((a, b) => (a.kind === b.kind ? b.createdAt - a.createdAt : a.kind === "solo" ? -1 : 1));
  return out;
}

export async function loadDub(slug: string, dubId: string): Promise<DubInfo | null> {
  if (!isTauri) return emptyDub(dubId, dubId === SOLO_DUB ? "solo" : "coop");
  try {
    return JSON.parse(await api.readText(slug, dubRel(dubId, "dub.json")));
  } catch {
    return null;
  }
}

export async function saveDub(slug: string, dub: DubInfo): Promise<void> {
  if (!isTauri) return;
  await api.writeText(slug, dubRel(dub.id, "dub.json"), JSON.stringify({ ...dub, updatedAt: Date.now() }, null, 2));
}

export async function ensureDub(slug: string, dubId: string, kind: DubInfo["kind"]): Promise<DubInfo> {
  const existing = await loadDub(slug, dubId);
  if (existing) return existing;
  const fresh = emptyDub(dubId, kind);
  await saveDub(slug, fresh);
  return fresh;
}

export async function deleteDub(slug: string, dubId: string): Promise<void> {
  if (!isTauri) return;
  await api.deleteDub(slug, dubId);
}

export async function loadTakes(slug: string, dubId: string): Promise<TakesMap> {
  if (!isTauri) return dubId === SOLO_DUB ? mockTakes(mockMeta(slug)) : {};
  await api.migrateDubs(slug).catch(() => false);
  try {
    return JSON.parse(await api.readText(slug, dubRel(dubId, "takes.json")));
  } catch {
    return {};
  }
}

export async function saveTakes(slug: string, dubId: string, takes: TakesMap): Promise<void> {
  if (!isTauri) return;
  await api.writeText(slug, dubRel(dubId, "takes.json"), JSON.stringify(takes, null, 2));
}

export function doneLineCount(takes: TakesMap, lineIds: string[]): number {
  return lineIds.filter((id) => takes[id]).length;
}
