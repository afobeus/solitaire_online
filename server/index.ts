import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { Database } from "./db.js";
import { Auth } from "./auth.js";
import { Network } from "./network.js";
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers.set-cookie",
      "req.body",
    ],
  },
  disableRequestLogging: true,
  bodyLimit: 8192,
  trustProxy: config.trustProxy,
  requestTimeout: 15000,
  connectionTimeout: 15000,
});
const db = new Database(),
  auth = new Auth(db),
  network = new Network(db, auth);
await app.register(cookie);
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: "1 minute",
  cache: 5000,
  errorResponseBuilder: () => ({
    error: "Слишком много запросов. Попробуйте чуть позже.",
  }),
});
await app.register(websocket, {
  options: { maxPayload: config.maxPayload, perMessageDeflate: false },
});
app.addHook("onRequest", async (req, reply) => {
  reply
    .header("X-Content-Type-Options", "nosniff")
    .header("Referrer-Policy", "same-origin")
    .header("X-Frame-Options", "DENY");
  if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  if (config.production)
    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${config.origin.replace(/^http/, "ws")}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin !== config.origin
  )
    return reply.code(403).send({ error: "Недопустимый источник запроса." });
});
await auth.routes(app, (id) => network.logout(id));
app.get("/api/rooms", async (req, reply) => {
  if (!auth.session(req))
    return reply.code(401).send({ error: "Войдите в аккаунт." });
  return { rooms: network.game.rooms.list() };
});
app.get("/api/health", { config: { rateLimit: false } }, async () => {
  db.sql.prepare("SELECT 1").get();
  return { ok: true };
});
await network.register(app);
if (existsSync(resolve("dist/client/index.html"))) {
  await app.register(staticFiles, {
    root: resolve("dist/client"),
    prefix: "/",
  });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") ||
    req.url.startsWith("/ws") ||
    req.url.includes(".")
      ? reply.code(404).send({ error: "Не найдено." })
      : reply.sendFile("index.html"),
  );
}
app.setErrorHandler((error, req, reply) => {
  const code = (error as { statusCode?: number }).statusCode ?? 500;
  if (code >= 500)
    app.log.error(
      { code: (error as { code?: string }).code ?? "INTERNAL" },
      "Ошибка запроса",
    );
  reply
    .code(code)
    .send({
      error:
        code >= 500
          ? "Ошибка сервера. Попробуйте позже."
          : "Некорректный запрос.",
    });
});
app.addHook("onClose", async () => {
  network.close();
  db.close();
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  network.close();
  await app.close();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
await app.listen({ port: config.port, host: config.host });
