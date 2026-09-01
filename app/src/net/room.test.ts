import { describe, expect, it } from "vitest";
import { GuestRoom, HostRoom, type TakeStore } from "./room";
import { memoryPair } from "./transport";
import type { TakeHeader } from "./protocol";
import type { SessionState } from "../session/state";
import { bytesOf, flush, makePack, makeParticipant, makeTake } from "../test/factories";

const HOST = "host-1";
const GUEST = "guest-1";

interface Wired {
  host: HostRoom;
  guest: GuestRoom;
  hostState: () => SessionState;
  guestState: () => SessionState | null;
  hostTakes: { header: TakeHeader; bytes: Uint8Array }[];
  guestTakes: { header: TakeHeader; bytes: Uint8Array }[];
  guestErrors: string[];
  disconnect: () => void;
  reconnect: () => GuestRoom;
}

function wire(guestPack = makePack()): Wired {
  const meta = makePack();
  const stored = new Map<string, { header: TakeHeader; bytes: Uint8Array }>();
  const store: TakeStore = { read: async (lineId) => stored.get(lineId) ?? null };
  const hostTakes: { header: TakeHeader; bytes: Uint8Array }[] = [];
  const guestTakes: { header: TakeHeader; bytes: Uint8Array }[] = [];
  const guestErrors: string[] = [];
  let hostState = null as SessionState | null;
  let guestState = null as SessionState | null;

  const host = new HostRoom(
    meta,
    makeParticipant(HOST),
    {
      onState: (s) => (hostState = s),
      onTake: (header, bytes) => {
        hostTakes.push({ header, bytes });
        stored.set(header.lineId, { header, bytes });
      },
      onError: () => {}
    },
    store
  );

  let pair = memoryPair();
  host.accept(pair[0]);
  const guestHooks = {
    onState: (s: SessionState) => (guestState = s),
    onTake: (header: TakeHeader, bytes: Uint8Array) => guestTakes.push({ header, bytes }),
    onError: (m: string) => guestErrors.push(m)
  };
  let guest = new GuestRoom(pair[1], makeParticipant(GUEST, { ready: false }), guestHooks, guestPack);

  return {
    host,
    get guest() {
      return guest;
    },
    hostState: () => hostState ?? host.session,
    guestState: () => guestState,
    hostTakes,
    guestTakes,
    guestErrors,
    disconnect: () => pair[1].close(),
    reconnect: () => {
      pair = memoryPair();
      host.accept(pair[0]);
      guest = new GuestRoom(pair[1], makeParticipant(GUEST, { ready: false }), guestHooks, guestPack);
      return guest;
    }
  } as Wired;
}

function wireWithoutPack(): Wired {
  const net = wire();
  net.guest.announce();
  return net;
}

async function lobbyWithRoles(): Promise<Wired> {
  const net = wire();
  await flush();
  net.host.command({ type: "claim", character: "ГЛЕБ" });
  net.guest.command({ type: "claim", character: "МИРА" });
  await flush();
  return net;
}

async function startedSession(): Promise<Wired> {
  const net = await lobbyWithRoles();
  net.host.command({ type: "start" });
  await flush();
  return net;
}

function takeHeader(lineId: string, authorId: string): TakeHeader {
  return { kind: "take", lineId, authorId, take: makeTake({ file: `takes/${lineId}.wav`, authorId }) };
}

