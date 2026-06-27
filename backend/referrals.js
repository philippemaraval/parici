const REFERRAL_EVENTS = new Set([
  'daily_completed',
  'rank_changed_minot',
  'rank_changed_vrai_marseillais',
]);

const REFERRAL_BADGES = {
  tier1: {
    id: 'referral_recruteur',
    name: 'Recruteur',
    emoji: '🫃',
    source: 'referral',
  },
  tier2: {
    id: 'referral_grand_frere',
    name: 'Grand Frère',
    emoji: '🧗‍♂️',
    source: 'referral',
  },
  tier3: {
    id: 'referral_ancien_des_anciens',
    name: "L'Ancien des Anciens",
    emoji: '👴',
    source: 'referral',
  },
  volumeTier1: {
    id: 'referral_passeur_routine',
    name: 'Passeur de Routine',
    emoji: '🥐',
    source: 'referral',
  },
};

function createReferralService(db) {
  async function awardReferralBadge(referral, badge, eventType, extraMetadata = {}) {
    return db.awardUserBadge(referral.referrer_user_id, badge, {
      referralId: referral.id,
      referredUserId: referral.referred_user_id,
      eventType,
      ...extraMetadata,
    });
  }

  async function checkVolumeBadge(referrerUserId, eventType) {
    const tier1Count = await db.countTier1ReferralsForReferrer(referrerUserId);
    if (tier1Count < 3) {
      return { tier1Count, awarded: null };
    }

    const awarded = await db.awardUserBadge(referrerUserId, REFERRAL_BADGES.volumeTier1, {
      tier1Referrals: tier1Count,
      eventType,
    });
    return { tier1Count, awarded };
  }

  async function checkReferralProgress(filleulId, eventType) {
    if (!REFERRAL_EVENTS.has(eventType)) {
      const error = new Error(`Unsupported referral event: ${eventType}`);
      error.code = 'REFERRAL_EVENT_UNSUPPORTED';
      throw error;
    }

    const referral = await db.getReferralByReferredUserId(filleulId);
    if (!referral) {
      return {
        linked: false,
        eventType,
        updated: false,
        reason: 'no_referral_link',
      };
    }

    if (eventType === 'daily_completed') {
      const dailyCount = await db.countFirstWeekSuccessfulDailies(referral.referred_user_id);
      await db.updateReferralTier1DailyCount(referral.id, dailyCount);

      if (dailyCount < 5 || referral.tier1_completed_at) {
        return {
          linked: true,
          eventType,
          updated: false,
          dailyCount,
          reason: referral.tier1_completed_at ? 'tier1_already_completed' : 'tier1_condition_not_met',
        };
      }

      const updatedReferral = await db.completeReferralTier(referral.id, 1, dailyCount);
      const tierBadge = await awardReferralBadge(updatedReferral, REFERRAL_BADGES.tier1, eventType, {
        successfulDailiesFirstWeek: dailyCount,
      });
      const volume = await checkVolumeBadge(updatedReferral.referrer_user_id, eventType);

      return {
        linked: true,
        eventType,
        updated: true,
        tierCompleted: 1,
        dailyCount,
        badgeAwarded: tierBadge,
        volumeBadgeAwarded: volume.awarded,
        tier1Referrals: volume.tier1Count,
      };
    }

    if (eventType === 'rank_changed_minot') {
      if (!referral.tier1_completed_at) {
        return {
          linked: true,
          eventType,
          updated: false,
          reason: 'tier1_required',
        };
      }
      if (referral.tier2_completed_at) {
        return {
          linked: true,
          eventType,
          updated: false,
          reason: 'tier2_already_completed',
        };
      }

      const updatedReferral = await db.completeReferralTier(referral.id, 2);
      const badgeAwarded = await awardReferralBadge(updatedReferral, REFERRAL_BADGES.tier2, eventType);
      return {
        linked: true,
        eventType,
        updated: true,
        tierCompleted: 2,
        badgeAwarded,
      };
    }

    if (!referral.tier2_completed_at) {
      return {
        linked: true,
        eventType,
        updated: false,
        reason: 'tier2_required',
      };
    }
    if (referral.tier3_completed_at) {
      return {
        linked: true,
        eventType,
        updated: false,
        reason: 'tier3_already_completed',
      };
    }

    const updatedReferral = await db.completeReferralTier(referral.id, 3);
    const badgeAwarded = await awardReferralBadge(updatedReferral, REFERRAL_BADGES.tier3, eventType);
    return {
      linked: true,
      eventType,
      updated: true,
      tierCompleted: 3,
      badgeAwarded,
    };
  }

  return {
    checkReferralProgress,
    REFERRAL_BADGES,
  };
}

module.exports = {
  REFERRAL_BADGES,
  REFERRAL_EVENTS,
  createReferralService,
};
