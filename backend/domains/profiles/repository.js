"use strict";

function createProfileRepository(database) {
  return {
    getModes: async (userId) => {
      const modes = await require("../site-shell/public-modes").publicModes(
        database.pool,
      );
      return {
        ...(modes.collect
          ? { collect: await database.getCollectProfileStats(userId) }
          : {}),
        ...(modes.explorer
          ? {
              explorer:
                await require("../explorer/controller").getUserExplorerProfile(
                  userId,
                ),
            }
          : {}),
      };
    },
    getStats: (userId) => database.getUserStats(userId),
    getReferrals: (userId) => database.getReferralProfileForUser(userId),
    updateAvatar: (userId, avatar) => database.updateUserAvatar(userId, avatar),
  };
}

module.exports = { createProfileRepository };
