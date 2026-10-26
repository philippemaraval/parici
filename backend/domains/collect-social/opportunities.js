"use strict";

// Only copies are exchangeable. Canonical ownership includes legacy merged cards.
const inventory = `inventory AS (
  SELECT cp.user_id,c.id,c.name,c.family,c.status,c.catalog_present,
    CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS rarity,
    COALESCE(c.image_override,c.image_reference) AS image_reference,
    COUNT(*)::int AS count,MAX(cp.id) FILTER(WHERE NOT cp.locked)::text AS copy_id,
    CASE WHEN COALESCE(s.locked,FALSE) OR COALESCE(s.hidden,FALSE) THEN 0
      ELSE LEAST(COUNT(*)-1,COUNT(*) FILTER(WHERE NOT cp.locked)) END::int AS spare
  FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
  JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
  LEFT JOIN collect_card_social_settings s ON s.user_id=cp.user_id AND s.card_id=c.id
  WHERE cp.user_id=$1 OR cp.user_id IN(SELECT id FROM partners)
  GROUP BY cp.user_id,c.id,s.locked,s.hidden
)`;

function filters(s, query) {
  const page = Number(query.page || 1),
    cardId = query.cardId ? s.id(query.cardId) : null;
  const search = String(query.search || "").trim();
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    search.length > 100
  )
    throw s.fail("Filtres invalides");
  return { page, cardId, search };
}

async function duplicates(pool, user, query = {}) {
  const s = require("./service"),
    { page, cardId, search } = filters(s, query);
  const rows = (
    await pool.query(
      `WITH partners AS(SELECT id FROM users WHERE FALSE),${inventory}
    SELECT *,COUNT(*) OVER()::int AS total FROM inventory
    WHERE user_id=$1 AND spare>0 AND rarity BETWEEN 1 AND 4 AND status='active' AND catalog_present
      AND ($2::bigint IS NULL OR id=$2) AND ($3='' OR name ILIKE '%'||$3||'%')
    ORDER BY name,id LIMIT 20 OFFSET $4`,
      [user, cardId, search, (page - 1) * 20],
    )
  ).rows;
  return {
    cards: rows.map(
      ({ total: _total, copy_id: _copyId, user_id: _user, ...card }) => card,
    ),
    total: rows[0]?.total || 0,
    page,
    pageSize: 20,
  };
}

