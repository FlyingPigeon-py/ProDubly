import type { PackLine, PackMeta, TranslationMap } from "./types";

export const CONTEXT_LIMIT = 8000;

export function pendingLines(meta: PackMeta, done: TranslationMap): PackLine[] {
  return meta.lines.filter((l) => l.text.trim().length > 0 && !done[l.id]);
}

export function buildContext(meta: PackMeta): string {
  const head = `Scene: ${meta.title}.`;
  const body = meta.lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => `${l.who}: ${l.text}`)
    .join("\n");
  const full = `${head}\n${body}`;
  return full.length <= CONTEXT_LIMIT ? full : full.slice(0, CONTEXT_LIMIT);
}

export function mergeTranslation(done: TranslationMap, lines: PackLine[], translated: string[]): TranslationMap {
  const merged = { ...done };
  lines.forEach((line, i) => {
    const text = translated[i]?.trim();
    if (text) merged[line.id] = text;
  });
  return merged;
}

export function displayText(line: PackLine, translation: TranslationMap, showTranslation: boolean): string {
  if (!showTranslation) return line.text;
  return translation[line.id] || line.text;
}
