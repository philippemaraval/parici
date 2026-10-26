-- Learning sessions have their own history and cannot enter reward/statistic queries.
CREATE TABLE IF NOT EXISTS collect_review_sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('revision','errors')),
  scope TEXT NOT NULL DEFAULT '',
  card_ids BIGINT[] NOT NULL CHECK(cardinality(card_ids) BETWEEN 1 AND 10),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS collect_review_open_user_idx
  ON collect_review_sessions(user_id) WHERE finished_at IS NULL;
CREATE TABLE IF NOT EXISTS collect_review_games (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES collect_review_sessions(id) ON DELETE CASCADE,
  card_id BIGINT NOT NULL REFERENCES cards(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 10),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  correct BOOLEAN,
  result_json JSONB,
  UNIQUE(session_id,position)
);
CREATE INDEX IF NOT EXISTS collect_review_history_idx ON collect_review_games(card_id,finished_at DESC);
CREATE INDEX IF NOT EXISTS collect_review_sessions_user_idx ON collect_review_sessions(user_id,started_at DESC);
