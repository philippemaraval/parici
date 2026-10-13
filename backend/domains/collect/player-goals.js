"use strict";
async function getAlbumGoal(db, userId) {
  const row = (
    await db.pool.query(
      `SELECT a.slug FROM collect_album_goals g JOIN albums a ON a.id=g.album_id WHERE g.user_id=$1 AND a.active`,
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  const album = (await db.getCollectAlbums(userId)).find(
    (item) => item.slug === row.slug,
  );
  if (!album) return null;
  const remaining = Math.max(
    0,
    album.active_card_count - album.owned_active_card_count,
  );
  if (!remaining) {
    await db.pool.query(
      `INSERT INTO collect_events(user_id,kind) SELECT $1,'album_complete' WHERE NOT EXISTS(
      SELECT 1 FROM collect_events e JOIN collect_album_goals g ON g.user_id=e.user_id WHERE e.user_id=$1 AND e.kind='album_complete' AND e.occurred_at>=g.chosen_at)`,
      [userId],
    );
  }
  return { ...album, remaining };
}
async function setAlbumGoal(db, userId, slug) {
  if (!slug) {
    await db.pool.query("DELETE FROM collect_album_goals WHERE user_id=$1", [
      userId,
    ]);
    return null;
  }
  const saved = await db.pool.query(
    `INSERT INTO collect_album_goals(user_id,album_id) SELECT $1,id FROM albums WHERE slug=$2 AND active
    ON CONFLICT(user_id) DO UPDATE SET album_id=EXCLUDED.album_id,chosen_at=NOW() RETURNING album_id`,
    [userId, slug],
  );
  if (!saved.rowCount)
    throw Object.assign(new Error("Album introuvable"), { status: 404 });
  return getAlbumGoal(db, userId);
}
module.exports = { getAlbumGoal, setAlbumGoal };
