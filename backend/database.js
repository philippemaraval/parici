const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_BOOTSTRAP_KEY = 'schema_bootstrap_version';
const SCHEMA_BOOTSTRAP_VERSION = '2026-07-22-remove-test-daily-attempt';
const USER_RENAME_SQL_PATH = path.join(__dirname, '..', 'migrations', 'unused-user-rename.sql');
const DAILY_RESET_SQL_PATH = path.join(__dirname, '..', 'migrations', '20260628_reset_changed_daily.sql');
const REFERRALS_SQL_PATH = path.join(__dirname, '..', 'migrations', '20260617_referrals.sql');
const MPHIL_ADMIN_SQL_PATH = path.join(__dirname, '..', 'migrations', '20260705_restore_mphil_admin.sql');
const TEST_DAILY_ATTEMPT_CLEANUP_SQL_PATH = path.join(
  __dirname,
  '..',
  'migrations',
  '20260722_remove_test_daily_attempt.sql'
);

// Connect via DATABASE_URL (provided by Render PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function hasCurrentSchemaBootstrap(client) {
  const tableCheck = await client.query(
    `SELECT to_regclass('public.app_settings') AS app_settings_table`
  );
  if (!tableCheck.rows[0]?.app_settings_table) {
    return false;
  }

  const versionCheck = await client.query(
    'SELECT value_text FROM app_settings WHERE key = $1',
    [SCHEMA_BOOTSTRAP_KEY]
  );
  return versionCheck.rows[0]?.value_text === SCHEMA_BOOTSTRAP_VERSION;
}

async function markSchemaBootstrapComplete(client) {
  await client.query(
    `INSERT INTO app_settings (key, value_text, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value_text = EXCLUDED.value_text,
       updated_at = NOW()`,
    [SCHEMA_BOOTSTRAP_KEY, SCHEMA_BOOTSTRAP_VERSION]
  );
}

async function ping() {
  await pool.query('SELECT 1');
}

async function renameUserIfNeeded(client) {
  const tableCheck = await client.query(
    `SELECT to_regclass('public.users') AS users_table`
  );
  if (!tableCheck.rows[0]?.users_table || !fs.existsSync(USER_RENAME_SQL_PATH)) {
    return;
  }

  const renameSql = fs.readFileSync(USER_RENAME_SQL_PATH, 'utf8');
  if (renameSql.trim()) {
    await client.query(renameSql);
  }
}

async function applyChangedDailyReset(client) {
  if (!fs.existsSync(DAILY_RESET_SQL_PATH)) {
    return;
  }

  const tableCheck = await client.query(
    `SELECT to_regclass('public.daily_user_attempts') AS daily_attempts_table`
  );
  if (!tableCheck.rows[0]?.daily_attempts_table) {
    return;
  }

  const resetSql = fs.readFileSync(DAILY_RESET_SQL_PATH, 'utf8');
  if (resetSql.trim()) {
    await client.query(resetSql);
  }
}

async function applyReferralSchema(client) {
  if (!fs.existsSync(REFERRALS_SQL_PATH)) {
    return;
  }

  const tableCheck = await client.query(
    `SELECT to_regclass('public.users') AS users_table`
  );
  if (!tableCheck.rows[0]?.users_table) {
    return;
  }

  const referralSql = fs.readFileSync(REFERRALS_SQL_PATH, 'utf8');
  if (referralSql.trim()) {
    await client.query(referralSql);
  }
}

async function restoreMPhilAdminRole(client) {
  if (!fs.existsSync(MPHIL_ADMIN_SQL_PATH)) {
    return;
  }
  const roleSql = fs.readFileSync(MPHIL_ADMIN_SQL_PATH, 'utf8');
  if (roleSql.trim()) {
    await client.query(roleSql);
  }
}

async function removeTestDailyAttempt(client) {
  if (!fs.existsSync(TEST_DAILY_ATTEMPT_CLEANUP_SQL_PATH)) {
    return;
  }
  const cleanupSql = fs.readFileSync(TEST_DAILY_ATTEMPT_CLEANUP_SQL_PATH, 'utf8');
  if (cleanupSql.trim()) {
    await client.query(cleanupSql);
  }
}

async function applyPushNotificationSchema(client) {
  const tableCheck = await client.query(
    `SELECT to_regclass('public.users') AS users_table`
  );
  if (!tableCheck.rows[0]?.users_table) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      subscription_json JSONB NOT NULL,
      vapid_public_key TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_notified_on DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS vapid_public_key TEXT`);
  await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_notified_on DATE`);
  await client.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON push_subscriptions (user_id)
  `);
}

// Initialize database tables
async function initDb() {
  const client = await pool.connect();
  try {
    // Keep the common startup path fast. Any schema change must bump
    // SCHEMA_BOOTSTRAP_VERSION so the migration block below runs exactly once.
    if (await hasCurrentSchemaBootstrap(client)) {
      console.log('Database schema already up to date.');
      return;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_sessions (
        session_hash TEXT PRIMARY KEY,
        visitor_hash TEXT NOT NULL,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        last_seen TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_hash
      ON visitor_sessions (visitor_hash)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_daily_uniques (
        day DATE NOT NULL,
        visitor_hash TEXT NOT NULL,
        first_seen_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (day, visitor_hash)
      )
    `);

    await renameUserIfNeeded(client);
    await applyReferralSchema(client);
    await applyPushNotificationSchema(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        avatar TEXT DEFAULT '👤',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await restoreMPhilAdminRole(client);
    await applyReferralSchema(client);
    await applyPushNotificationSchema(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        username TEXT,
        mode TEXT NOT NULL,
        game_type TEXT NOT NULL,
        session_id TEXT,
        score REAL NOT NULL,
        items_correct INTEGER DEFAULT 0,
        items_total INTEGER DEFAULT 0,
        time_sec REAL DEFAULT 0,
        arrondissement_name TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Retro-compatibility for existing DB:
    await client.query(`ALTER TABLE scores ADD COLUMN IF NOT EXISTS arrondissement_name TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_targets (
        date TEXT PRIMARY KEY,
        street_name TEXT NOT NULL,
        arrondissement TEXT,
        coordinates_json TEXT,
        geometry_json TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_user_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date TEXT NOT NULL,
        attempts_count INTEGER DEFAULT 0,
        best_distance_meters INTEGER,
        success BOOLEAN DEFAULT FALSE,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, date)
      )
    `);
    await client.query(`
      ALTER TABLE daily_user_attempts
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS friend_challenges (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by_username TEXT NOT NULL,
        mode TEXT NOT NULL,
        game_type TEXT NOT NULL,
        arrondissement_name TEXT,
        target_type TEXT NOT NULL,
        targets_json JSONB NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS friend_challenge_scores (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER NOT NULL REFERENCES friend_challenges(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score REAL NOT NULL,
        items_correct INTEGER DEFAULT 0,
        items_total INTEGER DEFAULT 0,
        time_sec REAL DEFAULT 0,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(challenge_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT UNIQUE NOT NULL,
        subscription_json JSONB NOT NULL,
        vapid_public_key TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_notified_on DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active
      ON password_reset_tokens (user_id, expires_at DESC)
      WHERE used_at IS NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
      ON push_subscriptions (user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_friend_challenges_code
      ON friend_challenges (code)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_friend_challenge_scores_challenge
      ON friend_challenge_scores (challenge_id)
    `);

    // Migration: add columns if missing (safe to run multiple times)
    const migrations = [
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '👤'",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'player'",
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT',
      'ALTER TABLE scores ADD COLUMN IF NOT EXISTS items_correct INTEGER DEFAULT 0',
      'ALTER TABLE scores ADD COLUMN IF NOT EXISTS items_total INTEGER DEFAULT 0',
      'ALTER TABLE scores ADD COLUMN IF NOT EXISTS time_sec REAL DEFAULT 0',
      'ALTER TABLE scores ADD COLUMN IF NOT EXISTS session_id TEXT',
      'ALTER TABLE daily_targets ADD COLUMN IF NOT EXISTS geometry_json TEXT',
      'ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS vapid_public_key TEXT',
      'ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE',
      'ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_notified_on DATE',
      'ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()'
    ];
    for (const sql of migrations) {
      try { await client.query(sql); } catch (e) { /* already exists */ }
    }

    await client.query(`
      UPDATE users
      SET role = 'player'
      WHERE role IS NULL OR TRIM(role) = ''
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_user_id_session_id
      ON scores (user_id, session_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scores_mode_game_type_timestamp
      ON scores (mode, game_type, timestamp DESC, arrondissement_name, user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scores_user_timestamp
      ON scores (user_id, timestamp DESC, mode, game_type)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_scores_user_arrondissement_timestamp
      ON scores (user_id, arrondissement_name, timestamp DESC)
      WHERE arrondissement_name IS NOT NULL AND TRIM(arrondissement_name) <> ''
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_user_attempts_user_date
      ON daily_user_attempts (user_id, date DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_user_attempts_user_success_date
      ON daily_user_attempts (user_id, success, date DESC)
    `);

    // Analytics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_streets (
        street_name TEXT NOT NULL,
        mode TEXT NOT NULL,
        correct_count INTEGER DEFAULT 0,
        wrong_count INTEGER DEFAULT 0,
        total_time_sec REAL DEFAULT 0,
        PRIMARY KEY (street_name, mode)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors_unique (
        visitor_hash TEXT PRIMARY KEY,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        last_seen TIMESTAMPTZ DEFAULT NOW(),
        hits INTEGER DEFAULT 1
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS visitors_counter (
        id SMALLINT PRIMARY KEY,
        total_visits BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_daily_stats (
        day DATE PRIMARY KEY,
        unique_visitors BIGINT NOT NULL DEFAULT 0,
        total_visits BIGINT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_text TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed total visits from current unique visitors once.
    // ON CONFLICT avoids duplicate-key crashes on concurrent starts.
    await client.query(`
      INSERT INTO visitors_counter (id, total_visits)
      SELECT 1, COUNT(*)::BIGINT
      FROM visitors_unique
      ON CONFLICT (id) DO NOTHING
    `);

    // Backfill daily unique visitors from the data that existed before daily hit tracking.
    // Historical total visits cannot be reconstructed because only a global counter existed.
    await client.query(`
      INSERT INTO visitor_daily_stats (day, unique_visitors, total_visits, updated_at)
      SELECT (first_seen AT TIME ZONE 'Europe/Paris')::DATE, COUNT(*)::BIGINT, NULL, NOW()
      FROM visitors_unique
      GROUP BY 1
      ON CONFLICT (day) DO UPDATE SET
        unique_visitors = GREATEST(visitor_daily_stats.unique_visitors, EXCLUDED.unique_visitors),
        updated_at = NOW()
    `);

    await applyChangedDailyReset(client);
    await removeTestDailyAttempt(client);
    await markSchemaBootstrapComplete(client);

    console.log('Database initialized successfully.');
  } finally {
    client.release();
  }
}

// ── User Helpers ──

async function createUser(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  try {
    const res = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id',
      [username, hash]
    );
    const userId = res.rows[0].id;
    await ensureReferralCodeForUser(userId);
    return userId;
  } catch (err) {
    if (err.code === '23505') { // PostgreSQL unique_violation
      throw new Error('Username already taken');
    }
    throw err;
  }
}

const REFERRAL_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const REFERRAL_CODE_LENGTH = 5;
const REFERRAL_CODE_PATTERN = /^[0-9A-Z]{5}$/;
const LEGACY_REFERRAL_CODE_PATTERN = /^CAMINO[0-9A-Z]+$/;

function generateReferralCode() {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += REFERRAL_CODE_ALPHABET[crypto.randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

function isCurrentReferralCodeFormat(code) {
  return REFERRAL_CODE_PATTERN.test(String(code || '').trim().toUpperCase());
}

function shouldRefreshReferralCode(code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  return !isCurrentReferralCodeFormat(normalizedCode) || LEGACY_REFERRAL_CODE_PATTERN.test(normalizedCode);
}

async function ensureReferralCodeForUser(userId) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('Invalid user id');
  }

  const existing = await pool.query('SELECT referral_code FROM users WHERE id = $1', [normalizedUserId]);
  if (existing.rowCount === 0) {
    throw new Error('User not found');
  }

  const existingCode = String(existing.rows[0]?.referral_code || '').trim().toUpperCase();
  if (!shouldRefreshReferralCode(existingCode)) {
    if (existing.rows[0].referral_code !== existingCode) {
      await pool.query('UPDATE users SET referral_code = $2 WHERE id = $1', [normalizedUserId, existingCode]);
    }
    return existingCode;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateReferralCode();
    try {
      const result = await pool.query(
        `UPDATE users
         SET referral_code = $2
         WHERE id = $1
           AND (
             referral_code IS NULL
             OR TRIM(referral_code) = ''
             OR UPPER(referral_code) !~ '^[0-9A-Z]{5}$'
             OR UPPER(referral_code) LIKE 'CAMINO%'
           )
         RETURNING referral_code`,
        [normalizedUserId, code]
      );

      if (result.rowCount > 0) {
        return result.rows[0].referral_code;
      }

      const refreshed = await pool.query('SELECT referral_code FROM users WHERE id = $1', [normalizedUserId]);
      const refreshedCode = String(refreshed.rows[0]?.referral_code || '').trim().toUpperCase();
      if (isCurrentReferralCodeFormat(refreshedCode)) {
        return refreshedCode;
      }
    } catch (err) {
      if (err.code !== '23505') {
        throw err;
      }
    }
  }

  throw new Error('Unable to generate a unique referral code');
}

async function getUser(username) {
  const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return res.rows[0] || null;
}

async function getUserById(userId) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [normalizedUserId]);
  return res.rows[0] || null;
}

