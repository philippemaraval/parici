"use strict";
const crypto = require("node:crypto");
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const owned = `EXISTS(SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges cm ON cm.source_card_id=cp.card_id
  WHERE cp.user_id=$1 AND COALESCE(cm.canonical_card_id,cp.card_id)=c.id)`;
const inventory = `WITH candidates AS (
  SELECT c.* FROM cards c WHERE c.status='active' AND c.catalog_present AND ${owned}
    AND ($2='' OR EXISTS(SELECT 1 FROM album_cards ac JOIN albums a ON a.id=ac.album_id
      LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id
      WHERE a.slug=$2 AND a.active AND COALESCE(m.canonical_card_id,ac.card_id)=c.id)
    OR EXISTS(SELECT 1 FROM collect_personal_albums a JOIN collect_personal_album_cards ac ON ac.album_id=a.id
      LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id
      WHERE 'personal-'||a.id=$2 AND a.user_id=$1 AND COALESCE(m.canonical_card_id,ac.card_id)=c.id))
), history AS (
  SELECT COALESCE(m.canonical_card_id,g.card_id) AS card_id,g.correct,g.finished_at AS played_at,'collect' AS origin
  FROM collect_games g LEFT JOIN collect_card_merges m ON m.source_card_id=g.card_id
  WHERE g.user_id=$1 AND g.finished_at IS NOT NULL AND NOT g.abandoned AND g.correct IS NOT NULL
  UNION ALL
  SELECT COALESCE(m.canonical_card_id,g.card_id),g.correct,g.finished_at,'review'
  FROM collect_review_games g JOIN collect_review_sessions s ON s.id=g.session_id
  LEFT JOIN collect_card_merges m ON m.source_card_id=g.card_id
  WHERE s.user_id=$1 AND g.finished_at IS NOT NULL AND g.correct IS NOT NULL
), latest AS (
  SELECT DISTINCT ON(card_id) card_id,correct FROM history ORDER BY card_id,played_at DESC,origin DESC
), eligible AS (
  SELECT c.*,l.correct,(SELECT MAX(played_at) FROM history h WHERE h.card_id=c.id AND h.origin='review') AS last_reviewed
  FROM candidates c LEFT JOIN latest l ON l.card_id=c.id
)`;

