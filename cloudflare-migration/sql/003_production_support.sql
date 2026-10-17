-- Additive support tables only. Does not seed or modify boss/group records.
-- Apply after backup to the production database before switching the webhook.
-- Names match the shared command engine for durable event/challenge storage.
BEGIN;
CREATE TABLE IF NOT EXISTS staging_admin_challenges (
  chat_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS staging_admin_challenges_expiration ON staging_admin_challenges (expires_at);
CREATE TABLE IF NOT EXISTS staging_line_events (
  event_id TEXT PRIMARY KEY,
  reply JSONB,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
