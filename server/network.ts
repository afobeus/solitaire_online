import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import {
  commandSchema,
  makePatch,
  type ClientState,
  type ServerMessage,
} from "../shared/protocol.js";
import { Auth } from "./auth.js";
import { Database, type User } from "./db.js";
import { Game } from "./game.js";
import { config } from "./config.js";
interface Peer {
  ws: WebSocket;
  user: User;
  seq: number;
  view: ClientState | null;
  alive: boolean;
  budget: number;
  budgetAt: number;
  tokenHash: string;
  expiresAt: number;
}
export class Network {
  readonly peers = new Map<number, Peer>();
  readonly game: Game;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private disconnect(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
    // Give the close frame time to reach the browser, avoiding reconnect/takeover loops.
    const timer = setTimeout(() => ws.terminate(), 1000);
    timer.unref();
    ws.once("close", () => clearTimeout(timer));
  }
  constructor(
    private db: Database,
    private auth: Auth,
  ) {
    this.game = new Game(db, (id, message) => {
      const p = this.peers.get(id);
      if (p) this.send(p, { type: "notice", message });
    });
  }
  private send(p: Peer, message: ServerMessage): boolean {
    if (p.ws.readyState !== WebSocket.OPEN) return false;
    if (p.ws.bufferedAmount > config.maxBuffered) {
      p.ws.terminate();
      return false;
    }
    p.ws.send(JSON.stringify(message), (e) => {
      if (e) p.ws.terminate();
    });
    return true;
  }
  flush(forceId?: number) {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      const state = this.game.view(id, now);
      if (!p.view || forceId === id) {
        this.send(p, { type: "snapshot", seq: ++p.seq, now, state });
        p.view = state;
      } else {
        const patch = makePatch(p.view, state);
        if (patch !== undefined) {
          this.send(p, {
            type: "patch",
            seq: ++p.seq,
            now,
            patch: patch as Record<string, unknown>,
          });
          p.view = state;
        }
      }
    }
  }
  logout(id: number) {
    const p = this.peers.get(id);
    if (p) this.disconnect(p.ws, 4001, "Session closed");
  }
  async register(app: FastifyInstance) {
    app.get(
      "/ws",
      {
        websocket: true,
        preValidation: async (req, reply) => {
          if (req.headers.origin !== config.origin)
            return reply.code(403).send({ error: "Недопустимый Origin." });
          const session = this.auth.session(req);
          if (!session)
            return reply.code(401).send({ error: "Войдите в аккаунт." });
          if (
            this.peers.size >= config.maxConnections &&
            !this.peers.has(session.user.id)
          )
            return reply.code(503).send({ error: "Сервер заполнен." });
        },
      },
      (ws, req) => {
        const session = this.auth.session(req);
        if (!session) {
          ws.close(4001, "Unauthorized");
          return;
        }
        const { user, tokenHash, expiresAt } = session;
        const old = this.peers.get(user.id);
        if (!old && this.peers.size >= config.maxConnections) {
          ws.close(4003, "Server full");
          return;
        }
        const peer: Peer = {
          ws,
          user,
          seq: 0,
          view: null,
          alive: true,
          budget: config.commandsPerSecond,
          budgetAt: Date.now(),
          tokenHash,
          expiresAt,
        };
        this.peers.set(user.id, peer);
        if (old) {
          this.send(old, {
            type: "replaced",
            message:
              "Управление перенесено в другую вкладку. Закройте её или нажмите «Вернуть управление».",
          });
          this.disconnect(old.ws, 4002, "Replaced");
        }
        this.game.connection(user.id, true);
        ws.on("pong", () => {
          peer.alive = true;
        });
        ws.on("error", () => ws.terminate());
        ws.on("close", () => {
          if (this.peers.get(user.id) !== peer) return;
          this.peers.delete(user.id);
          this.game.connection(user.id, false);
          this.flush();
        });
        ws.on("message", (raw, isBinary) => {
          if (this.peers.get(user.id) !== peer) return;
          const now = Date.now();
          if (now >= peer.expiresAt) {
            ws.close(4001, "Session expired");
            return;
          }
          peer.budget = Math.min(
            config.commandsPerSecond,
            peer.budget +
              ((now - peer.budgetAt) * config.commandsPerSecond) / 1000,
          );
          peer.budgetAt = now;
          if (peer.budget < 1) {
            ws.close(4008, "Rate limited");
            return;
          }
          peer.budget--;
          try {
            if (isBinary) throw new Error("Ожидалось текстовое сообщение.");
            const parsed = commandSchema.safeParse(JSON.parse(raw.toString()));
            if (!parsed.success) throw new Error("Некорректная команда.");
            this.game.command(user, parsed.data, now);
            this.flush(parsed.data.type === "sync" ? user.id : undefined);
          } catch (error) {
            this.send(peer, {
              type: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Не удалось выполнить действие.",
            });
            this.flush(user.id);
          }
        });
        this.flush(user.id);
      },
    );
    this.tickTimer = setInterval(() => {
      try {
        this.game.tick();
        this.flush();
      } catch {
        app.log.error("Ошибка обновления игрового состояния");
      }
    }, config.tickMs);
    this.pingTimer = setInterval(() => {
      this.db.cleanSessions();
      for (const p of this.peers.values()) {
        if (!p.alive) {
          p.ws.terminate();
          continue;
        }
        const valid = this.db.sql
          .prepare("SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?")
          .get(p.tokenHash, Date.now());
        if (!valid) {
          this.disconnect(p.ws, 4001, "Session expired");
          continue;
        }
        p.alive = false;
        p.ws.ping();
      }
    }, 10000);
  }
  close() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const p of this.peers.values()) p.ws.terminate();
    this.peers.clear();
  }
}