async function setUserRole(username, role) {
  const normalizedUsername = String(username || '').trim();
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!normalizedUsername) {
    throw new Error('Missing username');
  }
  if (!normalizedRole) {
    throw new Error('Missing role');
  }

  const result = await pool.query(
    `UPDATE users
     SET role = $1
     WHERE username = $2
     RETURNING id, username, role`,
    [normalizedRole, normalizedUsername]
  );
  return result.rows[0] || null;
}

async function listUsersForAdmin() {
  const result = await pool.query(
    `WITH score_stats AS (
       SELECT
         user_id,
         COUNT(*)::int AS games_played,
         MAX(timestamp) AS last_game_at,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'mode', mode,
             'game_type', game_type,
             'high_score', high_score,
             'best_items_correct', best_items_correct,
             'best_items_total', best_items_total
           )
         ) AS modes
       FROM (
         SELECT
           user_id,
           mode,
           game_type,
           MAX(score) AS high_score,
           MAX(items_correct) AS best_items_correct,
           MAX(items_total) AS best_items_total,
           MAX(timestamp) AS timestamp
         FROM scores
         WHERE user_id IS NOT NULL
         GROUP BY user_id, mode, game_type
       ) grouped_scores
       GROUP BY user_id
     ),
     daily_stats AS (
       SELECT
         user_id,
         COUNT(DISTINCT date)::int AS days_played,
         COUNT(DISTINCT date) FILTER (WHERE success = TRUE)::int AS successes,
         MAX(last_attempt_at) AS last_daily_at
       FROM daily_user_attempts
       GROUP BY user_id
     ),
     reminder_stats AS (
       SELECT user_id, BOOL_OR(enabled = TRUE) AS reminder_enabled
       FROM push_subscriptions
       GROUP BY user_id
     ),
     referral_stats AS (
       SELECT referrer_user_id AS user_id, COUNT(*)::int AS referral_count
       FROM referrals
       GROUP BY referrer_user_id
     )
     SELECT
       u.id,
       u.username,
       u.role,
       u.avatar,
       u.created_at,
       COALESCE(score_stats.games_played, 0)::int AS games_played,
       score_stats.last_game_at,
       COALESCE(score_stats.modes, '[]'::json) AS modes,
       COALESCE(daily_stats.days_played, 0)::int AS daily_days_played,
       COALESCE(daily_stats.successes, 0)::int AS daily_successes,
       daily_stats.last_daily_at,
       COALESCE(reminder_stats.reminder_enabled, FALSE) AS reminder_enabled,
       COALESCE(referral_stats.referral_count, 0)::int AS referral_count,
       GREATEST(
         1,
         LEAST(
           (timezone('Europe/Paris', NOW())::date - (u.created_at AT TIME ZONE 'Europe/Paris')::date) + 1,
           36500
         )
       )::int AS membership_days
     FROM users u
     LEFT JOIN score_stats ON score_stats.user_id = u.id
     LEFT JOIN daily_stats ON daily_stats.user_id = u.id
     LEFT JOIN reminder_stats ON reminder_stats.user_id = u.id
     LEFT JOIN referral_stats ON referral_stats.user_id = u.id
     ORDER BY u.created_at ASC, u.username ASC`
  );
  return result.rows;
}

async function deleteUserById(userId) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      'SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE',
      [normalizedUserId]
    );
    const user = userResult.rows[0] || null;
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }

    // These two historical foreign keys were created without ON DELETE CASCADE.
    await client.query('DELETE FROM scores WHERE user_id = $1', [normalizedUserId]);
    await client.query('DELETE FROM daily_user_attempts WHERE user_id = $1', [normalizedUserId]);
    await client.query('DELETE FROM users WHERE id = $1', [normalizedUserId]);
    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

async function createPasswordResetToken(username, tokenHash, expiresAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      'SELECT id, username FROM users WHERE username = $1 FOR UPDATE',
      [String(username || '').trim()]
    );
    const user = userResult.rows[0] || null;
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );
    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resetPasswordWithToken(tokenHash, password) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT token.id, token.user_id
       FROM password_reset_tokens token
       WHERE token.token_hash = $1
         AND token.used_at IS NULL
         AND token.expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );
    const token = tokenResult.rows[0] || null;
    if (!token) {
      await client.query('ROLLBACK');
      return false;
    }

    const hash = bcrypt.hashSync(password, 10);
    await client.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, token.user_id]
    );
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [token.user_id]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ── Score Helpers ──

