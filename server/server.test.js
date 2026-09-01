import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "./index.js";

let server;

beforeEach(async () => {
  server = await startServer(0);
});

afterEach(async () => {
  await server.close();
});

function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const inbox = [];
  const waiting = [];
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const waiter = waiting.findIndex((w) => w.type === msg.t);
    if (waiter >= 0) waiting.splice(waiter, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  const client = {
    socket,
    send: (msg) => socket.send(JSON.stringify(msg)),
    next: (type) =>
      new Promise((resolve, reject) => {
        const found = inbox.findIndex((m) => m.t === type);
        if (found >= 0) resolve(inbox.splice(found, 1)[0]);
        else {
          const timer = setTimeout(() => reject(new Error(`не дождался ${type}`)), 2000);
          waiting.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
        }
      }),
    close: () => socket.close()
  };
  return new Promise((resolve) => socket.on("open", () => resolve(client)));
}

async function hostedRoom() {
  const host = await connect();
  host.send({ t: "create" });
  const created = await host.next("created");
  return { host, code: created.code };
}

async function roomWithGuest() {
  const { host, code } = await hostedRoom();
  const guest = await connect();
  guest.send({ t: "join", code });
  const joined = await guest.next("joined");
  const seen = await host.next("peer-joined");
  return { host, guest, code, joined, seen };
}

describe("комнаты сигналинга", () => {
  it("выдаёт хосту код комнаты из шести символов", async () => {
    const { code } = await hostedRoom();

    expect(code).toMatch(/^[ACDEFGHJKLMNPQRTUVWXYZ2345679]{6}$/);
  });

  it("пускает гостя по коду и называет ему хоста", async () => {
    const { host, joined } = await roomWithGuest();
    host.send({ t: "create" });

    expect(joined.hostId).toEqual(expect.any(String));
    expect(joined.peerId).not.toBe(joined.hostId);
  });

  it("сообщает хосту о новом участнике", async () => {
    const { joined, seen } = await roomWithGuest();

    expect(seen.peerId).toBe(joined.peerId);
  });

  it("доносит сигнал до адресата", async () => {
    const { host, guest, joined } = await roomWithGuest();

    guest.send({ t: "signal", to: joined.hostId, payload: { sdp: "offer" } });
    const signal = await host.next("signal");

    expect(signal.payload).toEqual({ sdp: "offer" });
    expect(signal.from).toBe(joined.peerId);
  });

  it("отказывает во входе по неизвестному коду", async () => {
    const guest = await connect();

    guest.send({ t: "join", code: "ZZZZZZ" });
    const error = await guest.next("error");

    expect(error.message).toBe("Комната не найдена — проверьте код");
  });

  it("не пересылает сигнал участнику чужой комнаты", async () => {
    const { guest } = await roomWithGuest();
    const outsider = await hostedRoom();

    guest.send({ t: "signal", to: "кто-то-другой", payload: {} });
    const error = await guest.next("error");

    expect(error.message).toBe("Этот участник не в вашей комнате");
    expect(outsider.code).toEqual(expect.any(String));
  });

  it("сообщает хосту об уходе участника", async () => {
    const { host, guest, joined } = await roomWithGuest();

    guest.close();
    const left = await host.next("peer-left");

    expect(left.peerId).toBe(joined.peerId);
  });

  it("закрывает комнату, когда все разошлись", async () => {
    const { host, guest } = await roomWithGuest();

    guest.close();
    host.close();
    await new Promise((r) => setTimeout(r, 120));

    expect(server.rooms.size).toBe(0);
  });
});
