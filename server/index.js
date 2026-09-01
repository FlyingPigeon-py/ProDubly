import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { Rooms } from "./rooms.js";

const HEARTBEAT_MS = 30000;
const SWEEP_MS = 5 * 60 * 1000;

export function startServer(port = Number(process.env.PORT ?? 8787)) {
  const rooms = new Rooms();
  const sockets = new Map();

  const http = createServer((req, res) => {
    res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "text/plain" });
    res.end(req.url === "/health" ? `rooms: ${rooms.size}` : "not found");
  });
  const wss = new WebSocketServer({ server: http });

  const send = (peerId, msg) => {
    const socket = sockets.get(peerId);
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  wss.on("connection", (socket) => {
    const peerId = randomUUID();
    sockets.set(peerId, socket);
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(peerId, { t: "error", message: "Не разобрал сообщение" });
        return;
      }
      if (msg.t === "create") {
        const code = rooms.create(peerId);
        send(peerId, { t: "created", code, peerId });
        return;
      }
      if (msg.t === "join") {
        const result = rooms.join(String(msg.code ?? "").toUpperCase(), peerId);
        if (result.error) {
          send(peerId, { t: "error", message: result.error });
          return;
        }
        send(peerId, { t: "joined", peerId, hostId: result.hostId });
        result.peers.forEach((other) => send(other, { t: "peer-joined", peerId }));
        return;
      }
      if (msg.t === "signal") {
        if (!rooms.sees(peerId, msg.to)) {
          send(peerId, { t: "error", message: "Этот участник не в вашей комнате" });
          return;
        }
        send(msg.to, { t: "signal", from: peerId, payload: msg.payload });
      }
    });

    socket.on("close", () => {
      const left = rooms.leave(peerId);
      sockets.delete(peerId);
      left?.peers.forEach((other) => send(other, { t: "peer-left", peerId }));
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, HEARTBEAT_MS);

  const sweeper = setInterval(() => rooms.sweep(), SWEEP_MS);

  return new Promise((resolve) => {
    http.listen(port, () => {
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
  startServer().then((s) => console.log(`комнаты слушают порт ${s.port}`));
}
