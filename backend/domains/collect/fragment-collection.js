"use strict";

// Reveal card artwork only to the player who actually earned a fragment.
// The public profile continues to use its separate inventory response.
async function addOwnedFragmentsToCollection(pool, userId, cards) {
  const table = await pool.query(
    "SELECT to_regclass('public.collect_fragment_progress') AS progress_table",
  );
  if (!table.rows[0]?.progress_table) return cards;
  const result = await pool.query(
    `
    SELECT c.id, c.name, c.fragments_required,
           COALESCE(to_jsonb(c)->>'image_override', c.image_reference) AS image_reference,
           to_jsonb(c)->>'description_override' AS description,
           LEAST(COALESCE((SELECT cp.fragments FROM collect_fragment_progress cp
             WHERE cp.user_id=$1 AND cp.card_id=c.id), MAX(p.fragments)), c.fragments_required) AS fragment_count
    FROM collect_fragment_progress p
    LEFT JOIN collect_card_merges m ON m.source_card_id=p.card_id
    JOIN cards c ON c.id=COALESCE(m.canonical_card_id,p.card_id)
    WHERE p.user_id = $1 AND p.fragments > 0 AND c.fragments_enabled
    GROUP BY c.id`,
    [userId],
  );
  const progress = new Map(result.rows.map((row) => [String(row.id), row]));
  return cards.map((card) => {
    const owned = progress.get(String(card.id));
    if (
      !owned ||
      Number(owned.fragment_count) <= 0 ||
      Number(card.copy_count) > 0
    )
      return card;
    return {
      ...card,
      name: owned.name,
      image_reference: owned.image_reference,
      description: card.description || owned.description,
      current_rarity: 5,
      fragments_enabled: true,
      fragments_required: Number(owned.fragments_required),
      fragment_count: Number(owned.fragment_count),
    };
  });
}

module.exports = { addOwnedFragmentsToCollection };
