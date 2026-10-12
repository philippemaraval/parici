CREATE TABLE IF NOT EXISTS daily_guess_receipts (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 date date NOT NULL,
 request_id uuid NOT NULL,
 result_json jsonb NOT NULL,
 PRIMARY KEY(user_id,date,request_id)
);
CREATE TABLE IF NOT EXISTS verified_game_sessions (
 id uuid PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mode text NOT NULL,
 game_type text NOT NULL,
 arrondissement_name text,
 challenge_id bigint REFERENCES friend_challenges(id) ON DELETE CASCADE,
 targets jsonb NOT NULL,
 answers jsonb NOT NULL DEFAULT '[]',
 started_at timestamptz NOT NULL DEFAULT NOW(),
 target_started_at timestamptz NOT NULL DEFAULT NOW(),
 paused_at timestamptz,
 paused_ms bigint NOT NULL DEFAULT 0,
 target_paused_ms bigint NOT NULL DEFAULT 0,
 finished_at timestamptz,
 result_json jsonb
);
CREATE INDEX IF NOT EXISTS verified_sessions_owner ON verified_game_sessions(user_id,started_at);
