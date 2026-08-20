import type { ImportReport, PackCharacter, PackLine, PackMeta } from "./types";

export function parseIniData(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("[") || line.startsWith(";") || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = parseValue(value);
  }
  return out;
}

function parseValue(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    // одиночные кавычки или голое значение
    if (v.startsWith("[") && v.endsWith("]")) {
      return v
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    }
    return stripQuotes(v);
  }
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

const PALETTE = [
  "oklch(0.80 0.13 210)",
  "oklch(0.80 0.13 85)",
  "oklch(0.80 0.13 330)",
  "oklch(0.80 0.13 145)",
  "oklch(0.75 0.14 55)",
  "oklch(0.78 0.12 275)"
];

function cleanCaption(s: string): string {
  const t = s.trim();
  const pairs: [string, string][] = [
    ["“", "”"],
    ['"', '"'],
    ["«", "»"]
  ];
  for (const [a, b] of pairs) {
    if (t.startsWith(a) && t.endsWith(b) && t.length >= 2) return t.slice(1, -1).trim();
  }
  return t;
}

export function buildPackMeta(slug: string, report: ImportReport, fallbackTitle?: string): PackMeta {
  const info = parseIniData(report.pack_info);

  const lines: PackLine[] = [];
  for (const entry of report.lines) {
    const meta = parseIniData(entry.meta);
    const stamps = meta["dub_timestamps"];
    const start =
      Array.isArray(stamps) && stamps.length > 0 ? Number(stamps[0]) : NaN;
    if (!Number.isFinite(start)) continue;

    const chars = meta["dub_characters"];
    const who =
      Array.isArray(chars) && chars.length > 0
        ? String(chars[0])
        : entry.base.replace(/^\d+[_\-\s]*/, "") || "—";

    const caption = typeof meta["caption"] === "string" ? cleanCaption(meta["caption"] as string) : "";
    const numMatch = entry.base.match(/^(\d+)/);

    lines.push({
      id: entry.base,
      num: numMatch ? parseInt(numMatch[1], 10) : lines.length + 1,
      who,
      color: "",
      text: caption,
      start,
      end: Math.min(start + entry.duration, report.video_duration),
      orig: entry.audio,
      image: entry.image
    });
  }
  lines.sort((a, b) => a.start - b.start);

  const characters: PackCharacter[] = [];
  for (const line of lines) {
    let ch = characters.find((c) => c.name === line.who);
    if (!ch) {
      ch = {
        name: line.who,
        color: PALETTE[characters.length % PALETTE.length],
        image: line.image
      };
      characters.push(ch);
    }
    line.color = ch.color;
  }

  const authors = info["authors"];
  return {
    slug,
    title: typeof info["title"] === "string" && info["title"] ? (info["title"] as string) : fallbackTitle ?? slug,
    authors: Array.isArray(authors) ? authors.map(String) : [],
    icon: report.icon,
    cover: report.cover,
    video: report.video,
    videoDuration: report.video_duration,
    backing: report.backing,
    characters,
    lines
  };
}