async function addScore(userId, username, mode, gameType, score, itemsCorrect, itemsTotal, timeSec, arrondissementName, sessionId) {
  const result = await pool.query(
    `INSERT INTO scores (
       user_id, username, mode, game_type, score, items_correct, items_total, time_sec, arrondissement_name, session_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, session_id) DO NOTHING
     RETURNING id`,
    [
      userId,
      username,
      mode,
      gameType,
      score,
      itemsCorrect || 0,
      itemsTotal || 0,
      timeSec || 0,
      arrondissementName || null,
      sessionId || null,
    ]
  );
  return result.rowCount > 0;
}

function normalizeLeaderboardPeriod(period) {
  return period === 'month' ? 'month' : 'all';
}

function getLeaderboardPeriodWhereClause(period, scoreAlias = 's') {
  if (period !== 'month') {
    return '';
  }

  return `
    AND (${scoreAlias}.timestamp AT TIME ZONE 'Europe/Paris') >= date_trunc('month', timezone('Europe/Paris', NOW()))
    AND (${scoreAlias}.timestamp AT TIME ZONE 'Europe/Paris') < (date_trunc('month', timezone('Europe/Paris', NOW())) + INTERVAL '1 month')
  `;
}

async function getLeaderboard(mode, gameType, arrondissementName = null, limit = 10, options = {}) {
  const period = normalizeLeaderboardPeriod(options.period);
  const params = [mode, gameType];
  let whereClause = `s.mode = $1 AND s.game_type = $2`;

  if (arrondissementName) {
    whereClause += ` AND s.arrondissement_name = $3 `;
    params.push(arrondissementName);
  } else if (mode === 'arrondissement') {
    // Legacy scores with no arrondissement_name fallback
    whereClause += ` AND s.arrondissement_name IS NULL `;
  }
  whereClause += getLeaderboardPeriodWhereClause(period, 's');

  const limitParam = `$${params.length + 1}`;
  params.push(limit);

  const query = `
    WITH filtered AS (
      SELECT s.*, u.avatar
      FROM scores s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE ${whereClause}
    ),
    ranked AS (
      SELECT
        filtered.*,
        COUNT(*) OVER (
          PARTITION BY filtered.user_id, filtered.username
        ) AS games_played,
        ROW_NUMBER() OVER (
          PARTITION BY filtered.user_id, filtered.username
          ORDER BY
            CASE
              WHEN $2 = 'classique' THEN filtered.score::double precision
              ELSE filtered.items_correct::double precision
            END DESC,
            filtered.time_sec ASC,
            filtered.timestamp ASC
        ) AS rn
      FROM filtered
    ),
    best_runs AS (
      SELECT
        username,
        avatar,
        score AS high_score,
        items_correct,
        items_total,
        time_sec,
        games_played
      FROM ranked
      WHERE rn = 1
    )
    SELECT
      username,
      avatar,
      high_score,
      items_correct,
      items_total,
      time_sec,
      games_played
    FROM best_runs
    ORDER BY
      CASE
        WHEN $2 = 'classique' THEN best_runs.high_score::double precision
        ELSE best_runs.items_correct::double precision
      END DESC,
      time_sec ASC,
      username ASC
    LIMIT ${limitParam}
  `;

  const res = await pool.query(query, params);
  return res.rows;
}

async function getAllLeaderboards(limit = 100, options = {}) { // Increased limit since client truncates it
  const period = normalizeLeaderboardPeriod(options.period);
  const periodWhereClause = getLeaderboardPeriodWhereClause(period, 's');
  const rows = await pool.query(
    `WITH base AS (
       SELECT
         s.mode,
         s.game_type,
         CASE
           WHEN s.mode = 'arrondissement'
             THEN COALESCE(NULLIF(TRIM(s.arrondissement_name), ''), '__unknown__')
           ELSE ''
         END AS arrondissement_partition_key,
         CASE
           WHEN s.mode = 'arrondissement'
             THEN COALESCE(NULLIF(TRIM(s.arrondissement_name), ''), 'unknown')
           ELSE NULL
         END AS arrondissement_name,
         s.user_id,
         s.username,
         s.score,
         s.items_correct,
         s.items_total,
         s.time_sec,
         s.timestamp,
         u.avatar
       FROM scores s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE 1 = 1
       ${periodWhereClause}
     ),
     ranked_by_user AS (
       SELECT
         base.*,
         COUNT(*) OVER (
           PARTITION BY
             base.mode,
             base.game_type,
             base.arrondissement_partition_key,
             base.user_id,
             base.username
         ) AS games_played,
         ROW_NUMBER() OVER (
           PARTITION BY
             base.mode,
             base.game_type,
             base.arrondissement_partition_key,
             base.user_id,
             base.username
           ORDER BY
             CASE
               WHEN base.game_type = 'classique' THEN base.score::double precision
               ELSE base.items_correct::double precision
             END DESC,
             base.time_sec ASC,
             base.timestamp ASC
         ) AS user_rank
       FROM base
     ),
     best_runs AS (
       SELECT
         ranked_by_user.mode,
         ranked_by_user.game_type,
         ranked_by_user.arrondissement_name,
         ranked_by_user.username,
         ranked_by_user.avatar,
         ranked_by_user.score AS high_score,
         ranked_by_user.items_correct,
         ranked_by_user.items_total,
         ranked_by_user.time_sec,
         ranked_by_user.games_played,
         ROW_NUMBER() OVER (
           PARTITION BY
             ranked_by_user.mode,
             ranked_by_user.game_type,
             COALESCE(ranked_by_user.arrondissement_name, '')
           ORDER BY
             CASE
               WHEN ranked_by_user.game_type = 'classique'
                 THEN ranked_by_user.score::double precision
               ELSE ranked_by_user.items_correct::double precision
             END DESC,
             ranked_by_user.time_sec ASC,
             ranked_by_user.username ASC
         ) AS leaderboard_rank
       FROM ranked_by_user
       WHERE ranked_by_user.user_rank = 1
     )
     SELECT
       mode,
       game_type,
       arrondissement_name,
       username,
       avatar,
       high_score,
       items_correct,
       items_total,
       time_sec,
       games_played
     FROM best_runs
     WHERE leaderboard_rank <= $1
     ORDER BY mode, game_type, arrondissement_name NULLS FIRST, leaderboard_rank ASC`,
    [limit]
  );

  const result = {};
  rows.rows.forEach((row) => {
    let key = `${row.mode}|${row.game_type}`;
    if (row.arrondissement_name) {
      key += `|${row.arrondissement_name}`;
    }
    result[key] = result[key] || [];
    result[key].push({
      username: row.username,
      avatar: row.avatar,
      high_score: row.high_score,
      items_correct: row.items_correct,
      items_total: row.items_total,
      time_sec: row.time_sec,
      games_played: row.games_played,
    });
  });
  return result;
}

// ── Friend Challenge Helpers ──

async function createFriendChallenge({
  code,
  createdByUserId,
  createdByUsername,
  mode,
  gameType,
  arrondissementName,
  targetType,
  targetNames,
  expiresAt,
}) {
  const result = await pool.query(
    `INSERT INTO friend_challenges (
       code,
       created_by_user_id,
       created_by_username,
       mode,
       game_type,
       arrondissement_name,
       target_type,
       targets_json,
       item_count,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     RETURNING
       id,
       code,
       created_by_user_id,
       created_by_username,
       mode,
       game_type,
       arrondissement_name,
       target_type,
       targets_json,
       item_count,
       created_at,
       expires_at`,
    [
      code,
      createdByUserId,
      createdByUsername,
      mode,
      gameType,
      arrondissementName || null,
      targetType,
      JSON.stringify(Array.isArray(targetNames) ? targetNames : []),
      Array.isArray(targetNames) ? targetNames.length : 0,
      expiresAt || null,
    ]
  );
  return result.rows[0] || null;
}

