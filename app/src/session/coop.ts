import { api, assetUrl } from "../api";
import { dubRel, ensureDub, loadTakes, saveDub, saveTakes } from "../dubs";
import { connectAsGuest, connectAsHost } from "../net/peer";
import type { TakeHeader } from "../net/protocol";
import { GuestRoom, HostRoom, type TakeStore } from "../net/room";
import { Signaling } from "../net/signaling";
import { iceServers, loadSettings } from "../settings";
import { normalizeTake } from "../takes";
import { initialState, type Participant, type SessionCommand, type SessionState } from "./state";
import type { DubInfo, PackMeta, TakeInfo, TakesMap } from "../types";

export interface CoopView {
  role: "host" | "guest";
  code: string;
  state: SessionState;
  takes: TakesMap;
  error: string | null;
  selfId: string;
  slug: string;
  dubId: string;
  hasPack: boolean;
}

export class CoopSession {
  readonly role: "host" | "guest";
  readonly self: Participant;
  private signaling: Signaling;
  private hostRoom: HostRoom | null = null;
  private guestRoom: GuestRoom | null = null;
  private meta: PackMeta | null = null;
  private slug = "";
  private dubId = "";
  private state: SessionState;
  private takes: TakesMap = {};
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: CoopView;

  private constructor(role: "host" | "guest", signaling: Signaling, self: Participant) {
    this.role = role;
    this.signaling = signaling;
    this.self = self;
    this.state = initialState(self);
    this.snapshot = this.buildSnapshot();
    signaling.onFailure = (message) => this.fail(message);
  }

  static async create(opts: { meta: PackMeta; slug: string; dubId: string; self: Participant }): Promise<CoopSession> {
    const settings = loadSettings();
    const signaling = await Signaling.createRoom(settings.signalingUrl);
    const session = new CoopSession("host", signaling, opts.self);
    session.meta = opts.meta;
    session.slug = opts.slug;
    session.dubId = opts.dubId;
    session.hostRoom = new HostRoom(opts.meta, opts.self, session.hooks(), session.store());
    session.state = session.hostRoom.session;
    signaling.onPeerJoined = async (peerId) => {
      try {
        const transport = await connectAsHost(signaling.port(peerId), { iceServers: iceServers(loadSettings()) });
        session.hostRoom?.accept(transport);
      } catch (e) {
        session.fail(e instanceof Error ? e.message : String(e));
      }
    };
    await session.persistDub();
    session.emit();
    return session;
  }

  static async join(opts: { code: string; self: Participant }): Promise<CoopSession> {
    const settings = loadSettings();
    const signaling = await Signaling.joinRoom(settings.signalingUrl, opts.code);
    const session = new CoopSession("guest", signaling, opts.self);
    const transport = await connectAsGuest(signaling.port(signaling.hostId), {
      iceServers: iceServers(settings)
    });
    session.guestRoom = new GuestRoom(transport, opts.self, session.hooks());
    return session;
  }

  async attachPack(meta: PackMeta, dubId: string): Promise<void> {
    if (this.meta) return;
    this.meta = meta;
    this.slug = meta.slug;
    this.dubId = dubId;
    await ensureDub(meta.slug, dubId, "coop");
    // возвращаемся в ту же комнату — дубли, записанные до обрыва, уже лежат на диске
    this.takes = await loadTakes(meta.slug, dubId);
    this.guestRoom?.announce(meta);
    this.catchUp();
    this.emit();
  }

  private store(): TakeStore {
    return {
      read: async (lineId) => {
        const take = this.takes[lineId];
        if (!take || !this.slug) return null;
        const resp = await fetch(assetUrl(this.slug, dubRel(this.dubId, take.file)) + `?v=${take.recordedAt}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        return {
          header: { kind: "take", lineId, authorId: take.authorId ?? this.self.id, take },
          bytes
        };
      }
    };
  }

  private hooks() {
    return {
      onState: (state: SessionState) => {
        this.state = state;
        void this.persistDub();
        this.catchUp();
        this.emit();
      },
      onTake: (header: TakeHeader, bytes: Uint8Array) => void this.storeTake(header, bytes),
      onError: (message: string) => this.fail(message)
    };
  }

  private catchUp(): void {
    if (this.role !== "guest" || !this.meta) return;
    const missing = this.state.takenLineIds.filter((id) => !this.takes[id]);
    this.guestRoom?.requestTakes(missing);
  }

  private async persistDub(): Promise<void> {
    if (!this.slug || !this.dubId) return;
    const dub: DubInfo = {
      id: this.dubId,
      kind: "coop",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      participants: this.state.participants.map((p) => ({ id: p.id, name: p.name })),
      roles: this.state.roles
    };
    await saveDub(this.slug, dub).catch(() => {});
  }

  private async storeTake(header: TakeHeader, bytes: Uint8Array): Promise<void> {
    if (!this.slug || !this.dubId) return;
    const file = `takes/${header.lineId}.wav`;
    await api.writeBinary(this.slug, dubRel(this.dubId, file), bytes);
    this.takes = { ...this.takes, [header.lineId]: { ...header.take, file, authorId: header.authorId } };
    await saveTakes(this.slug, this.dubId, this.takes);
    this.emit();
  }

  private fail(message: string): void {
    this.error = message;
    this.emit();
  }

  clearError(): void {
    this.error = null;
    this.emit();
  }

  command(cmd: SessionCommand): void {
    if (this.hostRoom) this.hostRoom.command(cmd);
    else this.guestRoom?.command(cmd);
  }

  async publishTake(lineId: string, take: TakeInfo, bytes: Uint8Array): Promise<void> {
    const header: TakeHeader = { kind: "take", lineId, authorId: this.self.id, take };
    await this.storeTake(header, bytes);
    if (this.hostRoom) this.hostRoom.publishTake(header, bytes);
    else this.guestRoom?.publishTake(header, bytes);
  }

  leave(): void {
    this.guestRoom?.leave();
    this.signaling.close();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CoopView => this.snapshot;

  private buildSnapshot(): CoopView {
    return {
      role: this.role,
      code: this.signaling.code,
      state: this.state,
      takes: this.takes,
      error: this.error,
      selfId: this.self.id,
      slug: this.slug,
      dubId: this.dubId,
      hasPack: this.meta !== null
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l());
  }
}
