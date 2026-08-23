"use strict";

function createProfileRepository(database) {
  return {
    getStats: (userId) => database.getUserStats(userId),
    getReferrals: (userId) => database.getReferralProfileForUser(userId),
    updateAvatar: (userId, avatar) => database.updateUserAvatar(userId, avatar),
  };
}

module.exports = { createProfileRepository };