async function getFriendChallengeByCode(code) {
  const result = await pool.query(
    `SELECT
       id,
       code,
       created_by_user_id,
       created_by_username,
       mode,
       game_type,
       arrondissement_name,
       target_type,
       targets_json,
       item_count,
       created_at,
       expires_at
     FROM friend_challenges
     WHERE code = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

async function hasPlayedFriendChallenge(challengeId, userId) {
  const challenge = Number.parseInt(challengeId, 10);
  const user = Number.parseInt(userId, 10);
  if (!Number.isInteger(challenge) || challenge <= 0 || !Number.isInteger(user) || user <= 0) {
    return false;
  }

  const result = await pool.query(
    `SELECT 1
     FROM friend_challenge_scores
     WHERE challenge_id = $1 AND user_id = $2
     LIMIT 1`,
    [challenge, user]
  );
  return result.rowCount > 0;
}

async function addFriendChallengeScore(
  challengeId,
  userId,
  score,
  itemsCorrect,
  itemsTotal,
  timeSec,
  gameType
) {
  const result = await pool.query(
    `INSERT INTO friend_challenge_scores (
       challenge_id,
       user_id,
       score,
       items_correct,
       items_total,
       time_sec
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (challenge_id, user_id) DO UPDATE SET
       score = EXCLUDED.score,
       items_correct = EXCLUDED.items_correct,
       items_total = EXCLUDED.items_total,
       time_sec = EXCLUDED.time_sec,
       updated_at = NOW()
     WHERE
       (
         CASE
           WHEN $7 = 'classique' THEN EXCLUDED.score::double precision
           ELSE EXCLUDED.items_correct::double precision
         END
       ) >
       (
         CASE
           WHEN $7 = 'classique' THEN friend_challenge_scores.score::double precision
           ELSE friend_challenge_scores.items_correct::double precision
         END
       )
       OR (
         (
           CASE
             WHEN $7 = 'classique' THEN EXCLUDED.score::double precision
             ELSE EXCLUDED.items_correct::double precision
           END
         ) =
         (
           CASE
             WHEN $7 = 'classique' THEN friend_challenge_scores.score::double precision
             ELSE friend_challenge_scores.items_correct::double precision
           END
         )
         AND EXCLUDED.time_sec::double precision < friend_challenge_scores.time_sec::double precision
       )
     RETURNING id`,
    [
      challengeId,
      userId,
      score,
      itemsCorrect || 0,
      itemsTotal || 0,
      timeSec || 0,
      gameType,
    ]
  );
  return result.rowCount > 0;
}

async function getFriendChallengeLeaderboard(challengeId, gameType, limit = 20) {
  const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const result = await pool.query(
    `SELECT
       u.username,
       COALESCE(u.avatar, '👤') AS avatar,
       s.score,
       s.items_correct,
       s.items_total,
       s.time_sec
     FROM friend_challenge_scores s
     JOIN users u ON s.user_id = u.id
     WHERE s.challenge_id = $1
     ORDER BY
       CASE
         WHEN $2 = 'classique' THEN s.score::double precision
         ELSE s.items_correct::double precision
       END DESC,
       s.time_sec ASC,
       s.submitted_at ASC
     LIMIT $3`,
    [challengeId, gameType, parsedLimit]
  );
  return result.rows;
}

async function deleteExpiredFriendChallenges() {
  const result = await pool.query(
    `DELETE FROM friend_challenges
     WHERE expires_at IS NOT NULL
       AND expires_at <= NOW()`
  );
  return result.rowCount || 0;
}

// ── Daily Challenge Helpers ──

async function getDailyTarget(date) {
  const res = await pool.query('SELECT * FROM daily_targets WHERE date = $1', [date]);
  return res.rows[0] || null;
}

async function getRecentDailyTargets(limit) {
  const res = await pool.query(
    'SELECT * FROM daily_targets ORDER BY date DESC LIMIT $1',
    [limit]
  );
  return res.rows;
}

async function listDailyTargets() {
  const res = await pool.query(
    'SELECT * FROM daily_targets ORDER BY date DESC'
  );
  return res.rows;
}

async function setDailyTarget(date, streetName, arrondissement, coordinates, geometry) {
  await pool.query(
    `INSERT INTO daily_targets (date, street_name, arrondissement, coordinates_json, geometry_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (date) DO UPDATE SET
       street_name = EXCLUDED.street_name,
       arrondissement = EXCLUDED.arrondissement,
       coordinates_json = EXCLUDED.coordinates_json,
       geometry_json = EXCLUDED.geometry_json`,
    [date, streetName, arrondissement, JSON.stringify(coordinates), geometry ? JSON.stringify(geometry) : null]
  );
}

async function getDailyUserStatus(userId, date) {
  const res = await pool.query(
    'SELECT * FROM daily_user_attempts WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
  return res.rows[0] || null;
}

async function countDailyUserAttemptsForDate(date) {
  const res = await pool.query(
    'SELECT COUNT(*)::int AS attempt_count FROM daily_user_attempts WHERE date = $1',
    [date]
  );
  return Number(res.rows[0]?.attempt_count || 0);
}

async function startDailyUserAttempt(userId, date) {
  const res = await pool.query(
    `INSERT INTO daily_user_attempts (
       user_id, date, attempts_count, success, started_at, last_attempt_at
     )
     VALUES ($1, $2, 0, FALSE, NOW(), NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       started_at = CASE
         WHEN daily_user_attempts.started_at IS NULL
           AND COALESCE(daily_user_attempts.attempts_count, 0) = 0
           THEN NOW()
         ELSE daily_user_attempts.started_at
       END
     RETURNING *`,
    [userId, date]
  );
  return res.rows[0];
}

async function updateDailyUserAttempt(userId, date, distanceMeters, isSuccess) {
  const result = await pool.query(
    `INSERT INTO daily_user_attempts (
       user_id, date, attempts_count, best_distance_meters, success, started_at, last_attempt_at
     )
     VALUES ($1, $2, 1, $3, $4, NOW(), NOW())
     ON CONFLICT (user_id, date) DO UPDATE SET
       attempts_count = CASE
         WHEN COALESCE(daily_user_attempts.success, FALSE) = TRUE OR COALESCE(daily_user_attempts.attempts_count, 0) >= 7
           THEN daily_user_attempts.attempts_count
         ELSE COALESCE(daily_user_attempts.attempts_count, 0) + 1
       END,
       best_distance_meters = CASE
         WHEN COALESCE(daily_user_attempts.success, FALSE) = TRUE
           OR (COALESCE(daily_user_attempts.attempts_count, 0) >= 7 AND EXCLUDED.success = FALSE)
           THEN daily_user_attempts.best_distance_meters
         WHEN daily_user_attempts.best_distance_meters IS NULL THEN EXCLUDED.best_distance_meters
         WHEN EXCLUDED.best_distance_meters < daily_user_attempts.best_distance_meters THEN EXCLUDED.best_distance_meters
         ELSE daily_user_attempts.best_distance_meters
       END,
       success = CASE
         WHEN COALESCE(daily_user_attempts.success, FALSE) = TRUE
           THEN daily_user_attempts.success
         ELSE (COALESCE(daily_user_attempts.success, FALSE) OR EXCLUDED.success)
       END,
       last_attempt_at = CASE
         WHEN COALESCE(daily_user_attempts.success, FALSE) = TRUE
           OR (COALESCE(daily_user_attempts.attempts_count, 0) >= 7 AND EXCLUDED.success = FALSE)
           THEN daily_user_attempts.last_attempt_at
         ELSE NOW()
       END
     RETURNING attempts_count, best_distance_meters, success`,
    [userId, date, distanceMeters, Boolean(isSuccess)]
  );

  return result.rows[0];
}

async function getDailyLeaderboard(date) {
  const res = await pool.query(
    `SELECT
       u.username,
       u.avatar,
       LEAST(COALESCE(d.attempts_count, 0), 7)::int AS attempts_count,
       d.success,
       d.best_distance_meters
     FROM daily_user_attempts d
     JOIN users u ON d.user_id = u.id
     WHERE d.date = $1 AND (d.success = TRUE OR d.attempts_count >= 7)
     ORDER BY 
       d.success DESC,
       CASE WHEN d.success = TRUE THEN LEAST(COALESCE(d.attempts_count, 0), 7) ELSE NULL END ASC,
       CASE WHEN d.success = FALSE THEN d.best_distance_meters ELSE NULL END ASC,
       CASE
         WHEN d.started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (d.last_attempt_at - d.started_at))
         ELSE NULL
       END ASC NULLS LAST,
       d.last_attempt_at ASC
     LIMIT 20`,
    [date]
  );
  return res.rows;
}

async function getDailyAverageLeaderboard(limit = 20) {
  const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const res = await pool.query(
    `WITH player_averages AS (
       SELECT
         d.user_id,
         COUNT(*)::int AS participations,
         AVG(
           CASE
             WHEN d.success = TRUE THEN LEAST(COALESCE(d.attempts_count, 0), 7)
             ELSE 8
           END
         )::float8 AS average_attempts
       FROM daily_user_attempts d
       WHERE d.success = TRUE OR d.attempts_count >= 7
       GROUP BY d.user_id
       HAVING COUNT(*) >= 10
     )
     SELECT
       u.username,
       u.avatar,
       player_averages.average_attempts,
       player_averages.participations
     FROM player_averages
     JOIN users u ON player_averages.user_id = u.id
     WHERE LOWER(TRIM(u.username)) NOT IN (
       'philo14',
       'test8',
       'test9',
       'testphil1'
     )
     ORDER BY
       player_averages.average_attempts ASC,
       u.username ASC
     LIMIT $1`,
    [parsedLimit]
  );
  return res.rows;
}

async function getWeeklyDailyPodiumLeaderboard(date, limit = 20) {
  const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const res = await pool.query(
    `WITH completed AS (
       SELECT
         d.user_id,
         date_trunc('week', d.date::date)::date AS week_start,
         LEAST(COALESCE(d.attempts_count, 0), 7)::int AS attempts_count,
         d.success,
         d.best_distance_meters,
         d.last_attempt_at
       FROM daily_user_attempts d
       WHERE d.date::date < date_trunc('week', $1::date)::date
         AND (d.success = TRUE OR d.attempts_count >= 7)
     ),
     first_historical_week AS (
       SELECT MIN(week_start) AS week_start
       FROM completed
     ),
     weekly_stats AS (
       SELECT
         completed.week_start,
         completed.user_id,
         COUNT(*)::int AS days_played,
         SUM(CASE WHEN completed.success THEN 1 ELSE 0 END)::int AS successes,
         SUM(CASE WHEN completed.success THEN completed.attempts_count ELSE 7 END)::int AS total_attempts,
         MIN(completed.best_distance_meters)::int AS best_distance_meters,
         MAX(completed.last_attempt_at) AS last_completed_at
       FROM completed
       CROSS JOIN first_historical_week
       WHERE completed.week_start > first_historical_week.week_start
       GROUP BY completed.week_start, completed.user_id
     ),
     weekly_rankings AS (
       SELECT
         weekly_stats.user_id,
         ROW_NUMBER() OVER (
           PARTITION BY weekly_stats.week_start
           ORDER BY
             weekly_stats.successes DESC,
             CASE WHEN weekly_stats.successes = 0 THEN weekly_stats.days_played ELSE NULL END DESC NULLS LAST,
             weekly_stats.total_attempts ASC,
             weekly_stats.best_distance_meters ASC NULLS LAST,
             weekly_stats.last_completed_at ASC,
             u.username ASC
         ) AS weekly_rank
       FROM weekly_stats
       JOIN users u ON weekly_stats.user_id = u.id
     ),
     podiums AS (
       SELECT
         user_id,
         COUNT(*) FILTER (WHERE weekly_rank = 1)::int AS first_places,
         COUNT(*) FILTER (WHERE weekly_rank = 2)::int AS second_places,
         COUNT(*) FILTER (WHERE weekly_rank = 3)::int AS third_places
       FROM weekly_rankings
       WHERE weekly_rank <= 3
       GROUP BY user_id
     ),
     participations AS (
       SELECT
         user_id,
         COUNT(*)::int AS weeks_played
       FROM weekly_stats
       GROUP BY user_id
     )
     SELECT
       u.username,
       u.avatar,
       podiums.first_places,
       podiums.second_places,
       podiums.third_places,
       participations.weeks_played
     FROM podiums
     JOIN users u ON podiums.user_id = u.id
     JOIN participations ON podiums.user_id = participations.user_id
     WHERE LOWER(TRIM(u.username)) NOT IN (
       'philo14',
       'test',
       'test2',
       'test3',
       'test8',
       'testcheck',
       'testphil1',
       'allezlom!'
     )
     ORDER BY
       podiums.first_places DESC,
       podiums.second_places DESC,
       podiums.third_places DESC,
       u.username ASC
     LIMIT $2`,
    [date, parsedLimit]
  );
  return res.rows;
}

async function getDailyWeeklyLeaderboard(date, limit = 20) {
  const parsedLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const res = await pool.query(
    `WITH completed AS (
       SELECT
         d.user_id,
         LEAST(COALESCE(d.attempts_count, 0), 7)::int AS attempts_count,
         d.success,
         d.best_distance_meters,
         d.last_attempt_at
       FROM daily_user_attempts d
       WHERE d.date::date >= date_trunc('week', $1::date)::date
         AND d.date::date < (date_trunc('week', $1::date)::date + INTERVAL '7 days')
         AND (d.success = TRUE OR d.attempts_count >= 7)
     ),
     ranked AS (
       SELECT
         u.username,
         u.avatar,
         COUNT(*)::int AS days_played,
         SUM(CASE WHEN completed.success THEN 1 ELSE 0 END)::int AS successes,
         SUM(CASE WHEN completed.success THEN completed.attempts_count ELSE 7 END)::int AS total_attempts,
         SUM(completed.best_distance_meters)::int AS total_distance_meters,
         MAX(completed.last_attempt_at) AS last_completed_at
       FROM completed
       JOIN users u ON completed.user_id = u.id
       GROUP BY completed.user_id, u.username, u.avatar
     )
     SELECT
       username,
       avatar,
       days_played,
       successes,
       total_attempts,
       total_distance_meters
     FROM ranked
     ORDER BY
       successes DESC,
       total_attempts ASC,
       total_distance_meters ASC NULLS LAST,
       last_completed_at ASC,
       username ASC
     LIMIT $2`,
    [date, parsedLimit]
  );
  return res.rows;
}

// ── Push Notifications Helpers ──

async function upsertPushSubscription(userId, subscription, options = {}) {
  const endpoint = String(subscription?.endpoint || '').trim();
  if (!endpoint) {
    throw new Error('Invalid push subscription endpoint');
  }
  const vapidPublicKey = String(options?.vapidPublicKey || '').trim() || null;

  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, subscription_json, vapid_public_key, enabled, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, TRUE, NOW())
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       subscription_json = EXCLUDED.subscription_json,
       vapid_public_key = EXCLUDED.vapid_public_key,
       enabled = TRUE,
       updated_at = NOW()`,
    [userId, endpoint, JSON.stringify(subscription), vapidPublicKey]
  );
}

async function getPushSubscriptionStatusForUser(userId, options = {}) {
  const endpoint = String(options?.endpoint || '').trim();
  const vapidPublicKey = String(options?.vapidPublicKey || '').trim();
  const params = [userId];
  const endpointFilter = endpoint ? 'AND endpoint = $2' : '';
  if (endpoint) {
    params.push(endpoint);
  }
  const orderBy = vapidPublicKey
    ? `ORDER BY
         CASE
           WHEN enabled = TRUE AND (vapid_public_key IS NULL OR vapid_public_key = $${params.length + 1}) THEN 0
           WHEN enabled = TRUE THEN 1
           ELSE 2
         END,
         updated_at DESC`
    : 'ORDER BY updated_at DESC';
  if (vapidPublicKey) {
    params.push(vapidPublicKey);
  }

  const res = await pool.query(
    `SELECT endpoint, enabled, vapid_public_key, updated_at
     FROM push_subscriptions
     WHERE user_id = $1 ${endpointFilter}
     ${orderBy}
     LIMIT 1`,
    params
  );
  const row = res.rows[0] || null;
  if (!row) {
    return null;
  }

  const storedPublicKey = String(row.vapid_public_key || '').trim();
  const hasMatchingVapidKey = !vapidPublicKey || !storedPublicKey || storedPublicKey === vapidPublicKey;
  return {
    ...row,
    active: Boolean(row.enabled && hasMatchingVapidKey),
    stale_vapid_key: Boolean(row.enabled && !hasMatchingVapidKey),
  };
}

async function removePushSubscriptionForUser(userId, endpoint) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) {
    return;
  }
  await pool.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, normalizedEndpoint]
  );
}

