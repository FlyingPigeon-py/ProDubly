import { describe, expect, it } from "vitest";
import { leadPlan, lineWindow } from "./takeEngine";
import { makePack } from "../test/factories";

describe("разбег перед записью", () => {
  it("отматывает видео назад, когда до реплики есть запас", () => {
    expect(leadPlan(10, 2.1)).toEqual({ from: 7.9, onScreen: 2.1, onPause: 0 });
  });

  it("досчитывает на замершем кадре, когда до реплики меньше разбега", () => {
    expect(leadPlan(0.5, 2.1)).toEqual({ from: 0, onScreen: 0.5, onPause: 1.6 });
  });

  it("даёт полный отсчёт реплике, которая начинается с первого кадра", () => {
    expect(leadPlan(0, 2.1)).toEqual({ from: 0, onScreen: 0, onPause: 2.1 });
  });

  it("не уводит видео за начало файла", () => {
    expect(leadPlan(1, 3).from).toBe(0);
  });

  it("обходится без отсчёта, когда разбег выключен", () => {
    expect(leadPlan(10, 0)).toEqual({ from: 10, onScreen: 0, onPause: 0 });
  });
});

describe("окно реплики на волне", () => {
  it("оставляет слева место под разбег", () => {
    const line = makePack().lines[0];

    const win = lineWindow({ ...line, start: 10, end: 12 }, 2);

    expect(win.from).toBe(7.8);
  });

  it("прижимается к началу файла у самой ранней реплики", () => {
    const line = makePack().lines[0];

    const win = lineWindow({ ...line, start: 0.2, end: 1.2 }, 2);

    expect(win.from).toBe(0);
  });
});
