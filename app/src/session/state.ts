import type { PackMeta } from "../types";

export interface Participant {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

export type SessionPhase = "lobby" | "running" | "paused" | "finished";

export interface SessionState {
  phase: SessionPhase;
  hostId: string;
  packSlug: string;
  participants: Participant[];
  roles: Record<string, string>;
  lineIndex: number;
  takenLineIds: string[];
  pausedFor: string | null;
}

export type SessionCommand =
  | { type: "join"; participant: Participant }
  | { type: "ready"; participantId: string; ready: boolean }
  | { type: "leave"; participantId: string }
  | { type: "rejoin"; participantId: string }
  | { type: "claim"; character: string }
  | { type: "release"; character: string }
  | { type: "reassign"; character: string; toParticipantId: string }
  | { type: "start" }
  | { type: "take"; lineId: string }
  | { type: "retake" }
  | { type: "advance" }
  | { type: "resume" }
  | { type: "finish" };

export interface ReduceResult {
  state: SessionState;
  error?: string;
}

export function initialState(host: Participant, packSlug = ""): SessionState {
  return {
    phase: "lobby",
    hostId: host.id,
    packSlug,
    participants: [host],
    roles: {},
    lineIndex: 0,
    takenLineIds: [],
    pausedFor: null
  };
}

export function participant(state: SessionState, id: string): Participant | undefined {
  return state.participants.find((p) => p.id === id);
}

export function characterOwner(state: SessionState, character: string): string | undefined {
  return state.roles[character];
}

export function lineOwner(state: SessionState, meta: PackMeta, lineIndex: number): string | undefined {
  const line = meta.lines[lineIndex];
  return line ? state.roles[line.who] : undefined;
}

export function unclaimedCharacters(state: SessionState, meta: PackMeta): string[] {
  return meta.characters.map((c) => c.name).filter((name) => !state.roles[name]);
}

export function canStart(state: SessionState, meta: PackMeta): boolean {
  return (
    state.phase === "lobby" &&
    meta.lines.length > 0 &&
    unclaimedCharacters(state, meta).length === 0 &&
    state.participants.every((p) => p.ready && p.connected)
  );
}

export function canDrive(state: SessionState, meta: PackMeta, by: string): boolean {
  return by === state.hostId || lineOwner(state, meta, state.lineIndex) === by;
}

export function reduce(
  state: SessionState,
  cmd: SessionCommand,
  by: string,
  meta: PackMeta
): ReduceResult {
  const fail = (error: string): ReduceResult => ({ state, error });

  switch (cmd.type) {
    case "join": {
      if (participant(state, cmd.participant.id)) {
        return {
          state: {
            ...state,
            participants: state.participants.map((p) =>
              p.id === cmd.participant.id ? { ...cmd.participant, connected: true } : p
            )
          }
        };
      }
      if (state.phase !== "lobby") return fail("Сессия уже идёт");
      return { state: { ...state, participants: [...state.participants, cmd.participant] } };
    }

    case "ready": {
      return {
        state: {
          ...state,
          participants: state.participants.map((p) =>
            p.id === cmd.participantId ? { ...p, ready: cmd.ready } : p
          )
        }
      };
    }

    case "leave": {
      const rest = state.participants.map((p) =>
        p.id === cmd.participantId ? { ...p, connected: false } : p
      );
      if (state.phase === "lobby") {
        const roles = { ...state.roles };
        for (const [character, owner] of Object.entries(roles)) {
          if (owner === cmd.participantId) delete roles[character];
        }
        return {
          state: { ...state, roles, participants: rest.filter((p) => p.id !== cmd.participantId) }
        };
      }
      if (state.phase === "running") {
        return { state: { ...state, participants: rest, phase: "paused", pausedFor: cmd.participantId } };
      }
      return { state: { ...state, participants: rest } };
    }

    case "rejoin": {
      const known = participant(state, cmd.participantId);
      if (!known) return fail("Этот участник не из сессии");
      const participants = state.participants.map((p) =>
        p.id === cmd.participantId ? { ...p, connected: true } : p
      );
      const backOnTrack = state.phase === "paused" && state.pausedFor === cmd.participantId;
      return {
        state: {
          ...state,
          participants,
          phase: backOnTrack ? "running" : state.phase,
          pausedFor: backOnTrack ? null : state.pausedFor
        }
      };
    }

    case "claim": {
      if (state.phase !== "lobby") return fail("Роли разбирают до старта");
      if (!meta.characters.some((c) => c.name === cmd.character)) return fail("В паке нет такого персонажа");
      const owner = state.roles[cmd.character];
      if (owner && owner !== by) return fail("Персонажа уже взяли");
      return { state: { ...state, roles: { ...state.roles, [cmd.character]: by } } };
    }

    case "release": {
      if (state.phase !== "lobby") return fail("Роли разбирают до старта");
      if (state.roles[cmd.character] !== by) return fail("Это не ваш персонаж");
      const roles = { ...state.roles };
      delete roles[cmd.character];
      return { state: { ...state, roles } };
    }

    case "reassign": {
      if (by !== state.hostId) return fail("Роли передаёт хост");
      if (!participant(state, cmd.toParticipantId)) return fail("Этот участник не из сессии");
      return { state: { ...state, roles: { ...state.roles, [cmd.character]: cmd.toParticipantId } } };
    }

    case "start": {
      if (by !== state.hostId) return fail("Сессию начинает хост");
      if (state.phase !== "lobby") return fail("Сессия уже началась");
      if (unclaimedCharacters(state, meta).length > 0) return fail("Разберите всех персонажей");
      if (!state.participants.every((p) => p.ready && p.connected)) return fail("Не все готовы");
      return { state: { ...state, phase: "running", lineIndex: 0 } };
    }

    case "take": {
      if (state.phase !== "running") return fail("Сессия не идёт");
      if (lineOwner(state, meta, state.lineIndex) !== by) return fail("Эту реплику пишет другой участник");
      if (meta.lines[state.lineIndex]?.id !== cmd.lineId) return fail("Дубль не от текущей реплики");
      const takenLineIds = state.takenLineIds.includes(cmd.lineId)
        ? state.takenLineIds
        : [...state.takenLineIds, cmd.lineId];
      return { state: { ...state, takenLineIds } };
    }

    case "retake": {
      if (state.phase !== "running") return fail("Сессия не идёт");
      if (!canDrive(state, meta, by)) return fail("Реплику переписывает её автор");
      return { state };
    }

    case "advance": {
      if (state.phase !== "running") return fail("Сессия не идёт");
      if (!canDrive(state, meta, by)) return fail("Реплику двигает её автор");
      const next = state.lineIndex + 1;
      if (next >= meta.lines.length) return { state: { ...state, phase: "finished" } };
      return { state: { ...state, lineIndex: next } };
    }

    case "resume": {
      if (by !== state.hostId) return fail("Паузу снимает хост");
      if (state.phase !== "paused") return fail("Сессия не на паузе");
      return { state: { ...state, phase: "running", pausedFor: null } };
    }

    case "finish": {
      if (by !== state.hostId) return fail("Сессию завершает хост");
      return { state: { ...state, phase: "finished" } };
    }
  }
}
