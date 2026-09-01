import { describe, expect, it } from "vitest";
import { verdictColor, verdictLabel } from "./score";

describe("verdictLabel", () => {
  it("заменяет внутренний вердикт «за окном» понятной подписью", () => {
    expect(verdictLabel("за окном")).toBe("длинно");
  });

  it.each(["в точку", "поздно", "коротко", "тишина"] as const)("оставляет вердикт %s как есть", (verdict) => {
    expect(verdictLabel(verdict)).toBe(verdict);
  });
});

describe("verdictColor", () => {
  it("красит точный дубль в зелёный", () => {
    expect(verdictColor("в точку")).toBe("var(--green)");
  });

  it("красит тишину в красный", () => {
    expect(verdictColor("тишина")).toBe("var(--red)");
  });

  it("красит остальные вердикты в янтарный", () => {
    expect(verdictColor("за окном")).toBe("var(--amber)");
  });
});
