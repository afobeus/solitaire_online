import { randomInt, randomUUID } from "node:crypto";
import type {
  ClientState,
  Command,
  DuelView,
  MatchView,
  Person,
  ResultView,
  Item,
} from "../shared/protocol.js";
import { applyAction, boardView, score } from "../shared/solitaire.js";
import { config } from "./config.js";
import { Database, type User } from "./db.js";
import { Rooms } from "./rooms.js";
import { createDuel, overtime, shuffled, type Duel } from "./duels.js";
import { blocked, cells, distance, inside, levelObjects, spawnPositions } from "./map.js";
import { initialLoot, pickup, type Loot } from "./items.js";
interface Player extends Person {
  x: number;
  y: number;
  inventory: Item[];
  duelId: string | null;
  disconnectedAt: number | null;
  lastMove: number;
  outsideSince: number | null;
  protectedUntil: number;
  reconUntil: number;
  reason: string | null;
  duelWins: number;
  queueAt: number;
}
export interface Match {
  id: string;
  startedAt: number;
  endedAt: number | null;
  phase: "running" | "finished";
  players: Map<number, Player>;
  duels: Map<string, Duel>;
  loot: Loot[];
  inset: number;
  stage: number;
  final: boolean;
  result: ResultView | null;
}
export class Game {
  readonly rooms = new Rooms();
  readonly matches = new Map<string, Match>();
  readonly membership = new Map<number, string>();
  readonly connected = new Set<number>();
  constructor(
    private db: Database,
    private notice: (id: number, message: string) => void,
  ) {}
  connection(id: number, connected: boolean, now = Date.now()) {
    // Do not let a reconnect just after its deadline beat the next scheduler tick.
    if (connected) {
      const current = this.match(id);
      if (current) this.advance(current, now);
    }
    if (connected) this.connected.add(id);
    else this.connected.delete(id);
    this.rooms.connection(id, connected, now);
    const m = this.match(id),
      p = m?.players.get(id);
    if (p) {
      p.connected = connected;
      p.disconnectedAt = connected ? null : now;
    }
    if (m && connected) this.maybeFinish(m, now);
  }
  private match(id: number) {
    return this.matches.get(this.membership.get(id) ?? "");
  }
  private available(id: number) {
    const m = this.match(id),
      p = m?.players.get(id);
    if (m?.phase === "running" && p?.status !== "eliminated")
      throw new Error("Вы уже участвуете в матче.");
    if (m) this.membership.delete(id);
  }
  command(user: User, cmd: Command, now = Date.now()) {
    const id = user.id;
    if (!this.connected.has(id)) throw new Error("Соединение потеряно.");
    switch (cmd.type) {
      case "sync":
        return;
      case "room.create":
        this.available(id);
        this.rooms.create(id, cmd.name, user.username, cmd.limit);
        return;
      case "room.join":
        this.available(id);
        this.rooms.join(id, user.username, cmd.code);
        return;
      case "room.leave":
        this.rooms.leave(id);
        return;
      case "room.ready": {
        const p = this.rooms.get(id)?.players.find((p) => p.id === id);
        if (!p) throw new Error("Комната не найдена.");
        p.ready = cmd.ready;
        return;
      }
      case "room.start":
        this.start(id, now);
        return;
      case "match.leave": {
        const m = this.match(id);
        if (m && m.phase === "running") {
          this.eliminate(m, id, "Вы покинули матч.");
          this.resolveAbandoned(m, now);
          this.maybeFinish(m, now);
        }
        this.membership.delete(id);
        return;
      }
    }
    const m = this.match(id),
      p = m?.players.get(id);
    if (!m || !p || m.phase !== "running" || p.status === "eliminated")
      throw new Error("Вы не участвуете в активном матче.");
    // Apply deadlines before accepting an intent, including between scheduler ticks.
    this.advance(m, now);
    if (m.phase !== "running" || m.players.get(id)?.status === "eliminated")
      throw new Error("Действие опоздало: фаза игры изменилась.");
    if (cmd.type === "move") {
      if (m.final) throw new Error("Финал: ожидайте своей дуэли.");
      if (p.status !== "free")
        throw new Error("Перемещение недоступно во время дуэли.");
      if (now - p.lastMove < config.moveMs)
        throw new Error("Слишком быстрое перемещение.");
      const [dx, dy] = {
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
      }[cmd.direction];
      const pos = { x: p.x + dx, y: p.y + dy };
      if (!inside(pos, 0)) throw new Error("Это край карты.");
      if (blocked(pos)) throw new Error("Путь перекрыт объектом.");
      if (
        [...m.players.values()].some(
          (other) =>
            other.status === "duel" && other.x === pos.x && other.y === pos.y,
        )
      )
        throw new Error("Клетка занята дуэлью.");
      p.x = pos.x;
      p.y = pos.y;
      p.lastMove = now;
      p.outsideSince = inside(p, m.inset) ? null : (p.outsideSince ?? now);
      const message = pickup(p.inventory, m.loot, p);
      if (message) this.notice(id, message);
      this.collisions(m, now);
      return;
    }
    if (cmd.type === "item") {
      const slot = p.inventory.indexOf(cmd.item);
      if (slot < 0) throw new Error("У вас нет этого предмета.");
      if (cmd.item === "recon") {
        if (p.status !== "free")
          throw new Error("Разведка доступна только на карте.");
        if (p.reconUntil > now) throw new Error("Разведка уже действует.");
        p.reconUntil = now + config.reconMs;
      } else if (cmd.item === "peek") {
        const d = m.duels.get(p.duelId ?? "");
        if (!d) throw new Error("Подсмотреть можно только во время дуэли.");
        if (now < d.startAt) throw new Error("Дождитесь начала дуэли.");
        if ((d.peeks.get(id)?.until ?? 0) > now)
          throw new Error("Раскрытие уже действует.");
        const opponent = d.players.find((x) => x !== id)!;
        if (!d.boards.get(opponent)!.stock.length)
          throw new Error("Колода соперника пуста. Предмет сохранён.");
        d.peeks.set(id, {
          until: now + config.peekMs,
          cards: d.boards.get(opponent)!.stock.slice(-3).reverse().map(card=>({...card})),
        });
      } else {
        const d = m.duels.get(p.duelId ?? "");
        if (!d) throw new Error("Перетасовка доступна только во время дуэли.");
        if (now < d.startAt) throw new Error("Дождитесь начала дуэли.");
        const board = d.boards.get(id)!;
        const remaining = [...board.stock, ...board.waste];
        if (remaining.length < 2)
          throw new Error("Для перетасовки недостаточно карт. Предмет сохранён.");
        board.stock = shuffled(remaining);
        board.waste = [];
        d.revisions.set(id, d.revisions.get(id)! + 1);
        this.notice(id, "Колода добора и сброс перемешаны.");
      }
      p.inventory.splice(slot, 1);
      return;
    }
    if (cmd.type === "card") {
      const d = m.duels.get(p.duelId ?? "");
      if (!d || d.resolved || d.id !== cmd.duelId || d.round !== cmd.round)
        throw new Error("Эта дуэль или раунд уже завершены.");
      if (now < d.startAt)
        throw new Error("Дождитесь окончания обратного отсчёта.");
      if (now >= d.endAt) throw new Error("Время дуэли истекло.");
      if (cmd.revision !== d.revisions.get(id))
        throw new Error("Поле обновилось. Повторите ход.");
      const b = applyAction(d.boards.get(id)!, cmd.action);
      if (!b)
        throw new Error(
          "Недопустимый ход. Проверьте масть, цвет и порядок карт.",
        );
      d.boards.set(id, b);
      d.revisions.set(id, cmd.revision + 1);
      if (score(b) === 52 || (d.round === 2 && score(b) > 0))
        this.resolve(
          m,
          d,
          id,
          d.round === 2
            ? "Первая карта в основании дополнительного раунда."
            : "Пасьянс собран полностью.",
          now,
        );
      this.maybeFinish(m, now);
    }
  }
  private start(id: number, now: number) {
    const room = this.rooms.get(id);
    if (!room || room.owner !== id)
      throw new Error("Начать матч может только владелец комнаты.");
    const ready = room.players.filter((p) => p.ready && p.connected);
    if (ready.length < 2 || !ready.some((p) => p.id === id))
      throw new Error("Владелец и хотя бы ещё один игрок должны быть готовы.");
    if (
      [...this.matches.values()].filter((m) => m.phase === "running").length >=
      config.maxMatches
    )
      throw new Error("Все места для матчей заняты. Попробуйте позже.");
    const positions = spawnPositions(ready.length),
      matchId = randomUUID();
    const players = new Map<number, Player>(
      ready.map((p, i) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          connected: true,
          status: "free",
          ...positions[i],
          inventory: [],
          duelId: null,
          disconnectedAt: null,
          lastMove: 0,
          outsideSince: null,
          protectedUntil: now + config.protectionMs,
          reconUntil: 0,
          reason: null,
          duelWins: 0,
          queueAt: now,
        },
      ]),
    );
    const m: Match = {
      id: matchId,
      startedAt: now,
      endedAt: null,
      phase: "running",
      players,
      duels: new Map(),
      loot: initialLoot(positions),
      inset: 0,
      stage: -1,
      final: false,
      result: null,
    };
    this.matches.set(m.id, m);
    ready.forEach((p) => {
      this.rooms.leave(p.id);
      this.membership.set(p.id, m.id);
    });
  }
  private begin(m: Match, a: Player, b: Player, now: number) {
    if (a.status !== "free" || b.status !== "free") return;
    const d = createDuel(a.id, b.id, now);
    m.duels.set(d.id, d);
    for (const p of [a, b]) {
      p.status = "duel";
      p.duelId = d.id;
      p.outsideSince = null;
    }
  }
  private collisions(m: Match, now: number) {
    const free = [...m.players.values()].filter(
      (p) => p.status === "free" && p.protectedUntil <= now,
    );
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++)
        if (free[i].x === free[j].x && free[i].y === free[j].y)
          this.begin(m, free[i], free[j], now);
  }
  private returnInside(m: Match, p: Player, now: number) {
    const options = shuffled(cells(m.inset));
    const pos =
      options.find(
        (c) =>
          ![...m.players.values()].some(
            (o) =>
              o.id !== p.id &&
              o.status !== "eliminated" &&
              o.x === c.x &&
              o.y === c.y,
          ),
      ) ?? options[0];
    Object.assign(p, pos);
    p.status = "free";
    p.duelId = null;
    p.outsideSince = null;
    p.protectedUntil = now + config.protectionMs;
    p.queueAt = now;
  }
  private eliminate(m: Match, id: number, reason: string) {
    const p = m.players.get(id);
    if (!p || p.status === "eliminated") return;
    p.status = "eliminated";
    p.reason = reason;
    p.inventory = [];
    p.outsideSince = null;
    p.reconUntil = 0;
  }
  private resolve(
    m: Match,
    d: Duel,
    winner: number | null,
    reason: string,
    now: number,
  ) {
    if (d.resolved || m.phase !== "running") return;
    d.resolved = true;
    for (const id of d.players) {
      const p = m.players.get(id)!;
      p.duelId = null;
      if (p.status === "eliminated") continue;
      if (id === winner) {
        p.duelWins++;
        this.returnInside(m, p, now);
        this.notice(id, `Дуэль выиграна. ${reason}`);
      } else {
        this.eliminate(m, id, `Поражение в дуэли. ${reason}`);
        this.notice(id, `Дуэль проиграна. ${reason}`);
      }
    }
    m.duels.delete(d.id);
  }
  private resolveAbandoned(m: Match, now: number) {
    for (const d of m.duels.values()) {
      const alive = d.players.filter(
        (id) => m.players.get(id)!.status !== "eliminated",
      );
      if (alive.length < 2)
        this.resolve(
          m,
          d,
          alive[0] ?? null,
          "Соперник покинул матч или не переподключился.",
          now,
        );
    }
  }
  private maybeFinish(m: Match, now: number) {
    if (m.phase === "finished") return;
    const alive = [...m.players.values()].filter(
      (p) => p.status !== "eliminated",
    );
    if (alive.length > 1 || (alive.length === 1 && !alive[0].connected)) return;
    const winner = alive[0] ?? null;
    const result: ResultView = {
      matchId: m.id,
      winner: winner?.id ?? null,
      winnerName: winner?.name ?? null,
      reason: winner
        ? "Последний оставшийся игрок."
        : "Все участники выбыли. Победителя нет.",
      players: [...m.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        duelWins: p.duelWins,
        reason:
          p.id === winner?.id
            ? "Победитель матча"
            : (p.reason ?? "Матч завершён"),
      })),
    };
    // Transaction is committed before changing phase. UNIQUE(match id) makes retries idempotent.
    this.db.saveResult({
      id: m.id,
      startedAt: m.startedAt,
      endedAt: now,
      winner: result.winner,
      players: result.players,
    });
    m.phase = "finished";
    m.endedAt = now;
    m.result = result;
    m.duels.clear();
    m.loot = [];
  }
  private advance(m: Match, now: number) {
    if (m.phase !== "running") return;
    // Batch all eliminations before adjudicating duels/match (no phantom last-player winner).
    for (const p of m.players.values())
      if (
        p.status !== "eliminated" &&
        p.disconnectedAt !== null &&
        now - p.disconnectedAt >= config.disconnectMs
      )
        this.eliminate(m, p.id, "Не удалось переподключиться вовремя.");
    while (
      config.zoneStages[m.stage + 1] &&
      now >= m.startedAt + config.zoneStages[m.stage + 1].afterMs
    ) {
      const stage = config.zoneStages[++m.stage];
      m.inset = stage.inset;
      m.final = stage.final ?? false;
      if (m.final)
        for (const p of m.players.values())
          if (p.status === "free") this.returnInside(m, p, now);
    }
    for (const p of m.players.values())
      if (p.status === "free") {
        if (m.final || inside(p, m.inset)) p.outsideSince = null;
        else {
          p.outsideSince ??= now;
          if (now - p.outsideSince >= config.outsideMs)
            this.eliminate(
              m,
              p.id,
              "Слишком долго за пределами безопасной зоны.",
            );
        }
      }
    this.resolveAbandoned(m, now);
    for (const d of m.duels.values()) {
      for (const [id, peek] of d.peeks) if (peek.until <= now) d.peeks.delete(id);
      if (now < d.endAt || d.resolved) continue;
      // Timers advance even if both peers are absent. Match victory still waits
      // for a connected survivor or expiration of all reconnect deadlines.
      const [a, b] = d.players;
      if (d.round === 2) {
        this.resolve(
          m,
          d,
          d.players[randomInt(2)],
          "В дополнительном раунде никто не набрал очков. Победитель определён жеребьёвкой.",
          now,
        );
        continue;
      }
      const ba = d.boards.get(a)!,
        bb = d.boards.get(b)!;
      const delta = score(ba) - score(bb) || ba.revealed - bb.revealed;
      if (delta)
        this.resolve(
          m,
          d,
          delta > 0 ? a : b,
          score(ba) !== score(bb)
            ? "Больше карт в основаниях."
            : "Открыто больше закрытых карт.",
          now,
        );
      else {
        overtime(d, now);
        d.players.forEach((id) =>
          this.notice(
            id,
            "Ничья. Новый расклад: первая карта в основании решит исход.",
          ),
        );
      }
    }
    this.maybeFinish(m, now);
    if (this.isFinished(m)) return;
    if (m.final) {
      const free = shuffled(
        [...m.players.values()].filter(
          (p) => p.status === "free" && p.connected && p.protectedUntil <= now,
        ),
      ).sort((a, b) => a.queueAt - b.queueAt);
      for (let i = 0; i + 1 < free.length; i += 2)
        this.begin(m, free[i], free[i + 1], now);
    } else this.collisions(m, now);
  }
  private isFinished(m: Match) {
    return m.phase === "finished";
  }
  tick(now = Date.now()) {
    this.rooms.tick(now);
    const finished = [...this.matches.values()]
      .filter((m) => m.phase === "finished")
      .sort((a, b) => a.endedAt! - b.endedAt!);
    const evict = new Set(
      finished
        .slice(0, Math.max(0, finished.length - config.maxMatches * 4))
        .map((m) => m.id),
    );
    for (const [id, m] of this.matches) {
      this.advance(m, now);
      if (
        m.endedAt !== null &&
        (now - m.endedAt >= config.resultRetentionMs || evict.has(id))
      ) {
        this.matches.delete(id);
        for (const p of m.players.values())
          if (this.membership.get(p.id) === id) this.membership.delete(p.id);
      }
    }
  }
  view(id: number, now = Date.now()): ClientState {
    const m = this.match(id),
      p = m?.players.get(id);
    if (!m || !p) return { room: this.rooms.view(id), match: null };
    const publicPerson = (v: Player): Person => ({
      id: v.id,
      name: v.name,
      status: v.status,
      connected: v.connected,
    });
    const spectating = p.status === "eliminated" || m.phase === "finished";
    const visible = (v: { x: number; y: number }) =>
      spectating || distance(p, v) <= config.vision;
    const d = m.duels.get(p.duelId ?? "");
    let duel: DuelView | null = null;
    if (d && p.status === "duel") {
      const opponent = d.players.find((x) => x !== id)!,
        peek = d.peeks.get(id);
      duel = {
        id: d.id,
        round: d.round,
        startAt: d.startAt,
        endAt: d.endAt,
        opponent: publicPerson(m.players.get(opponent)!),
        own: boardView(d.boards.get(id)!),
        opponentBoard: boardView(d.boards.get(opponent)!),
        revision: d.revisions.get(id)!,
        opponentRevision: d.revisions.get(opponent)!,
        peek:
          peek && peek.until > now
            ? {
                until: peek.until,
                cards: peek.cards.map((c) => ({ ...c })),
              }
            : null,
      };
    }
    const next = config.zoneStages[m.stage + 1];
    const match: MatchView = {
      id: m.id,
      startedAt: m.startedAt,
      alive: [...m.players.values()].filter((v) => v.status !== "eliminated")
        .length,
      roster: [...m.players.values()].map(publicPerson),
      map: {
        size: config.mapSize,
        vision: config.vision,
        moveMs: config.moveMs,
        inset: m.inset,
        nextInset: next?.inset ?? null,
        nextAt: next ? m.startedAt + next.afterMs : null,
        final: m.final,
        objects: levelObjects.map((object) => ({ ...object })),
        players: [...m.players.values()]
          .filter(
            (v) =>
              v.status !== "eliminated" && (visible(v) || p.reconUntil > now),
          )
          .map((v) => ({
            ...publicPerson(v),
            x: v.x,
            y: v.y,
            protected: v.protectedUntil > now,
          })),
        loot: m.loot.filter(visible).map((v) => ({ ...v })),
      },
      self: {
        id: p.id,
        x: p.x,
        y: p.y,
        status: p.status,
        inventory: [...p.inventory],
        inventorySize: config.inventorySize,
        outsideDeadline:
          p.outsideSince !== null ? p.outsideSince + config.outsideMs : null,
        protectedUntil: p.protectedUntil,
        reconUntil: p.reconUntil > now ? p.reconUntil : 0,
        reason: p.reason,
      },
      duel,
      result: m.result,
    };
    return { room: null, match };
  }
}
