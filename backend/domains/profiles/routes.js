"use strict";

const express = require("express");

function createProfileRouter({ asyncHandler, authenticateToken, controller }) {
  const router = express.Router();
  router.get(
    "/",
    authenticateToken,
    asyncHandler(controller.getProfile.bind(controller)),
  );
  router.post(
    "/avatar",
    authenticateToken,
    asyncHandler(controller.updateAvatar.bind(controller)),
  );
  return router;
}

module.exports = { createProfileRouter };
