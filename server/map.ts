import { config } from "./config.js";
import { shuffled } from "./duels.js";
import type { MapView } from "../shared/protocol.js";
export interface Position {
  x: number;
  y: number;
}
export type LevelObject = MapView["objects"][number];
function point(x: number, y: number, kind: LevelObject["kind"]): LevelObject {
  return {
    x: Math.round((config.mapSize - 1) * x),
    y: Math.round((config.mapSize - 1) * y),
    kind,
  };
}
export const levelObjects: LevelObject[] = (() => {
  const raw: LevelObject[] = [
    point(.16, .16, "container"), point(.22, .16, "container"),
    point(.77, .18, "container"), point(.83, .18, "container"),
    point(.16, .78, "container"), point(.16, .84, "container"),
    point(.78, .82, "container"), point(.84, .82, "container"),
    point(.35, .12, "crate"), point(.52, .17, "crate"), point(.65, .11, "crate"),
    point(.11, .38, "crate"), point(.22, .48, "crate"), point(.88, .44, "crate"),
    point(.76, .55, "crate"), point(.34, .88, "crate"), point(.51, .82, "crate"),
    point(.66, .89, "crate"), point(.34, .34, "barrier"), point(.42, .34, "barrier"),
    point(.59, .34, "barrier"), point(.67, .34, "barrier"), point(.34, .66, "barrier"),
    point(.42, .66, "barrier"), point(.59, .66, "barrier"), point(.67, .66, "barrier"),
    point(.10, .60, "relay"), point(.90, .60, "relay"),
    point(.47, .10, "relay"), point(.47, .90, "relay"),
  ];
  const seen = new Set<string>();
  return raw.filter((object) => {
    const key = `${object.x}:${object.y}`;
    const central =
      Math.abs(object.x - (config.mapSize - 1) / 2) < 1.5 &&
      Math.abs(object.y - (config.mapSize - 1) / 2) < 1.5;
    if (
      object.x < 1 || object.y < 1 ||
      object.x >= config.mapSize - 1 || object.y >= config.mapSize - 1 ||
      central || seen.has(key)
    ) return false;
    seen.add(key);
    return true;
  });
})();
export const blocked = (p: Position) =>
  levelObjects.some((object) => object.x === p.x && object.y === p.y);
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
    for (let x = inset; x < config.mapSize - inset; x++)
      if (!blocked({ x, y })) out.push({ x, y });
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