async function removeAllPushSubscriptionsForUser(userId) {
  await pool.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
}

async function removePushSubscriptionByEndpoint(endpoint) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) {
    return;
  }
  await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1',
    [normalizedEndpoint]
  );
}

async function listPushSubscriptionsDueForDate(dateStr, options = {}) {
  const vapidPublicKey = String(options?.vapidPublicKey || '').trim();
  const params = [dateStr];
  const vapidFilter = vapidPublicKey
    ? 'AND (ps.vapid_public_key IS NULL OR ps.vapid_public_key = $2)'
    : '';
  if (vapidPublicKey) {
    params.push(vapidPublicKey);
  }

  const res = await pool.query(
    `SELECT ps.endpoint, ps.subscription_json
     FROM push_subscriptions ps
     WHERE ps.enabled = TRUE
       ${vapidFilter}
       AND (ps.last_notified_on IS NULL OR ps.last_notified_on < $1::date)
       AND NOT EXISTS (
         SELECT 1
         FROM daily_user_attempts dua
         WHERE dua.user_id = ps.user_id
           AND dua.date = $1::text
           AND COALESCE(dua.attempts_count, 0) > 0
       )
     ORDER BY ps.updated_at ASC`,
    params
  );
  return res.rows;
}

async function markPushSubscriptionNotified(endpoint, dateStr) {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) {
    return;
  }
  await pool.query(
    `UPDATE push_subscriptions
     SET last_notified_on = $1::date,
         updated_at = NOW()
     WHERE endpoint = $2`,
    [dateStr, normalizedEndpoint]
  );
}

// ── Player Profile Stats ──

