CREATE TABLE IF NOT EXISTS memo_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('note','task','reminder')),
 content TEXT NOT NULL,
 due_at TEXT,
 notice_minutes INTEGER CHECK(notice_minutes BETWEEN 0 AND 10080),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 completed_at TEXT,
 deleted_at TEXT,
 source_event TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS memo_owner_list ON memo_items(owner_id,deleted_at,status,due_at,id);
CREATE TABLE IF NOT EXISTS memo_events (
 event_id TEXT PRIMARY KEY,
 state TEXT NOT NULL CHECK(state IN ('pending','ready','delivered')),
 reply TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memo_events_cleanup ON memo_events(state,updated_at);
