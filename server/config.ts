function integer(name: string, fallback: number, min = 1, max = 1e9): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Некорректная настройка ${name}`);
  return value;
}
export const config = {
  production: process.env.NODE_ENV === "production",
  port: integer("PORT", 3000, 1, 65535),
  host: process.env.HOST ?? "0.0.0.0",
  origin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  database: process.env.DATABASE_PATH ?? "./data/solitaire.sqlite",
  trustProxy: process.env.TRUST_PROXY === "true",
  maxMatches: integer("MAX_MATCHES", 12),
  maxConnections: integer("MAX_CONNECTIONS", 120),
  maxRooms: integer("MAX_ROOMS", 40),
  maxPlayers: integer("MAX_PLAYERS", 8, 2, 8),
  maxPayload: integer("MAX_MESSAGE_BYTES", 4096, 512, 65536),
  maxBuffered: integer("MAX_BUFFERED_BYTES", 262144, 8192),
  commandsPerSecond: integer("COMMANDS_PER_SECOND", 20, 2, 100),
  moveMs: integer("MOVE_MS", 180, 30),
  tickMs: integer("TICK_MS", 250, 50, 1000),
  disconnectMs: integer("DISCONNECT_MS", 20000, 1000),
  countdownMs: integer("COUNTDOWN_MS", 3000, 0),
  duelMs: integer("DUEL_MS", 360000),
  protectionMs: integer("PROTECTION_MS", 5000),
  outsideMs: integer("OUTSIDE_MS", 10000),
  reconMs: integer("RECON_MS", 8000),
  peekMs: integer("PEEK_MS", 5000),
  mapSize: integer("MAP_SIZE", 18, 8, 24),
  vision: integer("VISION_RADIUS", 4, 1, 20),
  lootCount: integer("LOOT_COUNT", 9, 3, 100),
  inventorySize: integer("INVENTORY_SIZE", 3, 1, 6),
  sessionDays: integer("SESSION_DAYS", 30, 1, 90),
  resultRetentionMs: integer("RESULT_RETENTION_MS", 60000, 5000),
  zoneStages: JSON.parse(
    process.env.ZONE_STAGES ??
      '[{"afterMs":90000,"inset":2},{"afterMs":180000,"inset":4},{"afterMs":270000,"inset":5},{"afterMs":330000,"inset":7},{"afterMs":360000,"inset":8,"final":true}]',
  ) as Array<{ afterMs: number; inset: number; final?: boolean }>,
};
if (
  new URL(config.origin).origin !== config.origin ||
  (config.production && !config.origin.startsWith("https://"))
)
  throw new Error(
    "APP_ORIGIN должен быть origin без пути; production требует HTTPS",
  );
if (
  !Array.isArray(config.zoneStages) ||
  !config.zoneStages.length ||
  config.zoneStages.some(
    (s, i, a) =>
      !Number.isInteger(s.afterMs) ||
      s.afterMs < 1 ||
      !Number.isInteger(s.inset) ||
      s.inset < 0 ||
      s.inset >= config.mapSize / 2 ||
      (i > 0 && (s.afterMs <= a[i - 1].afterMs || s.inset < a[i - 1].inset)) ||
      (s.final && i !== a.length - 1),
  ) ||
  !config.zoneStages.at(-1)?.final
)
  throw new Error(
    "ZONE_STAGES: нужны возрастающие этапы, допустимые границы и финальный этап",
  );
