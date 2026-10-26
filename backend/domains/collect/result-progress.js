"use strict";

// Called inside the reward transaction. The snapshot is saved with the result,
// so retries and resumed results show the original before/after values.
async function resultProgress(client, userId, cardId, ownedCount) {
  const firstCopy = Number(ownedCount) === 1;
  const collection = (
    await client.query(
      `WITH inventory AS (
    SELECT c.id,EXISTS(SELECT 1 FROM card_copies cp
      LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
      WHERE cp.user_id=$1 AND COALESCE(m.canonical_card_id,cp.card_id)=c.id) AS owned
    FROM cards c WHERE c.status='active' AND c.catalog_present
      AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
  ) SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE owned)::int AS after FROM inventory`,
      [userId],
    )
  ).rows[0];
  const albums = firstCopy
    ? (
        await client.query(
          `WITH members AS (
    SELECT a.slug,a.name,COALESCE(m.canonical_card_id,ac.card_id) AS card_id,
      EXISTS(SELECT 1 FROM collect_album_goals g WHERE g.user_id=$1 AND g.album_id=a.id) AS targeted
    FROM albums a JOIN album_cards ac ON ac.album_id=a.id
    LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.active
    UNION ALL
    SELECT 'personal-'||a.id,a.name,COALESCE(m.canonical_card_id,ac.card_id),
      EXISTS(SELECT 1 FROM collect_album_goals g WHERE g.user_id=$1 AND g.personal_album_id=a.id)
    FROM collect_personal_albums a JOIN collect_personal_album_cards ac ON ac.album_id=a.id
    LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.user_id=$1
  ), inventory AS (
    SELECT DISTINCT a.*,EXISTS(SELECT 1 FROM card_copies cp
      LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
      WHERE cp.user_id=$1 AND COALESCE(m.canonical_card_id,cp.card_id)=a.card_id) AS owned
    FROM members a JOIN cards c ON c.id=a.card_id WHERE c.status='active' AND c.catalog_present
  ) SELECT slug,name,targeted,COUNT(*)::int AS total,
    COUNT(*) FILTER(WHERE owned)::int AS after FROM inventory
    GROUP BY slug,name,targeted HAVING BOOL_OR(card_id=$2)
    ORDER BY targeted DESC,(COUNT(*)=COUNT(*) FILTER(WHERE owned)) DESC,
      (COUNT(*) FILTER(WHERE owned))::float/COUNT(*) DESC,name,slug`,
          [userId, cardId],
        )
      ).rows.map((album) => ({
        ...album,
        before: album.after - 1,
        complete: album.after === album.total,
      }))
    : [];
  return {
    kind: firstCopy ? "new" : "duplicate",
    collection: {
      ...collection,
      before: collection.after - (firstCopy ? 1 : 0),
    },
    albums: albums.slice(0, 3),
    otherAlbumCount: Math.max(0, albums.length - 3),
  };
}

module.exports = { resultProgress };
