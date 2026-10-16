-- Execute ONLY on isolated STAGING_DATABASE_URL, never the live Neon database.
-- Worker instances are stateless: password challenges must survive restarts.
CREATE TABLE IF NOT EXISTS staging_admin_challenges (
  chat_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS staging_admin_challenges_expiration ON staging_admin_challenges (expires_at);
-- Optional maintenance on staging: DELETE FROM staging_admin_challenges WHERE expires_at < now();
