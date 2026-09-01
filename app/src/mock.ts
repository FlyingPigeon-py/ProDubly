import type { IndexPack, PackMeta, TakesMap } from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

const TITLES = [
  ["Ссора в лифте", "rina.k", "1:45 - 12 dub clips", "74 MB"],
  ["Допрос под дождём", "noirclub", "0:52 - 7 dub clips", "31 MB"],
  ["Прогноз погоды, 1997", "archive.tv", "0:38 - 5 dub clips", "18 MB"],
  ["Ночное такси", "kirsan", "2:14 - 18 dub clips", "141 MB"],
  ["Монолог на кухне", "lera.d", "0:38 - 4 dub clips", "12 MB"],
  ["Чёрный рыцарь", "smirqy", "2:55 - 65 dub clips", "196 MB"],
  ["Гоблет огня", "alir99", "1:24 - 20 dub clips", "171 MB"],
  ["Идеальная победа", "zoqax", "1:36 - 14 dub clips", "36 MB"]
];

export function mockIndex(): IndexPack[] {
  return TITLES.map(([title, creator, summary, size], i) => ({
    id: `mock-${i}`,
    slug: `mock-${i}`,
    title,
    shortDescription: `${title} — пак сообщества.`,
    searchText: `${title} ${creator} пак сообщества`.toLowerCase(),
    modType: "dub-pack",
    creator,
    sourceName: i % 3 === 0 ? "Creator Submission" : "GameBanana",
    installFolder: `mock-${i}`,
    hostingStatus: "self-hosted-authorized",
    thumbnail: `https://picsum.photos/seed/${encodeURIComponent(title)}/640/360`,
    tags: [],
    language: "Russian",
    fileSize: size,
    mature: i === 5,
    verified: false,
    featured: false,
    trending: i % 2 === 0,
    summaryLabel: "Video",
    summaryValue: summary,
    createdAt: `2026-07-${String(14 - i).padStart(2, "0")}`,
    updatedAt: `2026-08-${String(14 - i).padStart(2, "0")}`
  }));
}

const WHO = ["ГЛЕБ", "МИРА", "ДИКТОР", "СОСЕД"];
const COLORS = ["oklch(0.80 0.13 210)", "oklch(0.80 0.13 85)", "oklch(0.80 0.13 330)", "oklch(0.80 0.13 145)"];
const TEXTS = [
  "Осторожно, двери закрываются.",
  "Ты нажала минус первый?",
  "Я нажала то, что ты просил.",
  "Я просил парковку, а не подвал.",
  "Простите, вам на какой?",
  "Да ты вообще слушаешь? Я третий раз говорю.",
  "Я слышу. Мне просто нечего сказать.",
  "Я не про лифт. Я про то, что ты не слышишь.",
  "Технический этаж.",
  "Я, пожалуй, пешком.",
  "Останови на первом.",
  "Хорошо. Как хочешь."
];

export function mockMeta(slug: string): PackMeta {
  const lines = TEXTS.map((text, i) => ({
    id: `${String(i + 1).padStart(2, "0")}_x`,
    num: i + 1,
    who: WHO[i % 4],
    color: COLORS[i % 4],
    text,
    start: 4 + i * 8.6,
    end: 4 + i * 8.6 + 1.6 + (i % 4) * 0.8,
    orig: "",
    image: null
  }));
  return {
    slug,
    title: "Ссора в лифте",
    authors: ["rina.k"],
    icon: null,
    cover: null,
    video: "",
    videoDuration: 108,
    backing: null,
    characters: WHO.map((name, i) => ({ name, color: COLORS[i], image: null })),
    lines
  };
}

export function mockTakes(meta: PackMeta): TakesMap {
  const out: TakesMap = {};
  const verdicts = ["в точку", "в точку", "поздно", "в точку", "коротко", "за окном", "в точку", "тишина"] as const;
  meta.lines.slice(0, 8).forEach((l, i) => {
    out[l.id] = {
      file: "",
      duration: l.end - l.start + 0.3,
      recordedAt: 1000 + i,
      takeCount: 1 + (i % 3),
      analysis: {
        score: [92, 88, 61, 95, 70, 54, 90, 0][i],
        verdict: verdicts[i],
        startOffset: 0.05 + (i % 5) * 0.09,
        speechDur: l.end - l.start,
        fill: [0.9, 0.86, 0.8, 0.94, 0.4, 0.88, 0.9, 0][i],
        overrun: i === 5 ? 0.4 : 0
      }
    };
  });
  return out;
}
