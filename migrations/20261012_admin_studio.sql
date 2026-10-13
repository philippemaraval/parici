-- Additive administration schema; no player data reset.
CREATE TABLE IF NOT EXISTS admin_drafts (
 id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('daily','explorer','card','street','event')),
 entity_key TEXT NOT NULL, title TEXT NOT NULL, payload JSONB NOT NULL,
 base_snapshot JSONB, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','scheduled','published','failed','archived')),
 revision INTEGER NOT NULL DEFAULT 0, publish_at TIMESTAMPTZ, error TEXT,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_drafts_schedule_idx ON admin_drafts(publish_at) WHERE state='scheduled';
CREATE TABLE IF NOT EXISTS admin_entity_revisions (
 id BIGSERIAL PRIMARY KEY, domain TEXT NOT NULL, entity_key TEXT NOT NULL,
 before_json JSONB, after_json JSONB, actor TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_entity_revisions_entity_idx ON admin_entity_revisions(domain,entity_key,id DESC);
CREATE OR REPLACE FUNCTION admin_record_content_revision() RETURNS trigger AS $$
DECLARE previous JSONB; current_row JSONB;
BEGIN
 IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN current_row := to_jsonb(NEW); END IF;
 IF (previous - 'updated_at') IS DISTINCT FROM (current_row - 'updated_at') THEN
 INSERT INTO admin_entity_revisions(domain,entity_key,before_json,after_json,actor,reason)
 VALUES(TG_ARGV[0],COALESCE(current_row->>TG_ARGV[1],previous->>TG_ARGV[1]),previous,current_row,
 COALESCE(NULLIF(current_setting('camino.admin_actor',true),''),'API / synchronisation'),COALESCE(current_setting('camino.admin_reason',true),''));
 END IF;
 RETURN COALESCE(NEW,OLD);
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS admin_history ON explorer_riddles;
CREATE TRIGGER admin_history AFTER INSERT OR UPDATE OR DELETE ON explorer_riddles FOR EACH ROW EXECUTE FUNCTION admin_record_content_revision('explorer','id');
DROP TRIGGER IF EXISTS admin_history ON cards;
CREATE TRIGGER admin_history AFTER UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION admin_record_content_revision('card','id');
ALTER TABLE daily_targets ADD COLUMN IF NOT EXISTS image_url TEXT;
DROP TRIGGER IF EXISTS admin_history ON daily_targets;
CREATE TRIGGER admin_history AFTER INSERT OR UPDATE ON daily_targets FOR EACH ROW EXECUTE FUNCTION admin_record_content_revision('daily','date');
CREATE TABLE IF NOT EXISTS admin_reports (
 id BIGSERIAL PRIMARY KEY, domain TEXT NOT NULL, entity_key TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
 detail TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'normal' CHECK(severity IN ('low','normal','high','critical')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','dismissed')),
 assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 resolution TEXT NOT NULL DEFAULT '', source_key TEXT UNIQUE, revision INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS source_key TEXT UNIQUE;
ALTER TABLE admin_reports ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS admin_reports_status_idx ON admin_reports(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS admin_interventions (
 id UUID PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL, reason TEXT NOT NULL, before_json JSONB NOT NULL, after_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS admin_permissions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed BOOLEAN NOT NULL, PRIMARY KEY(user_id,permission)
);
CREATE TABLE IF NOT EXISTS admin_mfa (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_encrypted TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, last_counter BIGINT NOT NULL DEFAULT -1, recovery_hashes JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_version INTEGER NOT NULL,
 user_agent TEXT NOT NULL, first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_events (
 week_start DATE PRIMARY KEY, title TEXT NOT NULL, objectives JSONB NOT NULL, published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS admin_campaigns (
 id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('all','active30','inactive30')),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','sent','cancelled')), revision INTEGER NOT NULL DEFAULT 0,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_campaign_deliveries (
 campaign_id BIGINT NOT NULL REFERENCES admin_campaigns(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 test BOOLEAN NOT NULL DEFAULT FALSE, delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ, PRIMARY KEY(campaign_id,user_id,test)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_announcements BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS admin_backup_runs (
 run_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('success','failure')), backup_name TEXT NOT NULL,
 checksum TEXT, restored_tables INTEGER, detail TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE card_copies DROP CONSTRAINT IF EXISTS card_copies_source_check;
ALTER TABLE card_copies ADD CONSTRAINT card_copies_source_check CHECK(source IN('daily','collect','weekly','admin'));
ALTER TABLE card_copies DROP CONSTRAINT IF EXISTS card_copies_check;
ALTER TABLE card_copies ADD CONSTRAINT card_copies_check CHECK(
 (source='daily' AND daily_attempt_count IS NOT NULL AND daily_date IS NOT NULL AND daily_attempt_count BETWEEN 1 AND 7)
 OR (source IN('collect','weekly','admin') AND daily_attempt_count IS NULL AND daily_date IS NULL));

ALTER TABLE explorer_step_sessions ADD COLUMN IF NOT EXISTS riddle_snapshot JSONB;
UPDATE explorer_step_sessions s SET riddle_snapshot=to_jsonb(r) FROM explorer_riddles r WHERE r.id=s.riddle_id AND s.riddle_snapshot IS NULL;

ALTER TABLE admin_drafts ADD COLUMN IF NOT EXISTS publisher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
DROP TRIGGER IF EXISTS admin_history ON admin_events;
CREATE TRIGGER admin_history AFTER INSERT OR UPDATE ON admin_events FOR EACH ROW EXECUTE FUNCTION admin_record_content_revision('event','week_start');

ALTER TABLE admin_interventions ADD COLUMN IF NOT EXISTS request_hash TEXT;
