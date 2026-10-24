"use strict";

function createProfileRepository(database) {
  return {
    getModes: async (userId) => {
      const modes = await require("../site-shell/public-modes").publicModes(
        database.pool,
      );
      let collect;
      if (modes.collect) {
        collect = await database.getCollectProfileStats(userId);
        const { rows } = await database.pool.query(
          "SELECT collect_visibility FROM users WHERE id=$1",
          [userId],
        );
        collect = {
          ...collect,
          visibility: rows[0]?.collect_visibility || "private",
        };
      }
      return {
        ...(modes.collect ? { collect } : {}),
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