async function opportunities(pool, user, query = {}) {
  const s = require("./service"),
    { page, cardId } = filters(s, query);
  const rows = (
    await pool.query(
      `WITH relationships AS (
    SELECT u.*,me.collect_visibility AS my_visibility,me.collect_exchange_policy AS my_policy,
      EXISTS(SELECT 1 FROM collect_friendships f WHERE f.low_id=LEAST($1::int,u.id)
        AND f.high_id=GREATEST($1::int,u.id) AND f.state='accepted') AS friend
    FROM users u CROSS JOIN users me WHERE me.id=$1 AND u.id<>$1
      AND NOT EXISTS(SELECT 1 FROM collect_blocks b WHERE (b.user_id=$1 AND b.blocked_id=u.id) OR(b.user_id=u.id AND b.blocked_id=$1))
  ), partners AS (
    SELECT id,username FROM relationships WHERE
      (collect_visibility='public' OR(collect_visibility='friends' AND friend))
      AND(my_visibility='public' OR(my_visibility='friends' AND friend))
      AND(collect_exchange_policy='everyone' OR(collect_exchange_policy='friends' AND friend))
      AND(my_policy='everyone' OR(my_policy='friends' AND friend))
  ),${inventory}, members AS (
    SELECT a.slug,a.name,COALESCE(m.canonical_card_id,ac.card_id) AS card_id,
      EXISTS(SELECT 1 FROM collect_album_goals g WHERE g.user_id=$1 AND g.album_id=a.id) AS targeted
    FROM albums a JOIN album_cards ac ON ac.album_id=a.id
    LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.active
    UNION
    SELECT 'personal-'||a.id,a.name,COALESCE(m.canonical_card_id,ac.card_id),
      EXISTS(SELECT 1 FROM collect_album_goals g WHERE g.user_id=$1 AND g.personal_album_id=a.id)
    FROM collect_personal_albums a JOIN collect_personal_album_cards ac ON ac.album_id=a.id
    LEFT JOIN collect_card_merges m ON m.source_card_id=ac.card_id WHERE a.user_id=$1
  ), album_members AS (
    SELECT DISTINCT m.* FROM members m JOIN cards c ON c.id=m.card_id WHERE c.status='active' AND c.catalog_present
  ), album_stats AS (
    SELECT slug,name,targeted,COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM inventory i WHERE i.user_id=$1 AND i.id=card_id))::int AS owned
    FROM album_members GROUP BY slug,name,targeted
  ), priorities AS (
    SELECT DISTINCT ON(m.card_id) m.card_id,s.* FROM album_members m JOIN album_stats s USING(slug,name,targeted)
    ORDER BY m.card_id,s.targeted DESC,(s.owned+1)::float/s.total DESC,s.name,s.slug
  ) SELECT p.id AS partner_id,p.username,
    jsonb_build_object('id',g.id,'name',g.name,'family',g.family,'rarity',g.rarity,'copyId',g.copy_id,'count',g.count) AS give,
    jsonb_build_object('id',r.id,'name',r.name,'family',r.family,'rarity',r.rarity,'copyId',r.copy_id,'count',r.count) AS receive,
    CASE WHEN a.slug IS NOT NULL THEN jsonb_build_object('slug',a.slug,'name',a.name,'targeted',a.targeted,'before',a.owned,'after',a.owned+1,'total',a.total) END AS album
  FROM inventory g JOIN inventory r ON r.rarity=g.rarity AND r.user_id<>$1
    JOIN partners p ON p.id=r.user_id LEFT JOIN priorities a ON a.card_id=r.id
  WHERE g.user_id=$1 AND g.spare>0 AND r.spare>0 AND g.rarity BETWEEN 1 AND 4
    AND g.status='active' AND g.catalog_present AND r.status='active' AND r.catalog_present
    AND NOT EXISTS(SELECT 1 FROM inventory i WHERE i.user_id=r.user_id AND i.id=g.id)
    AND NOT EXISTS(SELECT 1 FROM inventory i WHERE i.user_id=$1 AND i.id=r.id)
    AND ($2::bigint IS NULL OR g.id=$2)
    AND NOT EXISTS(SELECT 1 FROM collect_trade_offers o WHERE o.simple_exchange AND o.state='active' AND o.expires_at>NOW()
      AND((o.maker_id=$1 AND o.receiver_id=p.id AND o.offered_ids @> ARRAY[g.copy_id::bigint] AND o.requested_ids @> ARRAY[r.copy_id::bigint])
      OR(o.receiver_id=$1 AND o.maker_id=p.id AND o.requested_ids @> ARRAY[g.copy_id::bigint] AND o.offered_ids @> ARRAY[r.copy_id::bigint])))
  ORDER BY COALESCE(a.targeted,FALSE) DESC,(a.owned+1)::float/a.total DESC NULLS LAST,p.username,r.name,g.name,p.id,r.id,g.id
  LIMIT 21 OFFSET $3`,
      [user, cardId, (page - 1) * 20],
    )
  ).rows;
  return {
    opportunities: rows
      .slice(0, 20)
      .map(({ partner_id, username, ...row }) => ({
        ...row,
        partner: { id: partner_id, username },
      })),
    page,
    hasMore: rows.length > 20,
  };
}

async function validateSimple(c, maker, receiver, given, received) {
  const s = require("./service");
  if (
    given.length !== 1 ||
    received.length !== 1 ||
    Number(given[0].rarity) !== Number(received[0].rarity) ||
    [...given, ...received].some(
      (r) =>
        Number(r.rarity) > 4 ||
        r.status !== "active" ||
        !r.catalog_present ||
        r.card_hidden,
    )
  )
    throw s.fail(
      "Choisis une carte contre une carte de même rareté, hors légendaires.",
      409,
    );
  await s.view(c, maker, receiver);
  await s.view(c, receiver, maker);
  await s.exchange(c, maker, receiver);
  await s.exchange(c, receiver, maker);
  for (const [owner, own, incoming] of [
    [maker, given[0], received[0]],
    [receiver, received[0], given[0]],
  ]) {
    const row = (
      await c.query(
        `SELECT COUNT(*) FILTER(WHERE COALESCE(m.canonical_card_id,cp.card_id)=$2)::int AS owned,
      COUNT(*) FILTER(WHERE COALESCE(m.canonical_card_id,cp.card_id)=$3)::int AS incoming
      FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id WHERE cp.user_id=$1`,
        [owner, own.canonical_id, incoming.canonical_id],
      )
    ).rows[0];
    if (row.owned < 2 || row.incoming !== 0)
      throw s.fail(
        "Cet échange n’est plus possible : chacun doit conserver un exemplaire et recevoir une carte manquante.",
        409,
      );
  }
}

module.exports = { duplicates, opportunities, validateSimple };
