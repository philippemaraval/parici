"use strict";

function createProfileService({ repository }) {
  async function buildProfile(currentUser, emptyStats) {
    const payload = {
      userId: currentUser.id,
      username: currentUser.username,
      avatar: currentUser.avatar || "👤",
      referralCode: currentUser.referralCode || null,
      ...emptyStats,
    };

    try {
      Object.assign(payload, (await repository.getStats(currentUser.id)) || {});
    } catch (error) {
      console.error("Profile stats error:", {
        userId: currentUser.id,
        username: currentUser.username,
        message: error?.message || "Unknown profile stats error",
      });
      payload.profileWarning = "partial_profile_stats_unavailable";
    }

    try {
      payload.referrals = await repository.getReferrals(currentUser.id);
      payload.referralCode = payload.referrals?.code || payload.referralCode;
    } catch (error) {
      console.error("Profile referral error:", {
        userId: currentUser.id,
        username: currentUser.username,
        message: error?.message || "Unknown referral profile error",
      });
      payload.referralWarning = "referral_profile_unavailable";
    }
    return payload;
  }

  return {
    buildProfile,
    updateAvatar: repository.updateAvatar,
  };
}

module.exports = { createProfileService };
