"use strict";
const express = require("express");
const content = require("./content");

module.exports = function createAdminRouter({
  db,
  authenticateToken,
  requireContentEditor,
  requireAdminUser,
  asyncHandler,
  invalidateContent,
  requireActionConfirmation,
  dailyPreview,
  dailyPlans = () => [],
}) {
  const router = express.Router();
  router.use(authenticateToken, requireContentEditor, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get(
    "/operations",
    asyncHandler(async (req, res) => {
      const [catalog, explorer] = await Promise.all([
        db.pool.query(
          "SELECT family,status,COUNT(*)::int AS count FROM cards GROUP BY family,status ORDER BY family,status",
        ),
        db.pool.query(
          "SELECT COUNT(*) FILTER(WHERE archived_at IS NULL)::int AS active,COUNT(*) FILTER(WHERE archived_at IS NOT NULL)::int AS archived,COUNT(*) FILTER(WHERE archived_at IS NULL AND (latitude IS NULL OR longitude IS NULL))::int AS missing_coordinates FROM explorer_riddles",
        ),
      ]);
      const result = {
        generatedAt: new Date().toISOString(),
        catalog: catalog.rows,
        explorer: explorer.rows[0],
      };
      if (req.user.role === "admin") {
        result.players = (
          await db.pool.query(`WITH activity AS (
        SELECT user_id,timestamp AS at FROM scores WHERE timestamp>=NOW()-INTERVAL '30 days'
        UNION ALL SELECT user_id,last_attempt_at FROM daily_user_attempts WHERE last_attempt_at>=NOW()-INTERVAL '30 days'
        UNION ALL SELECT user_id,COALESCE(finished_at,started_at) FROM collect_games WHERE COALESCE(finished_at,started_at)>=NOW()-INTERVAL '30 days'
        UNION ALL SELECT user_id,solved_at FROM explorer_user_progress WHERE solved_at>=NOW()-INTERVAL '30 days'
        UNION ALL SELECT user_id,started_at FROM explorer_step_sessions WHERE started_at>=NOW()-INTERVAL '30 days'
      ) SELECT (SELECT COUNT(*)::int FROM users) AS total,
        (SELECT COUNT(*)::int FROM users WHERE created_at>=NOW()-INTERVAL '7 days') AS new_7d,
        COUNT(DISTINCT user_id)::int AS active_30d,
        COUNT(DISTINCT user_id) FILTER(WHERE at>=NOW()-INTERVAL '7 days')::int AS active_7d FROM activity`)
        ).rows[0];
      }
      return res.json(result);
    }),
  );
  router.get(
    "/revisions",
    asyncHandler(async (_req, res) => {
      const rows = (
        await db.pool.query(
          "SELECT id,actor_username,action,created_at FROM admin_content_revisions ORDER BY id DESC LIMIT 100",
        )
      ).rows;
      return res.json({ revisions: rows, limit: 100 });
    }),
  );
  router.get(
    "/revisions/:id",
    asyncHandler(async (req, res) => {
      if (!/^\d+$/.test(req.params.id))
        return res.status(400).json({ error: "Révision invalide" });
      const row = (
        await db.pool.query(
          "SELECT * FROM admin_content_revisions WHERE id=$1",
          [req.params.id],
        )
      ).rows[0];
      return row
        ? res.json(row)
        : res.status(404).json({ error: "Révision introuvable" });
    }),
  );
  router.post(
    "/revisions/:id/restore",
    requireAdminUser,
    requireActionConfirmation,
    asyncHandler(async (req, res) => {
      if (!/^\d+$/.test(req.params.id))
        return res.status(400).json({ error: "Révision invalide" });
      try {
        const result = await content.restore(
          db.pool,
          req.params.id,
          req.body.expectedRevision,
          req.user.username,
        );
        invalidateContent();
        return res.json(result);
      } catch (error) {
        if (error.status)
          return res.status(error.status).json({ error: error.message });
        throw error;
      }
    }),
  );
  router.get(
    "/daily-calendar",
    requireAdminUser,
    asyncHandler(async (req, res) => {
      const month = String(
        req.query.month ||
          new Intl.DateTimeFormat("fr-CA", {
            timeZone: "Europe/Paris",
            year: "numeric",
            month: "2-digit",
          }).format(new Date()),
      );
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        return res.status(400).json({ error: "Mois invalide" });
      const rows = (
        await db.pool.query(
          `SELECT t.date,t.street_name,t.arrondissement AS quartier,t.coordinates_json,
      COUNT(d.id)::int AS players,COUNT(d.id) FILTER(WHERE d.success)::int AS successes
      FROM daily_targets t LEFT JOIN daily_user_attempts d ON d.date=t.date
      WHERE t.date LIKE $1 GROUP BY t.date ORDER BY t.date`,
          [month + "-%"],
        )
      ).rows;
      return res.json({
        month,
        targets: [
          ...rows.map((row) => ({
            ...row,
            source: "database",
            imageUrl: dailyPreview(row),
          })),
          ...dailyPlans(month)
            .filter((row) => !rows.some((saved) => saved.date === row.date))
            .map((row) => ({
              ...row,
              source: "manifest",
              players: null,
              successes: null,
              imageUrl: dailyPreview(row),
            })),
        ].sort((a, b) => a.date.localeCompare(b.date)),
        coverage:
          "Cibles enregistrées en base uniquement ; une date absente n’indique pas une panne.",
      });
    }),
  );
  router.get(
    "/players/:id",
    requireAdminUser,
    asyncHandler(async (req, res) => {
      if (!/^\d+$/.test(req.params.id))
        return res.status(400).json({ error: "Compte invalide" });
      const user = await db.getUserById(req.params.id);
      if (!user) return res.status(404).json({ error: "Compte introuvable" });
      const [daily, collect, explorer, scores] = await Promise.all([
        db.pool.query(
          "SELECT date,success,attempts_count,last_attempt_at FROM daily_user_attempts WHERE user_id=$1 ORDER BY date DESC LIMIT 30",
          [user.id],
        ),
        db.pool.query(
          "SELECT c.name,COUNT(*)::int AS copies,MAX(cp.obtained_at) AS last_obtained_at FROM card_copies cp JOIN cards c ON c.id=cp.card_id WHERE cp.user_id=$1 GROUP BY c.id ORDER BY MAX(cp.obtained_at) DESC LIMIT 50",
          [user.id],
        ),
        db.pool.query(
          "SELECT r.street_name_clean,p.solved_at,p.points_earned FROM explorer_user_progress p JOIN explorer_riddles r ON r.id=p.riddle_id WHERE p.user_id=$1 ORDER BY p.solved_at DESC LIMIT 50",
          [user.id],
        ),
        db.pool.query(
          "SELECT mode,game_type,score,timestamp FROM scores WHERE user_id=$1 ORDER BY timestamp DESC LIMIT 30",
          [user.id],
        ),
      ]);
      return res.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.created_at,
        },
        daily: daily.rows,
        collect: collect.rows,
        explorer: explorer.rows,
        scores: scores.rows,
      });
    }),
  );
  router.get(
    "/audit-log",
    requireAdminUser,
    asyncHandler(async (_req, res) => {
      const rows = (
        await db.pool.query(
          "SELECT actor_username,action,status_code,created_at,request_id FROM security_audit_logs ORDER BY created_at DESC LIMIT 100",
        )
      ).rows;
      return res.json({ entries: rows, limit: 100 });
    }),
  );
  return router;
};
