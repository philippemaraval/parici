const express = require("express");

const controller = require("./controller");

function createExplorerRouter({
  authenticateToken,
  requireContentEditor,
  asyncHandler,
}) {
  const router = express.Router();

  router.get("/riddles", asyncHandler(controller.listRiddles));
  router.get(
    "/progress",
    authenticateToken,
    asyncHandler(controller.getProgress),
  );
  router.post(
    "/admin/simulate",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.simulateStep),
  );
  router.get("/leaderboard", asyncHandler(controller.getLeaderboard));

  router.post(
    "/riddles/:id/start",
    authenticateToken,
    asyncHandler(controller.startStep),
  );
  router.post(
    "/riddles/:id/hint",
    authenticateToken,
    asyncHandler(controller.useHint),
  );
  router.post(
    "/progress/sync",
    authenticateToken,
    asyncHandler(controller.syncProgress),
  );
  router.post(
    "/leaderboard",
    authenticateToken,
    asyncHandler(controller.submitFinalScore),
  );

  router.get(
    "/admin/riddles",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.listAdminRiddles),
  );
  router.post(
    "/admin/riddles",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.createAdminRiddle),
  );
  router.put(
    "/admin/riddles/:id",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.updateAdminRiddle),
  );
  router.post(
    "/admin/riddles/:id/restore",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.restoreAdminRiddle),
  );
  router.delete(
    "/admin/riddles/:id",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.deleteAdminRiddle),
  );
  router.get(
    "/admin/streets",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.searchStreets),
  );
  router.post(
    "/admin/images",
    authenticateToken,
    requireContentEditor,
    asyncHandler(controller.uploadAdminImage),
  );

  return router;
}

module.exports = createExplorerRouter;
