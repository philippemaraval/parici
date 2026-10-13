"use strict";
const crypto = require("node:crypto");
const enabled = () => process.env.COLLECT_V2_ENABLED !== "false";
let migrated = false;
// The API flag does not prove that the schema exists yet.
const schemaEnabled = () => migrated;
const markMigrated = () => {
  migrated = true;
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function id(value) {
  if (!/^[1-9]\d{0,17}$/.test(String(value)))
    throw fail("Identifiant invalide");
  return String(value);
}
function uuid(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(value),
    )
  )
    throw fail("Identifiant de requête invalide");
  return String(value);
}
function ids(values) {
  if (!Array.isArray(values) || !values.length || values.length > 10000)
    throw fail(
      "Choisis les exemplaires précis (10 000 maximum par transaction)",
    );
  const result = values.map(id);
  if (new Set(result).size !== result.length)
    throw fail("Exemplaire sélectionné plusieurs fois");
  return result.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
}
async function tx(pool, users, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const unique = [...new Set(users.filter(Boolean).map(id))];
    const found = (
      await c.query(
        "SELECT id FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE",
        [unique],
      )
    ).rows;
    if (found.length !== unique.length) throw fail("Joueur introuvable", 404);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function relation(c, viewer, target) {
  const r = (
    await c.query(
      `SELECT u.id,u.username,u.avatar,u.collect_visibility,u.collect_exchange_policy,
    EXISTS(SELECT 1 FROM collect_blocks WHERE (user_id=$1 AND blocked_id=u.id) OR(user_id=u.id AND blocked_id=$1)) AS blocked,
    EXISTS(SELECT 1 FROM collect_friendships WHERE low_id=LEAST($1::int,u.id) AND high_id=GREATEST($1::int,u.id) AND state='accepted') AS friend
    FROM users u WHERE u.id=$2`,
      [viewer || 0, target],
    )
  ).rows[0];
  if (!r) throw fail("Joueur introuvable", 404);
  return r;
}
async function canView(c, viewer, target) {
  const r = await relation(c, viewer, target);
  return (
    String(viewer) === String(target) ||
    (!r.blocked &&
      (r.collect_visibility === "public" ||
        (r.collect_visibility === "friends" && r.friend)))
  );
}
async function view(c, viewer, target) {
  if (!(await canView(c, viewer, target)))
    throw fail("Collection non accessible", 404);
}
async function exchange(c, maker, receiver) {
  if (String(maker) === String(receiver)) throw fail("Choisis un autre joueur");
  const r = await relation(c, maker, receiver);
  if (
    r.blocked ||
    r.collect_exchange_policy === "nobody" ||
    (r.collect_exchange_policy === "friends" && !r.friend)
  )
    throw fail("Ce joueur ne reçoit pas tes propositions", 403);
}
async function notify(c, user, key, kind, payload = {}) {
  await c.query(
    "INSERT INTO collect_social_notifications(user_id,event_key,kind,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
    [user, key, kind, JSON.stringify(payload)],
  );
}
async function usernameId(c, name) {
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw fail("Pseudo invalide");
  const user = (
    await c.query("SELECT id FROM users WHERE LOWER(username)=LOWER($1)", [
      name.trim(),
    ])
  ).rows[0];
  if (!user) throw fail("Joueur introuvable", 404);
  return user.id;
}
async function settings(pool, user, body) {
  if (!body)
    return (
      await pool.query(
        "SELECT collect_visibility AS visibility,collect_exchange_policy AS exchanges,collect_social_push AS push FROM users WHERE id=$1",
        [user],
      )
    ).rows[0];
  if (
    !["public", "friends", "private"].includes(body.visibility) ||
    !["everyone", "friends", "nobody"].includes(body.exchanges) ||
    typeof body.push !== "boolean"
  )
    throw fail("Réglages invalides");
  return tx(pool, [user], async (c) => {
    await c.query(
      "UPDATE users SET collect_visibility=$2,collect_profile_public=($2='public'),collect_exchange_policy=$3,collect_social_push=$4 WHERE id=$1",
      [user, body.visibility, body.exchanges, body.push],
    );
    return {
      visibility: body.visibility,
      exchanges: body.exchanges,
      push: body.push,
    };
  });
}
async function friends(pool, user) {
  const rows = (
    await pool.query(
      `SELECT u.id,u.username,u.avatar,f.state,f.requester_id=$1 AS outgoing
 FROM collect_friendships f JOIN users u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END
 WHERE $1 IN(f.low_id,f.high_id) ORDER BY f.state,u.username`,
      [user],
    )
  ).rows;
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      visible: await canView(pool, user, row.id),
    })),
  );
}
async function friendAction(pool, user, target, action) {
  target = id(target);
  if (String(user) === target) throw fail("Choisis un autre joueur");
  return tx(pool, [user, target], async (c) => {
    const r = await relation(c, user, target);
    if (r.blocked) throw fail("Interaction indisponible", 403);
    const args = [user, target];
    const f = (
      await c.query(
        "SELECT * FROM collect_friendships WHERE low_id=LEAST($1::int,$2::int) AND high_id=GREATEST($1::int,$2::int) FOR UPDATE",
        args,
      )
    ).rows[0];
    if (action === "request") {
      if (f) return { state: f.state };
      await c.query(
        "INSERT INTO collect_friendships(low_id,high_id,requester_id,state) VALUES(LEAST($1::int,$2::int),GREATEST($1::int,$2::int),$1,'pending')",
        args,
      );
      await notify(
        c,
        target,
        `friend-request:${user}:${target}:${Date.now()}`,
        "friend_request",
        { userId: user },
      );
      return { state: "pending" };
    }
    if (!f) throw fail("Demande introuvable", 404);
    if (action === "accept") {
      if (f.state !== "pending" || String(f.requester_id) === String(user))
        throw fail("Seul le destinataire peut accepter", 403);
      await c.query(
        "UPDATE collect_friendships SET state='accepted' WHERE low_id=$1 AND high_id=$2",
        [f.low_id, f.high_id],
      );
      await notify(
        c,
        target,
        `friend-accepted:${f.low_id}:${f.high_id}:${f.created_at.toISOString()}`,
        "friend_accepted",
        { userId: user },
      );
      return { state: "accepted" };
    }
    if (action !== "remove") throw fail("Action invalide");
    await c.query(
      "DELETE FROM collect_friendships WHERE low_id=$1 AND high_id=$2",
      [f.low_id, f.high_id],
    );
    return { removed: true };
  });
}
async function block(pool, user, target, blocked) {
  target = id(target);
  if (String(user) === target) throw fail("Choisis un autre joueur");
  return tx(pool, [user, target], async (c) => {
    if (blocked) {
      await c.query(
        "INSERT INTO collect_blocks(user_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [user, target],
      );
      await c.query(
        "DELETE FROM collect_friendships WHERE low_id=LEAST($1::int,$2::int) AND high_id=GREATEST($1::int,$2::int)",
        [user, target],
      );
      await c.query(
        "UPDATE collect_trade_offers SET state='invalid' WHERE state='active' AND ((maker_id=$1 AND receiver_id=$2) OR(maker_id=$2 AND receiver_id=$1))",
        [user, target],
      );
    } else
      await c.query(
        "DELETE FROM collect_blocks WHERE user_id=$1 AND blocked_id=$2",
        [user, target],
      );
    return { blocked };
  });
}
async function blockedUsers(pool, user) {
  return (
    await pool.query(
      "SELECT u.id,u.username FROM collect_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=$1 ORDER BY u.username",
      [user],
    )
  ).rows;
}
async function cardSetting(pool, user, card, body) {
  card = id(card);
  if (
    !body ||
    ["locked", "hidden", "open", "wanted"].some(
      (k) => typeof body[k] !== "boolean",
    )
  )
    throw fail("Réglages de carte invalides");
  return tx(pool, [user], async (c) => {
    if (
      !(await c.query("SELECT id FROM cards WHERE id=$1", [card])).rows.length
    )
      throw fail("Carte introuvable", 404);
    await c.query(
      `INSERT INTO collect_card_social_settings(user_id,card_id,locked,hidden,open_to_offers,wanted) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(user_id,card_id) DO UPDATE SET locked=EXCLUDED.locked,hidden=EXCLUDED.hidden,open_to_offers=EXCLUDED.open_to_offers,wanted=EXCLUDED.wanted`,
      [user, card, body.locked, body.hidden, body.open, body.wanted],
    );
    await invalidate(c, [user]);
    return body;
  });
}
async function copies(c, user, selected, lock = false) {
  const rows = (
    await c.query(
      `SELECT cp.*,COALESCE(m.canonical_card_id,cp.card_id) AS canonical_id,c.name,c.family,c.status,
 CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS rarity,
 COALESCE(s.locked,FALSE) AS card_locked
 FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
 JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
 LEFT JOIN collect_card_social_settings s ON s.user_id=cp.user_id AND s.card_id=c.id
 WHERE cp.id=ANY($1::bigint[]) ORDER BY cp.id ${lock ? "FOR UPDATE OF cp" : ""}`,
      [selected],
    )
  ).rows;
  if (
    rows.length !== selected.length ||
    rows.some((r) => String(r.user_id) !== String(user))
  )
    throw fail("Un exemplaire n’est plus disponible", 409);
  if (rows.some((r) => r.locked || r.card_locked))
    throw fail("Un exemplaire est verrouillé", 409);
  return rows;
}
function quantities(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = String(r.canonical_id);
    const item = map.get(key) || { cardId: key, quantity: 0 };
    item.quantity++;
    map.set(key, item);
  }
  return [...map.values()];
}
function requirements(value) {
  if (!Array.isArray(value) || value.length > 10000)
    throw fail("Cartes recherchées invalides");
  const out = value.map((v) => ({
    cardId: id(v.cardId),
    quantity: Number(v.quantity),
  }));
  if (
    out.some(
      (v) =>
        !Number.isInteger(v.quantity) || v.quantity < 1 || v.quantity > 10000,
    ) ||
    out.reduce((n, v) => n + v.quantity, 0) > 10000 ||
    new Set(out.map((v) => v.cardId)).size !== out.length
  )
    throw fail("Quantités invalides");
  return out;
}
function sameRequirements(a, b) {
  return (
    JSON.stringify(
      [...a].sort((x, y) => (BigInt(x.cardId) < BigInt(y.cardId) ? -1 : 1)),
    ) ===
    JSON.stringify(
      [...b].sort((x, y) => (BigInt(x.cardId) < BigInt(y.cardId) ? -1 : 1)),
    )
  );
}
async function invalidate(c, users, changedIds = []) {
  await c.query(
    `UPDATE collect_trade_offers o SET state='invalid' WHERE state='active' AND kind='direct'
 AND (maker_id=ANY($1::int[]) OR receiver_id=ANY($1::int[]) OR offered_ids&&$2::bigint[] OR requested_ids&&$2::bigint[])
 AND (EXISTS(SELECT 1 FROM unnest(offered_ids) i(id) LEFT JOIN card_copies cp ON cp.id=i.id LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id LEFT JOIN collect_card_social_settings s ON s.user_id=cp.user_id AND s.card_id=COALESCE(m.canonical_card_id,cp.card_id) WHERE cp.id IS NULL OR cp.user_id<>o.maker_id OR cp.locked OR COALESCE(s.locked,FALSE))
 OR EXISTS(SELECT 1 FROM unnest(requested_ids) i(id) LEFT JOIN card_copies cp ON cp.id=i.id LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id LEFT JOIN collect_card_social_settings s ON s.user_id=cp.user_id AND s.card_id=COALESCE(m.canonical_card_id,cp.card_id) WHERE cp.id IS NULL OR cp.user_id<>o.receiver_id OR cp.locked OR COALESCE(s.locked,FALSE)))`,
    [users, changedIds],
  );
  await c.query(
    `UPDATE collect_trade_offers o SET state='invalid' WHERE state='active' AND kind='market' AND maker_id=ANY($1::int[]) AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(offered_cards) item WHERE (SELECT COUNT(*) FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id LEFT JOIN collect_card_social_settings s ON s.user_id=cp.user_id AND s.card_id=COALESCE(m.canonical_card_id,cp.card_id)
 WHERE cp.user_id=o.maker_id AND COALESCE(m.canonical_card_id,cp.card_id)=(item->>'cardId')::bigint AND NOT cp.locked AND NOT COALESCE(s.locked,FALSE))<(item->>'quantity')::integer)`,
    [users],
  );
}
async function lockCopy(pool, user, copy, locked) {
  if (typeof locked !== "boolean") throw fail("Verrouillage invalide");
  copy = id(copy);
  return tx(pool, [user], async (c) => {
    const result = await c.query(
      "UPDATE card_copies SET locked=$3 WHERE id=$1 AND user_id=$2 RETURNING id",
      [copy, user, locked],
    );
    if (!result.rows.length) throw fail("Exemplaire introuvable", 404);
    await invalidate(c, [user], [copy]);
    return { locked };
  });
}
async function destroy(pool, user, selected, confirmed) {
  selected = ids(selected);
  if (confirmed !== true) throw fail("Confirme la destruction définitive");
  return tx(pool, [user], async (c) => {
    await copies(c, user, selected, true);
    await c.query(
      "DELETE FROM card_copies WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [user, selected],
    );
    await invalidate(c, [user], selected);
    return { destroyed: selected.length };
  });
}
async function inventory(pool, viewer, target, query = {}, unpaged = false) {
  target = id(target);
  await view(pool, viewer, target);
  const cardId = query.cardId ? id(query.cardId) : null;
  const page = Number(query.page || 1),
    search = String(query.search || "").trim(),
    filter = String(query.filter || "all");
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    search.length > 100 ||
    ![
      "all",
      "available",
      "wanted",
      "missing",
      "earned",
      "trade",
      "owned",
    ].includes(filter)
  )
    throw fail("Filtres invalides");
  const rows = (
    await pool.query(
      `WITH inv AS(SELECT c.id,c.name,c.family,c.status,c.collection_number,
 CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS rarity,COALESCE(c.image_override,c.image_reference) AS image_reference,
 COALESCE(s.locked,FALSE) AS locked,COALESCE(s.hidden,FALSE) AS hidden,COALESCE(s.open_to_offers,FALSE) AS open,COALESCE(s.wanted,FALSE) AS wanted,
 COUNT(cp.id)::int AS count,COUNT(cp.id) FILTER(WHERE cp.acquisition='earned')::int AS earned,
 COUNT(cp.id) FILTER(WHERE NOT cp.locked)::int AS unlocked,
 COALESCE(jsonb_agg(jsonb_build_object('id',cp.id::text,'source',cp.source,'dailyDate',cp.daily_date,'dailyAttemptCount',cp.daily_attempt_count,'originAt',cp.obtained_at,'acquiredAt',cp.acquired_at,'acquisition',cp.acquisition,'locked',cp.locked) ORDER BY cp.id) FILTER(WHERE cp.id IS NOT NULL),'[]') AS copies
 FROM cards c LEFT JOIN collect_card_merges merged ON merged.source_card_id=c.id
 LEFT JOIN card_copies cp ON cp.user_id=$1 AND(cp.card_id=c.id OR cp.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))
 LEFT JOIN collect_card_social_settings s ON s.user_id=$1 AND s.card_id=c.id
 WHERE merged.source_card_id IS NULL AND(c.status='active' OR cp.id IS NOT NULL) GROUP BY c.id,s.locked,s.hidden,s.open_to_offers,s.wanted), filtered AS(
 SELECT *,NOT locked AND NOT hidden AND unlocked>0 AND(count>=2 OR open) AS available FROM inv)
 SELECT *,COUNT(*) OVER()::int AS total FROM filtered WHERE ($6::bigint IS NULL OR id=$6) AND ($2='' OR name ILIKE '%'||$2||'%')
 AND($3='all' OR($3='owned' AND count>0) OR($3='available' AND available) OR($3='wanted' AND wanted) OR($3='missing' AND count=0) OR($3='earned' AND earned>0) OR($3='trade' AND count>earned))
 ORDER BY family,name,id LIMIT $5 OFFSET $4`,
      [target, search, filter, (page - 1) * 50, unpaged ? 6000 : 50, cardId],
    )
  ).rows;
  const self = String(viewer) === String(target),
    r = await relation(pool, viewer, target);
  const permitted = self
    ? r.collect_exchange_policy !== "nobody"
    : !r.blocked &&
      (r.collect_exchange_policy === "everyone" ||
        (r.collect_exchange_policy === "friends" && r.friend));
  return {
    cards: rows.map(({ total: _total, ...r }) => ({
      ...r,
      ...require("../collect/image-urls").imageVariants(
        r.count ? r.image_reference : null,
      ),
      available: r.available && permitted,
      copies: self
        ? r.copies
        : r.copies.map(({ acquisition: _a, acquiredAt: _b, ...copy }) => copy),
    })),
    total: rows[0]?.total || 0,
    page,
    pageSize: 50,
  };
}
async function cardSettings(pool, user, card) {
  return (
    (
      await pool.query(
        "SELECT locked,hidden,open_to_offers AS open,wanted FROM collect_card_social_settings WHERE user_id=$1 AND card_id=$2",
        [user, id(card)],
      )
    ).rows[0] || { locked: false, hidden: false, open: false, wanted: false }
  );
}
async function owners(pool, viewer, card) {
  const rows = (
    await pool.query(
      `SELECT u.id,u.username,u.avatar FROM users u JOIN card_copies cp ON cp.user_id=u.id LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
 LEFT JOIN collect_card_social_settings s ON s.user_id=u.id AND s.card_id=$1
 WHERE COALESCE(m.canonical_card_id,cp.card_id)=$1 AND NOT cp.locked AND NOT COALESCE(s.locked,FALSE) AND NOT COALESCE(s.hidden,FALSE)
 GROUP BY u.id,s.open_to_offers HAVING (SELECT COUNT(*) FROM card_copies allcp LEFT JOIN collect_card_merges allm ON allm.source_card_id=allcp.card_id WHERE allcp.user_id=u.id AND COALESCE(allm.canonical_card_id,allcp.card_id)=$1)>1 OR COALESCE(s.open_to_offers,FALSE) ORDER BY u.username LIMIT 100`,
      [id(card)],
    )
  ).rows;
  const allowed = [];
  for (const r of rows) {
    if (String(r.id) === String(viewer)) continue;
    if (!(await canView(pool, viewer, r.id))) continue;
    try {
      await exchange(pool, viewer, r.id);
      allowed.push(r);
    } catch {
      /* Policy hides availability. */
    }
  }
  return allowed;
}
async function matching(pool, user, target) {
  await view(pool, user, target);
  await exchange(pool, user, target);
  const [mineData, theirData] = await Promise.all([
    inventory(pool, user, user, {}, true),
    inventory(pool, user, target, {}, true),
  ]);
  const mine = mineData.cards,
    theirs = theirData.cards;
  const other = new Map(theirs.map((c) => [String(c.id), c])),
    self = new Map(mine.map((c) => [String(c.id), c]));
  return {
    give: mine.filter(
      (c) =>
        c.available &&
        (other.get(String(c.id))?.wanted || !other.get(String(c.id))?.count),
    ),
    receive: theirs.filter(
      (c) =>
        c.available &&
        (self.get(String(c.id))?.wanted || !self.get(String(c.id))?.count),
    ),
  };
}
async function tick(pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const expired = (
      await c.query(
        "UPDATE collect_trade_offers SET state='expired' WHERE state='active' AND expires_at<=NOW() RETURNING *",
      )
    ).rows;
    for (const o of expired)
      for (const u of [o.maker_id, o.receiver_id].filter(Boolean))
        await notify(c, u, `offer-expired:${o.id}`, "expired", {
          offerId: o.id,
        });
    const soon = (
      await c.query(
        "SELECT id,maker_id,receiver_id FROM collect_trade_offers WHERE state='active' AND expires_at>NOW() AND expires_at<=NOW()+INTERVAL '24 hours'",
      )
    ).rows;
    for (const o of soon)
      for (const u of [o.maker_id, o.receiver_id].filter(Boolean))
        await notify(c, u, `offer-reminder:${o.id}`, "reminder", {
          offerId: o.id,
        });
    await c.query("COMMIT");
    return { expired: expired.length };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function createOffer(pool, user, body) {
  const kind = body?.kind || "direct",
    requestId = uuid(body?.requestId),
    offered = ids(body?.offeredIds);
  if (!["direct", "market"].includes(kind)) throw fail("Type d’offre invalide");
  const receiver = kind === "direct" ? id(body.receiverId) : null,
    requested = kind === "direct" ? ids(body.requestedIds) : [];
  if (offered.some((v) => requested.includes(v)))
    throw fail("Un exemplaire figure des deux côtés");
  const wanted = kind === "market" ? requirements(body.wanted || []) : [],
    parent = body.parentId ? uuid(body.parentId) : null;
  await tick(pool);
  return tx(pool, [user, receiver], async (c) => {
    const prior = (
      await c.query("SELECT * FROM collect_trade_offers WHERE request_id=$1", [
        requestId,
      ])
    ).rows[0];
    if (prior) {
      if (String(prior.maker_id) !== String(user))
        throw fail("Requête déjà utilisée", 409);
      return prior;
    }
    let old = null;
    if (parent) {
      old = (
        await c.query(
          "SELECT * FROM collect_trade_offers WHERE id=$1 FOR UPDATE",
          [parent],
        )
      ).rows[0];
      if (!old || old.state !== "active" || old.expires_at <= new Date())
        throw fail("Offre clôturée", 409);
    }
    if (receiver) {
      await exchange(c, user, receiver);
      await view(c, user, receiver);
    }
    const given = await copies(c, user, offered, true);
    let received = [];
    if (receiver) received = await copies(c, receiver, requested, true);
    if (old) {
      if (old.kind === "direct") {
        if (
          String(old.receiver_id) !== String(user) ||
          String(old.maker_id) !== String(receiver)
        )
          throw fail("Contre-proposition non autorisée", 403);
        await c.query(
          "UPDATE collect_trade_offers SET state='countered' WHERE id=$1",
          [old.id],
        );
      } else {
        if (String(old.maker_id) !== String(receiver))
          throw fail("Destinataire incorrect");
        if (!sameRequirements(quantities(received), old.offered_cards))
          throw fail("Choisis les exemplaires de l’annonce");
        if (
          body.exact === true &&
          old.wanted_cards.length &&
          !sameRequirements(quantities(given), old.wanted_cards)
        )
          throw fail("Les cartes ne correspondent pas à l’offre précise");
      }
    }
    const count = Number(
      (
        await c.query(
          "SELECT COUNT(*) AS n FROM collect_trade_offers WHERE maker_id=$1 AND kind=$2 AND state='active' AND expires_at>NOW()",
          [user, kind],
        )
      ).rows[0].n,
    );
    if (count >= 25)
      throw fail(
        kind === "market"
          ? "25 annonces actives maximum"
          : "25 propositions actives maximum",
        409,
      );
    for (const item of wanted)
      if (
        !(await c.query("SELECT id FROM cards WHERE id=$1", [item.cardId])).rows
          .length
      )
        throw fail("Carte recherchée introuvable", 404);
    const result = (
      await c.query(
        `INSERT INTO collect_trade_offers(id,maker_id,receiver_id,kind,offered_ids,requested_ids,offered_cards,wanted_cards,parent_id,request_id)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) RETURNING *`,
        [
          crypto.randomUUID(),
          user,
          receiver,
          kind,
          offered,
          requested,
          JSON.stringify(quantities(given)),
          JSON.stringify(wanted),
          parent,
          requestId,
        ],
      )
    ).rows[0];
    if (receiver)
      await notify(
        c,
        receiver,
        `offer-new:${result.id}`,
        old ? "counter" : "proposal",
        { offerId: result.id, userId: user },
      );
    return result;
  });
}
async function offerAction(pool, user, offerId, action, confirmed) {
  offerId = uuid(offerId);
  await tick(pool);
  const initial = (
    await pool.query("SELECT * FROM collect_trade_offers WHERE id=$1", [
      offerId,
    ])
  ).rows[0];
  if (
    !initial ||
    ![initial.maker_id, initial.receiver_id].some(
      (v) => String(v) === String(user),
    )
  )
    throw fail("Offre introuvable", 404);
  return tx(pool, [initial.maker_id, initial.receiver_id], async (c) => {
    const o = (
      await c.query(
        "SELECT * FROM collect_trade_offers WHERE id=$1 FOR UPDATE",
        [offerId],
      )
    ).rows[0];
    if (
      action === "accept" &&
      o.state === "accepted" &&
      String(user) === String(o.receiver_id)
    )
      return {
        trade: (
          await c.query("SELECT * FROM collect_trades WHERE offer_id=$1", [
            o.id,
          ])
        ).rows[0],
        duplicate: true,
      };
    if (o.state !== "active" || o.expires_at <= new Date())
      throw fail("Offre clôturée", 409);
    if (action === "withdraw") {
      if (String(o.maker_id) !== String(user))
        throw fail("Seul l’auteur peut retirer", 403);
      await c.query(
        "UPDATE collect_trade_offers SET state='withdrawn' WHERE id=$1",
        [o.id],
      );
      return { state: "withdrawn" };
    }
    if (o.kind !== "direct" || String(o.receiver_id) !== String(user))
      throw fail("Seul le destinataire peut répondre", 403);
    if (action === "refuse") {
      await c.query(
        "UPDATE collect_trade_offers SET state='refused' WHERE id=$1",
        [o.id],
      );
      await notify(c, o.maker_id, `offer-refused:${o.id}`, "refused", {
        offerId: o.id,
      });
      return { state: "refused" };
    }
    if (action !== "accept" || confirmed !== true)
      throw fail("Confirme le récapitulatif de l’échange");
    await exchange(c, o.maker_id, o.receiver_id);
    await view(c, o.maker_id, o.receiver_id);
    const all = [...o.offered_ids, ...o.requested_ids]
      .map(String)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    await c.query(
      "SELECT id FROM card_copies WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [all],
    );
    const given = await copies(c, o.maker_id, o.offered_ids.map(String)),
      received = await copies(c, o.receiver_id, o.requested_ids.map(String));
    const tradeId = crypto.randomUUID(),
      summary = {
        given: given.map((r) => ({
          copyId: String(r.id),
          cardId: String(r.canonical_id),
          name: r.name,
          family: r.family,
          source: r.source,
          dailyDate: r.daily_date,
          dailyAttempts: r.daily_attempt_count,
        })),
        received: received.map((r) => ({
          copyId: String(r.id),
          cardId: String(r.canonical_id),
          name: r.name,
          family: r.family,
          source: r.source,
          dailyDate: r.daily_date,
          dailyAttempts: r.daily_attempt_count,
        })),
      };
    await c.query(
      "INSERT INTO collect_trades(id,offer_id,maker_id,receiver_id,summary) VALUES($1,$2,$3,$4,$5::jsonb)",
      [tradeId, o.id, o.maker_id, o.receiver_id, JSON.stringify(summary)],
    );
    for (const [rows, from, to] of [
      [given, o.maker_id, o.receiver_id],
      [received, o.receiver_id, o.maker_id],
    ]) {
      await c.query(
        "UPDATE card_copies SET user_id=$2,acquisition='trade',acquired_at=NOW() WHERE id=ANY($1::bigint[])",
        [rows.map((r) => r.id), to],
      );
      for (const r of rows)
        await c.query(
          "INSERT INTO collect_copy_transfers(trade_id,copy_id,card_id,from_id,to_id) VALUES($1,$2,$3,$4,$5)",
          [tradeId, r.id, r.canonical_id, from, to],
        );
    }
    await c.query(
      "UPDATE collect_trade_offers SET state='accepted' WHERE id=$1",
      [o.id],
    );
    await invalidate(c, [o.maker_id, o.receiver_id], all);
    for (const u of [o.maker_id, o.receiver_id])
      await notify(c, u, `offer-accepted:${o.id}`, "accepted", {
        offerId: o.id,
        tradeId,
      });
    const db = require("../../database");
    await db.awardCollectBadges?.(o.maker_id, c);
    await db.awardCollectBadges?.(o.receiver_id, c);
    return { tradeId, state: "accepted" };
  });
}
async function offerRows(pool, user, query = {}, market = false) {
  await tick(pool);
  const page = Number(query.page || 1),
    family = String(query.family || ""),
    rarity = Number(query.rarity || 0),
    offered = String(query.offered || ""),
    wanted = String(query.wanted || "");
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !["", "street", "district", "monument", "bus"].includes(family) ||
    !Number.isInteger(rarity) ||
    rarity < 0 ||
    rarity > 5 ||
    offered.length > 100 ||
    wanted.length > 100
  )
    throw fail("Filtres invalides");
  const rows = (
    await pool.query(
      `SELECT o.*,u.username AS maker_name,v.username AS receiver_name FROM collect_trade_offers o JOIN users u ON u.id=o.maker_id LEFT JOIN users v ON v.id=o.receiver_id
 WHERE ${market ? "o.kind='market' AND o.state='active' AND o.expires_at>NOW()" : "(o.maker_id=$1 OR o.receiver_id=$1)"}
 AND(NOT $7::boolean OR o.maker_id=$1 OR ((u.collect_visibility='public' OR(u.collect_visibility='friends' AND EXISTS(SELECT 1 FROM collect_friendships f WHERE f.low_id=LEAST($1::int,u.id) AND f.high_id=GREATEST($1::int,u.id) AND f.state='accepted'))) AND(u.collect_exchange_policy='everyone' OR(u.collect_exchange_policy='friends' AND EXISTS(SELECT 1 FROM collect_friendships f WHERE f.low_id=LEAST($1::int,u.id) AND f.high_id=GREATEST($1::int,u.id) AND f.state='accepted'))) AND NOT EXISTS(SELECT 1 FROM collect_blocks b WHERE(b.user_id=$1 AND b.blocked_id=u.id)OR(b.user_id=u.id AND b.blocked_id=$1))))
 AND($2='' OR EXISTS(SELECT 1 FROM jsonb_array_elements(offered_cards) item JOIN cards c ON c.id=(item->>'cardId')::bigint WHERE c.name ILIKE '%'||$2||'%'))
 AND($3='' OR EXISTS(SELECT 1 FROM jsonb_array_elements(wanted_cards) item JOIN cards c ON c.id=(item->>'cardId')::bigint WHERE c.name ILIKE '%'||$3||'%'))
 AND($4='' OR EXISTS(SELECT 1 FROM jsonb_array_elements(offered_cards) item JOIN cards c ON c.id=(item->>'cardId')::bigint WHERE c.family=$4))
 AND($5=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(offered_cards) item JOIN cards c ON c.id=(item->>'cardId')::bigint WHERE CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END=$5))
 ORDER BY o.created_at DESC,o.id LIMIT 50 OFFSET $6`,
      [user, offered, wanted, family, rarity, (page - 1) * 50, market],
    )
  ).rows;
  const out = [];
  for (const o of rows) {
    if (market && String(o.maker_id) !== String(user)) {
      if (!(await canView(pool, user, o.maker_id))) continue;
      try {
        await exchange(pool, user, o.maker_id);
      } catch {
        continue;
      }
    }
    const cardIds = [...o.offered_cards, ...o.wanted_cards].map(
      (v) => v.cardId,
    );
    const cards = cardIds.length
      ? (
          await pool.query(
            "SELECT id,name,family,status,CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END AS rarity FROM cards WHERE id=ANY($1::bigint[])",
            [cardIds],
          )
        ).rows
      : [];
    const selected = [...o.offered_ids, ...o.requested_ids];
    const snapshot = selected.length
      ? (
          await pool.query(
            `SELECT cp.id::text,COALESCE(m.canonical_card_id,cp.card_id)::text AS card_id,c.name,c.family,cp.source,cp.daily_date,cp.daily_attempt_count,cp.locked
   FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id) WHERE cp.id=ANY($1::bigint[]) AND cp.user_id=ANY($2::int[])`,
            [selected, [o.maker_id, o.receiver_id].filter(Boolean)],
          )
        ).rows
      : [];
    const last = [];
    if (o.kind === "direct" && o.state === "active")
      for (const owner of [o.maker_id, o.receiver_id]) {
        const taking = owner === o.maker_id ? o.offered_ids : o.requested_ids;
        const counts = (
          await pool.query(
            `SELECT c.id,c.name,COUNT(cp.id)::int AS owned,COUNT(cp.id) FILTER(WHERE cp.id=ANY($2::bigint[]))::int AS given FROM cards c JOIN card_copies cp ON cp.card_id=c.id OR cp.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id) WHERE cp.user_id=$1 GROUP BY c.id HAVING COUNT(cp.id)=COUNT(cp.id) FILTER(WHERE cp.id=ANY($2::bigint[]))`,
            [owner, taking],
          )
        ).rows;
        last.push(...counts.map((c) => ({ ...c, userId: owner })));
      }
    out.push({ ...o, cards, copies: snapshot, lastCopies: last });
  }
  return { offers: out, page, pageSize: 50 };
}
async function history(pool, user) {
  return (
    await pool.query(
      `SELECT t.id,t.executed_at,t.summary,t.maker_id=$1 AS maker,u.username AS other_name FROM collect_trades t LEFT JOIN users u ON u.id=CASE WHEN t.maker_id=$1 THEN t.receiver_id ELSE t.maker_id END WHERE $1 IN(t.maker_id,t.receiver_id) ORDER BY t.executed_at DESC LIMIT 100`,
      [user],
    )
  ).rows;
}
async function statistics(pool, card) {
  return (
    await pool.query(
      `SELECT
 (SELECT COUNT(*) FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id WHERE COALESCE(m.canonical_card_id,cp.card_id)=$1)::int AS circulation,
 (SELECT COUNT(DISTINCT cp.user_id) FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id WHERE COALESCE(m.canonical_card_id,cp.card_id)=$1)::int AS owners,
 (SELECT COUNT(DISTINCT trade_id) FROM collect_copy_transfers WHERE card_id=$1)::int AS trades,
 (SELECT COUNT(*) FROM collect_trade_offers WHERE state='active' AND expires_at>NOW() AND(EXISTS(SELECT 1 FROM jsonb_array_elements(offered_cards||wanted_cards) x WHERE(x->>'cardId')::bigint=$1) OR EXISTS(SELECT 1 FROM card_copies WHERE id=ANY(offered_ids||requested_ids) AND card_id=$1)))::int AS "activeOffers"`,
      [id(card)],
    )
  ).rows[0];
}
async function albumProgress(pool, viewer, target) {
  await view(pool, viewer, target);
  return (
    await pool.query(
      `SELECT a.id,a.slug,a.name,COUNT(DISTINCT c.id)::int AS total,
 COUNT(DISTINCT c.id) FILTER(WHERE cp.id IS NOT NULL)::int AS owned,
 COUNT(DISTINCT c.id) FILTER(WHERE cp.acquisition='earned')::int AS earned
 FROM albums a JOIN album_cards ac ON ac.album_id=a.id JOIN cards c ON c.id=ac.card_id AND c.status='active'
 LEFT JOIN card_copies cp ON cp.user_id=$1 AND(cp.card_id=c.id OR cp.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)) WHERE a.active GROUP BY a.id ORDER BY a.id`,
      [target],
    )
  ).rows;
}
async function personalProgress(pool, user) {
  return (
    await pool.query(
      `SELECT a.id,a.name,COUNT(DISTINCT ac.card_id)::int AS total,COUNT(DISTINCT ac.card_id) FILTER(WHERE cp.id IS NOT NULL)::int AS owned,COUNT(DISTINCT ac.card_id) FILTER(WHERE cp.acquisition='earned')::int AS earned FROM collect_personal_albums a LEFT JOIN collect_personal_album_cards ac ON ac.album_id=a.id LEFT JOIN card_copies cp ON cp.user_id=$1 AND(cp.card_id=ac.card_id OR cp.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=ac.card_id)) WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.id`,
      [user],
    )
  ).rows;
}
async function activity(pool, user) {
  const rows = (
    await pool.query(
      `SELECT a.*,u.username FROM collect_social_activity a JOIN users u ON u.id=a.user_id JOIN collect_friendships f ON f.low_id=LEAST($1::int,a.user_id) AND f.high_id=GREATEST($1::int,a.user_id) AND f.state='accepted' ORDER BY a.created_at DESC LIMIT 100`,
      [user],
    )
  ).rows;
  const out = [];
  for (const r of rows)
    if (await canView(pool, user, r.user_id)) {
      if (r.kind === "legendary")
        r.label = (
          await pool.query("SELECT name FROM cards WHERE id=$1", [
            r.payload.cardId,
          ])
        ).rows[0]?.name;
      if (r.kind === "album") {
        const album = (
          await pool.query("SELECT name,slug FROM albums WHERE id=$1", [
            r.payload.albumId,
          ])
        ).rows[0];
        r.label = album?.name;
        r.albumSlug = album?.slug;
      }
      if (r.kind === "badge")
        r.label = (
          await pool.query("SELECT name FROM collect_badges WHERE id=$1", [
            r.payload.badgeId,
          ])
        ).rows[0]?.name;
      out.push(r);
    }
  return out;
}
async function notifications(pool, user) {
  await tick(pool);
  return (
    await pool.query(
      "SELECT id,kind,payload,created_at,read_at FROM collect_social_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user],
    )
  ).rows;
}
async function markRead(pool, user, notification) {
  await pool.query(
    "UPDATE collect_social_notifications SET read_at=NOW() WHERE user_id=$1 AND id=$2",
    [user, id(notification)],
  );
  return { read: true };
}
async function report(pool, user, target, body) {
  target = id(target);
  if (
    String(user) === target ||
    !["spam", "harassment", "circumvention", "content"].includes(body?.reason)
  )
    throw fail("Signalement invalide");
  await relation(pool, user, target);
  const offer = body.offerId ? uuid(body.offerId) : null;
  if (offer) {
    const o = (
      await pool.query("SELECT * FROM collect_trade_offers WHERE id=$1", [
        offer,
      ])
    ).rows[0];
    if (
      !o ||
      ![o.maker_id, o.receiver_id].some((v) => String(v) === String(target)) ||
      (![o.maker_id, o.receiver_id].some((v) => String(v) === String(user)) &&
        (o.kind !== "market" || !(await canView(pool, user, o.maker_id))))
    )
      throw fail("Offre introuvable", 404);
  }
  await pool.query(
    "INSERT INTO collect_social_reports(reporter_id,reported_id,reason,offer_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [user, target, body.reason, offer],
  );
  return { reported: true };
}
async function adminReports(pool) {
  return (
    await pool.query(
      "SELECT r.*,u.username AS reported_name,v.username AS reporter_name FROM collect_social_reports r LEFT JOIN users u ON u.id=r.reported_id LEFT JOIN users v ON v.id=r.reporter_id WHERE resolved_at IS NULL ORDER BY created_at LIMIT 100",
    )
  ).rows;
}
module.exports = {
  schemaEnabled,
  markMigrated,
  enabled,
  id,
  uuid,
  ids,
  fail,
  tx,
  relation,
  canView,
  view,
  exchange,
  notify,
  usernameId,
  settings,
  friends,
  friendAction,
  block,
  blockedUsers,
  cardSetting,
  cardSettings,
  lockCopy,
  destroy,
  inventory,
  owners,
  matching,
  tick,
  createOffer,
  offerAction,
  offerRows,
  history,
  statistics,
  albumProgress,
  personalProgress,
  activity,
  notifications,
  markRead,
  report,
  adminReports,
};
