import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";
export interface User {
  id: number;
  username: string;
  games: number;
  wins: number;
  duelWins: number;
}
export class Database {
  readonly sql: DatabaseSync;
  constructor(path = config.database) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    for (const name of readdirSync(resolve("migrations"))
      .filter((n) => /^\d+.*\.sql$/.test(n))
      .sort()) {
      if (this.sql.prepare("SELECT 1 FROM migrations WHERE name=?").get(name))
        continue;
      this.transaction(() => {
        this.sql.exec(readFileSync(resolve("migrations", name), "utf8"));
        this.sql
          .prepare("INSERT INTO migrations VALUES (?,?)")
          .run(name, Date.now());
      });
    }
    this.cleanSessions();
  }
  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.sql.exec("COMMIT");
      return value;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  user(id: number): User | undefined {
    return this.sql
      .prepare(
        "SELECT id,username,games,wins,duel_wins AS duelWins FROM users WHERE id=?",
      )
      .get(id) as unknown as User | undefined;
  }
  cleanSessions() {
    this.sql
      .prepare("DELETE FROM sessions WHERE expires_at<=?")
      .run(Date.now());
  }
  saveResult(match: {
    id: string;
    startedAt: number;
    endedAt: number;
    winner: number | null;
    players: Array<{ id: number; duelWins: number; reason: string }>;
  }) {
    this.transaction(() => {
      const saved = this.sql
        .prepare(
          "INSERT OR IGNORE INTO matches(id,started_at,ended_at,winner_id) VALUES (?,?,?,?)",
        )
        .run(match.id, match.startedAt, match.endedAt, match.winner);
      if (!saved.changes) return;
      for (const p of match.players) {
        this.sql
          .prepare(
            "INSERT INTO results(match_id,user_id,duel_wins,reason) VALUES (?,?,?,?)",
          )
          .run(match.id, p.id, p.duelWins, p.reason);
        this.sql
          .prepare(
            "UPDATE users SET games=games+1,wins=wins+?,duel_wins=duel_wins+? WHERE id=?",
          )
          .run(p.id === match.winner ? 1 : 0, p.duelWins, p.id);
      }
    });
  }
  close() {
    this.sql.close();
  }
}
