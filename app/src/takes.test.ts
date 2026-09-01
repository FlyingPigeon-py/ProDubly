import { describe, expect, it } from "vitest";
import { normalizeTakes } from "./takes";
import { makeTake } from "./test/factories";

const legacy = {
  file: "takes/001_line_01.wav",
  recordedAt: 1788293620318,
  takeCount: 3,
  startedBefore: 0,
  analysis: { score: 29, verdict: "late", startOffset: 0.65, fill: 0.26 }
};

describe("дубли прежних версий", () => {
  it("достраивает длительность речи, которой раньше не считали", () => {
    const takes = normalizeTakes({ l1: legacy } as never);

    expect(takes.l1.analysis?.speechDur).toBe(0);
  });

  it("достраивает выход за край реплики", () => {
    const takes = normalizeTakes({ l1: legacy } as never);

    expect(takes.l1.analysis?.overrun).toBe(0);
  });

  it("переводит английские вердикты на язык интерфейса", () => {
    const takes = normalizeTakes({
      a: { ...legacy, analysis: { ...legacy.analysis, verdict: "accurate" } },
      b: { ...legacy, analysis: { ...legacy.analysis, verdict: "late" } },
      c: { ...legacy, analysis: { ...legacy.analysis, verdict: "short" } },
      d: { ...legacy, analysis: { ...legacy.analysis, verdict: "long" } }
    } as never);

    expect([takes.a, takes.b, takes.c, takes.d].map((t) => t.analysis?.verdict)).toEqual([
      "в точку",
      "поздно",
      "коротко",
      "за окном"
    ]);
  });

  it("берёт длительность дубля из записи, когда её не сохранили", () => {
    const takes = normalizeTakes({ l1: legacy } as never);

    expect(takes.l1.duration).toBe(0);
  });

  it("не трогает дубли нынешнего формата", () => {
    const take = makeTake();

    const takes = normalizeTakes({ l1: take });

    expect(takes.l1).toEqual(take);
  });

  it("переживает запись вообще без разбора", () => {
    const takes = normalizeTakes({ l1: { file: "takes/x.wav", duration: 2, recordedAt: 1 } });

    expect(takes.l1.analysis).toBeUndefined();
  });
});
