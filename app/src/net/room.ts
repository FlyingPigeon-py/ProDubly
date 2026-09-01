import {
  initialState,
  participant as findParticipant,
  reduce,
  type Participant,
  type SessionCommand,
  type SessionState
} from "../session/state";
import { PROTOCOL_VERSION, linesHash, type NetMessage, type TakeHeader } from "./protocol";
import type { Transport } from "./transport";
import type { PackMeta } from "../types";

export interface RoomHooks {
  onState: (state: SessionState) => void;
  onTake: (header: TakeHeader, bytes: Uint8Array) => void;
  onError: (message: string) => void;
}

export interface TakeStore {
  read: (lineId: string) => Promise<{ header: TakeHeader; bytes: Uint8Array } | null>;
}

export class HostRoom {
  private state: SessionState;
  private meta: PackMeta;
  private hooks: RoomHooks;
  private store: TakeStore;
  private hash: string;
  private byPeer = new Map<Transport, string>();
  private byId = new Map<string, Transport>();

  constructor(meta: PackMeta, host: Participant, hooks: RoomHooks, store: TakeStore) {
    this.meta = meta;
    this.hooks = hooks;
    this.store = store;
    this.hash = linesHash(meta);
    this.state = initialState({ ...host, ready: true, connected: true }, meta.slug);
  }

  get session(): SessionState {
    return this.state;
  }

  accept(transport: Transport): void {
    transport.onMessage = (msg) => this.handle(transport, msg);
    transport.onBinary = (header, bytes) => this.handleTake(transport, header, bytes);
    transport.onClose = () => this.drop(transport);
  }

  command(cmd: SessionCommand): void {
    this.apply(cmd, this.state.hostId);
  }

  publishTake(header: TakeHeader, bytes: Uint8Array): void {
    this.apply({ type: "take", lineId: header.lineId }, header.authorId);
    this.byId.forEach((peer) => peer.sendBinary(header, bytes));
  }

  private handle(transport: Transport, msg: NetMessage): void {
    if (msg.t === "hello") {
      this.greet(transport, msg);
      return;
    }
    const id = this.byPeer.get(transport);
    if (!id) return;
    if (msg.t === "cmd") this.apply(msg.cmd, id);
    if (msg.t === "request-takes") void this.serveTakes(transport, msg.lineIds);
  }

  private greet(
    transport: Transport,
    msg: Extract<NetMessage, { t: "hello" }>
  ): void {
    if (msg.version !== PROTOCOL_VERSION) {
      transport.send({ t: "error", message: "Разные версии игры — обновитесь" });
      return;
    }
    const ready = msg.packSlug === this.meta.slug && msg.linesHash === this.hash;
    const known = findParticipant(this.state, msg.participant.id);
    this.byPeer.set(transport, msg.participant.id);
    this.byId.set(msg.participant.id, transport);
    if (known) {
      this.apply({ type: "rejoin", participantId: msg.participant.id }, msg.participant.id);
      this.apply({ type: "ready", participantId: msg.participant.id, ready }, msg.participant.id);
    } else {
      this.apply(
        { type: "join", participant: { ...msg.participant, ready, connected: true } },
        msg.participant.id
      );
    }
    transport.send({ t: "state", state: this.state });
  }

  private handleTake(transport: Transport, header: TakeHeader, bytes: Uint8Array): void {
    const id = this.byPeer.get(transport);
    if (!id || id !== header.authorId) return;
    const { state, error } = reduce(this.state, { type: "take", lineId: header.lineId }, id, this.meta);
    if (error) {
      transport.send({ t: "error", message: error });
      return;
    }
    this.state = state;
    this.hooks.onTake(header, bytes);
    this.byId.forEach((peer, peerId) => {
      if (peerId !== id) peer.sendBinary(header, bytes);
    });
    this.broadcast();
  }

  private async serveTakes(transport: Transport, lineIds: string[]): Promise<void> {
    for (const lineId of lineIds) {
      const stored = await this.store.read(lineId);
      if (stored) transport.sendBinary(stored.header, stored.bytes);
    }
  }

  private drop(transport: Transport): void {
    const id = this.byPeer.get(transport);
    if (!id) return;
    this.byPeer.delete(transport);
    this.byId.delete(id);
    this.apply({ type: "leave", participantId: id }, id);
  }

  private apply(cmd: SessionCommand, by: string): void {
    const { state, error } = reduce(this.state, cmd, by, this.meta);
    if (error) {
      const peer = this.byId.get(by);
      if (peer) peer.send({ t: "error", message: error });
      else this.hooks.onError(error);
      return;
    }
    this.state = state;
    this.broadcast();
  }

  private broadcast(): void {
    this.hooks.onState(this.state);
    this.byId.forEach((peer) => peer.send({ t: "state", state: this.state }));
  }
}

export class GuestRoom {
  private transport: Transport;
  private hooks: RoomHooks;
  private self: Participant;
  private state: SessionState | null = null;

  constructor(transport: Transport, self: Participant, hooks: RoomHooks, pack?: PackMeta) {
    this.transport = transport;
    this.hooks = hooks;
    this.self = self;
    transport.onMessage = (msg) => {
      if (msg.t === "state") {
        this.state = msg.state;
        hooks.onState(msg.state);
      }
      if (msg.t === "error") hooks.onError(msg.message);
    };
    transport.onBinary = (header, bytes) => hooks.onTake(header, bytes);
    transport.onClose = () => hooks.onError("Связь с хостом потеряна");
    this.announce(pack);
  }

  announce(pack?: PackMeta): void {
    this.transport.send({
      t: "hello",
      version: PROTOCOL_VERSION,
      participant: { ...this.self, ready: false, connected: true },
      packSlug: pack?.slug ?? "",
      linesHash: pack ? linesHash(pack) : ""
    });
  }

  get session(): SessionState | null {
    return this.state;
  }

  command(cmd: SessionCommand): void {
    this.transport.send({ t: "cmd", cmd });
  }

  publishTake(header: TakeHeader, bytes: Uint8Array): void {
    this.transport.sendBinary(header, bytes);
  }

  requestTakes(lineIds: string[]): void {
    if (lineIds.length > 0) this.transport.send({ t: "request-takes", lineIds });
  }

  leave(): void {
    this.transport.close();
  }
}
