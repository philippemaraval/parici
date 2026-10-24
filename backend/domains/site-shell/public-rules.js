"use strict";
const { publicModes } = require("./public-modes");
async function publicRules(database) {
  const modes = await publicModes(database.pool);
  if (!modes.collect) return modes;
  // Reuse the gameplay quota reader; no player inventory is exposed.
  const quota = await database.getCollectQuota(null);
  return {
    ...modes,
    collectRules: {
      quota: { copies: quota.limit, windowMinutes: quota.windowMinutes },
    },
  };
}
module.exports = { publicRules };
