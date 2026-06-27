const assert = require("node:assert/strict");
const test = require("node:test");

const { createReferralService } = require("../backend/referrals");

function createDbStub(referralOverrides = {}) {
  const badges = [];
  const state = {
    referral: {
      id: 10,
      referrer_user_id: 1,
      referred_user_id: 2,
      tier1_completed_at: null,
      tier2_completed_at: null,
      tier3_completed_at: null,
      ...referralOverrides,
    },
    dailyCount: 5,
    tier1Referrals: 3,
  };

  return {
    state,
    badges,
    async getReferralByReferredUserId() {
      return state.referral;
    },
    async countFirstWeekSuccessfulDailies() {
      return state.dailyCount;
    },
    async updateReferralTier1DailyCount(referralId, dailyCount) {
      state.referral.tier1_daily_count = dailyCount;
      return state.referral;
    },
    async completeReferralTier(referralId, tierNumber, dailyCount) {
      state.referral[`tier${tierNumber}_completed_at`] = new Date("2026-06-17T10:00:00Z");
      if (tierNumber === 1) {
        state.referral.tier1_daily_count = dailyCount;
      }
      return state.referral;
    },
    async awardUserBadge(userId, badge, metadata) {
      const existing = badges.find((entry) => entry.userId === userId && entry.id === badge.id);
      if (existing) {
        return null;
      }
      const row = { userId, id: badge.id, name: badge.name, metadata };
      badges.push(row);
      return row;
    },
    async countTier1ReferralsForReferrer() {
      return state.tier1Referrals;
    },
  };
}

test("referral daily event unlocks tier 1 and the cumulative volume badge", async () => {
  const db = createDbStub();
  const service = createReferralService(db);

  const result = await service.checkReferralProgress(2, "daily_completed");

  assert.equal(result.updated, true);
  assert.equal(result.tierCompleted, 1);
  assert.equal(result.badgeAwarded.id, "referral_recruteur");
  assert.equal(result.volumeBadgeAwarded.id, "referral_passeur_routine");
  assert.equal(db.badges.length, 2);
});

test("referral rank events enforce the tier cascade", async () => {
  const db = createDbStub();
  const service = createReferralService(db);

  const blockedMinot = await service.checkReferralProgress(2, "rank_changed_minot");
  assert.equal(blockedMinot.updated, false);
  assert.equal(blockedMinot.reason, "tier1_required");

  db.state.referral.tier1_completed_at = new Date("2026-06-17T10:00:00Z");
  const minot = await service.checkReferralProgress(2, "rank_changed_minot");
  assert.equal(minot.updated, true);
  assert.equal(minot.badgeAwarded.id, "referral_grand_frere");

  const vrai = await service.checkReferralProgress(2, "rank_changed_vrai_marseillais");
  assert.equal(vrai.updated, true);
  assert.equal(vrai.badgeAwarded.id, "referral_ancien_des_anciens");
});

test("referral progress is a no-op when the filleul is not linked", async () => {
  const service = createReferralService({
    async getReferralByReferredUserId() {
      return null;
    },
  });

  const result = await service.checkReferralProgress(99, "daily_completed");
  assert.equal(result.linked, false);
  assert.equal(result.reason, "no_referral_link");
});
