import { describe, expect, it } from "vitest";
import { participantSummaries, takeAuthorName } from "./summary";
import { makePack, makeTake } from "../test/factories";
import type { DubInfo, TakesMap } from "../types";

function makeDub(over: Partial<DubInfo> = {}): DubInfo {
  return {
    id: "coop-1",
    kind: "coop",
    createdAt: 1,
    updatedAt: 2,
    participants: [
      { id: "host-1", name: "Аня" },
      { id: "guest-1", name: "Боря" }
    ],
    roles: { ГЛЕБ: "host-1", МИРА: "guest-1" },
    ...over
  };
}

function takesOf(over: TakesMap = {}): TakesMap {
  return {
    l1: makeTake({ authorId: "host-1", analysis: { score: 90, verdict: "в точку", startOffset: 0.1, speechDur: 1, fill: 0.9, overrun: 0 } }),
    l2: makeTake({ authorId: "guest-1", analysis: { score: 60, verdict: "поздно", startOffset: 0.5, speechDur: 1, fill: 0.7, overrun: 0 } }),
    ...over
  };
}

describe("сводка по участникам", () => {
  it("считает каждому его реплики и средний балл", () => {
    const summaries = participantSummaries(makePack(), takesOf(), makeDub());

    expect(summaries.map((s) => [s.name, s.lines, s.recorded, s.averageScore])).toEqual([
      ["Аня", 1, 1, 90],
      ["Боря", 1, 1, 60]
    ]);
  });

  it("ставит выше того, кто попадал точнее", () => {
    const summaries = participantSummaries(makePack(), takesOf(), makeDub());

    expect(summaries[0].name).toBe("Аня");
  });

  it("показывает средний промах старта", () => {
    const summaries = participantSummaries(makePack(), takesOf(), makeDub());

    expect(summaries[1].averageMiss).toBe(0.5);
  });

  it("перечисляет персонажей участника", () => {
    const dub = makeDub({ roles: { ГЛЕБ: "host-1", МИРА: "host-1" } });

    const summaries = participantSummaries(makePack(), takesOf(), dub);

    expect(summaries[0].characters).toEqual(["ГЛЕБ", "МИРА"]);
  });

  it("оставляет нули тому, кто ещё ничего не записал", () => {
    const summaries = participantSummaries(makePack(), { l1: takesOf().l1 }, makeDub());

    expect(summaries[1]).toMatchObject({ name: "Боря", recorded: 0, averageScore: 0, averageMiss: 0 });
  });

  it("называет автора дубля по его записи", () => {
    expect(takeAuthorName(makeDub(), "guest-1")).toBe("Боря");
  });

  it("не приписывает автора соло-дублю", () => {
    expect(takeAuthorName(makeDub(), undefined)).toBe(null);
  });
});
