import { randomInt, randomUUID } from "node:crypto";
import { deal, orderedDeck, type Board, type Card } from "../shared/solitaire.js";
import { config } from "./config.js";
export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export interface Duel {
  id: string;
  players: [number, number];
  round: 1 | 2;
  startAt: number;
  endAt: number;
  boards: Map<number, Board>;
  revisions: Map<number, number>;
  resolved: boolean;
  peeks: Map<number, { until:number; cards:Card[] }>;
}
export function createDuel(a: number, b: number, now: number): Duel {
  const board = deal(shuffled(orderedDeck())),
    startAt = now + config.countdownMs;
  return {
    id: randomUUID(),
    players: [a, b],
    round: 1,
    startAt,
    endAt: startAt + config.duelMs,
    boards: new Map([
      [a, board],
      [b, structuredClone(board)],
    ]),
    revisions: new Map([
      [a, 0],
      [b, 0],
    ]),
    resolved: false,
    peeks: new Map(),
  };
}
export function overtime(d: Duel, now: number) {
  const board = deal(shuffled(orderedDeck()));
  d.round = 2;
  d.startAt = now + config.countdownMs;
  d.endAt = d.startAt + config.overtimeMs;
  d.peeks.clear();
  d.players.forEach((id) => {
    d.boards.set(id, structuredClone(board));
    d.revisions.set(id, 0);
  });
}
