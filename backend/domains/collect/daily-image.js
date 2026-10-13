"use strict";
// Keep the Daily a photographic clue. A cartographic card never replaces a photo.
async function dailyImageForStreet(pool, streetName, fallback) {
  const { rows } = await pool.query(
    `SELECT COALESCE(c.image_override,c.image_reference) AS image,c.image_override
    FROM cards source LEFT JOIN collect_card_merges m ON m.source_card_id=source.id
    JOIN cards c ON c.id=COALESCE(m.canonical_card_id,source.id)
    WHERE source.family='street' AND (source.source_entity_id=$1 OR LOWER(source.name)=LOWER($1))
    AND c.status='active' AND c.catalog_present
    ORDER BY (source.source_entity_id=$1) DESC,source.id LIMIT 1`,
    [streetName],
  );
  const card = rows[0];
  // Editorial card corrections win; untouched seed photos remain date-specific in Daily.
  return card?.image_override && !/\.svg(?:[?#]|$)/i.test(card.image_override)
    ? card.image_override
    : fallback ||
        (!/\.svg(?:[?#]|$)/i.test(card?.image || "") ? card?.image : null);
}
module.exports = { dailyImageForStreet };
