"use strict";
const { httpError } = require("./content");
async function syncReports(pool) {
  await pool.query(`INSERT INTO admin_reports(domain,entity_key,category,detail,reporter_id,source_key,created_at,updated_at,status)
 SELECT 'collect',r.card_id::text,r.content_type,'Signalement joueur · '||c.name,r.user_id,'collect:'||r.id,r.first_reported_at,r.last_reported_at,CASE WHEN r.status='resolved' THEN 'resolved' ELSE 'open' END
 FROM collect_content_reports r JOIN cards c ON c.id=r.card_id ON CONFLICT(source_key) DO UPDATE SET
 status=CASE WHEN EXCLUDED.updated_at>admin_reports.updated_at THEN EXCLUDED.status ELSE admin_reports.status END,updated_at=GREATEST(admin_reports.updated_at,EXCLUDED.updated_at)`);
}
async function quality(pool) {
  const [explorer, cards, duplicates, daily] = await Promise.all([
    pool.query(
      `SELECT id,street_name_clean,latitude,longitude,image_url,hint_text,explanation_text FROM explorer_riddles WHERE archived_at IS NULL AND (latitude IS NULL OR longitude IS NULL OR latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 OR image_url='' OR hint_text='' OR explanation_text IS NULL OR explanation_text='') ORDER BY id LIMIT 200`,
    ),
    pool.query(
      `SELECT id,name,family,CASE WHEN NOT catalog_present THEN 'Référence absente du catalogue' WHEN fragments_enabled AND NOT EXISTS(SELECT 1 FROM collect_questions q WHERE q.card_id=cards.id) THEN 'Questions manquantes' ELSE 'Image manquante' END AS issue FROM cards WHERE status='active' AND (NOT catalog_present OR COALESCE(image_override,image_reference,'') IN ('','/android-chrome-512x512.png') OR fragments_enabled AND NOT EXISTS(SELECT 1 FROM collect_questions q WHERE q.card_id=cards.id)) ORDER BY id LIMIT 200`,
    ),
    pool.query(
      `SELECT street_name_clean,COUNT(*)::int AS count FROM explorer_riddles WHERE archived_at IS NULL GROUP BY lower(street_name_clean),street_name_clean HAVING COUNT(*)>1 ORDER BY count DESC LIMIT 100`,
    ),
    pool.query(
      `SELECT date,street_name,image_url FROM daily_targets WHERE date>=to_char(NOW() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') ORDER BY date LIMIT 60`,
    ),
  ]);
  const tasks = [];
  for (const r of explorer.rows) {
    const missing = [];
    if (r.latitude == null || r.longitude == null) missing.push("coordonnées");
    if (!r.image_url) missing.push("image");
    if (!r.hint_text) missing.push("indice");
    if (!r.explanation_text) missing.push("explication");
    tasks.push({
      domain: "explorer",
      key: String(r.id),
      title: r.street_name_clean,
      issue: "À compléter : " + missing.join(", "),
      url: "/admin/explorer/",
    });
  }
  for (const r of cards.rows)
    tasks.push({
      domain: "collect",
      key: String(r.id),
      title: r.name,
      issue: r.issue,
      url: "/admin/collect/",
    });
  for (const r of duplicates.rows)
    tasks.push({
      domain: "explorer",
      key: r.street_name_clean,
      title: r.street_name_clean,
      issue: `${r.count} énigmes sur la même rue : vérifier le doublon`,
      url: "/admin/explorer/",
    });
  const fs = require("node:fs"),
    path = require("node:path"),
    root = path.resolve(__dirname, "../../..");
  const uploaded = new Set(
    (
      await pool.query("SELECT filename FROM explorer_uploaded_images")
    ).rows.map((r) => r.filename),
  );
  function missingLocal(url) {
    if (!url || !url.startsWith("/") || url.startsWith("//")) return false;
    const clean = url.split("?")[0];
    if (
      clean.startsWith("/data/explorer_uploads/") &&
      uploaded.has(clean.split("/").at(-1))
    )
      return false;
    const resolved = path.resolve(root, "." + clean);
    if (!resolved.startsWith(root + path.sep)) return true;
    return (
      !fs.existsSync(resolved) && !fs.existsSync(path.join(root, "dist", clean))
    );
  }
  const allCards = (
    await pool.query(
      "SELECT * FROM cards WHERE status='active' ORDER BY id LIMIT 10000",
    )
  ).rows;
  const content = require("../../database").collectCardContent;
  let imagesChecked = 0;
  for (const card of allCards) {
    const effective = content(card);
    if (effective.image_reference?.startsWith("/")) imagesChecked++;
    const issue = missingLocal(effective.image_reference)
      ? "Fichier image local introuvable"
      : !effective.description_full
        ? "Description détaillée manquante"
        : null;
    if (issue)
      tasks.push({
        domain: "collect",
        key: String(card.id),
        title: card.name,
        issue,
        url: "/admin/collect/",
      });
  }
  for (const r of (
    await pool.query(
      "SELECT id,street_name_clean,image_url FROM explorer_riddles WHERE archived_at IS NULL",
    )
  ).rows)
    if (missingLocal(r.image_url))
      tasks.push({
        domain: "explorer",
        key: String(r.id),
        title: r.street_name_clean,
        issue: "Fichier image local introuvable",
        url: "/admin/explorer/",
      });
  return {
    tasks: tasks.slice(0, 200),
    totalIssues: tasks.length,
    upcomingDaily: daily.rows,
    limit: 200,
    imagesChecked,
    generatedAt: new Date().toISOString(),
    coverage:
      "Contrôles des références, champs et fichiers image locaux. Les images externes ne sont pas testées par le serveur ; leur accès reste à vérifier dans l’aperçu.",
  };
}
async function analytics(pool, days = 30) {
  if (![7, 30, 90].includes(days)) throw httpError(400, "Période invalide.");
  const [modes, cohort, visits, collect, explorer] = await Promise.all([
    pool.query(
      `WITH a AS (SELECT user_id,timestamp AS at,'Parici'::text AS mode FROM scores UNION ALL SELECT user_id,last_attempt_at,'Daily' FROM daily_user_attempts UNION ALL SELECT user_id,started_at,'Collect' FROM collect_games UNION ALL SELECT user_id,started_at,'Explorer' FROM explorer_step_sessions)
 SELECT mode,COUNT(*) FILTER(WHERE at>=NOW()-$1*INTERVAL '1 day')::int AS current_events,COUNT(DISTINCT user_id) FILTER(WHERE at>=NOW()-$1*INTERVAL '1 day')::int AS current_players,COUNT(DISTINCT user_id) FILTER(WHERE at<NOW()-$1*INTERVAL '1 day')::int AS previous_players FROM a WHERE at>=NOW()-$1*INTERVAL '2 days' GROUP BY mode ORDER BY mode`,
      [days],
    ),
    pool.query(
      `WITH a AS (SELECT user_id,timestamp AS at FROM scores UNION ALL SELECT user_id,last_attempt_at FROM daily_user_attempts UNION ALL SELECT user_id,started_at FROM collect_games UNION ALL SELECT user_id,started_at FROM explorer_step_sessions)
 SELECT COUNT(*)::int AS registrations,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM a WHERE a.user_id=u.id AND a.at>=u.created_at AND a.at<u.created_at+INTERVAL '7 days'))::int AS first_play_7d,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM a WHERE a.user_id=u.id AND a.at>=u.created_at+INTERVAL '7 days' AND a.at<u.created_at+INTERVAL '14 days'))::int AS return_week2,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM a WHERE a.user_id=u.id AND a.at>=u.created_at+INTERVAL '30 days' AND a.at<u.created_at+INTERVAL '37 days'))::int AS return_week5
 FROM users u WHERE created_at>=NOW()-($1+37)*INTERVAL '1 day' AND created_at<NOW()-INTERVAL '37 days'`,
      [days],
    ),
    pool.query(
      `SELECT SUM(total_visits)::bigint AS visits,COUNT(*)::int AS tracked_days FROM visitor_daily_stats WHERE day>=((NOW() AT TIME ZONE 'Europe/Paris')::date-($1::integer-1))`,
      [days],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS started,COUNT(*) FILTER(WHERE finished_at IS NOT NULL)::int AS finished,COUNT(*) FILTER(WHERE correct)::int AS placement_success,COUNT(*) FILTER(WHERE abandoned)::int AS explicit_abandons,COUNT(*) FILTER(WHERE finished_at IS NULL AND NOT abandoned)::int AS pending FROM collect_games WHERE started_at>=NOW()-$1*INTERVAL '1 day'`,
      [days],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS started,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM explorer_user_progress p WHERE p.user_id=s.user_id AND p.riddle_id=s.riddle_id))::int AS solved FROM explorer_step_sessions s WHERE started_at>=NOW()-$1*INTERVAL '1 day'`,
      [days],
    ),
  ]);
  return {
    days,
    modes: modes.rows,
    cohort: cohort.rows[0],
    visits: visits.rows[0],
    collect: collect.rows[0],
    explorer: explorer.rows[0],
    notes: [
      "Les visites sont anonymes : aucun taux visite → inscription attribuable n’est calculé.",
      "Cohortes arrivées à maturité : inscriptions entre J−(période+37) et J−37. Retour = au moins une activité en jours 7–13 ou 30–36.",
      "Parici mesure les scores enregistrés ; une partie commencée sans score n’est pas observée. Une partie en attente n’est pas un abandon.",
    ],
    generatedAt: new Date().toISOString(),
  };
}
async function balance(pool, days) {
  if (![7, 30, 90].includes(days)) throw httpError(400, "Période invalide.");
  const [observed, rarities, config, questions] = await Promise.all([
    pool.query(
      `SELECT c.family,COUNT(*)::int AS draws,COUNT(*) FILTER(WHERE g.correct)::int AS success FROM collect_games g JOIN cards c ON c.id=g.card_id WHERE g.started_at>=NOW()-$1*INTERVAL '1 day' GROUP BY c.family`,
      [days],
    ),
    pool.query(
      `SELECT c.current_rarity,COUNT(*)::int AS copies FROM card_copies cp JOIN cards c ON c.id=cp.card_id WHERE cp.source='collect' AND cp.obtained_at>=NOW()-$1*INTERVAL '1 day' GROUP BY c.current_rarity ORDER BY c.current_rarity`,
      [days],
    ),
    pool.query(
      "SELECT key,value_json FROM collect_config WHERE key IN ('family_weights','rarity_draw_weights','street_category_weights')",
    ),
    pool.query(
      `SELECT q.card_id,c.name,COUNT(*)::int AS answers,COUNT(*) FILTER(WHERE q.correct)::int AS correct FROM collect_question_history q JOIN cards c ON c.id=q.card_id WHERE q.answered_at>=NOW()-$1*INTERVAL '1 day' GROUP BY q.card_id,c.name ORDER BY COUNT(*) DESC LIMIT 50`,
      [days],
    ),
  ]);
  const weights =
      config.rows.find((r) => r.key === "family_weights")?.value_json ||
      require("../collect/rules").DEFAULT_FAMILY_WEIGHTS,
    totalWeight = Object.values(weights).reduce((s, n) => s + Number(n), 0),
    total = observed.rows.reduce((s, r) => s + r.draws, 0);
  return {
    days,
    total,
    rows: Object.entries(weights).map(([family, w]) => {
      const r = observed.rows.find((r) => r.family === family);
      return {
        family,
        draws: r?.draws || 0,
        success: r?.success || 0,
        expectedPercent: (100 * w) / totalWeight,
        observedPercent: total ? (100 * (r?.draws || 0)) / total : null,
      };
    }),
    rarities: rarities.rows,
    config: config.rows,
    questions: questions.rows,
    note: "Fréquences descriptives, sans modification automatique. Les raretés sont celles des cartes aujourd’hui, pas un historique de rareté au moment du tirage.",
  };
}
module.exports = { syncReports, quality, analytics, balance };
