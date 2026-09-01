import { describe, expect, it } from "vitest";
import {
  canStart,
  initialState,
  reduce,
  unclaimedCharacters,
  type SessionCommand,
  type SessionState
} from "./state";
import { makePack, makeParticipant } from "../test/factories";

const HOST = "host-1";
const GUEST = "guest-1";
const BYSTANDER = "guest-2";

function withGuest(): SessionState {
  const state = initialState(makeParticipant(HOST));
  return reduce(state, { type: "join", participant: makeParticipant(GUEST) }, GUEST, makePack()).state;
}

function withBystander(): SessionState {
  return reduce(withGuest(), { type: "join", participant: makeParticipant(BYSTANDER) }, BYSTANDER, makePack()).state;
}

function apply(state: SessionState, commands: [SessionCommand, string][], meta = makePack()): SessionState {
  return commands.reduce((acc, [cmd, by]) => reduce(acc, cmd, by, meta).state, state);
}

function readyToStart(): SessionState {
  return apply(withGuest(), [
    [{ type: "claim", character: "ГЛЕБ" }, HOST],
    [{ type: "claim", character: "МИРА" }, GUEST]
  ]);
}

function running(): SessionState {
  return apply(readyToStart(), [[{ type: "start" }, HOST]]);
}

describe("разбор ролей", () => {
  it("записывает персонажа за тем, кто его взял", () => {
    const state = withGuest();

    const result = reduce(state, { type: "claim", character: "ГЛЕБ" }, HOST, makePack());

    expect(result.state.roles).toEqual({ ГЛЕБ: HOST });
  });

  it("не отдаёт персонажа, которого уже взяли", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, HOST]]);

    const result = reduce(state, { type: "claim", character: "ГЛЕБ" }, GUEST, makePack());

    expect(result.error).toBe("Персонажа уже взяли");
    expect(result.state.roles).toEqual({ ГЛЕБ: HOST });
  });

  it("освобождает персонажа по просьбе владельца", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, HOST]]);

    const result = reduce(state, { type: "release", character: "ГЛЕБ" }, HOST, makePack());

    expect(result.state.roles).toEqual({});
  });

  it("не даёт освободить чужого персонажа", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, HOST]]);

    const result = reduce(state, { type: "release", character: "ГЛЕБ" }, GUEST, makePack());

    expect(result.error).toBe("Это не ваш персонаж");
  });

  it("передаёт роль другому участнику по решению хоста", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, GUEST]]);

    const result = reduce(state, { type: "reassign", character: "ГЛЕБ", toParticipantId: HOST }, HOST, makePack());

    expect(result.state.roles).toEqual({ ГЛЕБ: HOST });
  });

  it("не даёт гостю передавать роли", () => {
    const state = readyToStart();

    const result = reduce(state, { type: "reassign", character: "ГЛЕБ", toParticipantId: GUEST }, GUEST, makePack());

    expect(result.error).toBe("Роли передаёт хост");
  });
});

describe("старт сессии", () => {
  it("ждёт, пока разберут всех персонажей", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, HOST]]);

    const result = reduce(state, { type: "start" }, HOST, makePack());

    expect(result.error).toBe("Разберите всех персонажей");
    expect(result.state.phase).toBe("lobby");
  });

  it("показывает, каких персонажей ещё не взяли", () => {
    const state = apply(withGuest(), [[{ type: "claim", character: "ГЛЕБ" }, HOST]]);

    expect(unclaimedCharacters(state, makePack())).toEqual(["МИРА"]);
  });

  it("не пускает в старт гостя", () => {
    const state = readyToStart();

    const result = reduce(state, { type: "start" }, GUEST, makePack());

    expect(result.error).toBe("Сессию начинает хост");
  });

  it("не стартует, пока кто-то не готов", () => {
    const state = apply(readyToStart(), [[{ type: "ready", participantId: GUEST, ready: false }, GUEST]]);

    const result = reduce(state, { type: "start" }, HOST, makePack());

    expect(result.error).toBe("Не все готовы");
  });

  it("разрешает старт с полностью разобранными ролями", () => {
    expect(canStart(readyToStart(), makePack())).toBe(true);
  });

  it("начинает проход с первой реплики", () => {
    const result = reduce(readyToStart(), { type: "start" }, HOST, makePack());

    expect(result.state.phase).toBe("running");
    expect(result.state.lineIndex).toBe(0);
  });
});

