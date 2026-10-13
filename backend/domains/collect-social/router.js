"use strict";
const express = require("express");
const s = require("./service");
function router(db, authenticate, admin) {
  const r = express.Router();
  const route = (fn) => (req, res, next) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .then((data) => {
        if (data !== undefined) res.json(data);
      })
      .catch(next);
  r.get("/config", (_req, res) =>
    res.json({ enabled: s.enabled() && s.schemaEnabled() }),
  );
  r.use((_req, res, next) =>
    s.enabled() && s.schemaEnabled()
      ? next()
      : res.status(404).json({ error: "Fonctionnalité inactive" }),
  );
  r.use(authenticate);
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  r.get(
    "/me",
    route(async (req) => ({
      userId: req.user.id,
      settings: await s.settings(db.pool, req.user.id),
    })),
  );
  r.get(
    "/players/:username",
    route(async (req) => {
      const target = await s.usernameId(db.pool, req.params.username);
      const relation = await s.relation(db.pool, req.user.id, target);
      if (relation.blocked) throw s.fail("Joueur introuvable", 404);
      return {
        userId: target,
        username: relation.username,
        friend: relation.friend,
        canPropose:
          relation.collect_exchange_policy === "everyone" ||
          (relation.collect_exchange_policy === "friends" && relation.friend),
        visible: await s.canView(db.pool, req.user.id, target),
      };
    }),
  );
  r.put(
    "/settings",
    route((req) => s.settings(db.pool, req.user.id, req.body)),
  );
  r.get(
    "/users",
    route(async (req) => {
      const search = String(req.query.search || "").trim();
      if (search.length < 2 || search.length > 100)
        throw s.fail("Saisis au moins deux caractères");
      return (
        await db.pool.query(
          `SELECT u.id,u.username,u.avatar FROM users u WHERE u.id<>$1 AND u.username ILIKE '%'||$2||'%' AND NOT EXISTS(SELECT 1 FROM collect_blocks b WHERE(b.user_id=$1 AND b.blocked_id=u.id)OR(b.user_id=u.id AND b.blocked_id=$1)) ORDER BY u.username LIMIT 25`,
          [req.user.id, search],
        )
      ).rows;
    }),
  );
  r.get(
    "/friends",
    route((req) => s.friends(db.pool, req.user.id)),
  );
  r.post(
    "/friends/:userId/:action",
    route((req) =>
      s.friendAction(
        db.pool,
        req.user.id,
        req.params.userId,
        req.params.action,
      ),
    ),
  );
  r.get(
    "/blocks",
    route((req) => s.blockedUsers(db.pool, req.user.id)),
  );
  r.put(
    "/blocks/:userId",
    route((req) => s.block(db.pool, req.user.id, req.params.userId, true)),
  );
  r.delete(
    "/blocks/:userId",
    route((req) => s.block(db.pool, req.user.id, req.params.userId, false)),
  );
  r.get(
    "/inventory/:userId",
    route((req) =>
      s.inventory(db.pool, req.user.id, req.params.userId, req.query),
    ),
  );
  r.get(
    "/matching/:userId",
    route((req) => s.matching(db.pool, req.user.id, s.id(req.params.userId))),
  );
  r.get(
    "/cards/:cardId/settings",
    route((req) => s.cardSettings(db.pool, req.user.id, req.params.cardId)),
  );
  r.put(
    "/cards/:cardId/settings",
    route((req) =>
      s.cardSetting(db.pool, req.user.id, req.params.cardId, req.body),
    ),
  );
  r.get(
    "/cards/:cardId/owners",
    route((req) => s.owners(db.pool, req.user.id, req.params.cardId)),
  );
  r.get(
    "/cards/:cardId/statistics",
    route((req) => s.statistics(db.pool, req.params.cardId)),
  );
  r.put(
    "/copies/:copyId/lock",
    route((req) =>
      s.lockCopy(db.pool, req.user.id, req.params.copyId, req.body?.locked),
    ),
  );
  r.delete(
    "/copies",
    route((req) =>
      s.destroy(db.pool, req.user.id, req.body?.copyIds, req.body?.confirmed),
    ),
  );
  r.get(
    "/offers",
    route((req) => s.offerRows(db.pool, req.user.id, req.query)),
  );
  r.get(
    "/market",
    route((req) => s.offerRows(db.pool, req.user.id, req.query, true)),
  );
  r.post(
    "/offers",
    route((req) => s.createOffer(db.pool, req.user.id, req.body)),
  );
  r.post(
    "/offers/:offerId/:action",
    route((req) =>
      s.offerAction(
        db.pool,
        req.user.id,
        req.params.offerId,
        req.params.action,
        req.body?.confirmed,
      ),
    ),
  );
  r.get(
    "/history",
    route((req) => s.history(db.pool, req.user.id)),
  );
  r.get(
    "/albums/:userId",
    route((req) =>
      s.albumProgress(db.pool, req.user.id, s.id(req.params.userId)),
    ),
  );
  r.get(
    "/personal-albums",
    route((req) => s.personalProgress(db.pool, req.user.id)),
  );
  r.get(
    "/activity",
    route((req) => s.activity(db.pool, req.user.id)),
  );
  r.get(
    "/notifications",
    route((req) => s.notifications(db.pool, req.user.id)),
  );
  r.post(
    "/notifications/:id/read",
    route((req) => s.markRead(db.pool, req.user.id, req.params.id)),
  );
  r.post(
    "/reports/:userId",
    route((req) => s.report(db.pool, req.user.id, req.params.userId, req.body)),
  );
  r.get(
    "/admin/reports",
    authenticate,
    admin,
    route(() => s.adminReports(db.pool)),
  );
  r.post(
    "/admin/reports/:id/resolve",
    authenticate,
    admin,
    route(async (req) => {
      await db.pool.query(
        "UPDATE collect_social_reports SET resolved_at=NOW() WHERE id=$1",
        [s.id(req.params.id)],
      );
      return { resolved: true };
    }),
  );
  return r;
}
module.exports = { router };
