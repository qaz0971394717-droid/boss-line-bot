CREATE TABLE IF NOT EXISTS boss_types (
 boss_key TEXT PRIMARY KEY NOT NULL,
 boss_name TEXT NOT NULL,
 minutes INTEGER NOT NULL CHECK(minutes > 0)
);
CREATE TABLE IF NOT EXISTS boss_kills (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 chat_id TEXT NOT NULL,
 boss_key TEXT NOT NULL,
 boss_name TEXT NOT NULL,
 kill_time TEXT NOT NULL,
 respawn_time TEXT NOT NULL,
 UNIQUE(chat_id,boss_key)
);
CREATE INDEX IF NOT EXISTS boss_kills_chat_respawn ON boss_kills(chat_id,respawn_time);
CREATE TABLE IF NOT EXISTS chat_settings (
 chat_id TEXT PRIMARY KEY NOT NULL,
 half_mode INTEGER NOT NULL DEFAULT 0 CHECK(half_mode IN (0,1))
);
CREATE TABLE IF NOT EXISTS staging_admin_challenges (
 chat_id TEXT PRIMARY KEY NOT NULL,
 command TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staging_admin_challenges_expiration ON staging_admin_challenges(expires_at);
CREATE TABLE IF NOT EXISTS staging_line_events (
 event_id TEXT PRIMARY KEY NOT NULL,
 reply TEXT,
 delivered_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
