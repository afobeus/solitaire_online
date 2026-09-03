import { config } from "./config.js";
import { shuffled } from "./duels.js";
export interface Position {
  x: number;
  y: number;
}
export const inside = (p: Position, inset: number) =>
  p.x >= inset &&
  p.y >= inset &&
  p.x < config.mapSize - inset &&
  p.y < config.mapSize - inset;
export const distance = (a: Position, b: Position) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export function cells(inset = 0): Position[] {
  const out: Position[] = [];
  for (let y = inset; y < config.mapSize - inset; y++)
    for (let x = inset; x < config.mapSize - inset; x++) out.push({ x, y });
  return out;
}
export function spawnPositions(count: number): Position[] {
  const selected: Position[] = [];
  for (const p of shuffled(cells())) {
    if (selected.every((other) => distance(p, other) >= 3)) selected.push(p);
    if (selected.length === count) return selected;
  }
  // Fallback for a custom small map: keep all starting cells distinct.
  for (const p of shuffled(cells())) {
    if (selected.every((other) => distance(p, other) > 0)) selected.push(p);
    if (selected.length === count) return selected;
  }
  return selected;
}
