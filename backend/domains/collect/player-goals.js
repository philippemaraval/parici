"use strict";

const TARGET_CHANCE = 0.2;
// Resolve legacy merged cards exactly as the collection does. An exchanged copy
// counts as owned; fragments without a complete copy do not.
const goalInventory = `WITH goal_album AS (
  SELECT g.album_id,g.personal_album_id,g.chosen_at::text AS chosen_at,
    a.slug,a.name FROM collect_album_goals g JOIN albums a ON a.id=g.album_id
    WHERE g.user_id=$1 AND a.active
  UNION ALL
  SELECT g.album_id,g.personal_album_id,g.chosen_at::text,
    'personal-'||a.id,a.name FROM collect_album_goals g
    JOIN collect_personal_albums a ON a.id=g.personal_album_id AND a.user_id=g.user_id
    WHERE g.user_id=$1
), members AS (
  SELECT ac.card_id FROM goal_album g JOIN album_cards ac ON ac.album_id=g.album_id
  UNION
  SELECT ac.card_id FROM goal_album g JOIN collect_personal_album_cards ac ON ac.album_id=g.personal_album_id
), inventory AS (
  SELECT DISTINCT c.*,EXISTS(
    SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges cm ON cm.source_card_id=cp.card_id
    WHERE cp.user_id=$1 AND COALESCE(cm.canonical_card_id,cp.card_id)=c.id
  ) AS owned FROM members ac
  LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id
  JOIN cards c ON c.id=COALESCE(m.canonical_card_id,ac.card_id)
  WHERE c.status='active' AND c.catalog_present
)`;

async function getAlbumGoal(db, userId, client = db.pool) {
  const album = (
    await client.query(
      `${goalInventory} SELECT g.*,
        (SELECT COUNT(*)::int FROM inventory) AS active_card_count,
        (SELECT COUNT(*)::int FROM inventory WHERE owned) AS owned_active_card_count
      FROM goal_album g`,
      [userId],
    )
  ).rows[0];
  if (!album) return null;
  const remaining = album.active_card_count - album.owned_active_card_count;
  if (!remaining) {
    // The identity and timestamp guard preserve a concurrently selected target.
    await client.query(
      `WITH removed AS (DELETE FROM collect_album_goals WHERE user_id=$1
        AND album_id IS NOT DISTINCT FROM $2::bigint
        AND personal_album_id IS NOT DISTINCT FROM $3::bigint
        AND chosen_at=$4::timestamptz RETURNING user_id)
      INSERT INTO collect_events(user_id,kind) SELECT user_id,'album_complete' FROM removed`,
      [userId, album.album_id, album.personal_album_id, album.chosen_at],
    );
    return null;
  }
  return {
    slug: album.slug,
    name: album.name,
    active_card_count: album.active_card_count,
    owned_active_card_count: album.owned_active_card_count,
    remaining,
    progress:
      Math.round(
        (album.owned_active_card_count / album.active_card_count) * 10000,
      ) / 100,
    targetChance: TARGET_CHANCE,
  };
}

async function setAlbumGoal(db, userId, slug) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!slug) {
      await client.query("DELETE FROM collect_album_goals WHERE user_id=$1", [
        userId,
      ]);
      await client.query("COMMIT");
      return null;
    }
    const personalId = /^personal-([1-9]\d{0,17})$/.exec(slug)?.[1];
    const saved = await client.query(
      personalId
        ? `INSERT INTO collect_album_goals(user_id,personal_album_id)
          SELECT $1,id FROM collect_personal_albums WHERE id=$2 AND user_id=$1
          ON CONFLICT(user_id) DO UPDATE SET album_id=NULL,
            personal_album_id=EXCLUDED.personal_album_id,chosen_at=NOW() RETURNING user_id`
        : `INSERT INTO collect_album_goals(user_id,album_id)
          SELECT $1,id FROM albums WHERE slug=$2 AND active
          ON CONFLICT(user_id) DO UPDATE SET album_id=EXCLUDED.album_id,
            personal_album_id=NULL,chosen_at=NOW() RETURNING user_id`,
      [userId, personalId || slug],
    );
    if (!saved.rowCount)
      throw Object.assign(new Error("Album introuvable"), { status: 404 });
    const goal = await getAlbumGoal(db, userId, client);
    if (!goal)
      throw Object.assign(
        new Error(
          "Cet album est déjà complet ou ne contient aucune carte disponible.",
        ),
        { status: 409 },
      );
    await client.query("COMMIT");
    return goal;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function targetDrawCard(
  client,
  userId,
  originalCard,
  random = Math.random,
) {
  const goal = await getAlbumGoal({ pool: client }, userId, client);
  if (!goal || random() >= TARGET_CHANCE) return originalCard;
  // First draw normally, then substitute only within the same displayed rarity.
  // If this rarity has no missing card in the album, keep the original draw.
  const rarity = originalCard.fragments_enabled
    ? 5
    : Number(originalCard.current_rarity);
  const result = await client.query(
    `${goalInventory} SELECT * FROM inventory WHERE NOT owned
      AND (CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END)=$2
      ORDER BY RANDOM() LIMIT 1`,
    [userId, rarity],
  );
  return result.rows[0] || originalCard;
}

module.exports = { getAlbumGoal, setAlbumGoal, targetDrawCard, TARGET_CHANCE };
