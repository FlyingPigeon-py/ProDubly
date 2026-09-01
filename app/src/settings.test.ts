import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, updateSettings } from "./settings";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  });
});

describe("updateSettings", () => {
  it("сохраняет изменённое поле между чтениями", () => {
    updateSettings({ showTranslation: false });

    expect(loadSettings().showTranslation).toBe(false);
  });

  it("не трогает остальные настройки", () => {
    saveSettings({ ...DEFAULT_SETTINGS, gain: 2.5, deeplKey: "abc:fx" });

    updateSettings({ showTranslation: false });

    const saved = loadSettings();
    expect(saved.gain).toBe(2.5);
    expect(saved.deeplKey).toBe("abc:fx");
  });

  it("возвращает настройки целиком после правки", () => {
    expect(updateSettings({ showTranslation: false })).toEqual({ ...DEFAULT_SETTINGS, showTranslation: false });
  });
});

describe("loadSettings", () => {
  it("подставляет значения по умолчанию для полей, которых нет в сохранённом виде", () => {
    store.set("dubl.settings", JSON.stringify({ gain: 1.5 }));

    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, gain: 1.5 });
  });

  it("возвращает значения по умолчанию, когда сохранённое повреждено", () => {
    store.set("dubl.settings", "{не json");

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
