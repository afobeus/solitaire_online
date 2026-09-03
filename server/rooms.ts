import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import type { RoomView, RoomSummary } from "../shared/protocol.js";
export interface Room extends RoomView {
  disconnected: Map<number, number>;
}
export class Rooms {
  readonly rooms = new Map<string, Room>();
  readonly byUser = new Map<number, string>();
  create(id: number, name: string, username: string, limit: number): Room {
    if (this.byUser.has(id))
      throw new Error("Сначала выйдите из текущей комнаты.");
    if (this.rooms.size >= config.maxRooms)
      throw new Error("Сервер заполнен. Дождитесь освобождения комнаты.");
    if (limit > config.maxPlayers)
      throw new Error(`Лимит сервера — ${config.maxPlayers} игроков.`);
    let code: string;
    do {
      code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      name,
      limit,
      owner: id,
      players: [{ id, name: username, ready: false, connected: true }],
      disconnected: new Map(),
    };
    this.rooms.set(code, room);
    this.byUser.set(id, code);
    return room;
  }
  join(id: number, username: string, code: string) {
    if (this.byUser.has(id)) throw new Error("Вы уже находитесь в комнате.");
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error("Комната не найдена или матч уже начался.");
    if (room.players.length >= room.limit)
      throw new Error("Комната заполнена.");
    room.players.push({ id, name: username, ready: false, connected: true });
    this.byUser.set(id, room.code);
  }
  get(id: number) {
    return this.rooms.get(this.byUser.get(id) ?? "");
  }
  leave(id: number) {
    const room = this.get(id);
    this.byUser.delete(id);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== id);
    room.disconnected.delete(id);
    if (!room.players.length) this.rooms.delete(room.code);
    else if (room.owner === id) room.owner = room.players[0].id;
  }
  connection(id: number, connected: boolean, now: number) {
    const room = this.get(id),
      p = room?.players.find((p) => p.id === id);
    if (!room || !p) return;
    p.connected = connected;
    if (connected) room.disconnected.delete(id);
    else {
      room.disconnected.set(id, now);
      p.ready = false;
    }
  }
  tick(now: number) {
    for (const r of this.rooms.values())
      for (const [id, since] of r.disconnected)
        if (now - since >= config.disconnectMs) this.leave(id);
  }
  view(id: number): RoomView | null {
    const room = this.get(id);
    if (!room) return null;
    const { disconnected, ...view } = room;
    return structuredClone(view);
  }
  list(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => ({
      code: r.code,
      name: r.name,
      limit: r.limit,
      count: r.players.length,
    }));
  }
}