async function getUserStats(userId) {
  // Per-mode stats
  const modeStatsPromise = pool.query(
    `WITH grouped AS (
       SELECT
         mode,
         game_type,
         COUNT(*) as games_played,
         ROUND(AVG(score)::numeric, 1) as avg_score
       FROM scores
       WHERE user_id = $1
       GROUP BY mode, game_type
     ),
     best AS (
       SELECT
         mode,
         game_type,
         score AS high_score,
         items_correct AS best_items_correct,
         items_total AS best_items_total,
         ROW_NUMBER() OVER (
           PARTITION BY mode, game_type
           ORDER BY
             CASE
               WHEN game_type = 'classique' THEN score::double precision
               ELSE items_correct::double precision
             END DESC,
             time_sec ASC,
             timestamp ASC
         ) AS rn
       FROM scores
       WHERE user_id = $1
     )
     SELECT
       grouped.mode,
       grouped.game_type,
       grouped.games_played,
       best.high_score,
       grouped.avg_score,
       best.best_items_correct,
       best.best_items_total
     FROM grouped
     JOIN best ON
       best.mode = grouped.mode
       AND best.game_type = grouped.game_type
       AND best.rn = 1
     ORDER BY grouped.mode, grouped.game_type`,
    [userId]
  );

  // Overall aggregates
  const overallPromise = pool.query(
    `SELECT COUNT(*) as total_games,
            COALESCE(MAX(score), 0) as best_score,
            ROUND(COALESCE(AVG(score), 0)::numeric, 1) as avg_score
     FROM scores WHERE user_id = $1`,
    [userId]
  );

  // Best mode (highest high score)
  const bestModePromise = pool.query(
    `WITH ranked AS (
       SELECT
         mode,
         game_type,
         score AS high_score,
         items_correct,
         items_total,
         time_sec,
         ROW_NUMBER() OVER (
           ORDER BY
             CASE
               WHEN game_type = 'classique' THEN score::double precision
               ELSE items_correct::double precision
             END DESC,
             time_sec ASC,
             timestamp ASC
         ) AS rn
       FROM scores
       WHERE user_id = $1
     )
     SELECT mode, game_type, high_score, items_correct, items_total
     FROM ranked
     WHERE rn = 1`,
    [userId]
  );

  const weeklyProgressPromise = pool.query(
    `WITH weeks AS (
       SELECT generate_series(
         date_trunc('week', timezone('Europe/Paris', NOW())) - interval '11 weeks',
         date_trunc('week', timezone('Europe/Paris', NOW())),
         interval '1 week'
       ) AS week_start
     ),
     agg AS (
       SELECT
         date_trunc('week', timestamp AT TIME ZONE 'Europe/Paris') AS week_start,
         COUNT(*)::int AS games_played,
         ROUND(AVG(score)::numeric, 1) AS avg_score,
         ROUND(
           AVG(
             CASE
               WHEN items_total > 0 THEN (items_correct::double precision * 100.0 / items_total::double precision)
               ELSE NULL
             END
           )::numeric,
           1
         ) AS success_rate,
         ROUND(AVG(NULLIF(time_sec, 0))::numeric, 1) AS avg_time_sec
       FROM scores
       WHERE user_id = $1
       GROUP BY 1
     )
     SELECT
       TO_CHAR(w.week_start, 'DD/MM') AS label,
       COALESCE(a.games_played, 0) AS games_played,
       COALESCE(a.avg_score, 0) AS avg_score,
       COALESCE(a.success_rate, 0) AS success_rate,
       COALESCE(a.avg_time_sec, 0) AS avg_time_sec
     FROM weeks w
     LEFT JOIN agg a ON a.week_start = w.week_start
     ORDER BY w.week_start ASC`,
    [userId]
  );

  const arrondissementStatsPromise = pool.query(
    `SELECT
       arrondissement_name,
       COUNT(*)::int AS games_played,
       ROUND(
         AVG(
           CASE
             WHEN items_total > 0 THEN (items_correct::double precision * 100.0 / items_total::double precision)
             ELSE NULL
           END
         )::numeric,
         1
       ) AS success_rate,
       ROUND(AVG(NULLIF(time_sec, 0))::numeric, 1) AS avg_time_sec,
       ROUND(MAX(score)::numeric, 1) AS best_score
     FROM scores
     WHERE user_id = $1
       AND arrondissement_name IS NOT NULL
       AND arrondissement_name <> ''
     GROUP BY arrondissement_name
     ORDER BY games_played DESC, success_rate DESC, arrondissement_name ASC
     LIMIT 40`,
    [userId]
  );

  const difficultyStatsPromise = pool.query(
    `SELECT
       mode,
       COUNT(*)::int AS games_played,
       ROUND(
         AVG(
           CASE
             WHEN items_total > 0 THEN (items_correct::double precision * 100.0 / items_total::double precision)
             ELSE NULL
           END
         )::numeric,
         1
       ) AS success_rate,
       ROUND(AVG(NULLIF(time_sec, 0))::numeric, 1) AS avg_time_sec
     FROM scores
     WHERE user_id = $1
     GROUP BY mode
     ORDER BY mode`,
    [userId]
  );

  // Daily challenge stats (basic)
  const dailyStatsPromise = pool.query(
    `SELECT COUNT(*) as total_days,
            SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
            ROUND(AVG(attempts_count)::numeric, 1) as avg_attempts
     FROM daily_user_attempts WHERE user_id = $1`,
    [userId]
  );

  const dailyStreaksPromise = pool.query(
    `WITH success_dates AS (
       SELECT DISTINCT date::date AS day
       FROM daily_user_attempts
       WHERE user_id = $1
         AND success = TRUE
         AND date ~ '^\\d{4}-\\d{2}-\\d{2}$'
     ),
     streak_groups AS (
       SELECT
         day,
         (day - (ROW_NUMBER() OVER (ORDER BY day))::int) AS grp
       FROM success_dates
     ),
     streaks AS (
       SELECT
         MIN(day) AS start_day,
         MAX(day) AS end_day,
         COUNT(*)::int AS streak_len
       FROM streak_groups
       GROUP BY grp
     ),
     today AS (
       SELECT timezone('Europe/Paris', NOW())::date AS day
     ),
     latest AS (
       SELECT end_day, streak_len
       FROM streaks
       ORDER BY end_day DESC
       LIMIT 1
     )
     SELECT
       COALESCE((SELECT MAX(streak_len) FROM streaks), 0)::int AS max_streak,
       COALESCE((
         SELECT
           CASE
             WHEN latest.end_day = today.day OR latest.end_day = (today.day - 1)
               THEN latest.streak_len
             ELSE 0
           END
         FROM latest
         CROSS JOIN today
       ), 0)::int AS current_streak`,
    [userId]
  );

  const userInfoPromise = pool.query(
    'SELECT created_at FROM users WHERE id = $1',
    [userId]
  );

  const [
    modeStats,
    overall,
    bestMode,
    weeklyProgress,
    arrondissementStats,
    difficultyStats,
    dailyStats,
    dailyStreaks,
    userInfo,
  ] = await Promise.all([
    modeStatsPromise,
    overallPromise,
    bestModePromise,
    weeklyProgressPromise,
    arrondissementStatsPromise,
    difficultyStatsPromise,
    dailyStatsPromise,
    dailyStreaksPromise,
    userInfoPromise,
  ]);
  const currentStreak = Number(dailyStreaks.rows[0]?.current_streak || 0);
  const maxStreak = Number(dailyStreaks.rows[0]?.max_streak || 0);

  return {
    memberSince: userInfo.rows[0]?.created_at || null,
    overall: overall.rows[0] || { total_games: 0, best_score: 0, avg_score: 0 },
    bestMode: bestMode.rows[0] || null,
    modes: modeStats.rows,
    weekly_progress: weeklyProgress.rows || [],
    arrondissement_stats: arrondissementStats.rows || [],
    difficulty_stats: difficultyStats.rows || [],
    daily: {
      ...(dailyStats.rows[0] || { total_days: 0, successes: 0, avg_attempts: 0 }),
      current_streak: currentStreak,
      max_streak: maxStreak
    }
  };
}

async function updateUserAvatar(userId, avatar) {
  await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, userId]);
}

// ── Referral Helpers ──

