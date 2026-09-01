import type { SignalPort } from "./peer";

type ServerMessage =
  | { t: "created"; code: string; peerId: string }
  | { t: "joined"; peerId: string; hostId: string }
  | { t: "peer-joined"; peerId: string }
  | { t: "peer-left"; peerId: string }
  | { t: "signal"; from: string; payload: unknown }
  | { t: "error"; message: string };

const OPEN_TIMEOUT = 12000;

export class Signaling {
  private socket: WebSocket;
  private handlers = new Map<string, (payload: any) => void>();
  selfId = "";
  hostId = "";
  code = "";
  onPeerJoined: ((peerId: string) => void) | null = null;
  onPeerLeft: ((peerId: string) => void) | null = null;
  onFailure: ((message: string) => void) | null = null;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (e) => this.dispatch(JSON.parse(e.data as string) as ServerMessage);
    socket.onclose = () => this.onFailure?.("Сервер комнат отключился");
  }

  private dispatch(msg: ServerMessage): void {
    if (msg.t === "peer-joined") this.onPeerJoined?.(msg.peerId);
    if (msg.t === "peer-left") this.onPeerLeft?.(msg.peerId);
    if (msg.t === "signal") this.handlers.get(msg.from)?.(msg.payload);
    if (msg.t === "error") this.onFailure?.(msg.message);
  }

  private static open(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("Сервер комнат не отвечает"));
      }, OPEN_TIMEOUT);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Не получилось связаться с сервером комнат"));
      };
    });
  }

  private static first<T extends ServerMessage["t"]>(
    socket: WebSocket,
    expected: T
  ): Promise<Extract<ServerMessage, { t: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Сервер комнат не ответил")), OPEN_TIMEOUT);
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        if (msg.t === "error") {
          clearTimeout(timer);
          reject(new Error(msg.message));
          return;
        }
        if (msg.t === expected) {
          clearTimeout(timer);
          resolve(msg as Extract<ServerMessage, { t: T }>);
        }
      };
    });
  }

  static async createRoom(url: string): Promise<Signaling> {
    const socket = await Signaling.open(url);
    socket.send(JSON.stringify({ t: "create" }));
    const created = await Signaling.first(socket, "created");
    const signaling = new Signaling(socket);
    signaling.selfId = created.peerId;
    signaling.hostId = created.peerId;
    signaling.code = created.code;
    return signaling;
  }

  static async joinRoom(url: string, code: string): Promise<Signaling> {
    const socket = await Signaling.open(url);
    socket.send(JSON.stringify({ t: "join", code: code.trim().toUpperCase() }));
    const joined = await Signaling.first(socket, "joined");
    const signaling = new Signaling(socket);
    signaling.selfId = joined.peerId;
    signaling.hostId = joined.hostId;
    signaling.code = code.trim().toUpperCase();
    return signaling;
  }

  port(peerId: string): SignalPort {
    return {
      send: (payload) => this.socket.send(JSON.stringify({ t: "signal", to: peerId, payload })),
      onSignal: (handler) => this.handlers.set(peerId, handler)
    };
  }

  close(): void {
    this.socket.onclose = null;
    this.socket.close();
  }
}
