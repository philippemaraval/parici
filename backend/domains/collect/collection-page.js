"use strict";

const families = new Set([
  "",
  "street",
  "district",
  "monument",
  "bus",
  "famous",
  "main",
  "street-district",
  "street-arrondissement",
]);
function parseCollectionFilters(query) {
  const value = (key) => (typeof query[key] === "string" ? query[key] : "");
  const filters = {
    family: value("family"),
    ownership: value("ownership") || "owned",
    search: value("search").trim(),
    sort: value("sort") || "rarity",
    district: value("district"),
    arrondissement: value("arrondissement"),
    rarity: Number(value("rarity") || "0"),
    page: Number(value("page") || "1"),
  };
  if (
    !families.has(filters.family) ||
    ![
      "owned",
      "favorites",
      "missing",
      "all",
      "fragments",
      ...(require("../collect-social/service").schemaEnabled()
        ? ["earned", "trade"]
        : []),
    ].includes(filters.ownership) ||
    !["name", "rarity", "recent", "copies"].includes(filters.sort) ||
    filters.search.length > 100 ||
    filters.district.length > 100 ||
    !Number.isInteger(filters.page) ||
    filters.page < 1 ||
    filters.page > 10000 ||
    !Number.isInteger(filters.rarity) ||
    filters.rarity < 0 ||
    filters.rarity > 5 ||
    !/^$|^(?:[1-9]|1[0-9]|20)$/.test(filters.arrondissement)
  )
    throw Object.assign(new Error("Filtres invalides"), { status: 400 });
  return filters;
}
async function collectionPage(
  db,
  userId,
  filters,
  { publicView = false } = {},
) {
  const params = [
    userId,
    filters.family,
    filters.ownership,
    filters.rarity,
    filters.search,
    filters.district,
    filters.arrondissement,
  ];
  const base = `WITH user_copies AS (
    SELECT COALESCE(m.canonical_card_id,cp.card_id) AS card_id,COUNT(*)::int AS copies,COUNT(*) FILTER(WHERE ${require("../collect-social/service").schemaEnabled() ? "cp.acquisition='earned'" : "TRUE"})::int AS earned_copies,MAX(${require("../collect-social/service").schemaEnabled() ? "cp.acquired_at" : "cp.obtained_at"}) AS recent
    FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
    WHERE cp.user_id=$1 GROUP BY COALESCE(m.canonical_card_id,cp.card_id)
  ), user_fragments AS (
    SELECT COALESCE(m.canonical_card_id,p.card_id) AS card_id,
      COALESCE(MAX(p.fragments) FILTER(WHERE m.source_card_id IS NULL),MAX(p.fragments)) AS fragments
    FROM collect_fragment_progress p LEFT JOIN collect_card_merges m ON m.source_card_id=p.card_id
    WHERE p.user_id=$1 GROUP BY COALESCE(m.canonical_card_id,p.card_id)
  ), inventory AS (
    SELECT c.id,c.family,c.name,c.collection_number,CASE WHEN c.catalog_present THEN c.status ELSE 'archived' END AS status,CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS rarity,
      COALESCE(cp.copies,0) AS copies,COALESCE(cp.earned_copies,0) AS earned_copies,cp.recent,f.card_id IS NOT NULL AS favorite,
      ${publicView ? "0" : "LEAST(COALESCE(p.fragments,0),c.fragments_required)"} AS fragments
    FROM cards c LEFT JOIN user_copies cp ON cp.card_id=c.id LEFT JOIN user_fragments p ON p.card_id=c.id
    LEFT JOIN collect_favorites f ON f.user_id=$1 AND f.card_id=c.id
    WHERE NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
  ), family_inventory AS (
    SELECT * FROM inventory i WHERE (status='active' OR copies>0) AND (
      $2='' OR family=$2 OR
      ($2 IN('famous','main','street-district','street-arrondissement') AND EXISTS(
        SELECT 1 FROM album_cards ac JOIN albums a ON a.id=ac.album_id WHERE ac.card_id=i.id AND a.active AND (
          ($2='famous' AND a.slug='famous-streets') OR ($2='main' AND a.slug='main-streets') OR
          ($2='street-district' AND family='street' AND ($6='' OR (a.slug LIKE 'street-district-%' AND a.name=$6))) OR
          ($2='street-arrondissement' AND family='street' AND ($7='' OR a.slug='street-arrondissement-'||$7))
        )
      ))
    )
  ), filtered AS (
    SELECT * FROM family_inventory WHERE ($3='all' OR ($3='owned' AND (copies>0 OR ($4=5 AND fragments>0))) OR ($3='missing' AND copies=0) OR ($3='favorites' AND favorite AND copies>0) OR ($3='fragments' AND fragments>0) OR ($3='earned' AND earned_copies>0) OR($3='trade' AND copies>earned_copies))
      AND ($4=0 OR rarity=$4) AND ($5='' OR name ILIKE '%'||$5||'%' OR
        (CASE family WHEN 'street' THEN 'R-' WHEN 'district' THEN 'Q-' WHEN 'monument' THEN 'M-' ELSE 'B-' END||LPAD(collection_number::text,CASE WHEN family='street' THEN 4 ELSE 3 END,'0')) ILIKE '%'||$5||'%')
  )`;
  const summary = (
    await db.pool.query(
      base +
        ` SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
    COUNT(*) FILTER(WHERE status='active')::int AS active,COUNT(*) FILTER(WHERE status='active' AND copies>0)::int AS owned,COALESCE(SUM(copies),0)::int AS copies FROM family_inventory WHERE ($4=0 OR rarity=$4)`,
      params,
    )
  ).rows[0];
  const pageSize = 50,
    page = Math.min(
      filters.page,
      Math.max(1, Math.ceil(summary.total / pageSize)),
    );
  const order = {
    rarity: "rarity,name,collection_number",
    name: "name,collection_number",
    recent: "recent DESC NULLS LAST,name,collection_number",
    copies: "copies DESC,name,collection_number",
  }[filters.sort];
  const ids = (
    await db.pool.query(
      base + ` SELECT id FROM filtered ORDER BY ${order},id LIMIT $8 OFFSET $9`,
      [...params, pageSize, (page - 1) * pageSize],
    )
  ).rows.map((row) => row.id);
  const cards = ids.length
    ? await db.getCollectCollection(userId, {
        publicView,
        cardIds: ids,
        compact: true,
      })
    : [];
  const byId = new Map(cards.map((card) => [Number(card.id), card]));
  const { addOwnedFragmentsToCollection } = require("./fragment-collection");
  const ordered = ids.map((id) => byId.get(Number(id))).filter(Boolean);
  return {
    cards: publicView
      ? ordered
      : await addOwnedFragmentsToCollection(db.pool, userId, ordered),
    summary,
    total: summary.total,
    page,
    pageSize,
    filters,
    rarityLabels: await db.getCollectRarityLabels(),
  };
}
module.exports = { parseCollectionFilters, collectionPage };
