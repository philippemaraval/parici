"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { promisify } = require("node:util");
const gzipCollectMap = promisify(require("node:zlib").gzip);
module.exports = function registerCollect({
  app,
  db,
  authenticateToken,
  requireAdminUser,
  asyncHandler,
  getStreetIndex,
  getEffectiveContentLists,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  isValidPushSubscription,
  ensurePushRuntimeReady,
  getPushRuntime,
}) {
  const BACKEND_STREETS_LIGHT_PATH = path.join(
    __dirname,
    "data/paris_rues_light.geojson",
  );
  const BACKEND_MONUMENTS_GEOJSON_PATH = path.join(
    __dirname,
    "data/paris_monuments.geojson",
  );

  app.post(
    "/api/collect/push/subscribe",
    authenticateToken,
    asyncHandler(async (req, res) => {
      await ensurePushRuntimeReady();
      const runtime = getPushRuntime();
      if (!runtime.enabled)
        return res
          .status(503)
          .json({
            error: "Les alertes push sont momentanément indisponibles.",
          });
      const subscription = req.body?.subscription;
      if (!isValidPushSubscription(subscription))
        return res.status(400).json({ error: "Abonnement invalide" });
      await db.pool.query(
        `INSERT INTO push_subscriptions(user_id,endpoint,subscription_json,vapid_public_key,enabled,daily_enabled,collect_enabled) VALUES($1,$2,$3::jsonb,$4,TRUE,FALSE,TRUE) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription_json=EXCLUDED.subscription_json,vapid_public_key=EXCLUDED.vapid_public_key,enabled=TRUE,collect_enabled=TRUE,daily_enabled=CASE WHEN push_subscriptions.user_id=EXCLUDED.user_id THEN push_subscriptions.daily_enabled ELSE FALSE END,updated_at=NOW()`,
        [
          req.user.id,
          subscription.endpoint,
          JSON.stringify(subscription),
          runtime.publicKey,
        ],
      );
      await db.setCollectNotificationPreference(req.user.id, true);
      res.json({ success: true });
    }),
  );
  app.post(
    "/api/collect/push/unsubscribe",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const endpoint = String(req.body?.endpoint || "");
      const result = await db.pool.query(
        "UPDATE push_subscriptions SET collect_enabled=FALSE,enabled=daily_enabled WHERE user_id=$1 AND ($2='' OR endpoint=$2) RETURNING daily_enabled",
        [req.user.id, endpoint],
      );
      await db.setCollectNotificationPreference(req.user.id, false);
      res.json({
        success: true,
        keepSubscription: result.rows.some((row) => row.daily_enabled),
      });
    }),
  );

  const collectMapResponses = new Map();
  async function sendCollectMapResponse(req, res, entry) {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.vary("Accept-Encoding");
    res.type("application/json");
    if (req.acceptsEncodings("gzip") === "gzip") {
      res.setHeader("Content-Encoding", "gzip");
      return res.send(await entry.compressed);
    }
    return res.send(entry.body);
  }
  app.get(
    "/api/collect/map/:family",
    asyncHandler(async (req, res) => {
      const sources = {
        street: [
          BACKEND_STREETS_LIGHT_PATH,
          path.join(__dirname, "..", "data/paris_rues_light.geojson"),
        ],
        district: [
          path.join(__dirname, "data/paris_arrondissements.geojson"),
          path.join(__dirname, "..", "data/paris_arrondissements.geojson"),
        ],
        monument: [
          BACKEND_MONUMENTS_GEOJSON_PATH,
          path.join(__dirname, "..", "data/paris_monuments.geojson"),
        ],
        bus: [path.join(__dirname, "..", "data/paris_transit_lines.geojson")],
      };
      const candidates = sources[req.params.family];
      if (!candidates)
        return res.status(400).json({ error: "Famille invalide" });
      const sourcePath = candidates.find((candidate) =>
        fs.existsSync(candidate),
      );
      if (!sourcePath)
        return res
          .status(503)
          .json({ error: "Référentiel cartographique indisponible" });
      const modified = fs.statSync(sourcePath).mtimeMs;
      const cached = collectMapResponses.get(req.params.family);
      if (
        cached &&
        cached.path === sourcePath &&
        cached.modified === modified &&
        cached.index === getStreetIndex()
      )
        return sendCollectMapResponse(req, res, cached);
      if (req.params.family !== "street") {
        const body = Buffer.from(
          JSON.stringify(
            require("./domains/collect/map-data").compactMap(
              JSON.parse(fs.readFileSync(sourcePath, "utf8")),
              req.params.family,
            ),
          ),
        );
        const entry = {
          path: sourcePath,
          modified,
          index: getStreetIndex(),
          body,
          compressed: gzipCollectMap(body),
        };
        collectMapResponses.set(req.params.family, entry);
        return sendCollectMapResponse(req, res, entry);
      }
      const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
      require("./domains/collect/map-data").prepareStreetMap(
        data,
        getStreetIndex(),
      );
      const body = Buffer.from(
        JSON.stringify(
          require("./domains/collect/map-data").compactMap(data, "street"),
        ),
      );
      const entry = {
        path: sourcePath,
        modified,
        index: getStreetIndex(),
        body,
        compressed: gzipCollectMap(body),
      };
      collectMapResponses.set(req.params.family, entry);
      return sendCollectMapResponse(req, res, entry);
    }),
  );

  app.get(
    "/api/collect/profile-visibility",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const result = await db.pool.query(
        "SELECT collect_profile_public FROM users WHERE id=$1",
        [req.user.id],
      );
      return res.json({
        public: result.rows[0]?.collect_profile_public !== false,
      });
    }),
  );
  app.patch(
    "/api/collect/profile-visibility",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (typeof req.body.public !== "boolean")
        return res.status(400).json({ error: "Visibilité invalide" });
      await db.pool.query(
        "UPDATE users SET collect_profile_public=$2 WHERE id=$1",
        [req.user.id, req.body.public],
      );
      if (require("./domains/collect-social/service").schemaEnabled())
        await db.pool.query(
          "UPDATE users SET collect_visibility=$2 WHERE id=$1",
          [req.user.id, req.body.public ? "public" : "private"],
        );
      return res.json({ public: req.body.public });
    }),
  );
  app.use(
    "/api/collect/v2",
    require("./domains/collect-social/router").router(
      db,
      authenticateToken,
      requireAdminUser,
    ),
  );
  app.use(
    "/api/collect/profiles/:username",
    (req, res, next) => {
      if (!require("./domains/collect-social/service").schemaEnabled())
        return next();
      if (
        (req.headers.authorization || "").replace(/^Bearer\s*/, "").trim() ||
        parseCookieHeader(req).get(SESSION_COOKIE_NAME)
      )
        return authenticateToken(req, res, next);
      next();
    },
    asyncHandler(async (req, res, next) => {
      if (require("./domains/collect-social/service").schemaEnabled()) {
        const s = require("./domains/collect-social/service");
        const target = await db.pool.query(
          "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
          [req.params.username],
        );
        if (
          !target.rows.length ||
          !(await s.canView(db.pool, req.user?.id, target.rows[0].id))
        )
          return res.status(404).json({ error: "Profil introuvable" });
        res.setHeader("Cache-Control", "private, no-store");
        return next();
      }
      const result = await db.pool.query(
        "SELECT collect_profile_public FROM users WHERE LOWER(username)=LOWER($1)",
        [req.params.username],
      );
      if (
        !result.rows.length ||
        result.rows[0].collect_profile_public === false
      )
        return res.status(404).json({ error: "Profil introuvable" });
      res.setHeader("Cache-Control", "no-store");
      return next();
    }),
  );
  app.get(
    "/api/collect/profiles/:username/albums/:slug/cards",
    asyncHandler(async (req, res) => {
      if (
        !/^[a-z0-9-]{1,100}$/.test(req.params.slug) ||
        req.params.username.length > 100
      )
        return res.status(400).json({ error: "Profil ou album invalide" });
      const cards = await db.getCollectAlbumCards(
        null,
        req.params.slug,
        req.params.username,
      );
      return cards
        ? res.json({ cards })
        : res.status(404).json({ error: "Profil introuvable" });
    }),
  );
  app.get(
    "/api/collect/profiles/:username",
    asyncHandler(async (req, res) => {
      const username = String(req.params.username || "").trim();
      if (!username || username.length > 100)
        return res.status(400).json({ error: "Pseudo invalide" });
      const profile = await db.getPublicCollectProfile(username);
      if (!profile)
        return res.status(404).json({ error: "Profil introuvable" });
      return res.json(profile);
    }),
  );
  app.get(
    "/api/collect/quota",
    authenticateToken,
    asyncHandler(async (req, res) => {
      await db.touchCollectNotificationPresence(req.user.id);
      return res.json(await db.getCollectQuota(req.user.id));
    }),
  );

  app.get(
    "/api/collect/notifications",
    authenticateToken,
    asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return res.json(await db.getCollectNotificationStatus(req.user.id));
    }),
  );

  app.post(
    "/api/collect/notifications/open",
    authenticateToken,
    asyncHandler(async (req, res) => {
      return res.json(
        await db.getCollectNotificationStatus(req.user.id, { opened: true }),
      );
    }),
  );

  app.post(
    "/api/collect/notifications/leave",
    authenticateToken,
    asyncHandler(async (req, res) => {
      await db.clearCollectNotificationPresence(req.user.id);
      return res.json({ success: true });
    }),
  );

  app.post(
    "/api/collect/notifications/prompted",
    authenticateToken,
    asyncHandler(async (req, res) => {
      await db.markCollectNotificationPrompted(req.user.id);
      return res.json({ success: true });
    }),
  );

  app.put(
    "/api/collect/notifications/preference",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (typeof req.body?.enabled !== "boolean")
        return res.status(400).json({ error: "enabled must be boolean" });
      await db.setCollectNotificationPreference(req.user.id, req.body.enabled);
      return res.json(await db.getCollectNotificationStatus(req.user.id));
    }),
  );
  app.get(
    "/api/collect/games/pending",
    authenticateToken,
    asyncHandler(async (req, res) => {
      return res.json({ game: await db.getPendingCollectGame(req.user.id) });
    }),
  );
  app.delete(
    "/api/collect/games/:gameId",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          req.params.gameId,
        )
      )
        return res.status(400).json({ error: "Partie invalide" });
      return res.json(
        await db.abandonCollectGame(req.user.id, req.params.gameId),
      );
    }),
  );
  app.post(
    "/api/collect/events",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        req.body?.kind !== "map_ready" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          req.body.gameId || "",
        )
      )
        return res.status(400).json({ error: "Événement invalide" });
      await db.pool.query(
        `INSERT INTO collect_events(user_id,game_id,kind) SELECT $1,id,'map_ready' FROM collect_games WHERE user_id=$1 AND id=$2 ON CONFLICT DO NOTHING`,
        [req.user.id, req.body.gameId],
      );
      return res.json({ recorded: true });
    }),
  );
  app.post(
    "/api/collect/games",
    authenticateToken,
    asyncHandler(async (req, res) => {
      try {
        try {
          const {
            ensureCurrentChallenge,
          } = require("./domains/collect/weekly-challenge");
          await ensureCurrentChallenge(db.pool);
        } catch (weeklyError) {
          console.error("[Collect] Weekly challenge unavailable:", weeklyError);
        }
        const { resolveStreetGroups } = require("./domains/collect/rules");
        const streetGroups = resolveStreetGroups(
          getStreetIndex(),
          await getEffectiveContentLists(),
        );
        return res
          .status(201)
          .json(
            await db.startCollectGame(req.user.id, Math.random, streetGroups),
          );
      } catch (error) {
        if (error.code === "COLLECT_RATE_LIMIT")
          return res.status(429).json({ error: error.message });
        if (String(error.message).startsWith("collect_family_empty:")) {
          return res
            .status(503)
            .json({
              error: "Collect catalog family is not ready",
              code: "COLLECT_CATALOG_INCOMPLETE",
            });
        }
        if (error.message === "collect_catalog_empty") {
          return res
            .status(503)
            .json({
              error: "Collect catalog is not ready",
              code: "COLLECT_CATALOG_EMPTY",
            });
        }
        throw error;
      }
    }),
  );
  app.post(
    "/api/collect/games/:gameId/answer",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          req.params.gameId,
        )
      ) {
        return res
          .status(400)
          .json({ error: "Invalid gameId", code: "INVALID_COLLECT_GAME" });
      }
      const answerEntityId = String(req.body?.answerEntityId || "").trim();
      const answerContext = String(req.body?.answerContext || "").trim();
      if (
        !answerEntityId ||
        answerEntityId.length > 200 ||
        answerContext.length > 200
      ) {
        return res
          .status(400)
          .json({
            error: "Invalid answerEntityId",
            code: "INVALID_COLLECT_ANSWER",
          });
      }
      const guessRequestId = req.body?.requestId || null;
      if (
        guessRequestId !== null &&
        (typeof guessRequestId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            guessRequestId,
          ))
      )
        return res.status(400).json({ error: "Invalid requestId" });
      try {
        return res.json(
          await withWeeklyPrize(
            req.user.id,
            await db.finishCollectGame(
              req.user.id,
              req.params.gameId,
              answerEntityId,
              answerContext,
              null,
              guessRequestId,
            ),
          ),
        );
      } catch (error) {
        if (error.code === "COLLECT_GAME_EXPIRED")
          return res.status(410).json({ error: error.message });
        if (error.code === "COLLECT_GAME_NOT_FOUND")
          return res.status(404).json({ error: "Collect game not found" });
        if (error.code === "COLLECT_GAME_ALREADY_FINISHED")
          return res
            .status(409)
            .json({ error: "Collect game already finished" });
        throw error;
      }
    }),
  );
  app.post(
    "/api/collect/games/:gameId/question",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          req.params.gameId,
        ) ||
        !Number.isInteger(req.body?.answerIndex) ||
        req.body.answerIndex < 0 ||
        req.body.answerIndex > 3
      )
        return res.status(400).json({ error: "Réponse invalide" });
      try {
        return res.json(
          await withWeeklyPrize(
            req.user.id,
            await db.finishCollectGame(
              req.user.id,
              req.params.gameId,
              "",
              "",
              req.body.answerIndex,
            ),
          ),
        );
      } catch (error) {
        if (error.code === "COLLECT_GAME_EXPIRED")
          return res.status(410).json({ error: error.message });
        if (error.code === "COLLECT_GAME_NOT_FOUND")
          return res.status(404).json({ error: "Partie introuvable" });
        if (error.code === "COLLECT_QUESTION_NOT_PENDING")
          return res.status(409).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.get(
    "/api/collect/cards/:cardId",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      const card = await db.getCollectCardDetails(
        req.user.id,
        req.params.cardId,
      );
      return card
        ? res.json(card)
        : res.status(404).json({ error: "Carte non possédée" });
    }),
  );
  app.post(
    "/api/collect/cards/:cardId/reports",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        !/^\d{1,18}$/.test(req.params.cardId) ||
        !["image", "description", "question"].includes(req.body?.contentType)
      )
        return res.status(400).json({ error: "Signalement invalide" });
      const report = await db.reportCollectCardContent(
        req.user.id,
        req.params.cardId,
        req.body.contentType,
      );
      return report
        ? res.json({ reported: true, contentType: report.content_type })
        : res.status(404).json({ error: "Carte introuvable" });
    }),
  );
  app.get(
    "/api/collect/profiles/:username/cards/:cardId",
    asyncHandler(async (req, res) => {
      if (!/^\d{1,18}$/.test(req.params.cardId))
        return res.status(400).json({ error: "Carte invalide" });
      if (!req.params.username.trim() || req.params.username.length > 100)
        return res.status(400).json({ error: "Pseudo invalide" });
      const card = await db.getCollectCardDetails(null, req.params.cardId, {
        publicView: true,
        username: req.params.username,
      });
      return card
        ? res.json(card)
        : res.status(404).json({ error: "Carte non possédée" });
    }),
  );
  app.get(
    "/api/collect/collection/page",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const {
        parseCollectionFilters,
        collectionPage,
      } = require("./domains/collect/collection-page");
      try {
        return res.json(
          await collectionPage(
            db,
            req.user.id,
            parseCollectionFilters(req.query),
          ),
        );
      } catch (error) {
        if (error.status === 400)
          return res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.get(
    "/api/collect/profiles/:username/collection/page",
    asyncHandler(async (req, res) => {
      if (!req.params.username.trim() || req.params.username.length > 100)
        return res.status(400).json({ error: "Pseudo invalide" });
      const user = await db.pool.query(
        "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
        [req.params.username],
      );
      if (!user.rows.length)
        return res.status(404).json({ error: "Profil introuvable" });
      const {
        parseCollectionFilters,
        collectionPage,
      } = require("./domains/collect/collection-page");
      try {
        return res.json(
          await collectionPage(
            db,
            user.rows[0].id,
            { ...parseCollectionFilters(req.query), ownership: "owned" },
            { publicView: true },
          ),
        );
      } catch (error) {
        if (error.status === 400)
          return res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.get(
    "/api/collect/collection",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const {
        addOwnedFragmentsToCollection,
      } = require("./domains/collect/fragment-collection");
      const cards = await addOwnedFragmentsToCollection(
        db.pool,
        req.user.id,
        await db.getCollectCollection(req.user.id),
      );
      return res.json({
        cards,
        quota: await db.getCollectQuota(req.user.id),
        rarityLabels: await db.getCollectRarityLabels(),
      });
    }),
  );
  app.put(
    "/api/collect/cards/:cardId/favorite",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const cardId = Number(req.params.cardId);
      if (
        !Number.isSafeInteger(cardId) ||
        cardId <= 0 ||
        typeof req.body?.favorite !== "boolean"
      ) {
        return res.status(400).json({ error: "Carte ou favori invalide" });
      }
      try {
        return res.json(
          await db.setCollectFavorite(req.user.id, cardId, req.body.favorite),
        );
      } catch (error) {
        if (error.code === "COLLECT_CARD_NOT_OWNED")
          return res.status(404).json({ error: "Carte non possédée" });
        throw error;
      }
    }),
  );
  app.get(
    "/api/collect/albums",
    authenticateToken,
    asyncHandler(async (req, res) => {
      return res.json({
        albums: await db.getCollectAlbums(req.user.id),
        badges: await db.getCollectBadges(req.user.id),
      });
    }),
  );
  const personalAlbums = require("./domains/collect/personal-albums");
  async function personalAlbumContents(req) {
    const payload = await personalAlbums.catalog(
      db.pool,
      req.user.id,
      req.params.albumId,
      req.query,
      true,
    );
    const ownedIds = payload.cards
      .filter((card) => card.owned)
      .map((card) => card.id);
    const details = ownedIds.length
      ? await db.getCollectCollection(req.user.id, {
          cardIds: ownedIds,
          compact: true,
        })
      : [];
    const byId = new Map(details.map((card) => [String(card.id), card]));
    payload.cards = payload.cards.map((card) => ({
      ...card,
      ...byId.get(String(card.id)),
      copy_count: byId.get(String(card.id))?.copy_count || 0,
    }));
    return payload;
  }
  app.get(
    "/api/collect/personal-albums",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json({
        albums: await personalAlbums.listAlbums(db.pool, req.user.id),
      }),
    ),
  );
  app.post(
    "/api/collect/personal-albums",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json(
          await personalAlbums.createAlbum(
            db.pool,
            req.user.id,
            req.body?.name,
          ),
        ),
    ),
  );
  app.get(
    "/api/collect/personal-albums/:albumId/cards",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json(await personalAlbumContents(req)),
    ),
  );
  app.get(
    "/api/collect/personal-albums/:albumId/catalog",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json(
        await personalAlbums.catalog(
          db.pool,
          req.user.id,
          req.params.albumId,
          req.query,
        ),
      ),
    ),
  );
  app.post(
    "/api/collect/personal-albums/:albumId/cards",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json(
        await personalAlbums.addCards(
          db.pool,
          req.user.id,
          req.params.albumId,
          req.body?.cardIds,
        ),
      ),
    ),
  );
  app.delete(
    "/api/collect/personal-albums/:albumId/cards/:cardId",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json(
        await personalAlbums.removeCard(
          db.pool,
          req.user.id,
          req.params.albumId,
          req.params.cardId,
        ),
      ),
    ),
  );
  app.delete(
    "/api/collect/personal-albums/:albumId",
    authenticateToken,
    asyncHandler(async (req, res) =>
      res.json(
        await personalAlbums.deleteAlbum(
          db.pool,
          req.user.id,
          req.params.albumId,
        ),
      ),
    ),
  );
  async function withWeeklyPrize(userId, result) {
    if (result.rewardGranted)
      try {
        const weekly =
          await require("./domains/collect/weekly-challenge").getWeeklyChallenge(
            db.pool,
            userId,
          );
        if (weekly.reward?.granted) result.weeklyReward = weekly.reward;
      } catch (error) {
        console.error("[Collect] Weekly prize deferred:", error.message);
      }
    return result;
  }
  app.get(
    "/api/collect/albums/:slug/cards",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (!/^[a-z0-9-]{1,100}$/.test(req.params.slug))
        return res.status(400).json({ error: "Album invalide" });
      return res.json({
        cards: await db.getCollectAlbumCards(req.user.id, req.params.slug),
      });
    }),
  );
  const optionalCollectAuthentication = (req, res, next) => {
    if (
      (req.headers.authorization || "").replace(/^Bearer\s*/, "").trim() ||
      parseCookieHeader(req).get(SESSION_COOKIE_NAME)
    )
      return authenticateToken(req, res, next);
    return next();
  };
  app.get(
    "/api/collect/leaderboard/performance",
    optionalCollectAuthentication,
    asyncHandler(async (req, res) => {
      return res.json(
        await db.getCollectPerformanceLeaderboard(req.user?.id || null),
      );
    }),
  );
  app.get(
    "/api/collect/leaderboard/albums/:slug",
    optionalCollectAuthentication,
    asyncHandler(async (req, res) => {
      if (!/^[a-z0-9-]{1,100}$/.test(req.params.slug))
        return res.status(400).json({ error: "Album invalide" });
      return res.json(
        await db.getCollectAlbumLeaderboard(
          req.params.slug,
          req.user?.id || null,
        ),
      );
    }),
  );
  app.get(
    "/api/collect/leaderboard",
    optionalCollectAuthentication,
    asyncHandler(async (req, res) => {
      return res.json(await db.getCollectLeaderboard(25, req.user?.id || null));
    }),
  );
  app.get(
    "/api/collect/weekly-challenge/history",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const {
        getWeeklyHistory,
      } = require("./domains/collect/weekly-challenge");
      return res.json({ weeks: await getWeeklyHistory(db.pool, req.user.id) });
    }),
  );
  app.get(
    "/api/collect/weekly-challenge",
    authenticateToken,
    asyncHandler(async (req, res) => {
      const {
        getWeeklyChallenge,
      } = require("./domains/collect/weekly-challenge");
      if (req.query.week && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.week))
        return res.status(400).json({ error: "Semaine invalide" });
      try {
        return res.json(
          await getWeeklyChallenge(
            db.pool,
            req.user.id,
            req.query.week || null,
          ),
        );
      } catch (error) {
        if (error.status === 404)
          return res.status(404).json({ error: error.message });
        throw error;
      }
    }),
  );
  app.get(
    "/api/collect/goal",
    authenticateToken,
    asyncHandler(async (req, res) => {
      return res.json({
        goal: await require("./domains/collect/player-goals").getAlbumGoal(
          db,
          req.user.id,
        ),
      });
    }),
  );
  app.put(
    "/api/collect/goal",
    authenticateToken,
    asyncHandler(async (req, res) => {
      if (
        typeof req.body?.slug !== "string" ||
        (req.body.slug && !/^[a-z0-9-]{1,100}$/.test(req.body.slug))
      )
        return res.status(400).json({ error: "Album invalide" });
      try {
        return res.json({
          goal: await require("./domains/collect/player-goals").setAlbumGoal(
            db,
            req.user.id,
            req.body.slug,
          ),
        });
      } catch (error) {
        if (error.status === 404)
          return res.status(404).json({ error: error.message });
        throw error;
      }
    }),
  );
};
