CREATE TABLE IF NOT EXISTS site_notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_key)
);

CREATE TABLE IF NOT EXISTS admin_reports (
 id BIGSERIAL PRIMARY KEY,
 domain TEXT NOT NULL,
 entity_key TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL,
 detail TEXT NOT NULL,
 reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'open',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
