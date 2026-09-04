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
  round: 1;
  startAt: number;
  endAt: number;
  boards: Map<number, Board>;
  revisions: Map<number, number>;
  histories: Map<number, Board[]>;
  resolved: boolean;
  peeks: Map<number, { until:number; cards:Card[] }>;
  autoFinish: {
    player: number;
    startedAt: number;
    nextStepAt: number;
    completeAt: number | null;
  } | null;
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
    histories: new Map([
      [a, []],
      [b, []],
    ]),
    resolved: false,
    peeks: new Map(),
    autoFinish: null,
  };
}