async function createReferralByCode(referredUserId, referralCode) {
  const normalizedReferredUserId = Number.parseInt(referredUserId, 10);
  const normalizedCode = String(referralCode || '').trim().toUpperCase();
  if (!Number.isInteger(normalizedReferredUserId) || normalizedReferredUserId <= 0) {
    throw new Error('Invalid referred user id');
  }
  if (!normalizedCode) {
    throw new Error('Missing referral code');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const referrerResult = await client.query(
      `SELECT id, username, referral_code
       FROM users
       WHERE UPPER(referral_code) = $1
       FOR UPDATE`,
      [normalizedCode]
    );
    const referrer = referrerResult.rows[0] || null;
    if (!referrer) {
      await client.query('ROLLBACK');
      const error = new Error('Referral code not found');
      error.code = 'REFERRER_NOT_FOUND';
      throw error;
    }
    if (Number(referrer.id) === normalizedReferredUserId) {
      await client.query('ROLLBACK');
      const error = new Error('A player cannot use their own referral code');
      error.code = 'REFERRAL_SELF_LINK';
      throw error;
    }

    const existingResult = await client.query(
      `SELECT id, referrer_user_id, referred_user_id, referral_code, created_at
       FROM referrals
       WHERE referred_user_id = $1`,
      [normalizedReferredUserId]
    );
    if (existingResult.rows[0]) {
      await client.query('COMMIT');
      return { referral: existingResult.rows[0], alreadyLinked: true };
    }

    const insertResult = await client.query(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code)
       VALUES ($1, $2, $3)
       RETURNING id, referrer_user_id, referred_user_id, referral_code, created_at`,
      [referrer.id, normalizedReferredUserId, referrer.referral_code]
    );

    await client.query('COMMIT');
    return { referral: insertResult.rows[0], alreadyLinked: false };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Ignore rollback errors and surface the original failure.
    }
    if (error?.code === '23505') {
      const duplicate = new Error('This player is already linked to a referrer');
      duplicate.code = 'REFERRAL_ALREADY_LINKED';
      throw duplicate;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getReferralByReferredUserId(referredUserId) {
  const normalizedUserId = Number.parseInt(referredUserId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const result = await pool.query(
    `SELECT
       r.*,
       referrer.username AS referrer_username,
       referred.username AS referred_username,
       referred.created_at AS referred_created_at
     FROM referrals r
     JOIN users referrer ON referrer.id = r.referrer_user_id
     JOIN users referred ON referred.id = r.referred_user_id
     WHERE r.referred_user_id = $1`,
    [normalizedUserId]
  );
  return result.rows[0] || null;
}

async function countFirstWeekSuccessfulDailies(userId) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return 0;
  }

  const result = await pool.query(
    `SELECT COUNT(DISTINCT dua.date)::int AS successful_dailies
     FROM users u
     JOIN daily_user_attempts dua ON dua.user_id = u.id
     WHERE u.id = $1
       AND dua.success = TRUE
       AND dua.date ~ '^\\d{4}-\\d{2}-\\d{2}$'
       AND dua.date::date >= (u.created_at AT TIME ZONE 'Europe/Paris')::date
       AND dua.date::date < ((u.created_at AT TIME ZONE 'Europe/Paris')::date + INTERVAL '7 days')`,
    [normalizedUserId]
  );
  return Number(result.rows[0]?.successful_dailies || 0);
}

async function awardUserBadge(userId, badge, metadata = {}) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !badge?.id) {
    throw new Error('Invalid badge award');
  }

  const result = await pool.query(
    `INSERT INTO user_badges (user_id, badge_id, badge_name, badge_emoji, source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (user_id, badge_id) DO NOTHING
     RETURNING id, user_id, badge_id, badge_name, badge_emoji, source, metadata, unlocked_at`,
    [
      normalizedUserId,
      badge.id,
      badge.name,
      badge.emoji,
      badge.source || 'referral',
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rows[0] || null;
}

async function completeReferralTier(referralId, tierNumber, dailyCount = null) {
  const normalizedReferralId = Number.parseInt(referralId, 10);
  const normalizedTier = Number.parseInt(tierNumber, 10);
  if (!Number.isInteger(normalizedReferralId) || normalizedReferralId <= 0 || ![1, 2, 3].includes(normalizedTier)) {
    throw new Error('Invalid referral tier update');
  }

  const column = `tier${normalizedTier}_completed_at`;
  const dailyCountSet = normalizedTier === 1 ? ', tier1_daily_count = GREATEST(tier1_daily_count, $2)' : '';
  const params = normalizedTier === 1
    ? [normalizedReferralId, Number.parseInt(dailyCount, 10) || 0]
    : [normalizedReferralId];

  const result = await pool.query(
    `UPDATE referrals
     SET ${column} = COALESCE(${column}, NOW()),
         updated_at = NOW()
         ${dailyCountSet}
     WHERE id = $1
     RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

async function updateReferralTier1DailyCount(referralId, dailyCount) {
  const normalizedReferralId = Number.parseInt(referralId, 10);
  const normalizedCount = Math.max(0, Number.parseInt(dailyCount, 10) || 0);
  if (!Number.isInteger(normalizedReferralId) || normalizedReferralId <= 0) {
    return null;
  }

  const result = await pool.query(
    `UPDATE referrals
     SET tier1_daily_count = GREATEST(tier1_daily_count, $2),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [normalizedReferralId, normalizedCount]
  );
  return result.rows[0] || null;
}

async function countTier1ReferralsForReferrer(referrerUserId) {
  const normalizedUserId = Number.parseInt(referrerUserId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return 0;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS tier1_referrals
     FROM referrals
     WHERE referrer_user_id = $1
       AND tier1_completed_at IS NOT NULL`,
    [normalizedUserId]
  );
  return Number(result.rows[0]?.tier1_referrals || 0);
}

async function getReferralProfileForUser(userId) {
  const normalizedUserId = Number.parseInt(userId, 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const referralCode = await ensureReferralCodeForUser(normalizedUserId);
  const [badgesResult, referralStatsResult, referredByResult] = await Promise.all([
    pool.query(
      `SELECT badge_id, badge_name, badge_emoji, source, metadata, unlocked_at
       FROM user_badges
       WHERE user_id = $1
       ORDER BY unlocked_at ASC, badge_id ASC`,
      [normalizedUserId]
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COUNT(*) FILTER (WHERE tier1_completed_at IS NOT NULL)::int AS tier1_referrals,
         COUNT(*) FILTER (WHERE tier2_completed_at IS NOT NULL)::int AS tier2_referrals,
         COUNT(*) FILTER (WHERE tier3_completed_at IS NOT NULL)::int AS tier3_referrals
       FROM referrals
       WHERE referrer_user_id = $1`,
      [normalizedUserId]
    ),
    pool.query(
      `SELECT r.id, r.referrer_user_id, u.username AS referrer_username, r.created_at
       FROM referrals r
       JOIN users u ON u.id = r.referrer_user_id
       WHERE r.referred_user_id = $1`,
      [normalizedUserId]
    ),
  ]);

  return {
    code: referralCode,
    stats: referralStatsResult.rows[0] || {
      total_referrals: 0,
      tier1_referrals: 0,
      tier2_referrals: 0,
      tier3_referrals: 0,
    },
    referredBy: referredByResult.rows[0] || null,
    badges: badgesResult.rows.map((row) => ({
      id: row.badge_id,
      name: row.badge_name,
      emoji: row.badge_emoji,
      source: row.source,
      metadata: row.metadata || {},
      unlockedAt: row.unlocked_at,
    })),
  };
}

// ── Analytics ──

async function trackStreetAnswer(streetName, mode, correct, timeSec) {
  const col = correct ? 'correct_count' : 'wrong_count';
  await pool.query(
    `INSERT INTO analytics_streets (street_name, mode, ${col}, total_time_sec)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (street_name, mode) DO UPDATE SET
       ${col} = analytics_streets.${col} + 1,
       total_time_sec = analytics_streets.total_time_sec + $3`,
    [streetName.toLowerCase().trim(), mode, timeSec || 0]
  );
}

async function getAnalytics(limit = 20) {
  // Hardest streets (lowest success rate, min 5 answers)
  const hardest = await pool.query(
    `SELECT street_name, mode,
            correct_count, wrong_count,
            (correct_count + wrong_count) as total,
            ROUND((correct_count * 100.0 / NULLIF(correct_count + wrong_count, 0))::numeric, 1) as success_rate,
            ROUND((total_time_sec / NULLIF(correct_count, 0))::numeric, 1) as avg_time_sec
     FROM analytics_streets
     WHERE (correct_count + wrong_count) >= 5
     ORDER BY success_rate ASC
     LIMIT $1`,
    [limit]
  );

  // Easiest streets
  const easiest = await pool.query(
    `SELECT street_name, mode,
            correct_count, wrong_count,
            (correct_count + wrong_count) as total,
            ROUND((correct_count * 100.0 / NULLIF(correct_count + wrong_count, 0))::numeric, 1) as success_rate,
            ROUND((total_time_sec / NULLIF(correct_count, 0))::numeric, 1) as avg_time_sec
     FROM analytics_streets
     WHERE (correct_count + wrong_count) >= 5
     ORDER BY success_rate DESC
     LIMIT $1`,
    [limit]
  );

  // Overall stats
  const overall = await pool.query(
    `SELECT COUNT(DISTINCT street_name) as unique_streets,
            SUM(correct_count + wrong_count) as total_answers,
            ROUND(AVG(correct_count * 100.0 / NULLIF(correct_count + wrong_count, 0))::numeric, 1) as avg_success_rate
     FROM analytics_streets`
  );

  return {
    hardest: hardest.rows,
    easiest: easiest.rows,
    overall: overall.rows[0] || {}
  };
}

async function recordVisitHit(visitorHash, visitHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const visitSession = await client.query(
      `INSERT INTO visitor_sessions (session_hash, visitor_hash)
       VALUES ($1, $2)
       ON CONFLICT (session_hash) DO NOTHING
       RETURNING session_hash`,
      [visitHash, visitorHash]
    );
    const isNewVisit = visitSession.rowCount > 0;

    const inserted = await client.query(
      `INSERT INTO visitors_unique (visitor_hash)
       VALUES ($1)
       ON CONFLICT (visitor_hash) DO NOTHING
       RETURNING visitor_hash`,
      [visitorHash]
    );
    const isNewVisitor = inserted.rowCount > 0;

    if (!isNewVisitor) {
      await client.query(
        `UPDATE visitors_unique
         SET last_seen = NOW(),
             hits = hits + $2
         WHERE visitor_hash = $1`,
        [visitorHash, isNewVisit ? 1 : 0]
      );
    }

    if (!isNewVisit) {
      await client.query(
        `UPDATE visitor_sessions
         SET last_seen = NOW()
         WHERE session_hash = $1 AND visitor_hash = $2`,
        [visitHash, visitorHash]
      );
      const currentTotal = await client.query(
        `INSERT INTO visitors_counter (id, total_visits)
         SELECT 1, COALESCE(SUM(hits)::BIGINT, 0)
         FROM visitors_unique
         ON CONFLICT (id) DO UPDATE SET
           total_visits = visitors_counter.total_visits
         RETURNING total_visits`
      );
      await client.query('COMMIT');
      return Number(currentTotal.rows[0]?.total_visits || 0);
    }

    const dailyUnique = await client.query(
      `INSERT INTO visitor_daily_uniques (day, visitor_hash, first_seen_at)
       VALUES ((NOW() AT TIME ZONE 'Europe/Paris')::DATE, $1, NOW())
       ON CONFLICT (day, visitor_hash) DO NOTHING
       RETURNING visitor_hash`,
      [visitorHash]
    );
    const isDailyUniqueVisitor = dailyUnique.rowCount > 0;

    await client.query(
      `INSERT INTO visitor_daily_stats (day, unique_visitors, total_visits, updated_at)
       VALUES ((NOW() AT TIME ZONE 'Europe/Paris')::DATE, $1, 1, NOW())
       ON CONFLICT (day) DO UPDATE SET
         unique_visitors = visitor_daily_stats.unique_visitors + EXCLUDED.unique_visitors,
         total_visits = GREATEST(
           COALESCE(visitor_daily_stats.total_visits, 0) + 1,
           visitor_daily_stats.unique_visitors + EXCLUDED.unique_visitors
         ),
         updated_at = NOW()`,
      [isDailyUniqueVisitor ? 1 : 0]
    );

    const total = await client.query(
      `INSERT INTO visitors_counter (id, total_visits, updated_at)
       VALUES (1, COALESCE((SELECT SUM(hits)::BIGINT FROM visitors_unique), 0), NOW())
       ON CONFLICT (id) DO UPDATE SET
         total_visits = visitors_counter.total_visits + 1,
         updated_at = NOW()
       RETURNING total_visits`
    );

    await client.query('COMMIT');
    return Number(total.rows[0]?.total_visits || 0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getVisitCount() {
  await pool.query(
    `INSERT INTO visitors_counter (id, total_visits)
     SELECT 1, COUNT(*)::BIGINT
     FROM visitors_unique
     ON CONFLICT (id) DO NOTHING`
  );

  const total = await pool.query(
    `SELECT total_visits
     FROM visitors_counter
     WHERE id = 1`
  );
  return Number(total.rows[0]?.total_visits || 0);
}

async function getDailyVisitStats() {
  const rows = await pool.query(
    `WITH daily_uniques AS (
       SELECT day, COUNT(*)::BIGINT AS unique_visitors
       FROM visitor_daily_uniques
       GROUP BY 1
     )
     SELECT stats.day,
            COALESCE(daily_uniques.unique_visitors, stats.unique_visitors, 0)::BIGINT AS unique_visitors,
            CASE WHEN stats.total_visits IS NULL THEN NULL
                 ELSE GREATEST(stats.total_visits, COALESCE(daily_uniques.unique_visitors, stats.unique_visitors, 0))
            END::BIGINT AS total_visits,
            stats.updated_at
     FROM visitor_daily_stats stats
     LEFT JOIN daily_uniques ON daily_uniques.day = stats.day
     ORDER BY stats.day DESC`
  );
  const total = await getVisitCount();
  const chartRows = await pool.query(
    `WITH days AS (
       SELECT generate_series(
         ((NOW() AT TIME ZONE 'Europe/Paris')::DATE - INTERVAL '29 days')::DATE,
         (NOW() AT TIME ZONE 'Europe/Paris')::DATE,
         INTERVAL '1 day'
       )::DATE AS day
     ),
     daily_uniques AS (
       SELECT day, COUNT(*)::BIGINT AS unique_visitors
       FROM visitor_daily_uniques
       WHERE day >= ((NOW() AT TIME ZONE 'Europe/Paris')::DATE - INTERVAL '29 days')
       GROUP BY 1
     )
     SELECT days.day,
            COALESCE(daily_uniques.unique_visitors, stats.unique_visitors, 0)::BIGINT AS unique_visitors,
            GREATEST(COALESCE(stats.total_visits, 0), COALESCE(daily_uniques.unique_visitors, stats.unique_visitors, 0))::BIGINT AS total_visits,
            stats.updated_at
     FROM days
     LEFT JOIN visitor_daily_stats stats ON stats.day = days.day
     LEFT JOIN daily_uniques ON daily_uniques.day = days.day
     ORDER BY days.day ASC`
  );
  const mappedChartRows = chartRows.rows.map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
    uniqueVisitors: Number(row.unique_visitors || 0),
    totalVisits: Number(row.total_visits || 0),
    updatedAt: row.updated_at,
  }));
  let visitsAfterDay = 0;
  for (let index = mappedChartRows.length - 1; index >= 0; index -= 1) {
    mappedChartRows[index].cumulativeTotal = Math.max(0, total - visitsAfterDay);
    visitsAfterDay += mappedChartRows[index].totalVisits;
  }

  return {
    totalVisits: total,
    chartRows: mappedChartRows,
    rows: rows.rows.map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
      uniqueVisitors: Number(row.unique_visitors || 0),
      totalVisits: row.total_visits === null ? null : Number(row.total_visits || 0),
      updatedAt: row.updated_at,
    })),
  };
}

async function getAppSetting(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return null;
  }
  const result = await pool.query(
    'SELECT value_text FROM app_settings WHERE key = $1',
    [normalizedKey]
  );
  return result.rows[0]?.value_text || null;
}

async function setAppSetting(key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    throw new Error('Invalid app setting key');
  }
  await pool.query(
    `INSERT INTO app_settings (key, value_text, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value_text = EXCLUDED.value_text,
       updated_at = NOW()`,
    [normalizedKey, String(value ?? '')]
  );
}

async function setAppSettingIfMissing(key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    throw new Error('Invalid app setting key');
  }
  await pool.query(
    `INSERT INTO app_settings (key, value_text, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [normalizedKey, String(value ?? '')]
  );
}

async function clearAllScores() {
  await pool.query('DELETE FROM scores');
}

module.exports = {
  pool,
  initDb,
  ping,
  createUser,
  ensureReferralCodeForUser,
  getUser,
  getUserById,
  listUsersForAdmin,
  deleteUserById,
  verifyPassword,
  createPasswordResetToken,
  resetPasswordWithToken,
  addScore,
  getLeaderboard,
  getAllLeaderboards,
  createFriendChallenge,
  getFriendChallengeByCode,
  hasPlayedFriendChallenge,
  addFriendChallengeScore,
  getFriendChallengeLeaderboard,
  deleteExpiredFriendChallenges,
  getDailyTarget,
  getRecentDailyTargets,
  listDailyTargets,
  setDailyTarget,
  getDailyUserStatus,
  countDailyUserAttemptsForDate,
  startDailyUserAttempt,
  updateDailyUserAttempt,
  getDailyLeaderboard,
  getDailyAverageLeaderboard,
  getWeeklyDailyPodiumLeaderboard,
  getDailyWeeklyLeaderboard,
  upsertPushSubscription,
  getPushSubscriptionStatusForUser,
  removePushSubscriptionForUser,
  removeAllPushSubscriptionsForUser,
  removePushSubscriptionByEndpoint,
  listPushSubscriptionsDueForDate,
  markPushSubscriptionNotified,
  getUserStats,
  createReferralByCode,
  getReferralByReferredUserId,
  countFirstWeekSuccessfulDailies,
  awardUserBadge,
  completeReferralTier,
  updateReferralTier1DailyCount,
  countTier1ReferralsForReferrer,
  getReferralProfileForUser,
  trackStreetAnswer,
  getAnalytics,
  recordVisitHit,
  getVisitCount,
  getDailyVisitStats,
  getAppSetting,
  setAppSetting,
  setAppSettingIfMissing,
  clearAllScores,
  updateUserAvatar,
  setUserRole
};
