import type { DubInfo, PackMeta, TakesMap } from "../types";

export interface ParticipantSummary {
  id: string;
  name: string;
  characters: string[];
  lines: number;
  recorded: number;
  averageScore: number;
  averageMiss: number;
}

export function participantSummaries(meta: PackMeta, takes: TakesMap, dub: DubInfo): ParticipantSummary[] {
  return dub.participants
    .map((p) => {
      const characters = Object.entries(dub.roles)
        .filter(([, owner]) => owner === p.id)
        .map(([character]) => character);
      const lines = meta.lines.filter((l) => characters.includes(l.who));
      const scored = lines
        .map((l) => takes[l.id]?.analysis)
        .filter((a): a is NonNullable<typeof a> => Boolean(a));
      const average = (pick: (a: (typeof scored)[number]) => number) =>
        scored.length === 0 ? 0 : scored.reduce((sum, a) => sum + pick(a), 0) / scored.length;
      return {
        id: p.id,
        name: p.name,
        characters,
        lines: lines.length,
        recorded: scored.length,
        averageScore: Math.round(average((a) => a.score)),
        averageMiss: Number(average((a) => Math.abs(a.startOffset)).toFixed(2))
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore);
}

export function takeAuthorName(dub: DubInfo, authorId: string | undefined): string | null {
  if (!authorId) return null;
  return dub.participants.find((p) => p.id === authorId)?.name ?? null;
}
