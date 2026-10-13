-- Parici Explorer: offline-first historical treasure hunt mode.

CREATE TABLE IF NOT EXISTS explorer_riddles (
    id SERIAL PRIMARY KEY,
    way_id BIGINT NOT NULL,
    street_name_clean VARCHAR(255) NOT NULL,
    riddle_text TEXT NOT NULL,
    hint_text TEXT NOT NULL,
    explanation_text TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS explorer_user_progress (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    riddle_id INT REFERENCES explorer_riddles(id) ON DELETE CASCADE,
    started_at TIMESTAMP NOT NULL,
    solved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hints_used INT DEFAULT 0,
    points_earned INT NOT NULL,
    walking_time_seconds INT DEFAULT 0,
    client_payload JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT unique_user_riddle UNIQUE (user_id, riddle_id)
);

CREATE TABLE IF NOT EXISTS explorer_leaderboard (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_score INT NOT NULL,
    total_walking_time_seconds INT NOT NULL,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_explorer_riddles_way_id
ON explorer_riddles (way_id);

CREATE INDEX IF NOT EXISTS idx_explorer_riddles_coordinates
ON explorer_riddles (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_explorer_progress_user_solved
ON explorer_user_progress (user_id, solved_at DESC);

CREATE INDEX IF NOT EXISTS idx_explorer_leaderboard_score
ON explorer_leaderboard (total_score DESC, total_walking_time_seconds ASC, completed_at ASC);

ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE explorer_riddles ADD COLUMN IF NOT EXISTS seed_key TEXT UNIQUE;
CREATE TABLE IF NOT EXISTS explorer_step_sessions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 riddle_id INTEGER NOT NULL REFERENCES explorer_riddles(id) ON DELETE CASCADE,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 hint_used BOOLEAN NOT NULL DEFAULT FALSE,
 riddle_snapshot JSONB,
 PRIMARY KEY(user_id,riddle_id)
);
CREATE TABLE IF NOT EXISTS explorer_uploaded_images (
 filename TEXT PRIMARY KEY,
 mime_type TEXT NOT NULL,
 content BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
