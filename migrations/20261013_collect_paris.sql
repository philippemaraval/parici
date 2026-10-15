ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS daily_enabled BOOLEAN NOT NULL DEFAULT TRUE;
-- Parici Collect: additive schema, no historical account or inventory reset.
-- 20260928_collect_v1.sql
CREATE TABLE IF NOT EXISTS cards (
  id BIGSERIAL PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN ('street', 'district', 'monument', 'bus')),
  source_entity_id TEXT NOT NULL,
  collection_number INTEGER NOT NULL CHECK (collection_number > 0),
  name TEXT NOT NULL,
  image_reference TEXT,
  base_rarity SMALLINT NOT NULL DEFAULT 1 CHECK (base_rarity BETWEEN 1 AND 5),
  current_rarity SMALLINT NOT NULL DEFAULT 1 CHECK (current_rarity BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (family, source_entity_id),
  UNIQUE (family, collection_number)
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS catalog_present BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS card_copies (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('daily', 'collect')),
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  daily_attempt_count SMALLINT,
  daily_date TEXT,
  CHECK ((source = 'daily' AND daily_attempt_count IS NOT NULL AND daily_date IS NOT NULL AND daily_attempt_count BETWEEN 1 AND 7)
      OR (source = 'collect' AND daily_attempt_count IS NULL AND daily_date IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_copy_per_user_date
  ON card_copies(user_id, daily_date) WHERE source = 'daily';
CREATE INDEX IF NOT EXISTS idx_card_copies_user_card ON card_copies(user_id, card_id, obtained_at);
CREATE INDEX IF NOT EXISTS idx_card_copies_user_obtained ON card_copies(user_id, obtained_at DESC);

CREATE TABLE IF NOT EXISTS collect_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correct BOOLEAN NOT NULL,
  reward_available BOOLEAN NOT NULL,
  reward_granted BOOLEAN NOT NULL,
  request_id TEXT UNIQUE,
  CHECK (NOT reward_granted OR (correct AND reward_available))
);
CREATE INDEX IF NOT EXISTS idx_collect_attempts_card_played ON collect_attempts(card_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_collect_attempts_user_played ON collect_attempts(user_id, played_at DESC);
CREATE TABLE IF NOT EXISTS collect_games (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  answer_entity_id TEXT,
  correct BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_collect_games_user_started ON collect_games(user_id, started_at DESC);
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS answer_context TEXT;
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS result_json JSONB;
CREATE TABLE IF NOT EXISTS card_answer_aliases (
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  answer_entity_id TEXT NOT NULL,
  answer_context TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(card_id, answer_entity_id, answer_context)
);

CREATE TABLE IF NOT EXISTS card_rarity_history (
  id BIGSERIAL PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  old_rarity SMALLINT NOT NULL CHECK (old_rarity BETWEEN 1 AND 5),
  new_rarity SMALLINT NOT NULL CHECK (new_rarity BETWEEN 1 AND 5),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL,
  success_rate NUMERIC(7,6) NOT NULL CHECK (success_rate BETWEEN 0 AND 1),
  UNIQUE(card_id, changed_at)
);
CREATE TABLE IF NOT EXISTS collect_rarity_recalc_runs (
  month_key TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cards_updated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS albums (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS album_cards (
  album_id BIGINT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  PRIMARY KEY(album_id, card_id)
);
CREATE TABLE IF NOT EXISTS collect_badges (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS user_collect_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id BIGINT NOT NULL REFERENCES collect_badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, badge_id)
);
INSERT INTO albums(slug, name, description) VALUES
  ('streets', 'Les rues de Paris', 'Les rues présentes dans Camino.'),
  ('districts', 'Les quartiers', 'Les 111 quartiers administratifs de Paris.'),
  ('monuments', 'Les monuments', 'Les monuments déjà référencés dans Camino.'),
  ('bus', 'Les transports', 'Les transports déjà référencées dans Camino.')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO collect_badges(slug, name, description, rule_json) VALUES
  ('collect-first-card', 'Première carte', 'Gagner sa première carte.', '{"type":"first_card"}'::jsonb),
  ('collect-10-cards', 'Collectionneur', 'Posséder 10 cartes distinctes actives.', '{"type":"distinct_cards","count":10}'::jsonb),
  ('collect-100-cards', 'Grand collectionneur', 'Posséder 100 cartes distinctes actives.', '{"type":"distinct_cards","count":100}'::jsonb),
  ('album-streets', 'Album des rues complet', 'Compléter l’album des rues.', '{"type":"family_complete","family":"street"}'::jsonb),
  ('album-districts', 'Album des quartiers complet', 'Compléter l’album des quartiers.', '{"type":"family_complete","family":"district"}'::jsonb),
  ('album-monuments', 'Album des monuments complet', 'Compléter l’album des monuments.', '{"type":"family_complete","family":"monument"}'::jsonb),
  ('album-bus', 'Album des transports complet', 'Compléter l’album des transports.', '{"type":"family_complete","family":"bus"}'::jsonb),
  ('collect-master', 'Parici complet', 'Posséder toutes les cartes actives.', '{"type":"all_active_cards"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS collect_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO collect_config(key, value_json) VALUES
  ('family_weights', '{"street":76,"district":8,"monument":8,"bus":8}'::jsonb),
  ('performance_ranking', '{"minimum_attempts":50}'::jsonb),
  ('reward_quota', '{"copies":4,"window_minutes":20}'::jsonb),
  ('rarity', '{"labels":{"1":"Commune","2":"Rare","3":"Épique","4":"Légendaire"},"difficulty_to_base_rarity":{"very_easy":1,"easy":2,"medium":3,"hard":4},"minimum_attempts":50,"success_rate_thresholds":[0.65,0.40,0.20],"recalculate":"monthly"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings(key, value_text, updated_at)
VALUES ('collect_launch_at', 'infinity', NOW())
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()
WHERE app_settings.value_text IS NULL;

CREATE OR REPLACE FUNCTION enforce_collect_reward_quota()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  quota_limit INTEGER := 4;
  window_minutes INTEGER := 20;
  recent_copies INTEGER := 0;
BEGIN
  PERFORM 1 FROM cards WHERE id = NEW.card_id AND status = 'active' AND catalog_present FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'collect_card_archived' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.source = 'collect' THEN
    PERFORM 1 FROM users WHERE id = NEW.user_id FOR UPDATE;
    NEW.obtained_at := clock_timestamp();
    SELECT COALESCE((value_json->>'copies')::integer, 4),
           COALESCE((value_json->>'window_minutes')::integer, 20)
      INTO quota_limit, window_minutes FROM collect_config WHERE key = 'reward_quota';
    SELECT COUNT(*) INTO recent_copies FROM card_copies
        WHERE user_id = NEW.user_id AND source = 'collect'
          AND obtained_at > clock_timestamp() - make_interval(mins => window_minutes);
    IF recent_copies >= quota_limit THEN
      RAISE EXCEPTION 'collect_reward_quota_reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS card_copies_collect_quota ON card_copies;
CREATE TRIGGER card_copies_collect_quota
BEFORE INSERT ON card_copies FOR EACH ROW EXECUTE FUNCTION enforce_collect_reward_quota();

CREATE OR REPLACE FUNCTION preserve_collect_card_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.collection_number <> OLD.collection_number OR NEW.family <> OLD.family
     OR NEW.source_entity_id <> OLD.source_entity_id THEN
    RAISE EXCEPTION 'collect_card_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cards_immutable_identity ON cards;
CREATE TRIGGER cards_immutable_identity BEFORE UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION preserve_collect_card_number();

-- Editorial overrides survive automatic catalogue synchronisation.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_override TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS description_override TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_credit_override TEXT;

-- 20260928_collect_fragments.sql
-- Optional per-item question banks. Existing cards and copies retain their meaning.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS fragments_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS fragments_required INTEGER NOT NULL DEFAULT 1 CHECK (fragments_required BETWEEN 1 AND 100);
CREATE TABLE IF NOT EXISTS collect_questions (
 id UUID PRIMARY KEY, card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, theme TEXT NOT NULL, text TEXT NOT NULL,
 answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) = 4),
 correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3), explanation TEXT NOT NULL,
 UNIQUE(card_id, position)
);
CREATE TABLE IF NOT EXISTS collect_fragment_progress (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 fragments INTEGER NOT NULL DEFAULT 0 CHECK (fragments >= 0), PRIMARY KEY(user_id, card_id)
);
CREATE TABLE IF NOT EXISTS collect_question_history (
 game_id UUID PRIMARY KEY REFERENCES collect_games(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 question_id UUID NOT NULL, answered_at TIMESTAMPTZ, correct BOOLEAN
);
CREATE INDEX IF NOT EXISTS collect_question_history_rotation ON collect_question_history(user_id, card_id, question_id);
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS question_snapshot JSONB;

-- 20260929_collect_acquisition.sql
-- Apply approved initial settings once; later recalibration survives every restart.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key='collect_acquisition_v1') THEN
    UPDATE collect_config SET value_json = value_json || '{"minimum_attempts":50}'::jsonb WHERE key='performance_ranking';
    UPDATE collect_config SET value_json = value_json || '{"minimum_attempts":50,"success_rate_thresholds":[0.65,0.40,0.20],"recalculate":"monthly"}'::jsonb WHERE key='rarity';
    ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_fragments_required_check;
    -- Preserve question banks, copies and accumulated progress while formalizing tiers.
    UPDATE cards SET fragments_required = CASE
      WHEN NOT fragments_enabled THEN 0
      WHEN fragments_required <= 2 THEN 2
      WHEN fragments_required = 3 THEN 3
      ELSE 4 END;
    ALTER TABLE cards ALTER COLUMN fragments_required SET DEFAULT 0;
    ALTER TABLE cards ADD CONSTRAINT cards_fragments_required_check CHECK (
      (NOT fragments_enabled AND fragments_required=0) OR
      (fragments_enabled AND fragments_required IN (2,3,4))
    );
    INSERT INTO app_settings(key,value_text,updated_at) VALUES('collect_acquisition_v1','20260929',NOW());
  END IF;
END $$;

-- 20261001_collect_street_merges.sql
-- Reversible aliases between former segment cards and their canonical street card.
-- Copies, attempts and question history remain on their original immutable card.
CREATE TABLE IF NOT EXISTS collect_card_merges (
  source_card_id BIGINT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  canonical_card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_card_id <> canonical_card_id)
);
CREATE INDEX IF NOT EXISTS idx_collect_card_merges_canonical
  ON collect_card_merges(canonical_card_id);

-- 20261001_collect_rarity_override.sql
-- An administrator can pin a card rarity. NULL keeps the automatic rarity.
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS rarity_override SMALLINT
  CHECK (rarity_override BETWEEN 1 AND 5);


-- 20261001_collect_rarity_catalog.sql
-- One-time repair. A database already on schema 20261001-12 has received it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key='collect_twenty_attempts_applied') THEN
    IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key='collect_v1_schema'
      AND value_text IN ('20261001-12','20261001-13')) THEN
-- Initial rarity estimates remain active until 20 placement attempts have been
-- observed. Performance ranking keeps its independent 50-attempt threshold.
UPDATE collect_config
SET value_json = jsonb_set(value_json, '{minimum_attempts}', '20'::jsonb, true),
    updated_at = NOW()
WHERE key = 'rarity';

    END IF;
    INSERT INTO app_settings(key,value_text,updated_at) VALUES('collect_twenty_attempts_applied','applied',NOW());
  END IF;
END $$;

-- 20261001_collect_draw_weights.sql
-- Keep the approved zone probabilities; weight cards within each zone by rarity.
-- Existing administrator configuration takes precedence.
INSERT INTO collect_config(key,value_json) VALUES
  ('street_category_weights','{"famous":6,"main":16,"other":54}'::jsonb),
  ('rarity_draw_weights','{"1":2,"2":0.75,"3":1,"4":0.8,"5":0.8}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Older schemas exposed four labels until the fragment bank was seeded.
UPDATE collect_config SET value_json=jsonb_set(value_json,'{labels}',
  '{"1":"Commune","2":"Peu commune","3":"Rare","4":"Épique","5":"Légendaire"}'::jsonb), updated_at=NOW()
WHERE key='rarity' AND NOT COALESCE((value_json->'labels') ? '5', FALSE);

-- Materialize the strongest existing progress once on the canonical card.
-- Retain every source row as history; future cycles use the canonical row only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_settings WHERE key='collect_fragment_canonical_v1') THEN
    INSERT INTO collect_fragment_progress(user_id,card_id,fragments)
    SELECT p.user_id,m.canonical_card_id,MAX(p.fragments)
    FROM collect_fragment_progress p JOIN collect_card_merges m ON m.source_card_id=p.card_id
    GROUP BY p.user_id,m.canonical_card_id
    ON CONFLICT(user_id,card_id) DO UPDATE
      SET fragments=GREATEST(collect_fragment_progress.fragments,EXCLUDED.fragments);
    INSERT INTO app_settings(key,value_text,updated_at) VALUES('collect_fragment_canonical_v1','applied',NOW());
  END IF;
END $$;

-- 20261002_collect_initial_rarity.sql
-- Initial estimates are independent of the existing manual freeze.
ALTER TABLE cards ADD COLUMN IF NOT EXISTS base_rarity_override SMALLINT
  CHECK (base_rarity_override BETWEEN 1 AND 5);
ALTER TABLE cards ADD COLUMN IF NOT EXISTS rarity_evaluated_at TIMESTAMPTZ;

-- Preserve already calculated rarities, including monthly runs with no change.
UPDATE cards c SET rarity_evaluated_at = COALESCE(
  (SELECT MAX(changed_at) FROM card_rarity_history WHERE card_id=c.id),
  (SELECT MAX(r.completed_at) FROM collect_rarity_recalc_runs r
   WHERE r.completed_at IS NOT NULL AND c.rarity_override IS NULL AND
     (SELECT COUNT(*) FROM collect_attempts a
      WHERE (a.card_id=c.id OR a.card_id IN
        (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))
        AND a.played_at<=r.completed_at)
      >= COALESCE((SELECT (value_json->>'minimum_attempts')::int FROM collect_config WHERE key='rarity'),20))
) WHERE c.rarity_evaluated_at IS NULL;

-- 20261002_collect_descriptions.sql
ALTER TABLE cards ADD COLUMN IF NOT EXISTS description_full_override TEXT
  CHECK (char_length(description_full_override) <= 4000);

-- 20261004_collect_quota_notifications.sql
CREATE TABLE IF NOT EXISTS collect_quota_notifications (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cycle_copy_id BIGINT,
  due_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  seen_at TIMESTAMPTZ,
  active_until TIMESTAMPTZ,
  prompted_at TIMESTAMPTZ,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collect_quota_notifications_due
  ON collect_quota_notifications (due_at) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS collect_quota_push_deliveries (
  cycle_copy_id BIGINT NOT NULL,
  endpoint TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (cycle_copy_id, endpoint)
);

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS daily_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS collect_enabled BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO collect_quota_notifications(user_id, cycle_copy_id, due_at)
SELECT user_id, MAX(id), MIN(obtained_at + INTERVAL '20 minutes')
FROM card_copies
WHERE source = 'collect' AND obtained_at > NOW() - INTERVAL '20 minutes'
GROUP BY user_id
HAVING COUNT(*) >= 4
ON CONFLICT (user_id) DO NOTHING;

-- 20261005_collect_weekly_challenges.sql
CREATE TABLE IF NOT EXISTS collect_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS weekly_challenges (
  id BIGSERIAL PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  category_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS weekly_challenge_objectives (
  id BIGSERIAL PRIMARY KEY,
  challenge_id BIGINT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('arrondissement', 'quartier', 'monument', 'bus', 'district', 'famous', 'main')),
  target SMALLINT NOT NULL CHECK (target > 0),
  label TEXT NOT NULL,
  UNIQUE (challenge_id, position),
  UNIQUE (challenge_id, kind)
);

CREATE TABLE IF NOT EXISTS weekly_challenge_card_dimensions (
  challenge_id BIGINT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  family TEXT NOT NULL,
  quartier TEXT,
  arrondissement SMALLINT,
  famous BOOLEAN NOT NULL DEFAULT FALSE,
  main BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (challenge_id, card_id)
);

CREATE TABLE IF NOT EXISTS weekly_challenge_results (
  challenge_id BIGINT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score NUMERIC(8,5) NOT NULL,
  completed_at TIMESTAMPTZ,
  rank INTEGER NOT NULL,
  progress JSONB NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_challenge_results_rank
  ON weekly_challenge_results(challenge_id, rank);
CREATE INDEX IF NOT EXISTS idx_collect_weekly_copies
  ON card_copies(obtained_at, user_id, card_id) WHERE source = 'collect';

-- 20261007_collect_content_reports.sql
CREATE TABLE IF NOT EXISTS collect_content_reports (
  id BIGSERIAL PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image', 'description')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (card_id, user_id, content_type)
);

CREATE INDEX IF NOT EXISTS collect_content_reports_open_idx
  ON collect_content_reports(card_id, content_type, last_reported_at DESC)
  WHERE status = 'open';

-- 20261007_collect_draw_proportions.sql
-- Set the requested 70% street, 10% district, 10% monument, 10% bus split.
-- Preserve any administrator-configured weights.
INSERT INTO collect_config(key,value_json) VALUES
  ('family_weights','{"street":70,"district":10,"monument":10,"bus":10}'::jsonb),
  ('street_category_weights','{"famous":8,"main":18,"other":44}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE collect_config
SET value_json='{"street":70,"district":10,"monument":10,"bus":10}'::jsonb, updated_at=NOW()
WHERE key='family_weights'
  AND value_json='{"street":76,"district":8,"monument":8,"bus":8}'::jsonb;

UPDATE collect_config
SET value_json='{"famous":8,"main":18,"other":44}'::jsonb, updated_at=NOW()
WHERE key='street_category_weights'
  AND value_json='{"famous":6,"main":16,"other":54}'::jsonb;

-- 20261008_collect_guess_limits.sql
-- Snapshot the allowance when the card is drawn; ongoing older games keep one try.
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS max_attempts smallint NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 3);
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS placement_guesses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(placement_guesses) = 'array');

-- 20261008_collect_improvements.sql
-- Additive, replayable changes; keep existing copies, questions and progression.
ALTER TABLE collect_games ADD COLUMN IF NOT EXISTS abandoned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS collect_games_pending_user_idx ON collect_games(user_id,started_at DESC) WHERE finished_at IS NULL;
ALTER TABLE collect_questions ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]';
ALTER TABLE collect_content_reports DROP CONSTRAINT IF EXISTS collect_content_reports_content_type_check;
ALTER TABLE collect_content_reports ADD CONSTRAINT collect_content_reports_content_type_check CHECK (content_type IN ('image','description','question'));
CREATE TABLE IF NOT EXISTS collect_content_corrections (
  id BIGSERIAL PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  editor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  before_json JSONB NOT NULL, after_json JSONB NOT NULL,
  verified_entity TEXT, verification_source TEXT,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS collect_album_goals (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  album_id BIGINT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  chosen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS collect_events (
  id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES collect_games(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('map_ready','abandon','album_complete')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,game_id,kind)
);
CREATE INDEX IF NOT EXISTS collect_events_time_idx ON collect_events(occurred_at,kind);

-- 20261008_collect_v2.sql
-- 20261009_collect_personal_albums_rewards.sql
-- Personal albums remain private; weekly prizes have an independent provenance.
CREATE TABLE IF NOT EXISTS collect_personal_albums (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS collect_personal_albums_user_idx ON collect_personal_albums(user_id,id);
CREATE TABLE IF NOT EXISTS collect_personal_album_cards (
  album_id BIGINT NOT NULL REFERENCES collect_personal_albums(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(album_id,card_id)
);
ALTER TABLE weekly_challenges ADD COLUMN IF NOT EXISTS reward_policy JSONB;
CREATE TABLE IF NOT EXISTS collect_weekly_rewards (
  challenge_id BIGINT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  copy_id BIGINT NOT NULL UNIQUE REFERENCES card_copies(id) ON DELETE RESTRICT,
  awarded_rarity SMALLINT NOT NULL CHECK(awarded_rarity BETWEEN 1 AND 5),
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(challenge_id,user_id)
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='collect_weekly_reward_source_v1') THEN
    ALTER TABLE card_copies DROP CONSTRAINT IF EXISTS card_copies_source_check;
    ALTER TABLE card_copies ADD CONSTRAINT card_copies_source_check CHECK(source IN('daily','collect','weekly'));
    ALTER TABLE card_copies DROP CONSTRAINT IF EXISTS card_copies_check;
    ALTER TABLE card_copies ADD CONSTRAINT card_copies_check CHECK(
      (source='daily' AND daily_attempt_count IS NOT NULL AND daily_date IS NOT NULL AND daily_attempt_count BETWEEN 1 AND 7)
      OR (source IN('collect','weekly') AND daily_attempt_count IS NULL AND daily_date IS NULL));
    INSERT INTO app_settings(key,value_text) VALUES('collect_weekly_reward_source_v1','applied');
  END IF;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS collect_profile_public BOOLEAN NOT NULL DEFAULT TRUE;
-- Collect V2 schema. Applied unless COLLECT_V2_ENABLED=false.
ALTER TABLE users ADD COLUMN IF NOT EXISTS collect_visibility TEXT;
UPDATE users SET collect_visibility=CASE WHEN collect_profile_public THEN 'public' ELSE 'private' END WHERE collect_visibility IS NULL;
ALTER TABLE users ALTER COLUMN collect_visibility SET DEFAULT 'public';
ALTER TABLE users ALTER COLUMN collect_visibility SET NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS collect_exchange_policy TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE users ADD COLUMN IF NOT EXISTS collect_social_push BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='collect_visibility_values') THEN
 ALTER TABLE users ADD CONSTRAINT collect_visibility_values CHECK(collect_visibility IN('public','friends','private'));
 ALTER TABLE users ADD CONSTRAINT collect_exchange_policy_values CHECK(collect_exchange_policy IN('everyone','friends','nobody'));
 END IF;
END $$;
ALTER TABLE card_copies ADD COLUMN IF NOT EXISTS initial_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE card_copies ADD COLUMN IF NOT EXISTS acquisition TEXT NOT NULL DEFAULT 'earned' CHECK(acquisition IN('earned','trade'));
ALTER TABLE card_copies ADD COLUMN IF NOT EXISTS acquired_at TIMESTAMPTZ;
ALTER TABLE card_copies ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE card_copies SET initial_owner_id=user_id,acquired_at=obtained_at WHERE acquired_at IS NULL;
ALTER TABLE card_copies ALTER COLUMN acquired_at SET DEFAULT NOW();
ALTER TABLE card_copies ALTER COLUMN acquired_at SET NOT NULL;
DROP INDEX IF EXISTS idx_daily_copy_per_user_date;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_copy_origin_date ON card_copies(initial_owner_id,daily_date) WHERE source='daily';
CREATE TABLE IF NOT EXISTS collect_awards (
 id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id BIGINT NOT NULL REFERENCES cards(id),
 copy_id BIGINT UNIQUE REFERENCES card_copies(id) ON DELETE SET NULL,
 source TEXT NOT NULL, daily_date TEXT, obtained_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE collect_awards ADD COLUMN IF NOT EXISTS card_id BIGINT REFERENCES cards(id);
UPDATE collect_awards a SET card_id=cp.card_id FROM card_copies cp WHERE a.copy_id=cp.id AND a.card_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collect_award_daily ON collect_awards(user_id,daily_date) WHERE source='daily';
CREATE INDEX IF NOT EXISTS collect_award_quota ON collect_awards(user_id,obtained_at) WHERE source='collect';
INSERT INTO collect_awards(user_id,card_id,copy_id,source,daily_date,obtained_at)
 SELECT initial_owner_id,card_id,id,source,daily_date,obtained_at FROM card_copies WHERE initial_owner_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION collect_v2_copy_award() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO collect_awards(user_id,card_id,copy_id,source,daily_date,obtained_at) VALUES(NEW.user_id,NEW.card_id,NEW.id,NEW.source,NEW.daily_date,NEW.obtained_at);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION enforce_collect_reward_quota() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE quota_limit INTEGER:=4; window_minutes INTEGER:=20; recent_copies INTEGER:=0;
BEGIN
 PERFORM 1 FROM cards WHERE id=NEW.card_id AND status='active' AND catalog_present FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'collect_card_archived' USING ERRCODE='P0001'; END IF;
 IF NEW.source='collect' THEN
  PERFORM 1 FROM users WHERE id=NEW.user_id FOR UPDATE;
  NEW.obtained_at:=clock_timestamp();
  SELECT COALESCE((value_json->>'copies')::integer,4),COALESCE((value_json->>'window_minutes')::integer,20)
   INTO quota_limit,window_minutes FROM collect_config WHERE key='reward_quota';
  SELECT COUNT(*) INTO recent_copies FROM collect_awards WHERE user_id=NEW.user_id AND source='collect' AND obtained_at>clock_timestamp()-make_interval(mins=>window_minutes);
  IF recent_copies>=quota_limit THEN RAISE EXCEPTION 'collect_reward_quota_reached' USING ERRCODE='P0001'; END IF;
 END IF;
 NEW.initial_owner_id:=NEW.user_id; NEW.acquired_at:=NEW.obtained_at; NEW.acquisition:='earned';
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS collect_v2_award ON card_copies;
CREATE TRIGGER collect_v2_award AFTER INSERT ON card_copies FOR EACH ROW EXECUTE FUNCTION collect_v2_copy_award();
-- Preserve the one-time weekly reward receipt if its copy is destroyed.
ALTER TABLE collect_weekly_rewards DROP CONSTRAINT IF EXISTS collect_weekly_rewards_copy_id_fkey;
CREATE TABLE IF NOT EXISTS collect_friendships (
 low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN('pending','accepted')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(low_id,high_id),CHECK(low_id<high_id),CHECK(requester_id IN(low_id,high_id))
);
CREATE TABLE IF NOT EXISTS collect_blocks (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(user_id,blocked_id),CHECK(user_id<>blocked_id)
);
CREATE TABLE IF NOT EXISTS collect_card_social_settings (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 locked BOOLEAN NOT NULL DEFAULT FALSE,hidden BOOLEAN NOT NULL DEFAULT FALSE,
 open_to_offers BOOLEAN NOT NULL DEFAULT FALSE,wanted BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(user_id,card_id)
);
CREATE TABLE IF NOT EXISTS collect_trade_offers (
 id UUID PRIMARY KEY,maker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN('direct','market')),state TEXT NOT NULL DEFAULT 'active'
 CHECK(state IN('active','accepted','refused','withdrawn','expired','invalid','countered')),
 offered_ids BIGINT[] NOT NULL,requested_ids BIGINT[] NOT NULL DEFAULT '{}',
 offered_cards JSONB NOT NULL DEFAULT '[]',wanted_cards JSONB NOT NULL DEFAULT '[]',
 parent_id UUID REFERENCES collect_trade_offers(id) ON DELETE SET NULL,
 request_id UUID NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '7 days',
 CHECK((kind='direct' AND receiver_id IS NOT NULL AND maker_id<>receiver_id AND cardinality(offered_ids)>0 AND cardinality(requested_ids)>0)
 OR (kind='market' AND receiver_id IS NULL AND cardinality(offered_ids)>0))
);
CREATE INDEX IF NOT EXISTS collect_offers_users ON collect_trade_offers(maker_id,kind,state,expires_at);
CREATE INDEX IF NOT EXISTS collect_offers_receiver ON collect_trade_offers(receiver_id,state);
CREATE TABLE IF NOT EXISTS collect_trades (
 id UUID PRIMARY KEY,offer_id UUID UNIQUE REFERENCES collect_trade_offers(id) ON DELETE SET NULL,
 maker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 receiver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 summary JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS collect_copy_transfers (
 id BIGSERIAL PRIMARY KEY,trade_id UUID NOT NULL REFERENCES collect_trades(id) ON DELETE CASCADE,
 copy_id BIGINT NOT NULL,card_id BIGINT NOT NULL REFERENCES cards(id),
 from_id INTEGER REFERENCES users(id) ON DELETE SET NULL,to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(trade_id,copy_id)
);
CREATE INDEX IF NOT EXISTS collect_transfers_card ON collect_copy_transfers(card_id,trade_id);
CREATE TABLE IF NOT EXISTS collect_social_notifications (
 id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_key TEXT NOT NULL,kind TEXT NOT NULL,payload JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),read_at TIMESTAMPTZ,push_status TEXT NOT NULL DEFAULT 'pending',
 UNIQUE(user_id,event_key)
);
CREATE TABLE IF NOT EXISTS collect_social_activity (
 id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_key TEXT NOT NULL,kind TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,event_key)
);
CREATE TABLE IF NOT EXISTS collect_social_reports (
 id BIGSERIAL PRIMARY KEY,reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 reported_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 reason TEXT NOT NULL CHECK(reason IN('spam','harassment','circumvention','content')),
 offer_id UUID REFERENCES collect_trade_offers(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS collect_social_report_dedupe ON collect_social_reports(reporter_id,reported_id,reason,COALESCE(offer_id,'00000000-0000-0000-0000-000000000000')) WHERE resolved_at IS NULL;
CREATE OR REPLACE FUNCTION collect_v2_activity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE n INTEGER; item RECORD;
BEGIN
 IF TG_TABLE_NAME='user_collect_badges' THEN
  INSERT INTO collect_social_activity(user_id,event_key,kind,payload) VALUES(NEW.user_id,'badge:'||NEW.badge_id,'badge',jsonb_build_object('badgeId',NEW.badge_id)) ON CONFLICT DO NOTHING;
 ELSE
  IF TG_OP='INSERT' OR OLD.user_id<>NEW.user_id THEN
   IF EXISTS(SELECT 1 FROM cards WHERE id=NEW.card_id AND fragments_enabled) THEN
    INSERT INTO collect_social_activity(user_id,event_key,kind,payload) VALUES(NEW.user_id,'legendary:'||NEW.card_id,'legendary',jsonb_build_object('cardId',NEW.card_id)) ON CONFLICT DO NOTHING;
   END IF;
   SELECT COUNT(DISTINCT COALESCE(m.canonical_card_id,cp.card_id)) INTO n FROM card_copies cp
    LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id) WHERE cp.user_id=NEW.user_id AND c.status='active';
   FOR item IN SELECT unnest(ARRAY[10,50,100,250,500,1000,2500,5000]) AS milestone LOOP
    IF n>=item.milestone THEN INSERT INTO collect_social_activity(user_id,event_key,kind,payload) VALUES(NEW.user_id,'milestone:'||item.milestone,'milestone',jsonb_build_object('count',item.milestone)) ON CONFLICT DO NOTHING; END IF;
   END LOOP;
   FOR item IN SELECT a.id FROM albums a JOIN album_cards ac ON ac.album_id=a.id JOIN cards c ON c.id=ac.card_id WHERE a.active AND c.status='active' GROUP BY a.id HAVING COUNT(*)=COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id WHERE cp.user_id=NEW.user_id AND COALESCE(m.canonical_card_id,cp.card_id)=c.id)) LOOP
    INSERT INTO collect_social_activity(user_id,event_key,kind,payload) VALUES(NEW.user_id,'album:'||item.id,'album',jsonb_build_object('albumId',item.id)) ON CONFLICT DO NOTHING;
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS collect_v2_copy_activity ON card_copies;
CREATE TRIGGER collect_v2_copy_activity AFTER INSERT OR UPDATE OF user_id ON card_copies FOR EACH ROW EXECUTE FUNCTION collect_v2_activity();
DROP TRIGGER IF EXISTS collect_v2_badge_activity ON user_collect_badges;
CREATE TRIGGER collect_v2_badge_activity AFTER INSERT ON user_collect_badges FOR EACH ROW EXECUTE FUNCTION collect_v2_activity();
CREATE OR REPLACE FUNCTION collect_v2_origin_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source IS DISTINCT FROM OLD.source OR NEW.daily_date IS DISTINCT FROM OLD.daily_date
 OR NEW.daily_attempt_count IS DISTINCT FROM OLD.daily_attempt_count OR NEW.obtained_at IS DISTINCT FROM OLD.obtained_at
 OR(NEW.initial_owner_id IS DISTINCT FROM OLD.initial_owner_id AND NEW.initial_owner_id IS NOT NULL) THEN
 RAISE EXCEPTION 'collect_copy_origin_immutable'; END IF;
 IF NEW.user_id<>OLD.user_id THEN NEW.acquisition:='trade';NEW.acquired_at:=clock_timestamp();END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS collect_v2_origin_guard ON card_copies;
CREATE TRIGGER collect_v2_origin_guard BEFORE UPDATE ON card_copies FOR EACH ROW EXECUTE FUNCTION collect_v2_origin_guard();

-- 20261010_collect_legendary_weekly_rewards.sql
-- Extend weekly prize rarity without changing previously awarded copies.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='collect_weekly_legendary_rewards_v2') THEN
    ALTER TABLE collect_weekly_rewards DROP CONSTRAINT IF EXISTS collect_weekly_rewards_awarded_rarity_check;
    ALTER TABLE collect_weekly_rewards ADD CONSTRAINT collect_weekly_rewards_awarded_rarity_check
      CHECK(awarded_rarity BETWEEN 1 AND 5);
    INSERT INTO app_settings(key,value_text) VALUES('collect_weekly_legendary_rewards_v2','applied');
  END IF;
END $$;
