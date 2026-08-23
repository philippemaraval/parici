"use strict";

function createProfileController({
  allowedAvatars,
  emptyStats,
  getAuthenticatedUser,
  service,
}) {
  return {
    async getProfile(request, response) {
      const currentUser = await getAuthenticatedUser(request.user);
      if (!currentUser) {
        return response
          .status(401)
          .json({ error: "Unknown authenticated user" });
      }
      return response.json(
        await service.buildProfile(currentUser, emptyStats()),
      );
    },

    async updateAvatar(request, response) {
      const avatar = String(request.body?.avatar || "").normalize("NFC");
      if (!allowedAvatars.has(avatar)) {
        return response.status(400).json({
          error: "Invalid avatar",
          code: "AVATAR_NOT_ALLOWED",
        });
      }
      await service.updateAvatar(request.user.id, avatar);
      return response.json({ success: true, avatar });
    },
  };
}

module.exports = { createProfileController };
