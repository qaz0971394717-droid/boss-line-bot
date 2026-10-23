-- Apply ONLY to the isolated staging database before enabling LINE.
-- Keep claims indefinitely until an operator reconciles any pending events.
-- Clearing a claim permits a LINE redelivery to run the command again.
CREATE TABLE IF NOT EXISTS staging_line_events (
  event_id TEXT PRIMARY KEY,
  reply JSONB,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
