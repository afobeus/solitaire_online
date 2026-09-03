CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  duel_wins INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE matches (
  id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  winner_id INTEGER REFERENCES users(id)
);
CREATE TABLE results (
  match_id TEXT NOT NULL REFERENCES matches(id),
  user_id INTEGER NOT NULL REFERENCES users(id), duel_wins INTEGER NOT NULL,
  reason TEXT NOT NULL, PRIMARY KEY(match_id,user_id)
);
CREATE INDEX results_user ON results(user_id);
