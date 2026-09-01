import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { Rooms } from "./rooms.js";

const HEARTBEAT_MS = 30000;
const SWEEP_MS = 5 * 60 * 1000;

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

function short(peerId) {
  return peerId.slice(0, 6);
}

function describeSignal(payload) {
  if (payload?.sdp) return `sdp:${payload.sdp.type}`;
  if (payload?.ice) {
    const typ = /typ (\w+)/.exec(payload.ice.candidate ?? "");
    return `ice:${typ ? typ[1] : "?"}`;
  }
  return "?";
}

function consoleLog(line) {
  console.log(`${stamp()} ${line}`);
}

export function startServer(port = Number(process.env.PORT ?? 8787), { log = consoleLog } = {}) {
  const rooms = new Rooms();
  const sockets = new Map();

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      const body = JSON.stringify({
        rooms: [...rooms.rooms.values()].map((r) => ({ code: r.code, peers: r.peers.length })),
        total: rooms.size
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  const wss = new WebSocketServer({ server: http });

  const send = (peerId, msg) => {
    const socket = sockets.get(peerId);
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  wss.on("connection", (socket, req) => {
    const peerId = randomUUID();
    sockets.set(peerId, socket);
    log(`подключился ${short(peerId)} с ${req.socket.remoteAddress} · всего сокетов ${sockets.size}`);
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log(`${short(peerId)} прислал не JSON — ${raw.length} байт`);
        send(peerId, { t: "error", message: "Не разобрал сообщение" });
        return;
      }
      if (msg.t === "create") {
        const code = rooms.create(peerId);
        log(`комната ${code} · открыл ${short(peerId)}`);
        send(peerId, { t: "created", code, peerId });
        return;
      }
      if (msg.t === "join") {
        const code = String(msg.code ?? "").toUpperCase();
        const result = rooms.join(code, peerId);
        if (result.error) {
          log(`комната ${code || "—"} · ${short(peerId)} не вошёл: ${result.error}`);
          send(peerId, { t: "error", message: result.error });
          return;
        }
        log(
          `комната ${code} · вошёл ${short(peerId)} · хост ${short(result.hostId)} · уже внутри ${result.peers.length + 1}`
        );
        send(peerId, { t: "joined", peerId, hostId: result.hostId });
        result.peers.forEach((other) => send(other, { t: "peer-joined", peerId }));
        return;
      }
      if (msg.t === "signal") {
        if (!rooms.sees(peerId, msg.to)) {
          log(`${short(peerId)} шлёт сигнал мимо комнаты, адресат ${short(String(msg.to ?? "—"))}`);
          send(peerId, { t: "error", message: "Этот участник не в вашей комнате" });
          return;
        }
        const target = sockets.get(msg.to);
        log(
          `сигнал ${short(peerId)} → ${short(msg.to)} · ${describeSignal(msg.payload)}${target ? "" : " · адресат уже отключился"}`
        );
        send(msg.to, { t: "signal", from: peerId, payload: msg.payload });
      }
    });

    socket.on("error", (e) => log(`сокет ${short(peerId)} сломался: ${e.message}`));

    socket.on("close", (code) => {
      const left = rooms.leave(peerId);
      sockets.delete(peerId);
      log(
        left
          ? `комната ${left.code} · ушёл ${short(peerId)} (код ${code}) · осталось ${left.peers.length}${left.closed ? " · комната закрыта" : ""}`
          : `отключился ${short(peerId)} (код ${code}), в комнатах его не было`
      );
      left?.peers.forEach((other) => send(other, { t: "peer-left", peerId }));
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) {
        log("сокет не ответил на пинг — рву связь");
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, HEARTBEAT_MS);

  const sweeper = setInterval(() => {
    const dropped = rooms.sweep();
    if (dropped.length > 0) log(`убрал заброшенные комнаты: ${dropped.join(", ")}`);
  }, SWEEP_MS);

  return new Promise((resolve) => {
    http.listen(port, () => {
      log(`сервер комнат слушает порт ${http.address().port}`);
      resolve({
        port: http.address().port,
        rooms,
        close: () =>
          new Promise((done) => {
            clearInterval(heartbeat);
            clearInterval(sweeper);
            wss.clients.forEach((socket) => socket.terminate());
            wss.close(() => http.close(done));
          })
      });
    });
  });
}

if (process.argv[1]?.endsWith("index.js")) {
  startServer();
}
