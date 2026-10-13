"use strict";
const express = require("express");
const crypto = require("node:crypto");
const security = require("./security"),
  editorial = require("./editorial"),
  insights = require("./insights"),
  support = require("./support"),
  campaigns = require("./campaigns");
const { httpError } = require("./content");
const id = (v) => {
  if (!/^[1-9]\d{0,14}$/.test(String(v)))
    throw httpError(400, "Identifiant invalide");
  return String(v);
};
module.exports = function ({
  db,
  authenticateToken,
  requireContentEditor,
  requireActionConfirmation,
  invalidateContent,
  deployInfo,
  dailyPlan,
}) {
  const router = express.Router();
  router.use(authenticateToken, requireContentEditor, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const route = (permission, fn) => async (req, res, next) => {
    try {
      if (permission)
        await security.requireAccess(
          db.pool,
          req.user,
          permission,
          req.headers["x-admin-mfa"],
        );
      await fn(req, res);
    } catch (e) {
      if (e.status)
        return res.status(e.status).json({ error: e.message, code: e.code });
      next(e);
    }
  };
  async function checkDraftKind(req, kind) {
    if (kind === "event")
      await security.requireAccess(
        db.pool,
        req.user,
        "events",
        req.headers["x-admin-mfa"],
      );
  }
  async function checkDraftId(req) {
    const row = (
      await db.pool.query("SELECT kind FROM admin_drafts WHERE id=$1", [
        id(req.params.id),
      ])
    ).rows[0];
    if (!row) throw httpError(404, "Brouillon introuvable");
    await checkDraftKind(req, row.kind);
  }
  router.get(
    "/me",
    route(null, async (req, res) => {
      const grants = {};
      for (const p of security.permissions)
        grants[p] = await security.allowed(db.pool, req.user, p);
      const mfa = (
        await db.pool.query("SELECT enabled FROM admin_mfa WHERE user_id=$1", [
          req.user.id,
        ])
      ).rows[0];
      res.json({
        user: req.user,
        permissions: grants,
        mfaEnabled: !!mfa?.enabled,
      });
    }),
  );
  router.post(
    "/mfa/challenge",
    route(null, async (req, res) => {
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await security.verifyCode(c, req.user.id, req.body.code);
        const u = (
          await c.query("SELECT session_version FROM users WHERE id=$1", [
            req.user.id,
          ])
        ).rows[0];
        await c.query("COMMIT");
        res.json({ proof: security.proof(req.user.id, u.session_version) });
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }),
  );
  router.post(
    "/mfa/enroll",
    requireActionConfirmation,
    route("read", async (req, res) => {
      const secret = security.base32(crypto.randomBytes(20));
      const row = await db.pool.query(
        "INSERT INTO admin_mfa(user_id,secret_encrypted) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,last_counter=-1 WHERE NOT admin_mfa.enabled RETURNING user_id",
        [req.user.id, security.encrypt(secret)],
      );
      if (!row.rowCount) throw httpError(409, "MFA déjà activée.");
      res.json({
        secret,
        uri: `otpauth://totp/Parici:${encodeURIComponent(req.user.username)}?secret=${secret}&issuer=Parici&digits=6&period=30`,
      });
    }),
  );
  router.post(
    "/mfa/enable",
    route(null, async (req, res) => {
      const codes = Array.from({ length: 10 }, () =>
        crypto.randomBytes(8).toString("hex"),
      );
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        const row = (
          await c.query(
            "SELECT enabled FROM admin_mfa WHERE user_id=$1 FOR UPDATE",
            [req.user.id],
          )
        ).rows[0];
        if (!row || row.enabled)
          throw httpError(409, "Configuration non disponible.");
        await security.verifyCode(c, req.user.id, req.body.code, true);
        await c.query(
          "UPDATE admin_mfa SET recovery_hashes=$2 WHERE user_id=$1",
          [req.user.id, JSON.stringify(codes.map(security.hash))],
        );
        await c.query("COMMIT");
        const u = (
          await db.pool.query("SELECT session_version FROM users WHERE id=$1", [
            req.user.id,
          ])
        ).rows[0];
        res.json({
          enabled: true,
          recoveryCodes: codes,
          proof: security.proof(req.user.id, u.session_version),
        });
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }),
  );
  router.post(
    "/mfa/disable",
    requireActionConfirmation,
    route("read", async (req, res) => {
      await db.pool.query("DELETE FROM admin_mfa WHERE user_id=$1", [
        req.user.id,
      ]);
      res.json({ enabled: false });
    }),
  );
  router.get(
    "/sessions",
    route("read", async (req, res) =>
      res.json({
        sessions: (
          await db.pool.query(
            "SELECT token_hash,user_agent,first_seen,last_seen,expires_at FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.session_version=u.session_version AND expires_at>NOW() ORDER BY last_seen DESC LIMIT 50",
            [req.user.id],
          )
        ).rows,
      }),
    ),
  );
  router.post(
    "/sessions/revoke",
    requireActionConfirmation,
    route("read", async (req, res) => {
      await db.pool.query(
        "UPDATE users SET session_version=session_version+1 WHERE id=$1",
        [req.user.id],
      );
      res.json({ revoked: true });
    }),
  );
  router.get(
    "/permissions",
    route("security", async (_req, res) =>
      res.json({
        permissions: security.permissions,
        accounts: (
          await db.pool.query(
            "SELECT id,username,role FROM users WHERE role IN ('admin','editor') ORDER BY username",
          )
        ).rows,
        overrides: (
          await db.pool.query(
            "SELECT * FROM admin_permissions ORDER BY user_id,permission",
          )
        ).rows,
      }),
    ),
  );
  router.put(
    "/permissions/:id",
    requireActionConfirmation,
    route("security", async (req, res) => {
      const target = id(req.params.id);
      if (Number(target) === req.user.id)
        throw httpError(
          400,
          "Vous ne pouvez pas modifier vos propres permissions.",
        );
      const changes = req.body.permissions;
      if (
        !changes ||
        typeof changes !== "object" ||
        Array.isArray(changes) ||
        Object.entries(changes).some(
          ([k, v]) =>
            !security.permissions.includes(k) || typeof v !== "boolean",
        )
      )
        throw httpError(400, "Permissions invalides");
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        const user = (
          await c.query(
            "SELECT id,role FROM users WHERE id=$1 AND role IN ('admin','editor') FOR UPDATE",
            [target],
          )
        ).rows[0];
        if (!user) throw httpError(404, "Compte éditeur requis.");
        if (user.role === "admin")
          throw httpError(
            400,
            "Les permissions des administrateurs restent complètes ; configurez les comptes éditeurs.",
          );
        const before = (
          await c.query(
            "SELECT permission,allowed FROM admin_permissions WHERE user_id=$1",
            [target],
          )
        ).rows;
        for (const [p, v] of Object.entries(changes))
          await c.query(
            "INSERT INTO admin_permissions(user_id,permission,allowed) VALUES($1,$2,$3) ON CONFLICT(user_id,permission) DO UPDATE SET allowed=EXCLUDED.allowed",
            [target, p, v],
          );
        await c.query(
          "INSERT INTO admin_entity_revisions(domain,entity_key,before_json,after_json,actor,reason) VALUES('permissions',$1,$2,$3,$4,$5)",
          [
            target,
            JSON.stringify(before),
            JSON.stringify(changes),
            req.user.username,
            editorial.text(req.body.reason),
          ],
        );
        await c.query(
          "UPDATE users SET session_version=session_version+1 WHERE id=$1",
          [target],
        );
        await c.query("COMMIT");
        res.json({ saved: true });
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }),
  );
  router.get(
    "/tasks",
    route("read", async (_req, res) => {
      await insights.syncReports(db.pool);
      const quality = await insights.quality(db.pool);
      const reports = (
        await db.pool.query(
          "SELECT id,domain,entity_key,category,severity,detail,status FROM admin_reports WHERE status IN ('open','investigating') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,created_at LIMIT 100",
        )
      ).rows;
      const drafts = (
        await db.pool.query(
          "SELECT id,title,state,error FROM admin_drafts WHERE state IN ('failed','scheduled') ORDER BY updated_at DESC LIMIT 50",
        )
      ).rows;
      res.json({ ...quality, reports, drafts });
    }),
  );
  router.get(
    "/quality",
    route("quality", async (_req, res) =>
      res.json(await insights.quality(db.pool)),
    ),
  );
  router.get(
    "/analytics",
    route("support", async (req, res) =>
      res.json(await insights.analytics(db.pool, Number(req.query.days || 30))),
    ),
  );
  router.get(
    "/balance",
    route("balance", async (req, res) =>
      res.json(await insights.balance(db.pool, Number(req.query.days || 30))),
    ),
  );
  router.get(
    "/reports",
    route("quality", async (req, res) => {
      await insights.syncReports(db.pool);
      const status = req.query.status || "open";
      if (
        !["open", "investigating", "resolved", "dismissed", "all"].includes(
          status,
        )
      )
        throw httpError(400, "Statut invalide");
      res.json({
        reports: (
          await db.pool.query(
            "SELECT r.*,u.username AS assignee FROM admin_reports r LEFT JOIN users u ON u.id=r.assignee_id WHERE ($1='all' OR r.status=$1) ORDER BY r.updated_at DESC LIMIT 200",
            [status],
          )
        ).rows,
        assignees: (
          await db.pool.query(
            "SELECT id,username FROM users WHERE role IN ('admin','editor') ORDER BY username",
          )
        ).rows,
      });
    }),
  );
  router.post(
    "/reports",
    route("quality", async (req, res) => {
      const p = req.body;
      if (
        !["camino", "daily", "collect", "explorer", "technical"].includes(
          p.domain,
        ) ||
        !editorial.text(p.detail) ||
        ![
          "image",
          "description",
          "question",
          "geography",
          "bug",
          "other",
        ].includes(p.category)
      )
        throw httpError(400, "Signalement invalide");
      const row = (
        await db.pool.query(
          "INSERT INTO admin_reports(domain,entity_key,category,detail,reporter_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            p.domain,
            editorial.text(p.entity_key, 100),
            p.category,
            editorial.text(p.detail),
            req.user.id,
          ],
        )
      ).rows[0];
      res.status(201).json(row);
    }),
  );
  router.put(
    "/reports/:id",
    route("quality", async (req, res) => {
      const p = req.body;
      if (
        !["open", "investigating", "resolved", "dismissed"].includes(
          p.status,
        ) ||
        !["low", "normal", "high", "critical"].includes(p.severity) ||
        !Number.isInteger(p.revision)
      )
        throw httpError(400, "État invalide");
      if (
        ["resolved", "dismissed"].includes(p.status) &&
        editorial.text(p.resolution).length < 5
      )
        throw httpError(400, "Précisez la résolution.");
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        if (
          p.assignee_id &&
          (
            await c.query(
              "SELECT 1 FROM users WHERE id=$1 AND role IN ('admin','editor')",
              [id(p.assignee_id)],
            )
          ).rowCount !== 1
        )
          throw httpError(400, "Responsable invalide");
        const row = (
          await c.query(
            "UPDATE admin_reports SET status=$2,severity=$3,assignee_id=$4,resolution=$5,revision=revision+1,updated_at=NOW() WHERE id=$1 AND revision=$6 RETURNING *",
            [
              id(req.params.id),
              p.status,
              p.severity,
              p.assignee_id || null,
              editorial.text(p.resolution),
              p.revision,
            ],
          )
        ).rows[0];
        if (!row) throw httpError(409, "Le signalement a changé");
        if (row.source_key?.startsWith("collect:"))
          await c.query(
            "UPDATE collect_content_reports SET status=$2,resolved_at=CASE WHEN $2='resolved' THEN NOW() ELSE NULL END WHERE id=$1",
            [
              row.source_key.slice(8),
              ["resolved", "dismissed"].includes(row.status)
                ? "resolved"
                : "open",
            ],
          );
        await c.query("COMMIT");
        res.json(row);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }),
  );
  router.get(
    "/drafts",
    route("edit", async (_req, res) =>
      res.json({
        drafts: (
          await db.pool.query(
            "SELECT d.*,u.username AS author FROM admin_drafts d LEFT JOIN users u ON u.id=d.actor_id ORDER BY d.updated_at DESC LIMIT 200",
          )
        ).rows,
      }),
    ),
  );
  router.get(
    "/entity/:kind/:key",
    route("edit", async (req, res) => {
      const { kind, key } = req.params;
      if (!editorial.kinds.includes(kind))
        throw httpError(400, "Type invalide");
      if (["card", "explorer"].includes(kind) && key !== "new") id(key);
      if (["daily", "event"].includes(kind) && !editorial.dateKey(key))
        throw httpError(400, "Date invalide");
      const current = await editorial.snapshot(db.pool, kind, key, {
        week_start: key,
        mode: req.query.mode,
        name: key,
      });
      res.json({
        current: current
          ? {
              ...current,
              ...(kind === "daily" ? { quartier: current.arrondissement } : {}),
            }
          : kind === "daily" && dailyPlan
            ? dailyPlan(key)
            : null,
      });
    }),
  );
  router.get(
    "/streets",
    route("edit", async (req, res) => {
      const q = String(req.query.q || "")
        .toLocaleLowerCase("fr")
        .slice(0, 100);
      const rows = require("../../data/streets_index.json")
        .filter((s) => s.name?.toLocaleLowerCase("fr").includes(q))
        .slice(0, 30);
      res.json({
        streets: rows.map((s) => ({
          name: s.name,
          quartier: s.quartier,
          coordinates: s.centroid,
        })),
      });
    }),
  );
  router.post(
    "/drafts",
    route("edit", async (req, res) => {
      const p = req.body,
        payload = editorial.validate(p.kind, p.payload),
        key = editorial.text(
          p.entity_key || p.payload.date || p.payload.week_start || "new",
          200,
        );
      if (["card", "explorer"].includes(p.kind) && key !== "new") id(key);
      if (p.kind === "card" && key === "new")
        throw httpError(400, "Carte existante requise.");
      if (
        (p.kind === "daily" && key !== payload.date) ||
        (p.kind === "event" && key !== payload.week_start)
      )
        throw httpError(400, "Date incohérente");
      await checkDraftKind(req, p.kind);
      const base = await editorial.snapshot(db.pool, p.kind, key, payload);
      if (["card", "explorer"].includes(p.kind) && key !== "new" && !base)
        throw httpError(404, "Contenu introuvable");
      const row = (
        await db.pool.query(
          "INSERT INTO admin_drafts(kind,entity_key,title,payload,base_snapshot,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            p.kind,
            key,
            editorial.text(
              p.title ||
                payload.street_name ||
                payload.street_name_clean ||
                key,
              200,
            ),
            JSON.stringify(payload),
            JSON.stringify(base),
            req.user.id,
          ],
        )
      ).rows[0];
      res.status(201).json(row);
    }),
  );
  router.put(
    "/drafts/:id",
    route("edit", async (req, res) => {
      const p = req.body,
        d = (
          await db.pool.query("SELECT * FROM admin_drafts WHERE id=$1", [
            id(req.params.id),
          ])
        ).rows[0];
      if (!d) throw httpError(404, "Brouillon introuvable");
      await checkDraftKind(req, d.kind);
      const payload = editorial.validate(d.kind, p.payload);
      if (
        (d.kind === "daily" && payload.date !== d.entity_key) ||
        (d.kind === "event" && payload.week_start !== d.entity_key)
      )
        throw httpError(400, "La date ne peut pas changer");
      const row = (
        await db.pool.query(
          "UPDATE admin_drafts SET payload=$2,title=$3,state='draft',publish_at=NULL,publisher_id=NULL,error=NULL,revision=revision+1,updated_at=NOW(),actor_id=$5 WHERE id=$1 AND revision=$4 AND state IN ('draft','failed','scheduled') RETURNING *",
          [
            d.id,
            JSON.stringify(payload),
            editorial.text(p.title || d.title, 200),
            p.revision,
            req.user.id,
          ],
        )
      ).rows[0];
      if (!row) throw httpError(409, "Brouillon modifié ou déjà publié");
      res.json(row);
    }),
  );
  router.post(
    "/drafts/:id/preview",
    route("edit", async (req, res) => {
      const d = (
        await db.pool.query("SELECT * FROM admin_drafts WHERE id=$1", [
          id(req.params.id),
        ])
      ).rows[0];
      if (!d) throw httpError(404, "Brouillon introuvable");
      await checkDraftKind(req, d.kind);
      res.json({
        draft: d,
        current: await editorial.snapshot(
          db.pool,
          d.kind,
          d.entity_key,
          d.payload,
        ),
        ...(d.kind === "event"
          ? { event: await editorial.eventPreview(db.pool, d.payload) }
          : {}),
      });
    }),
  );
  router.post(
    "/drafts/:id/publish",
    requireActionConfirmation,
    route("publish", async (req, res) => {
      await checkDraftId(req);
      return res.json(
        await editorial.publish(
          db.pool,
          id(req.params.id),
          req.body.revision,
          req.user.username,
          invalidateContent,
        ),
      );
    }),
  );
  router.post(
    "/drafts/:id/schedule",
    requireActionConfirmation,
    route("publish", async (req, res) => {
      await checkDraftId(req);
      const when = new Date(req.body.publishAt);
      if (!Number.isFinite(when.getTime()) || when <= new Date())
        throw httpError(400, "Date future requise.");
      const row = (
        await db.pool.query(
          "UPDATE admin_drafts SET state='scheduled',publish_at=$2,publisher_id=$4,revision=revision+1,error=NULL,updated_at=NOW() WHERE id=$1 AND revision=$3 AND state IN ('draft','failed') RETURNING *",
          [id(req.params.id), when, req.body.revision, req.user.id],
        )
      ).rows[0];
      if (!row) throw httpError(409, "Brouillon indisponible");
      res.json(row);
    }),
  );
  router.post(
    "/drafts/:id/archive",
    route("edit", async (req, res) => {
      await checkDraftId(req);
      const row = (
        await db.pool.query(
          "UPDATE admin_drafts SET state='archived',revision=revision+1,updated_at=NOW() WHERE id=$1 AND revision=$2 AND state IN ('draft','failed','scheduled') RETURNING *",
          [id(req.params.id), req.body.revision],
        )
      ).rows[0];
      if (!row) throw httpError(409, "Brouillon indisponible");
      res.json(row);
    }),
  );
  router.get(
    "/history",
    route("edit", async (req, res) =>
      res.json({
        revisions: (
          await db.pool.query(
            "SELECT * FROM admin_entity_revisions WHERE ($1='' OR domain=$1) AND ($2='' OR entity_key=$2) ORDER BY id DESC LIMIT 100",
            [String(req.query.domain || ""), String(req.query.key || "")],
          )
        ).rows,
      }),
    ),
  );
  router.post(
    "/history/:id/restore-draft",
    route("edit", async (req, res) => {
      const r = (
        await db.pool.query(
          "SELECT * FROM admin_entity_revisions WHERE id=$1",
          [id(req.params.id)],
        )
      ).rows[0];
      if (
        !r ||
        !r.before_json ||
        !["card", "daily", "explorer"].includes(r.domain)
      )
        throw httpError(400, "Cette révision ne peut pas être restaurée ici.");
      const allowedFields = {
        card: [
          "description_override",
          "description_full_override",
          "image_override",
          "image_credit_override",
        ],
        explorer: [
          "way_id",
          "street_name_clean",
          "riddle_text",
          "hint_text",
          "explanation_text",
          "image_url",
          "latitude",
          "longitude",
        ],
        daily: [
          "street_name",
          "arrondissement",
          "coordinates_json",
          "image_url",
        ],
      }[r.domain];
      const fields =
        req.body.fields === undefined ? allowedFields : req.body.fields;
      if (
        !Array.isArray(fields) ||
        !fields.length ||
        fields.some((f) => !allowedFields.includes(f))
      )
        throw httpError(400, "Choisissez les champs à restaurer.");
      const current = await editorial.snapshot(
        db.pool,
        r.domain,
        r.entity_key,
        {},
      );
      if (!current) throw httpError(409, "Le contenu n’existe plus.");
      const merged = {
        ...current,
        ...Object.fromEntries(fields.map((f) => [f, r.before_json[f]])),
      };
      const payload = editorial.validate(r.domain, {
        ...merged,
        quartier: merged.arrondissement || merged.quartier,
        date: r.domain === "daily" ? r.entity_key : undefined,
        coordinates:
          r.domain === "daily"
            ? JSON.parse(merged.coordinates_json)
            : undefined,
        verified: true,
      });
      const base = current;
      const draft = (
        await db.pool.query(
          "INSERT INTO admin_drafts(kind,entity_key,title,payload,base_snapshot,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            r.domain,
            r.entity_key,
            "Restauration révision " + r.id,
            JSON.stringify(payload),
            JSON.stringify(base),
            req.user.id,
          ],
        )
      ).rows[0];
      res.status(201).json(draft);
    }),
  );
  router.get(
    "/players/:id",
    route("support", async (req, res) => {
      const user = await db.getUserById(id(req.params.id));
      if (!user) throw httpError(404, "Joueur introuvable");
      res.json({
        user: {
          id: user.id,
          username: user.username,
          suspendedAt: user.suspended_at,
        },
        interventions: (
          await db.pool.query(
            "SELECT id,action,reason,after_json,created_at FROM admin_interventions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
            [user.id],
          )
        ).rows,
      });
    }),
  );
  router.post(
    "/players/:id/preview",
    route("support", async (req, res) =>
      res.json(await support.preview(db.pool, id(req.params.id), req.body)),
    ),
  );
  router.post(
    "/players/:id/intervene",
    requireActionConfirmation,
    route("support", async (req, res) =>
      res.json(
        await support.execute(
          db.pool,
          id(req.params.id),
          req.user.id,
          req.body,
        ),
      ),
    ),
  );
  router.get(
    "/explorer",
    route("read", async (_req, res) =>
      res.json({
        riddles: (
          await db.pool.query(
            "SELECT r.*,(SELECT COUNT(*)::int FROM explorer_step_sessions s WHERE s.riddle_id=r.id) AS starts,(SELECT COUNT(*)::int FROM explorer_user_progress p WHERE p.riddle_id=r.id) AS solved FROM explorer_riddles r ORDER BY id",
          )
        ).rows,
        rules:
          "Première étape : rue la plus proche. Ensuite : tirage uniforme parmi les 5 rues restantes les plus proches. Sans position : tirage uniforme parmi toutes les rues restantes.",
      }),
    ),
  );
  router.post(
    "/explorer/simulate",
    route("read", async (req, res) => {
      const p = req.body;
      if (
        p.position &&
        (!Number.isFinite(p.position.latitude) ||
          !Number.isFinite(p.position.longitude) ||
          Math.abs(p.position.latitude) > 90 ||
          Math.abs(p.position.longitude) > 180)
      )
        throw httpError(400, "Position invalide");
      const rows = (
        await db.pool.query(
          "SELECT * FROM explorer_riddles WHERE archived_at IS NULL ORDER BY id",
        )
      ).rows;
      const solved = new Set(
        (Array.isArray(p.solved) ? p.solved : []).map(String),
      );
      const remaining = rows.filter((r) => !solved.has(String(r.id)));
      const selection = require("../../../src/public/js/explorer-selection");
      let ranked = remaining.map((r) => ({
        riddle: r,
        distance: p.position
          ? selection.distance(p.position, r, explorerGeometry())
          : Infinity,
      }));
      ranked.sort((a, b) => a.distance - b.distance);
      const pool = p.position
        ? selection.candidatePool(ranked, solved.size === 0)
        : ranked;
      res.json({
        choice: pool[Math.floor(Math.random() * pool.length)]?.riddle || null,
        candidates: pool.map((r) => ({
          id: r.riddle.id,
          name: r.riddle.street_name_clean,
          distance: Number.isFinite(r.distance) ? r.distance : null,
          probability: 1 / pool.length,
        })),
        remaining: remaining.length,
      });
    }),
  );
  router.get(
    "/events",
    route("events", async (_req, res) =>
      res.json({
        events: (
          await db.pool.query(
            "SELECT * FROM admin_events ORDER BY week_start DESC LIMIT 50",
          )
        ).rows,
        challenges: (
          await db.pool.query(
            "SELECT id,week_start,starts_at,ends_at,reward_policy FROM weekly_challenges ORDER BY week_start DESC LIMIT 10",
          )
        ).rows,
      }),
    ),
  );
  router.get(
    "/campaigns",
    route("notify", async (_req, res) =>
      res.json({
        campaigns: (
          await db.pool.query(
            "SELECT c.*,COUNT(d.user_id) FILTER(WHERE NOT d.test)::int AS delivered,COUNT(d.user_id) FILTER(WHERE NOT d.test AND d.read_at IS NOT NULL)::int AS read FROM admin_campaigns c LEFT JOIN admin_campaign_deliveries d ON d.campaign_id=c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 100",
          )
        ).rows,
      }),
    ),
  );
  router.post(
    "/campaigns",
    route("notify", async (req, res) => {
      const p = campaigns.validate(req.body);
      await campaigns.audience(db.pool, p.audience);
      res
        .status(201)
        .json(
          (
            await db.pool.query(
              "INSERT INTO admin_campaigns(title,body,url,audience,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [p.title, p.body, p.url, p.audience, req.user.id],
            )
          ).rows[0],
        );
    }),
  );
  router.post(
    "/campaigns/:id/preview",
    route("notify", async (req, res) => {
      const row = (
        await db.pool.query("SELECT * FROM admin_campaigns WHERE id=$1", [
          id(req.params.id),
        ])
      ).rows[0];
      if (!row) throw httpError(404, "Campagne introuvable");
      res.json(await campaigns.preview(db.pool, row));
    }),
  );
  router.post(
    "/campaigns/:id/test",
    route("notify", async (req, res) =>
      res.json(
        await campaigns.send(
          db.pool,
          id(req.params.id),
          req.user.id,
          req.body,
          true,
        ),
      ),
    ),
  );
  router.post(
    "/campaigns/:id/send",
    requireActionConfirmation,
    route("notify", async (req, res) =>
      res.json(
        await campaigns.send(db.pool, id(req.params.id), req.user.id, req.body),
      ),
    ),
  );
  router.get(
    "/operations",
    route("operations", async (_req, res) =>
      res.json({
        ...deployInfo(),
        backups: (
          await db.pool.query(
            "SELECT * FROM admin_backup_runs ORDER BY created_at DESC LIMIT 5",
          )
        ).rows,
        scheduled: (
          await db.pool.query(
            "SELECT state,COUNT(*)::int AS count,MIN(publish_at) AS next FROM admin_drafts WHERE state IN ('scheduled','failed') GROUP BY state",
          )
        ).rows,
        errors: (
          await db.pool.query(
            "SELECT action,status_code,created_at FROM security_audit_logs WHERE status_code>=400 ORDER BY created_at DESC LIMIT 30",
          )
        ).rows,
      }),
    ),
  );
  router.get(
    "/backups",
    route("backups", async (_req, res) =>
      res.json({
        runs: (
          await db.pool.query(
            "SELECT * FROM admin_backup_runs ORDER BY created_at DESC LIMIT 50",
          )
        ).rows,
        workflow:
          "https://github.com/philippemaraval/parici/actions/workflows/postgres-backup.yml",
        procedure: "/admin/restore-guide.html",
      }),
    ),
  );
  return router;
};
let geometry;
function explorerGeometry() {
  if (!geometry) {
    const fs = require("node:fs"),
      path = require("node:path"),
      selection = require("../../../src/public/js/explorer-selection");
    geometry = selection.buildIndex(
      JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, "../../data/paris_rues_light.geojson"),
          "utf8",
        ),
      ).features,
    );
  }
  return geometry;
}
