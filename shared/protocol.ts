import { z } from "zod";
import type { BoardView, Card } from "./solitaire.js";
export type Item = "shield" | "recon" | "peek";
export const itemInfo: Record<
  Item,
  { name: string; icon: string; description: string }
> = {
  shield: {
    name: "Щит",
    icon: "⬡",
    description: "Автоматически спасает от одного поражения в дуэли.",
  },
  recon: {
    name: "Разведка",
    icon: "◎",
    description: "Временно показывает позиции всех оставшихся игроков.",
  },
  peek: {
    name: "Подсмотреть",
    icon: "◈",
    description:
      "На пять секунд раскрывает до трёх следующих карт добора соперника.",
  },
};
const idx = z.number().int().min(0).max(51);
const source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("waste") }).strict(),
  z.object({ type: z.literal("tableau"), column: idx, index: idx }).strict(),
]);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draw") }).strict(),
  z
    .object({
      type: z.literal("move"),
      from: source,
      to: z
        .object({ type: z.enum(["tableau", "foundation"]), column: idx })
        .strict(),
    })
    .strict(),
]);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync") }).strict(),
  z
    .object({
      type: z.literal("room.create"),
      name: z.string().trim().min(1).max(40),
      limit: z.number().int().min(2).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("room.join"),
      code: z.string().trim().min(4).max(10),
    })
    .strict(),
  z.object({ type: z.literal("room.leave") }).strict(),
  z.object({ type: z.literal("room.ready"), ready: z.boolean() }).strict(),
  z.object({ type: z.literal("room.start") }).strict(),
  z.object({ type: z.literal("match.leave") }).strict(),
  z
    .object({
      type: z.literal("move"),
      direction: z.enum(["up", "down", "left", "right"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("item"),
      item: z.enum(["shield", "recon", "peek"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("card"),
      duelId: z.string().max(64),
      round: z.number().int().min(1).max(2),
      revision: z.number().int().min(0),
      action,
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface RoomView {
  code: string;
  name: string;
  limit: number;
  owner: number;
  players: { id: number; name: string; ready: boolean; connected: boolean }[];
}
export interface RoomSummary {
  code: string;
  name: string;
  limit: number;
  count: number;
}
export interface Person {
  id: number;
  name: string;
  status: "free" | "duel" | "eliminated";
  connected: boolean;
}
export interface MapView {
  size: number;
  vision: number;
  moveMs: number;
  inset: number;
  nextInset: number | null;
  nextAt: number | null;
  final: boolean;
  players: (Person & { x: number; y: number; protected: boolean })[];
  loot: { id: string; x: number; y: number; item: Item }[];
}
export interface DuelView {
  id: string;
  round: 1 | 2;
  startAt: number;
  endAt: number;
  opponent: Person;
  own: BoardView;
  opponentBoard: BoardView;
  revision: number;
  opponentRevision: number;
  peek: { cards: Card[]; until: number } | null;
}
export interface ResultView {
  matchId: string;
  winner: number | null;
  winnerName: string | null;
  reason: string;
  players: { id: number; name: string; duelWins: number; reason: string }[];
}
export interface MatchView {
  id: string;
  startedAt: number;
  alive: number;
  roster: Person[];
  map: MapView;
  self: {
    id: number;
    x: number;
    y: number;
    status: Person["status"];
    inventory: Item[];
    inventorySize: number;
    outsideDeadline: number | null;
    protectedUntil: number;
    reconUntil: number;
    reason: string | null;
  };
  duel: DuelView | null;
  result: ResultView | null;
}
export interface ClientState {
  room: RoomView | null;
  match: MatchView | null;
}
export type Patch = Record<string, unknown>;
export type ServerMessage =
  | { type: "snapshot"; seq: number; now: number; state: ClientState }
  | { type: "patch"; seq: number; now: number; patch: Patch }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "replaced"; message: string };
// JSON merge patch: arrays are replaced, object fields are patched independently.
export function makePatch(previous: unknown, current: unknown): unknown {
  if (JSON.stringify(previous) === JSON.stringify(current)) return undefined;
  if (
    current === null ||
    typeof current !== "object" ||
    Array.isArray(current) ||
    !previous ||
    typeof previous !== "object" ||
    Array.isArray(previous)
  )
    return current;
  const out: Patch = {};
  const a = previous as Patch,
    b = current as Patch;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const value = key in b ? makePatch(a[key], b[key]) : null;
    if (value !== undefined) out[key] = value;
  }
  return out;
}
export function mergePatch<T>(state: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch))
    return patch as T;
  const result = {
    ...(state && typeof state === "object" ? state : {}),
  } as Patch;
  for (const [key, value] of Object.entries(patch))
    result[key] = mergePatch(result[key], value);
  return result as T;
}