describe("лобби по сети", () => {
  it("показывает хосту подключившегося гостя", async () => {
    const net = wire();

    await flush();

    expect(net.hostState().participants.map((p) => p.id)).toEqual([HOST, GUEST]);
  });

  it("считает готовым гостя с тем же паком", async () => {
    const net = wire();

    await flush();

    expect(net.hostState().participants[1].ready).toBe(true);
  });

  it("не считает готовым гостя с другим паком", async () => {
    const net = wire(makePack({ lines: [] }));

    await flush();

    expect(net.hostState().participants[1].ready).toBe(false);
  });

  it("называет гостю пак, который предстоит озвучивать", async () => {
    const net = wire();

    await flush();

    expect(net.guestState()?.packSlug).toBe("pack");
  });

  it("считает готовым гостя, который доложил о нужном паке позже", async () => {
    const net = wireWithoutPack();
    await flush();

    net.guest.announce(makePack());
    await flush();

    expect(net.hostState().participants[1].ready).toBe(true);
  });

  it("разносит разобранные роли обоим", async () => {
    const net = await lobbyWithRoles();

    expect(net.guestState()?.roles).toEqual({ ГЛЕБ: HOST, МИРА: GUEST });
  });

  it("отказывает гостю в старте и объясняет причину", async () => {
    const net = await lobbyWithRoles();

    net.guest.command({ type: "start" });
    await flush();

    expect(net.guestErrors).toEqual(["Сессию начинает хост"]);
  });
});

describe("обмен дублями", () => {
  it("доносит дубль гостя до хоста в целости", async () => {
    const net = await startedSession();
    net.host.command({ type: "advance" });
    await flush();
    const bytes = bytesOf(50000, 3);

    net.guest.publishTake(takeHeader("l2", GUEST), bytes);
    await flush();

    expect(net.hostTakes[0].bytes).toEqual(bytes);
    expect(net.hostState().takenLineIds).toEqual(["l2"]);
  });

  it("рассылает дубль хоста остальным участникам", async () => {
    const net = await startedSession();
    const bytes = bytesOf(1000, 5);

    net.host.publishTake(takeHeader("l1", HOST), bytes);
    await flush();

    expect(net.guestTakes[0].bytes).toEqual(bytes);
  });

  it("не принимает дубль на чужую реплику", async () => {
    const net = await startedSession();

    net.guest.publishTake(takeHeader("l1", GUEST), bytesOf(100));
    await flush();

    expect(net.hostTakes).toHaveLength(0);
    expect(net.guestErrors).toEqual(["Эту реплику пишет другой участник"]);
  });
});

describe("обрыв и возвращение", () => {
  it("ставит сессию на паузу, когда гость пропал", async () => {
    const net = await startedSession();

    net.disconnect();
    await flush();

    expect(net.hostState().phase).toBe("paused");
    expect(net.hostState().pausedFor).toBe(GUEST);
  });

  it("продолжает сессию, когда гость вернулся", async () => {
    const net = await startedSession();
    net.disconnect();
    await flush();

    net.reconnect();
    await flush();

    expect(net.hostState().phase).toBe("running");
  });

  it("отдаёт вернувшемуся дубли, которых у него нет", async () => {
    const net = await startedSession();
    net.host.publishTake(takeHeader("l1", HOST), bytesOf(2048, 9));
    await flush();
    net.disconnect();
    await flush();

    const returned = net.reconnect();
    await flush();
    returned.requestTakes(["l1"]);
    await flush();

    expect(net.guestTakes[net.guestTakes.length - 1].bytes).toEqual(bytesOf(2048, 9));
  });
});

describe("полный проход", () => {
  it("доводит сессию от лобби до финиша", async () => {
    const net = await startedSession();

    net.host.publishTake(takeHeader("l1", HOST), bytesOf(600, 2));
    await flush();
    net.host.publishTake(takeHeader("l1", HOST), bytesOf(700, 4));
    await flush();
    net.host.command({ type: "advance" });
    await flush();
    net.disconnect();
    await flush();
    net.reconnect();
    await flush();
    net.guest.publishTake(takeHeader("l2", GUEST), bytesOf(800, 6));
    await flush();
    net.guest.command({ type: "advance" });
    await flush();

    expect(net.hostState().phase).toBe("finished");
    expect(net.hostState().takenLineIds).toEqual(["l1", "l2"]);
    expect(net.guestState()?.phase).toBe("finished");
  });
});
