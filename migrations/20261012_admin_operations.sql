CREATE TABLE IF NOT EXISTS admin_content_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO admin_content_state(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS admin_content_revisions (
  id SERIAL PRIMARY KEY, actor_username TEXT NOT NULL, action TEXT NOT NULL,
  before_settings JSONB NOT NULL, after_settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS explorer_uploaded_images (
  filename TEXT PRIMARY KEY, mime_type TEXT NOT NULL,
  content BYTEA NOT NULL CHECK(octet_length(content) <= 5242880),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
