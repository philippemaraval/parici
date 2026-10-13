"use strict";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function albumId(value) {
  if (!/^\d{1,18}$/.test(String(value))) throw fail("Album invalide");
  return String(value);
}
async function ownedAlbum(pool, userId, id) {
  const album = (
    await pool.query(
      "SELECT id,name FROM collect_personal_albums WHERE id=$1 AND user_id=$2",
      [albumId(id), userId],
    )
  ).rows[0];
  if (!album) throw fail("Album introuvable", 404);
  return album;
}
async function listAlbums(pool, userId) {
  return (
    await pool.query(
      `SELECT a.id,a.name,COUNT(DISTINCT COALESCE(m.canonical_card_id,ac.card_id))::int AS total,
    COUNT(DISTINCT COALESCE(m.canonical_card_id,ac.card_id)) FILTER(WHERE EXISTS(
      SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges cm ON cm.source_card_id=cp.card_id
      WHERE cp.user_id=$1 AND COALESCE(cm.canonical_card_id,cp.card_id)=COALESCE(m.canonical_card_id,ac.card_id)))::int AS owned
    ${require("../collect-social/service").schemaEnabled() ? `,COUNT(DISTINCT COALESCE(m.canonical_card_id,ac.card_id)) FILTER(WHERE EXISTS(SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges cm ON cm.source_card_id=cp.card_id WHERE cp.user_id=$1 AND cp.acquisition='earned' AND COALESCE(cm.canonical_card_id,cp.card_id)=COALESCE(m.canonical_card_id,ac.card_id)))::int AS earned` : ""}
    FROM collect_personal_albums a LEFT JOIN collect_personal_album_cards ac ON ac.album_id=a.id
    LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at,a.id`,
      [userId],
    )
  ).rows;
}
async function createAlbum(pool, userId, name) {
  name = typeof name === "string" ? name.trim() : "";
  if (!name || name.length > 60)
    throw fail("Choisis un nom de 1 à 60 caractères");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (
      Number(
        (
          await client.query(
            "SELECT COUNT(*) AS count FROM collect_personal_albums WHERE user_id=$1",
            [userId],
          )
        ).rows[0].count,
      ) >= 30
    )
      throw fail("Tu peux créer jusqu’à 30 albums");
    const album = (
      await client.query(
        "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,$2) RETURNING id,name",
        [userId, name],
      )
    ).rows[0];
    await client.query("COMMIT");
    return album;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function catalog(pool, userId, id, query = {}, onlySelected = false) {
  const album = await ownedAlbum(pool, userId, id);
  const search = String(query.search || "").trim(),
    family = String(query.family || ""),
    page = Number(query.page || 1);
  if (
    search.length > 100 ||
    !["", "street", "district", "monument", "bus"].includes(family) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000
  )
    throw fail("Filtres invalides");
  const rows = (
    await pool.query(
      `WITH inventory AS (
    SELECT c.id,c.name,c.family,c.collection_number,c.current_rarity,c.fragments_enabled,
      COALESCE(c.image_override,c.image_reference) AS image_reference,
      EXISTS(SELECT 1 FROM card_copies cp LEFT JOIN collect_card_merges cm ON cm.source_card_id=cp.card_id WHERE cp.user_id=$1 AND COALESCE(cm.canonical_card_id,cp.card_id)=c.id) AS owned,
      EXISTS(SELECT 1 FROM collect_personal_album_cards ac LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE ac.album_id=$2 AND COALESCE(m.canonical_card_id,ac.card_id)=c.id) AS selected
    FROM cards c WHERE (c.status='active' AND c.catalog_present OR EXISTS(SELECT 1 FROM card_copies cp WHERE cp.user_id=$1 AND cp.card_id=c.id))
      AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
  ), filtered AS (SELECT * FROM inventory WHERE ($3='' OR name ILIKE '%'||$3||'%') AND ($4='' OR family=$4) AND (NOT $5::boolean OR selected))
  SELECT *,COUNT(*) OVER()::int AS total FROM filtered ORDER BY family,name,id LIMIT 50 OFFSET $6`,
      [userId, album.id, search, family, onlySelected, (page - 1) * 50],
    )
  ).rows;
  return {
    album,
    cards: rows.map(({ total, ...card }) => ({
      ...card,
      image_reference: card.owned ? card.image_reference : null,
    })),
    total: rows[0]?.total || 0,
    page,
    pageSize: 50,
  };
}
async function addCards(pool, userId, id, cardIds) {
  if (
    !Array.isArray(cardIds) ||
    !cardIds.length ||
    cardIds.length > 50 ||
    cardIds.some((value) => !/^\d{1,18}$/.test(String(value)))
  )
    throw fail("Choisis entre 1 et 50 cartes");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ownedAlbum(client, userId, id);
    await client.query(
      "SELECT id FROM collect_personal_albums WHERE id=$1 FOR UPDATE",
      [id],
    );
    const selected = (
      await client.query(
        `SELECT DISTINCT COALESCE(m.canonical_card_id,c.id) AS id FROM cards c LEFT JOIN collect_card_merges m ON m.source_card_id=c.id
      JOIN cards canonical ON canonical.id=COALESCE(m.canonical_card_id,c.id)
      WHERE c.id=ANY($1::bigint[]) AND (canonical.status='active' AND canonical.catalog_present OR EXISTS(SELECT 1 FROM card_copies cp WHERE cp.user_id=$2 AND cp.card_id=canonical.id))`,
        [cardIds, userId],
      )
    ).rows.map((row) => row.id);
    if (!selected.length) throw fail("Ces cartes ne sont plus disponibles");
    const total = Number(
      (
        await client.query(
          "SELECT COUNT(*) AS count FROM collect_personal_album_cards WHERE album_id=$1",
          [id],
        )
      ).rows[0].count,
    );
    const additions = Number(
      (
        await client.query(
          "SELECT COUNT(*) AS count FROM unnest($2::bigint[]) s(id) WHERE NOT EXISTS(SELECT 1 FROM collect_personal_album_cards ac WHERE ac.album_id=$1 AND ac.card_id=s.id)",
          [id, selected],
        )
      ).rows[0].count,
    );
    if (total + additions > 500)
      throw fail("Un album peut contenir jusqu’à 500 cartes");
    await client.query(
      "INSERT INTO collect_personal_album_cards(album_id,card_id) SELECT $1,unnest($2::bigint[]) ON CONFLICT DO NOTHING",
      [id, selected],
    );
    await client.query("COMMIT");
    return { added: additions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function removeCard(pool, userId, id, cardId) {
  await ownedAlbum(pool, userId, id);
  await pool.query(
    "DELETE FROM collect_personal_album_cards ac USING collect_personal_albums a WHERE ac.album_id=a.id AND a.id=$1 AND a.user_id=$2 AND (ac.card_id=$3 OR ac.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=$3))",
    [id, userId, albumId(cardId)],
  );
  return { removed: true };
}
async function deleteAlbum(pool, userId, id) {
  await ownedAlbum(pool, userId, id);
  await pool.query(
    "DELETE FROM collect_personal_albums WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  return { deleted: true };
}
module.exports = {
  listAlbums,
  createAlbum,
  catalog,
  addCards,
  removeCard,
  deleteAlbum,
};
