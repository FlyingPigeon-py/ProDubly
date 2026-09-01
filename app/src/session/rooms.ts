const KEY = "dubl.rooms";

export interface RoomMemory {
  slug: string;
  dubId: string;
}

type Store = Record<string, RoomMemory>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

export function recallRoom(code: string): RoomMemory | null {
  const entry = read()[code.trim().toUpperCase()];
  return entry?.slug && entry?.dubId ? entry : null;
}

export function rememberRoom(code: string, memory: RoomMemory): void {
  if (!code) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [code.trim().toUpperCase()]: memory }));
  } catch {
    // без хранилища возврат в комнату просто начнёт новый дубль
  }
}
