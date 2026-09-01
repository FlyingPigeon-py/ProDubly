import { describe, expect, it } from "vitest";
import { buildPackMeta, parseIniData } from "./ini";
import type { ImportReport } from "./types";

function lineEntry(over: Partial<ImportReport["lines"][number]> = {}): ImportReport["lines"][number] {
  return {
    base: "01_James",
    audio: "lines/01_James.m4a",
    duration: 2,
    image: null,
    meta: '[data]\ncaption="“Mary...?”"\ndub_timestamps=[7.578]\ndub_characters=["James"]',
    ...over
  };
}

function report(over: Partial<ImportReport> = {}): ImportReport {
  return {
    video: "video.mp4",
    video_duration: 125.61,
    backing: null,
    icon: null,
    cover: null,
    pack_info: '[data]\ntitle="Silent Hill 2"\nauthors=["Hollyfrogg"]',
    lines: [lineEntry()],
    ...over
  };
}

describe("parseIniData", () => {
  it("читает строки, списки и числа", () => {
    const data = parseIniData('[data]\ncaption="привет"\ndub_timestamps=[7.578]\ndub_characters=["James"]');

    expect(data).toEqual({ caption: "привет", dub_timestamps: [7.578], dub_characters: ["James"] });
  });

  it("возвращает пустой объект на пустом файле", () => {
    expect(parseIniData("")).toEqual({});
  });
});

describe("buildPackMeta без _pack_info.ini", () => {
  it("берёт название из каталога", () => {
    const meta = buildPackMeta("sh2", report({ pack_info: "" }), "Silent Hill 2 - Maria ending");

    expect(meta.title).toBe("Silent Hill 2 - Maria ending");
  });

  it("берёт автора из каталога", () => {
    const meta = buildPackMeta("sh2", report({ pack_info: "" }), "Silent Hill 2", "Hollyfrogg");

    expect(meta.authors).toEqual(["Hollyfrogg"]);
  });

  it("оставляет реплики на месте", () => {
    const meta = buildPackMeta("sh2", report({ pack_info: "" }), "Silent Hill 2");

    expect(meta.lines).toHaveLength(1);
  });

  it("падает на слаг, когда названия нет ниоткуда", () => {
    const meta = buildPackMeta("sh2", report({ pack_info: "" }));

    expect(meta.title).toBe("sh2");
  });
});

describe("buildPackMeta с _pack_info.ini", () => {
  it("предпочитает название из файла", () => {
    const meta = buildPackMeta("sh2", report(), "название из каталога");

    expect(meta.title).toBe("Silent Hill 2");
  });

  it("предпочитает авторов из файла", () => {
    const meta = buildPackMeta("sh2", report(), "Silent Hill 2", "creator из каталога");

    expect(meta.authors).toEqual(["Hollyfrogg"]);
  });

  it("берёт автора из каталога, когда список в файле пуст", () => {
    const meta = buildPackMeta("sh2", report({ pack_info: '[data]\nauthors=[]' }), "Silent Hill 2", "Hollyfrogg");

    expect(meta.authors).toEqual(["Hollyfrogg"]);
  });
});

describe("buildPackMeta и границы видео", () => {
  it("выбрасывает реплику, которая начинается после конца видео", () => {
    const meta = buildPackMeta(
      "sh2",
      report({
        video_duration: 125.61,
        lines: [
          lineEntry({ base: "01_James", meta: '[data]\ndub_timestamps=[7.578]' }),
          lineEntry({ base: "211_Maria", meta: '[data]\ndub_timestamps=[140.365]' })
        ]
      }),
      "Silent Hill 2"
    );

    expect(meta.lines.map((l) => l.id)).toEqual(["01_James"]);
  });

  it("обрезает по концу видео реплику, которая в него не помещается", () => {
    const meta = buildPackMeta(
      "sh2",
      report({
        video_duration: 10,
        lines: [lineEntry({ duration: 5, meta: '[data]\ndub_timestamps=[8]' })]
      }),
      "Silent Hill 2"
    );

    expect(meta.lines[0].end).toBe(10);
  });

  it("оставляет реплики, когда длительность видео неизвестна", () => {
    const meta = buildPackMeta(
      "sh2",
      report({ video_duration: 0, lines: [lineEntry({ meta: '[data]\ndub_timestamps=[140.365]' })] }),
      "Silent Hill 2"
    );

    expect(meta.lines).toHaveLength(1);
  });
});
