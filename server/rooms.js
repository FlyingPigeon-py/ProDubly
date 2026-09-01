const ALPHABET = "ACDEFGHJKLMNPQRTUVWXYZ2345679";
const CODE_LENGTH = 6;
const ROOM_TTL_MS = 60 * 60 * 1000;

function makeCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export class Rooms {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.rooms = new Map();
    this.location = new Map();
  }

  create(peerId) {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    this.rooms.set(code, { code, hostId: peerId, peers: [peerId], touchedAt: this.now() });
    this.location.set(peerId, code);
    return code;
  }

  join(code, peerId) {
    const room = this.rooms.get(code);
    if (!room) return { error: "Комната не найдена — проверьте код" };
    const others = room.peers.filter((id) => id !== peerId);
    room.peers = [...others, peerId];
    room.touchedAt = this.now();
    this.location.set(peerId, code);
    return { hostId: room.hostId, peers: others };
  }

  leave(peerId) {
    const code = this.location.get(peerId);
    if (!code) return null;
    this.location.delete(peerId);
    const room = this.rooms.get(code);
    if (!room) return null;
    room.peers = room.peers.filter((id) => id !== peerId);
    room.touchedAt = this.now();
    if (room.peers.length === 0) this.rooms.delete(code);
    return { code, peers: room.peers, closed: room.peers.length === 0 };
  }

  peersOf(peerId) {
    const code = this.location.get(peerId);
    const room = code ? this.rooms.get(code) : null;
    return room ? room.peers.filter((id) => id !== peerId) : [];
  }

  sees(peerId, otherId) {
    const code = this.location.get(peerId);
    return Boolean(code) && this.location.get(otherId) === code;
  }

  sweep() {
    const deadline = this.now() - ROOM_TTL_MS;
    const dropped = [];
    for (const [code, room] of this.rooms) {
      if (room.touchedAt < deadline) {
        this.rooms.delete(code);
        room.peers.forEach((id) => this.location.delete(id));
        dropped.push(code);
      }
    }
    return dropped;
  }

  get size() {
    return this.rooms.size;
  }
}