async function validateScope(client, userId, scope) {
  if (typeof scope !== "string" || (scope && !/^[a-z0-9-]{1,100}$/.test(scope)))
    throw fail("Album invalide");
  if (!scope) return;
  const result = await client.query(
    `SELECT 1 FROM albums WHERE slug=$2 AND active
    UNION ALL SELECT 1 FROM collect_personal_albums WHERE user_id=$1 AND 'personal-'||id=$2`,
    [userId, scope],
  );
  if (!result.rows.length) throw fail("Album introuvable", 404);
}
async function counts(db, userId, scope = "") {
  await validateScope(db.pool, userId, scope);
  if (scope)
    return (
      await db.pool.query(
        `${inventory} SELECT COUNT(*)::int AS revision,
    COUNT(*) FILTER(WHERE correct=FALSE)::int AS errors FROM eligible`,
        [userId, scope],
      )
    ).rows[0];
  const rows = (
    await db.pool.query(
      `${inventory}, memberships AS (
    SELECT a.slug AS scope,COALESCE(m.canonical_card_id,ac.card_id) AS card_id
      FROM albums a JOIN album_cards ac ON ac.album_id=a.id
      LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.active
    UNION
    SELECT 'personal-'||a.id,COALESCE(m.canonical_card_id,ac.card_id)
      FROM collect_personal_albums a JOIN collect_personal_album_cards ac ON ac.album_id=a.id
      LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.user_id=$1
  ) SELECT '' AS scope,COUNT(*)::int AS revision,COUNT(*) FILTER(WHERE correct=FALSE)::int AS errors FROM eligible
    UNION ALL SELECT m.scope,COUNT(*)::int,COUNT(*) FILTER(WHERE e.correct=FALSE)::int
      FROM memberships m JOIN eligible e ON e.id=m.card_id GROUP BY m.scope`,
      [userId, scope],
    )
  ).rows;
  return {
    ...rows.find((r) => r.scope === ""),
    albums: Object.fromEntries(
      rows
        .filter((r) => r.scope)
        .map((r) => [r.scope, { revision: r.revision, errors: r.errors }]),
    ),
  };
}
async function transaction(db, userId, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function summary(client, session) {
  const stats = (
    await client.query(
      `SELECT COUNT(*) FILTER(WHERE correct IS NOT NULL)::int AS answered,
    COUNT(*) FILTER(WHERE correct=TRUE)::int AS correct,COUNT(*) FILTER(WHERE correct=FALSE)::int AS errors
    FROM collect_review_games WHERE session_id=$1`,
      [session.id],
    )
  ).rows[0];
  return {
    sessionId: session.id,
    mode: session.mode,
    scope: session.scope,
    total: session.card_ids.length,
    ...stats,
  };
}
async function present(db, client, session, game) {
  const content = db.collectCardContent(game);
  return {
    gameId: game.id,
    maxAttempts: 1,
    guesses: [],
    review: { ...(await summary(client, session)), position: game.position },
    card: {
      family: game.family,
      name: game.name,
      imageReference: content.image_reference || "/apple-touch-icon.png",
      imageAttribution: content.image_attribution,
    },
  };
}
async function completion(client, session) {
  const remaining = await client.query(
    `${inventory} SELECT COUNT(*) FILTER(WHERE correct=FALSE)::int AS remaining FROM eligible`,
    [session.user_id, session.scope],
  );
  return {
    complete: true,
    review: {
      ...(await summary(client, session)),
      remainingErrors: remaining.rows[0].remaining,
    },
  };
}
async function advance(db, client, session) {
  const games = (
    await client.query(
      "SELECT * FROM collect_review_games WHERE session_id=$1 ORDER BY position",
      [session.id],
    )
  ).rows;
  const current = games.find((g) => !g.finished_at);
  let position = current?.position || (games.at(-1)?.position || 0) + 1;
  while (position <= session.card_ids.length) {
    const card = (
      await client.query(
        `SELECT c.* FROM cards c WHERE c.id=$2 AND c.status='active' AND c.catalog_present AND ${owned}`,
        [session.user_id, session.card_ids[position - 1]],
      )
    ).rows[0];
    if (card) {
      const game =
        current?.position === position
          ? current
          : (
              await client.query(
                `INSERT INTO collect_review_games(id,session_id,card_id,position)
        VALUES($1,$2,$3,$4) RETURNING *`,
                [crypto.randomUUID(), session.id, card.id, position],
              )
            ).rows[0];
      return present(db, client, session, { ...card, ...game });
    }
    if (current?.position === position)
      await client.query(
        "UPDATE collect_review_games SET finished_at=NOW() WHERE id=$1",
        [current.id],
      );
    position++;
  }
  await client.query(
    "UPDATE collect_review_sessions SET finished_at=NOW() WHERE id=$1",
    [session.id],
  );
  return completion(client, session);
}
async function start(db, userId, { mode = "revision", scope = "" } = {}) {
  if (!["revision", "errors"].includes(mode))
    throw fail("Mode de révision invalide");
  return transaction(db, userId, async (client) => {
    await validateScope(client, userId, scope);
    const existing = (
      await client.query(
        "SELECT * FROM collect_review_sessions WHERE user_id=$1 AND finished_at IS NULL FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (existing?.mode === mode && existing.scope === scope)
      return advance(db, client, existing);
    const cards = (
      await client.query(
        `${inventory} SELECT id FROM eligible WHERE ($3='revision' OR correct=FALSE)
      ORDER BY last_reviewed ASC NULLS FIRST,RANDOM() LIMIT 10`,
        [userId, scope, mode],
      )
    ).rows;
    if (!cards.length)
      throw fail(
        mode === "errors"
          ? "Aucune erreur à revoir"
          : "Aucune carte obtenue disponible dans cet album",
        409,
      );
    if (existing)
      await client.query(
        "UPDATE collect_review_sessions SET finished_at=NOW() WHERE id=$1",
        [existing.id],
      );
    const session = (
      await client.query(
        `INSERT INTO collect_review_sessions(id,user_id,mode,scope,card_ids)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [crypto.randomUUID(), userId, mode, scope, cards.map((c) => c.id)],
      )
    ).rows[0];
    return advance(db, client, session);
  });
}
async function next(db, userId, sessionId) {
  return transaction(db, userId, async (client) => {
    const session = (
      await client.query(
        "SELECT * FROM collect_review_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [sessionId, userId],
      )
    ).rows[0];
    if (!session) throw fail("Session introuvable", 404);
    if (session.finished_at) return completion(client, session);
    return advance(db, client, session);
  });
}
async function answer(db, userId, gameId, answerEntityId, answerContext = "") {
  return transaction(db, userId, async (client) => {
    const row = (
      await client.query(
        `SELECT g.*,s.user_id,s.mode,s.scope,s.card_ids,s.finished_at AS session_finished_at,c.family,c.source_entity_id,c.name,c.collection_number,
      c.image_reference,c.image_override,c.description_override,c.description_full_override,c.image_credit_override,c.current_rarity,c.fragments_enabled
      FROM collect_review_games g JOIN collect_review_sessions s ON s.id=g.session_id JOIN cards c ON c.id=g.card_id
      WHERE g.id=$1 AND s.user_id=$2 FOR UPDATE OF s,g`,
        [gameId, userId],
      )
    ).rows[0];
    if (!row) throw fail("Partie de révision introuvable", 404);
    if (row.result_json) return row.result_json;
    if (row.session_finished_at) throw fail("Cette session est terminée", 409);
    const session = {
      id: row.session_id,
      user_id: userId,
      mode: row.mode,
      scope: row.scope,
      card_ids: row.card_ids,
    };
    const available = (
      await client.query(
        `SELECT 1 FROM cards c WHERE c.id=$2 AND c.status='active' AND c.catalog_present AND ${owned}`,
        [userId, row.card_id],
      )
    ).rows.length;
    if (!available)
      throw fail(
        "Cette carte n’est plus disponible dans ta collection. Passe à la suivante.",
        409,
      );
    let correct = String(answerEntityId) === String(row.source_entity_id);
    if (!correct && row.family === "street")
      correct =
        (
          await client.query(
            "SELECT 1 FROM card_answer_aliases WHERE card_id=$1 AND answer_entity_id=$2 AND answer_context=$3",
            [row.card_id, answerEntityId, answerContext],
          )
        ).rows.length > 0;
    await client.query(
      "UPDATE collect_review_games SET finished_at=NOW(),correct=$2 WHERE id=$1",
      [gameId, correct],
    );
    const result = {
      correct,
      rewardGranted: false,
      rewardAvailable: false,
      rewardBlockedReason: "review",
      attempts: 1,
      maxAttempts: 1,
      guesses: [{ answerEntityId, answerName: answerEntityId, correct }],
      review: { ...(await summary(client, session)), position: row.position },
      card: {
        id: row.card_id,
        family: row.family,
        name: row.name,
        sourceEntityId: row.source_entity_id,
        collectionNumber: row.collection_number,
        rarity: row.fragments_enabled ? 5 : Number(row.current_rarity),
      },
    };
    await client.query(
      "UPDATE collect_review_games SET result_json=$2::jsonb WHERE id=$1",
      [gameId, JSON.stringify(result)],
    );
    return result;
  });
}
module.exports = { counts, start, next, answer };
