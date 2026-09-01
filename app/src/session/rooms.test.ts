import { beforeEach, describe, expect, it, vi } from "vitest";
import { recallRoom, rememberRoom } from "./rooms";

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

describe("память о комнатах", () => {
  it("возвращает пак и дубль по коду комнаты", () => {
    rememberRoom("KX7M2A", { slug: "elevator", dubId: "coop-1" });

    expect(recallRoom("KX7M2A")).toEqual({ slug: "elevator", dubId: "coop-1" });
  });

  it("узнаёт код, набранный как попало", () => {
    rememberRoom("KX7M2A", { slug: "elevator", dubId: "coop-1" });

    expect(recallRoom(" kx7m2a ")).toEqual({ slug: "elevator", dubId: "coop-1" });
  });

  it("держит несколько комнат сразу", () => {
    rememberRoom("AAAAAA", { slug: "one", dubId: "coop-1" });
    rememberRoom("BBBBBB", { slug: "two", dubId: "coop-2" });

    expect(recallRoom("AAAAAA")?.slug).toBe("one");
    expect(recallRoom("BBBBBB")?.slug).toBe("two");
  });

  it("не помнит комнату, в которой не были", () => {
    expect(recallRoom("ZZZZZZ")).toBe(null);
  });

  it("переживает мусор в хранилище", () => {
    store.set("dubl.rooms", "{сломано");

    expect(recallRoom("KX7M2A")).toBe(null);
  });
});
