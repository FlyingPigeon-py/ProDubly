import { describe, expect, it } from "vitest";
import { CONTEXT_LIMIT, buildContext, displayText, mergeTranslation, pendingLines } from "./translate";
import type { PackLine, PackMeta } from "./types";

function line(over: Partial<PackLine> = {}): PackLine {
  return {
    id: "01_James",
    num: 1,
    who: "James",
    color: "",
    text: "Mary...?",
    start: 7.578,
    end: 9.1,
    orig: "lines/01_James.m4a",
    image: null,
    ...over
  };
}

function meta(lines: PackLine[]): PackMeta {
  return {
    slug: "sh2",
    title: "Silent Hill 2",
    authors: [],
    icon: null,
    cover: null,
    video: "video.mp4",
    videoDuration: 125.61,
    backing: null,
    characters: [],
    lines
  };
}

describe("pendingLines", () => {
  it("отдаёт реплики, которых ещё нет в переводе", () => {
    const packMeta = meta([line({ id: "a" }), line({ id: "b" })]);

    const pending = pendingLines(packMeta, { a: "Мэри?" });

    expect(pending.map((l) => l.id)).toEqual(["b"]);
  });

  it("пропускает реплики без текста", () => {
    const packMeta = meta([line({ id: "a", text: "   " }), line({ id: "b" })]);

    const pending = pendingLines(packMeta, {});

    expect(pending.map((l) => l.id)).toEqual(["b"]);
  });

  it("отдаёт пустой список, когда всё переведено", () => {
    const packMeta = meta([line({ id: "a" })]);

    expect(pendingLines(packMeta, { a: "Мэри?" })).toEqual([]);
  });
});

describe("buildContext", () => {
  it("собирает сцену с именами персонажей и репликами", () => {
    const packMeta = meta([line({ who: "James", text: "Mary...?" }), line({ id: "b", who: "Maria", text: "James..." })]);

    expect(buildContext(packMeta)).toBe("Scene: Silent Hill 2.\nJames: Mary...?\nMaria: James...");
  });

  it("обрезает контекст до предельной длины", () => {
    const many = Array.from({ length: 2000 }, (_, i) => line({ id: `l${i}`, text: "a".repeat(20) }));

    expect(buildContext(meta(many)).length).toBe(CONTEXT_LIMIT);
  });
});

describe("mergeTranslation", () => {
  it("складывает новые переводы к уже готовым", () => {
    const merged = mergeTranslation({ a: "Мэри?" }, [line({ id: "b" })], ["Джеймс..."]);

    expect(merged).toEqual({ a: "Мэри?", b: "Джеймс..." });
  });

  it("пропускает пустые ответы сервиса", () => {
    const merged = mergeTranslation({}, [line({ id: "a" }), line({ id: "b" })], ["  ", "Джеймс..."]);

    expect(merged).toEqual({ b: "Джеймс..." });
  });
});

describe("displayText", () => {
  it("показывает перевод, когда он включён и существует", () => {
    expect(displayText(line({ id: "a" }), { a: "Мэри?" }, true)).toBe("Мэри?");
  });

  it("показывает оригинал, когда перевод выключен", () => {
    expect(displayText(line({ id: "a" }), { a: "Мэри?" }, false)).toBe("Mary...?");
  });

  it("показывает оригинал, когда перевода для реплики нет", () => {
    expect(displayText(line({ id: "a" }), {}, true)).toBe("Mary...?");
  });
});
