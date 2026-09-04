import { randomUUID } from "node:crypto";
import type { Item } from "../shared/protocol.js";
import { cells, type Position } from "./map.js";
import { shuffled } from "./duels.js";
import { config } from "./config.js";
export interface Loot extends Position {
  id: string;
  item: Item;
}
export function initialLoot(spawns: Position[]): Loot[] {
  const available = shuffled(
    cells().filter((c) => !spawns.some((p) => p.x === c.x && p.y === c.y)),
  );
  const kinds: Item[] = ["shuffle", "recon", "peek"];
  return available
    .slice(0, config.lootCount)
    .map((p, i) => ({ ...p, id: randomUUID(), item: kinds[i % 3] }));
}
export function pickup(
  inventory: Item[],
  loot: Loot[],
  p: Position,
): string | null {
  const index = loot.findIndex((l) => l.x === p.x && l.y === p.y);
  if (index < 0) return null;
  const item = loot[index].item;
  if (inventory.length >= config.inventorySize)
    return "Инвентарь заполнен. Предмет остался на карте.";
  inventory.push(item);
  loot.splice(index, 1);
  return null;
}
