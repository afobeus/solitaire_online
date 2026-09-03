import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { Database, type User } from "./db.js";
import { config } from "./config.js";
const credentials = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Zа-яА-ЯёЁ0-9_]{3,24}$/u),
    password: z.string().min(8).max(128),
  })
  .strict();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function hash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    ),
  );
}
export class Auth {
  private hashing = 0;
  constructor(private db: Database) {}
  session(
    req: FastifyRequest,
  ): { user: User; tokenHash: string; expiresAt: number } | null {
    const token = req.cookies.sbr_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = digest(token);
    const row = this.db.sql
      .prepare(
        "SELECT user_id,expires_at FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(tokenHash, Date.now()) as
      | { user_id: number; expires_at: number }
      | undefined;
    const user = row && this.db.user(row.user_id);
    return user && row ? { user, tokenHash, expiresAt: row.expires_at } : null;
  }
  private issue(user: User, req: FastifyRequest, reply: FastifyReply) {
    const token = randomBytes(32).toString("hex"),
      expires = Date.now() + config.sessionDays * 86400000;
    const previous = req.cookies.sbr_session;
    this.db.transaction(() => {
      if (previous)
        this.db.sql
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .run(digest(previous));
      this.db.sql
        .prepare("INSERT INTO sessions VALUES (?,?,?)")
        .run(digest(token), user.id, expires);
      this.db.sql
        .prepare(
          "DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 5)",
        )
        .run(user.id, user.id);
    });
    reply.setCookie("sbr_session", token, {
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      path: "/",
      maxAge: config.sessionDays * 86400,
    });
    return { user };
  }
  async routes(app: FastifyInstance, onLogout: (id: number) => void) {
    app.get("/api/me", async (req) => ({
      user: this.session(req)?.user ?? null,
    }));
    for (const mode of ["register", "login"] as const)
      app.post(
        `/api/auth/${mode}`,
        {
          config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        },
        async (req, reply) => {
          const parsed = credentials.safeParse(req.body);
          if (!parsed.success)
            return reply
              .code(400)
              .send({
                error:
                  "Логин: 3–24 буквы, цифры или _. Пароль: 8–128 символов.",
              });
          if (this.hashing >= 2)
            return reply
              .code(503)
              .send({
                error:
                  "Вход временно занят. Попробуйте через несколько секунд.",
              });
          this.hashing++;
          try {
            const { username, password } = parsed.data;
            if (mode === "register") {
              const salt = randomBytes(16).toString("hex"),
                key = await hash(password, salt);
              let id: number;
              try {
                id = Number(
                  this.db.sql
                    .prepare(
                      "INSERT INTO users(username,password_hash,salt,created_at) VALUES (?,?,?,?)",
                    )
                    .run(username, key.toString("hex"), salt, Date.now())
                    .lastInsertRowid,
                );
              } catch (error) {
                if (String(error).includes("UNIQUE"))
                  return reply
                    .code(409)
                    .send({ error: "Этот логин уже занят." });
                throw error;
              }
              return this.issue(this.db.user(id)!, req, reply);
            }
            const row = this.db.sql
              .prepare(
                "SELECT id,password_hash,salt FROM users WHERE username=?",
              )
              .get(username) as
              | { id: number; password_hash: string; salt: string }
              | undefined;
            const key = await hash(
              password,
              row?.salt ?? "missing-account-dummy-salt",
            );
            if (
              !row ||
              !timingSafeEqual(key, Buffer.from(row.password_hash, "hex"))
            )
              return reply
                .code(401)
                .send({ error: "Неверный логин или пароль." });
            return this.issue(this.db.user(row.id)!, req, reply);
          } finally {
            this.hashing--;
          }
        },
      );
    app.post("/api/auth/logout", async (req, reply) => {
      const session = this.session(req);
      if (session) {
        this.db.sql
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .run(session.tokenHash);
        onLogout(session.user.id);
      }
      reply.clearCookie("sbr_session", { path: "/" });
      return { ok: true };
    });
  }
}
