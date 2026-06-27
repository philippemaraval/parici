ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique
ON users (referral_code)
WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tier1_daily_count INTEGER NOT NULL DEFAULT 0,
  tier1_completed_at TIMESTAMPTZ,
  tier2_completed_at TIMESTAMPTZ,
  tier3_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referrals_not_self CHECK (referrer_user_id <> referred_user_id),
  CONSTRAINT referrals_single_referrer_per_referred UNIQUE (referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_user_id
ON referrals (referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referred_user_id
ON referrals (referred_user_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_tier1
ON referrals (referrer_user_id, tier1_completed_at)
WHERE tier1_completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_badges (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  badge_name TEXT NOT NULL,
  badge_emoji TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'system',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_badges_unique_user_badge UNIQUE (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id
ON user_badges (user_id);
