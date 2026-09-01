import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, packDuration, packLineCount, packSizeMb, selectPacks } from "./catalog";
import type { IndexPack } from "./types";

function pack(over: Partial<IndexPack> = {}): IndexPack {
  return {
    id: "id",
    slug: "slug",
    title: "Ссора в лифте",
    shortDescription: "пак сообщества",
    searchText: "ссора в лифте rina.k пак сообщества",
    modType: "dub-pack",
    creator: "rina.k",
    sourceName: "GameBanana",
    installFolder: "slug",
    hostingStatus: "self-hosted-authorized",
    thumbnail: "",
    tags: [],
    language: "English",
    fileSize: "12 MB",
    mature: false,
    verified: false,
    featured: false,
    trending: false,
    summaryLabel: "Video",
    summaryValue: "0:36 - 14 dub clips",
    createdAt: "2026-07-01",
    updatedAt: "2026-08-01",
    ...over
  };
}

describe("packDuration", () => {
  it("читает длительность из формата с минутами и секундами", () => {
    expect(packDuration("1:21 - 16 dub clips")).toBe(81);
  });

  it("возвращает null, когда длительности в строке нет", () => {
    expect(packDuration("8 dub clips")).toBe(null);
  });
});

describe("packLineCount", () => {
  it("читает число реплик", () => {
    expect(packLineCount("0:36 - 14 dub clips")).toBe(14);
  });

  it("читает число реплик без длительности", () => {
    expect(packLineCount("8 dub clips")).toBe(8);
  });
});

describe("packSizeMb", () => {
  it.each([
    ["112 MB", 112],
    ["512 KB", 0.5],
    ["2 GB", 2048]
  ])("переводит %s в мегабайты", (input, expected) => {
    expect(packSizeMb(input)).toBe(expected);
  });
});

describe("selectPacks", () => {
  it("ищет по всему каталогу, а не по началу списка", () => {
    const all = [pack({ slug: "a", searchText: "ночное такси" }), pack({ slug: "b", searchText: "монолог на кухне" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, q: "кухне" });

    expect(found.map((p) => p.slug)).toEqual(["b"]);
  });

  it("требует совпадения всех слов запроса", () => {
    const all = [pack({ slug: "a", searchText: "ночное такси" }), pack({ slug: "b", searchText: "ночной монолог" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, q: "ночное такси" });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });

  it("не различает е и ё", () => {
    const all = [pack({ slug: "a", searchText: "чёрный рыцарь" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, q: "черный" });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });

  it("прячет 18+ по умолчанию", () => {
    const all = [pack({ slug: "a", mature: true }), pack({ slug: "b" })];

    const found = selectPacks(all, DEFAULT_FILTERS);

    expect(found.map((p) => p.slug)).toEqual(["b"]);
  });

  it("оставляет только трендовые паки", () => {
    const all = [pack({ slug: "a", trending: true }), pack({ slug: "b", trending: false })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, trendingOnly: true });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });

  it("оставляет только заявки авторов", () => {
    const all = [pack({ slug: "a", sourceName: "Creator Submission" }), pack({ slug: "b", sourceName: "GameBanana" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, creatorsOnly: true });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });

  it("отсекает ролики длиннее порога", () => {
    const all = [pack({ slug: "a", summaryValue: "0:25 - 2 dub clips" }), pack({ slug: "b", summaryValue: "1:21 - 9 dub clips" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, maxDuration: 30 });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });

  it("прячет паки без длительности, когда фильтр по длительности включён", () => {
    const all = [pack({ slug: "a", summaryValue: "8 dub clips" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, maxDuration: 60 });

    expect(found).toEqual([]);
  });

  it("отсекает паки с числом реплик больше порога", () => {
    const all = [pack({ slug: "a", summaryValue: "0:36 - 14 dub clips" }), pack({ slug: "b", summaryValue: "0:20 - 4 dub clips" })];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, maxLines: 5 });

    expect(found.map((p) => p.slug)).toEqual(["b"]);
  });

  it("сортирует по свежести обновления", () => {
    const all = [pack({ slug: "a", updatedAt: "2026-08-01" }), pack({ slug: "b", updatedAt: "2026-08-14" })];

    const found = selectPacks(all, DEFAULT_FILTERS);

    expect(found.map((p) => p.slug)).toEqual(["b", "a"]);
  });

  it("сортирует по размеру с учётом единиц измерения", () => {
    const all = [
      pack({ slug: "gb", fileSize: "1 GB" }),
      pack({ slug: "kb", fileSize: "900 KB" }),
      pack({ slug: "mb", fileSize: "40 MB" })
    ];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, sort: "small" });

    expect(found.map((p) => p.slug)).toEqual(["kb", "mb", "gb"]);
  });

  it("совмещает фильтры с поиском", () => {
    const all = [
      pack({ slug: "a", searchText: "ночное такси", trending: true, summaryValue: "0:20 - 3 dub clips" }),
      pack({ slug: "b", searchText: "ночное такси", trending: false, summaryValue: "0:20 - 3 dub clips" }),
      pack({ slug: "c", searchText: "ночное такси", trending: true, summaryValue: "2:14 - 18 dub clips" })
    ];

    const found = selectPacks(all, { ...DEFAULT_FILTERS, q: "такси", trendingOnly: true, maxDuration: 30 });

    expect(found.map((p) => p.slug)).toEqual(["a"]);
  });
});
