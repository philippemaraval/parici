"use strict";
module.exports = function ({
  app,
  db,
  authenticateToken,
  requireContentEditor,
  asyncHandler,
}) {
  app.get(
    "/api/editor/collect/cards",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      const {
        family = "",
        status = "",
        rarity = "",
        search = "",
        quality = "",
        page = "1",
        sort = "number",
        order = "asc",
      } = req.query;
      if (
        !["", "street", "district", "monument", "bus"].includes(family) ||
        !["", "active", "archived"].includes(status) ||
        !["", "1", "2", "3", "4", "5"].includes(String(rarity)) ||
        typeof search !== "string" ||
        search.length > 200 ||
        !/^\d{1,6}$/.test(String(page)) ||
        Number(page) < 1 ||
        !["number", "name", "status", "copies", "rarity", "fragments"].includes(
          sort,
        ) ||
        !["asc", "desc"].includes(order) ||
        !["", "missing-image", "reported", "verified", "unverified"].includes(
          quality,
        )
      ) {
        return res.status(400).json({ error: "Filtres invalides" });
      }
      return res.json(
        await db.listCollectCards({
          family,
          status,
          rarity,
          search,
          quality,
          page,
          sort,
          order,
        }),
      );
    }),
  );
  app.get(
    "/api/editor/collect/reports",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (_req, res) => {
      return res.json({ reports: await db.listCollectContentReports() });
    }),
  );
  app.patch(
    "/api/editor/collect/reports/:cardId/:contentType/resolve",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (
        !/^\d{1,18}$/.test(req.params.cardId) ||
        !["image", "description", "question"].includes(req.params.contentType)
      )
        return res.status(400).json({ error: "Signalement invalide" });
      return res.json(
        await db.resolveCollectContentReports(
          req.params.cardId,
          req.params.contentType,
        ),
      );
    }),
  );
  app.get(
    "/api/editor/collect/cards/:cardId/fragments",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      const config = await db.getCollectFragments(req.params.cardId);
      return config
        ? res.json(config)
        : res.status(404).json({ error: "Carte introuvable" });
    }),
  );
  app.put(
    "/api/editor/collect/cards/:cardId/fragments",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      try {
        const config = await db.saveCollectFragments(
          req.params.cardId,
          req.body,
        );
        return config
          ? res.json(config)
          : res.status(404).json({ error: "Carte introuvable" });
      } catch (error) {
        if (error.code === "INVALID_FRAGMENT_CONFIG")
          return res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.put(
    "/api/editor/collect/cards/:cardId/content",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      try {
        const {
          saveContentCorrection,
        } = require("./domains/collect/content-quality");
        const card = await saveContentCorrection(
          db,
          req.user.id,
          req.params.cardId,
          req.body,
        );
        return card
          ? res.json({ card })
          : res.status(404).json({ error: "Carte introuvable" });
      } catch (error) {
        if (error.code === "INVALID_CARD_CONTENT" || error.status === 400)
          return res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.get(
    "/api/editor/collect/cards/:cardId/corrections",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      return res.json({
        corrections: (
          await db.pool.query(
            `SELECT corrected_at,verified_entity,verification_source,before_json,after_json FROM collect_content_corrections WHERE card_id=$1 ORDER BY corrected_at DESC LIMIT 30`,
            [req.params.cardId],
          )
        ).rows,
      });
    }),
  );
  app.get(
    "/api/editor/collect/health",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (_req, res) => {
      const health =
        await require("./domains/collect/content-quality").qualityHealth(db);

      return res.json(health);
    }),
  );
  app.put(
    "/api/editor/collect/cards/:cardId/rarity",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      try {
        const card = await db.configureCollectCardRarity(
          req.params.cardId,
          req.body || {},
        );
        return card
          ? res.json({ card })
          : res.status(404).json({ error: "Carte introuvable" });
      } catch (error) {
        if (error.code === "INVALID_COLLECT_RARITY")
          return res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.patch(
    "/api/editor/collect/cards/:cardId",
    authenticateToken,
    requireContentEditor,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId)) {
        return res.status(400).json({ error: "Carte invalide" });
      }
      const rarityFields = [
        "initialRarity",
        "automaticRarity",
        "applyRarityNow",
      ];
      if (
        rarityFields.some((key) =>
          Object.prototype.hasOwnProperty.call(req.body || {}, key),
        )
      ) {
        if ("status" in req.body || "rarity" in req.body)
          return res.status(400).json({ error: "Modification invalide" });
        try {
          const card = await db.configureCollectCardRarity(
            req.params.cardId,
            req.body,
          );
          return card
            ? res.json({ card })
            : res.status(404).json({ error: "Carte introuvable" });
        } catch (error) {
          if (error.code === "INVALID_COLLECT_RARITY")
            return res.status(400).json({ error: error.message });
          throw error;
        }
      }
      const hasStatus = Object.prototype.hasOwnProperty.call(
        req.body || {},
        "status",
      );
      const hasRarity = Object.prototype.hasOwnProperty.call(
        req.body || {},
        "rarity",
      );
      if (hasStatus === hasRarity)
        return res.status(400).json({ error: "Modification invalide" });
      if (hasRarity) {
        if (
          req.body.rarity !== null &&
          ![1, 2, 3, 4].includes(Number(req.body.rarity))
        ) {
          return res.status(400).json({ error: "Rareté invalide" });
        }
        const card = await db.setCollectCardRarity(
          req.params.cardId,
          req.body.rarity,
        );
        return card
          ? res.json({ card })
          : res.status(404).json({ error: "Carte introuvable" });
      }
      if (!["active", "archived"].includes(req.body.status)) {
        return res.status(400).json({ error: "Statut invalide" });
      }
      let card;
      try {
        card = await db.setCollectCardStatus(
          req.params.cardId,
          req.body.status,
        );
      } catch (error) {
        if (error.code === "COLLECT_CARD_NOT_IN_CATALOG")
          return res.status(409).json({ error: error.message });
        throw error;
      }
      if (!card) return res.status(404).json({ error: "Carte introuvable" });
      return res.json({ card });
    }),
  );
};