describe("проход по репликам", () => {
  it("принимает дубль от владельца текущей реплики", () => {
    const result = reduce(running(), { type: "take", lineId: "l1" }, HOST, makePack());

    expect(result.state.takenLineIds).toEqual(["l1"]);
  });

  it("не принимает дубль от чужого участника", () => {
    const result = reduce(running(), { type: "take", lineId: "l1" }, GUEST, makePack());

    expect(result.error).toBe("Эту реплику пишет другой участник");
  });

  it("двигает проход по команде автора реплики", () => {
    const result = reduce(running(), { type: "advance" }, HOST, makePack());

    expect(result.state.lineIndex).toBe(1);
  });

  it("не двигает проход по команде участника без роли на этой реплике", () => {
    const state = apply(withBystander(), [
      [{ type: "claim", character: "ГЛЕБ" }, HOST],
      [{ type: "claim", character: "МИРА" }, GUEST],
      [{ type: "start" }, HOST]
    ]);

    const result = reduce(state, { type: "advance" }, BYSTANDER, makePack());

    expect(result.error).toBe("Реплику двигает её автор");
    expect(result.state.lineIndex).toBe(0);
  });

  it("двигает проход по команде владельца следующей реплики, когда очередь дошла до него", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "advance" }, GUEST, makePack());

    expect(result.state.phase).toBe("finished");
  });

  it("не даёт хосту двигать проход за другого участника", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "advance" }, HOST, makePack());

    expect(result.error).toBe("Реплику двигает её автор");
    expect(result.state.lineIndex).toBe(1);
  });

  it("заканчивает сессию после последней реплики", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "advance" }, GUEST, makePack());

    expect(result.state.phase).toBe("finished");
  });
});

describe("возврат к своим репликам", () => {
  it("переводит прогон на реплику того, кто её озвучивает", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "goto", lineIndex: 0 }, HOST, makePack());

    expect(result.state.lineIndex).toBe(0);
  });

  it("не пускает хоста на чужую реплику", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "goto", lineIndex: 1 }, HOST, makePack());

    expect(result.error).toBe("Эту реплику ведёт другой участник");
  });

  it("пускает владельца на его реплику, пока прогон стоит на чужой", () => {
    const state = apply(running(), [[{ type: "advance" }, HOST]]);

    const result = reduce(state, { type: "goto", lineIndex: 0 }, HOST, makePack());

    expect(result.state.lineIndex).toBe(0);
  });

  it("не пускает на чужую реплику того, кто её не озвучивает", () => {
    const state = apply(withBystander(), [
      [{ type: "claim", character: "ГЛЕБ" }, HOST],
      [{ type: "claim", character: "МИРА" }, GUEST],
      [{ type: "start" }, HOST]
    ]);

    const result = reduce(state, { type: "goto", lineIndex: 1 }, BYSTANDER, makePack());

    expect(result.error).toBe("Эту реплику ведёт другой участник");
  });

  it("не знает реплик за пределами пака", () => {
    const result = reduce(running(), { type: "goto", lineIndex: 9 }, HOST, makePack());

    expect(result.error).toBe("Такой реплики нет");
  });
});

describe("обрывы связи", () => {
  it("ставит идущую сессию на паузу", () => {
    const result = reduce(running(), { type: "leave", participantId: GUEST }, GUEST, makePack());

    expect(result.state.phase).toBe("paused");
    expect(result.state.pausedFor).toBe(GUEST);
  });

  it("возвращает сессию в работу, когда участник вернулся", () => {
    const state = apply(running(), [[{ type: "leave", participantId: GUEST }, GUEST]]);

    const result = reduce(state, { type: "rejoin", participantId: GUEST }, GUEST, makePack());

    expect(result.state.phase).toBe("running");
    expect(result.state.pausedFor).toBe(null);
  });

  it("сохраняет место в проходе на время паузы", () => {
    const state = apply(running(), [
      [{ type: "advance" }, HOST],
      [{ type: "leave", participantId: GUEST }, GUEST]
    ]);

    expect(state.lineIndex).toBe(1);
  });

  it("освобождает роли ушедшего в лобби", () => {
    const state = apply(readyToStart(), [[{ type: "leave", participantId: GUEST }, GUEST]]);

    expect(state.roles).toEqual({ ГЛЕБ: HOST });
    expect(state.participants).toHaveLength(1);
  });

  it("даёт хосту продолжить проход без пропавшего", () => {
    const state = apply(running(), [[{ type: "leave", participantId: GUEST }, GUEST]]);

    const result = reduce(state, { type: "resume" }, HOST, makePack());

    expect(result.state.phase).toBe("running");
    expect(result.state.pausedFor).toBe(null);
  });

  it("возвращает хосту право вести проход вместе с ролью пропавшего", () => {
    const state = apply(running(), [
      [{ type: "advance" }, HOST],
      [{ type: "leave", participantId: GUEST }, GUEST],
      [{ type: "reassign", character: "МИРА", toParticipantId: HOST }, HOST],
      [{ type: "resume" }, HOST]
    ]);

    const result = reduce(state, { type: "advance" }, HOST, makePack());

    expect(result.state.phase).toBe("finished");
  });

  it("не даёт гостю снимать паузу", () => {
    const state = apply(running(), [[{ type: "leave", participantId: GUEST }, GUEST]]);

    const result = reduce(state, { type: "resume" }, GUEST, makePack());

    expect(result.error).toBe("Паузу снимает хост");
  });

  it("не пускает чужака в идущую сессию", () => {
    const result = reduce(running(), { type: "rejoin", participantId: "кто-то" }, "кто-то", makePack());

    expect(result.error).toBe("Этот участник не из сессии");
  });
});
