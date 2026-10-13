"use strict";
async function saveContentCorrection(db, editorId, cardId, body) {
  const {
    verifiedEntity = null,
    verificationSource = null,
    resolveType = null,
    ...content
  } = body || {};
  if (
    verifiedEntity !== null &&
    (typeof verifiedEntity !== "string" || verifiedEntity.length > 200)
  )
    throw Object.assign(new Error("Lieu vérifié invalide"), { status: 400 });
  if (verificationSource !== null) {
    try {
      const url = new URL(verificationSource);
      if (
        url.protocol !== "https:" ||
        verificationSource.length > 2048 ||
        url.username ||
        url.password
      )
        throw Error();
    } catch {
      throw Object.assign(new Error("Source de vérification HTTPS invalide"), {
        status: 400,
      });
    }
  }
  if (resolveType !== null && !["image", "description"].includes(resolveType))
    throw Object.assign(new Error("Signalement invalide"), { status: 400 });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const previous = (
      await client.query("SELECT * FROM cards WHERE id=$1 FOR UPDATE", [cardId])
    ).rows[0];
    if (!previous) {
      await client.query("ROLLBACK");
      return null;
    }
    const card = await db.saveCollectCardContent(cardId, content, client);
    await client.query(
      `INSERT INTO collect_content_corrections(card_id,editor_id,before_json,after_json,verified_entity,verification_source) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        cardId,
        editorId,
        JSON.stringify({
          image: previous.image_override,
          description: previous.description_override,
          descriptionFull: previous.description_full_override,
          credit: previous.image_credit_override,
        }),
        JSON.stringify(content),
        verifiedEntity,
        verificationSource,
      ],
    );
    if (resolveType)
      await client.query(
        "UPDATE collect_content_reports SET status='resolved',resolved_at=NOW() WHERE card_id=$1 AND content_type=$2 AND status='open'",
        [cardId, resolveType],
      );
    await client.query("COMMIT");
    return card;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function qualityHealth(db) {
  const catalog = (
    await db.pool
      .query(`SELECT family,COUNT(*) FILTER(WHERE status='active')::int AS active,COUNT(*) FILTER(WHERE NOT catalog_present)::int AS absent,
    COUNT(*) FILTER(WHERE status='active' AND COALESCE(image_override,image_reference,'/apple-touch-icon.png')='/apple-touch-icon.png')::int AS fallback_images,
    COUNT(*) FILTER(WHERE fragments_enabled AND NOT EXISTS(SELECT 1 FROM collect_questions q WHERE q.card_id=cards.id))::int AS missing_questions FROM cards GROUP BY family ORDER BY family`)
  ).rows;
  const settings = (
    await db.pool.query(
      "SELECT key,value_text,updated_at FROM app_settings WHERE key LIKE 'collect_%' AND key NOT LIKE '%secret%' ORDER BY key",
    )
  ).rows;
  const funnel = (
    await db.pool
      .query(`SELECT 'started' AS step,COUNT(*)::int AS count FROM collect_games WHERE started_at>NOW()-INTERVAL '7 days'
    UNION ALL SELECT 'placement_success',COUNT(*)::int FROM collect_attempts WHERE correct AND played_at>NOW()-INTERVAL '7 days'
    UNION ALL SELECT 'question_answered',COUNT(*)::int FROM collect_question_history WHERE answered_at>NOW()-INTERVAL '7 days'
    UNION ALL SELECT 'question_success',COUNT(*)::int FROM collect_question_history WHERE correct AND answered_at>NOW()-INTERVAL '7 days'
    UNION ALL SELECT 'copy',COUNT(*)::int FROM card_copies WHERE source='collect' AND obtained_at>NOW()-INTERVAL '7 days'
    UNION ALL SELECT kind,COUNT(*)::int FROM collect_events WHERE occurred_at>NOW()-INTERVAL '7 days' GROUP BY kind`)
  ).rows;
  const notifications = (
    await db.pool.query(
      `SELECT MAX(sent_at) AS last_sent,COUNT(*) FILTER(WHERE sent_at IS NULL)::int AS pending FROM collect_quota_push_deliveries`,
    )
  ).rows[0];
  const reports = (
    await db.pool.query(
      "SELECT content_type,COUNT(*)::int AS open FROM collect_content_reports WHERE status='open' GROUP BY content_type",
    )
  ).rows;
  return {
    catalog,
    settings,
    funnel,
    notifications,
    reports,
    release: process.env.RENDER_GIT_COMMIT || null,
  };
}
module.exports = { saveContentCorrection, qualityHealth };
