"use strict";
const { pool } = require("./database");
const crypto = require("node:crypto");
const {
  DEFAULT_FAMILY_WEIGHTS,
  STREET_GROUP_WEIGHTS,
  rarityDrawWeights,
  chooseFamily,
  resolveStreetGroups,
  rewardDecision,
} = require("./domains/collect/rules");
async function getCollectQuota(userId, client = pool) {
  const quotaTable = require("./domains/collect-social/service").schemaEnabled()
    ? "collect_awards"
    : "card_copies";
  const result = await client.query(
    `WITH config AS (
       SELECT COALESCE((value_json->>'copies')::int, 4) AS quota_limit,
              COALESCE((value_json->>'window_minutes')::int, 20) AS window_minutes
       FROM collect_config WHERE key = 'reward_quota'
     )
     SELECT COUNT(cp.id)::int AS copies,
            (SELECT MIN(cp2.obtained_at + make_interval(mins => config.window_minutes))
             FROM ${quotaTable} cp2
             WHERE cp2.user_id = $1 AND cp2.source = 'collect'
               AND cp2.obtained_at > clock_timestamp() - make_interval(mins => config.window_minutes)) AS next_available_at,
            config.quota_limit AS quota_limit, config.window_minutes
     FROM config LEFT JOIN ${quotaTable} cp ON cp.user_id = $1 AND cp.source = 'collect'
       AND cp.obtained_at > clock_timestamp() - make_interval(mins => config.window_minutes)
     GROUP BY config.quota_limit, config.window_minutes`,
    [userId],
  );
  const row = result.rows[0] || {};
  return {
    copies: Number(row.copies || 0),
    limit: Number(row.quota_limit || 4),
    windowMinutes: Number(row.window_minutes || 20),
    nextAvailableAt: row.next_available_at || null,
  };
}

async function recordCollectQuotaFull(userId, copyId, dueAt, client = pool) {
  await client.query(
    `INSERT INTO collect_quota_notifications (user_id, cycle_copy_id, due_at, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       cycle_copy_id = EXCLUDED.cycle_copy_id,
       due_at = EXCLUDED.due_at,
       released_at = NULL,
       seen_at = NULL,
       updated_at = NOW()`,
    [userId, copyId, dueAt],
  );
}

// The first expired card in a full cycle is the only release event. The row
// survives process restarts and later expirations cannot produce a new event.
async function releaseDueCollectQuotas(client = pool) {
  const quotaTable = require("./domains/collect-social/service").schemaEnabled()
    ? "collect_awards"
    : "card_copies";
  const result = await client.query(
    `UPDATE collect_quota_notifications n
     SET released_at = NOW(),
         seen_at = CASE WHEN n.active_until > NOW() THEN NOW() ELSE n.seen_at END,
         updated_at = NOW()
     WHERE n.released_at IS NULL AND n.due_at <= NOW()
       AND (SELECT COUNT(*) FROM ${quotaTable} cp
            WHERE cp.user_id = n.user_id AND cp.source = 'collect'
              AND cp.obtained_at > NOW() - INTERVAL '20 minutes') < 4
     RETURNING n.user_id`,
  );
  return result.rowCount;
}

async function getCollectNotificationStatus(userId, { opened = false } = {}) {
  await releaseDueCollectQuotas();
  if (opened) {
    await pool.query(
      `UPDATE collect_quota_notifications
       SET seen_at = CASE WHEN released_at IS NOT NULL THEN COALESCE(seen_at, NOW()) ELSE seen_at END,
           active_until = NOW() + INTERVAL '45 seconds', updated_at = NOW()
       WHERE user_id = $1`,
      [userId],
    );
  }
  const result = await pool.query(
    `SELECT cycle_copy_id, due_at, prompted_at, push_enabled, released_at,
            released_at IS NOT NULL AND seen_at IS NULL AS badge
     FROM collect_quota_notifications WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0] || {};
  const activeCycle = Boolean(row.cycle_copy_id && !row.released_at);
  const quota = activeCycle ? await getCollectQuota(userId) : null;
  return {
    badge: Boolean(row.badge),
    full: Boolean(activeCycle && quota.copies >= quota.limit),
    prompted: Boolean(row.prompted_at),
    pushEnabled: Boolean(row.push_enabled),
    dueAt: row.due_at || null,
  };
}

async function markCollectNotificationPrompted(userId) {
  await pool.query(
    `INSERT INTO collect_quota_notifications(user_id, prompted_at) VALUES ($1, NOW())
     ON CONFLICT (user_id) DO UPDATE SET prompted_at = COALESCE(collect_quota_notifications.prompted_at, NOW()), updated_at = NOW()`,
    [userId],
  );
}

async function setCollectNotificationPreference(userId, enabled) {
  await pool.query(
    `INSERT INTO collect_quota_notifications(user_id, push_enabled, prompted_at)
     VALUES ($1, $2, CASE WHEN $2 THEN NOW() ELSE NULL END)
     ON CONFLICT(user_id) DO UPDATE SET push_enabled = EXCLUDED.push_enabled,
       prompted_at = CASE WHEN EXCLUDED.push_enabled THEN COALESCE(collect_quota_notifications.prompted_at, NOW())
         ELSE collect_quota_notifications.prompted_at END, updated_at = NOW()`,
    [userId, Boolean(enabled)],
  );
}

async function touchCollectNotificationPresence(userId) {
  await pool.query(
    `UPDATE collect_quota_notifications
     SET active_until = NOW() + INTERVAL '45 seconds',
         seen_at = CASE WHEN released_at IS NOT NULL THEN COALESCE(seen_at, NOW()) ELSE seen_at END
     WHERE user_id = $1`,
    [userId],
  );
}

async function clearCollectNotificationPresence(userId) {
  await pool.query(
    `UPDATE collect_quota_notifications SET active_until = NULL WHERE user_id = $1`,
    [userId],
  );
}

async function claimCollectPushDeliveries(vapidPublicKey) {
  await releaseDueCollectQuotas();
  await pool.query(
    `INSERT INTO collect_quota_push_deliveries(cycle_copy_id, endpoint)
     SELECT n.cycle_copy_id, ps.endpoint
     FROM collect_quota_notifications n
     JOIN push_subscriptions ps ON ps.user_id = n.user_id
     WHERE n.released_at IS NOT NULL AND n.seen_at IS NULL
       AND n.push_enabled = TRUE AND ps.enabled = TRUE AND ps.collect_enabled = TRUE
       AND (ps.vapid_public_key IS NULL OR ps.vapid_public_key = $1)
     ON CONFLICT DO NOTHING`,
    [vapidPublicKey],
  );
  const result = await pool.query(
    `WITH candidates AS (
       SELECT n.user_id, n.cycle_copy_id, ps.endpoint, ps.subscription_json
       FROM collect_quota_notifications n
       JOIN push_subscriptions ps ON ps.user_id = n.user_id
       WHERE n.released_at IS NOT NULL AND n.seen_at IS NULL
         AND n.push_enabled = TRUE AND ps.enabled = TRUE AND ps.collect_enabled = TRUE
         AND (ps.vapid_public_key IS NULL OR ps.vapid_public_key = $1)
     )
     UPDATE collect_quota_push_deliveries d
     SET claimed_at = NOW()
     FROM candidates c
     WHERE d.cycle_copy_id = c.cycle_copy_id AND d.endpoint = c.endpoint
       AND d.sent_at IS NULL
       AND (d.claimed_at IS NULL OR d.claimed_at < NOW() - INTERVAL '2 minutes')
     RETURNING c.user_id, d.cycle_copy_id, d.endpoint, c.subscription_json`,
    [vapidPublicKey],
  );
  return result.rows;
}

async function markCollectPushDelivery(cycleCopyId, endpoint, sent) {
  await pool.query(
    `UPDATE collect_quota_push_deliveries
     SET sent_at = CASE WHEN $3 THEN NOW() ELSE sent_at END,
         claimed_at = CASE WHEN $3 THEN claimed_at ELSE NULL END
     WHERE cycle_copy_id = $1 AND endpoint = $2`,
    [cycleCopyId, endpoint, Boolean(sent)],
  );
}

function collectCardContent(card) {
  const details = require("./domains/collect/catalog-details").cardDetails(
    card.family,
    card.source_entity_id || card.name,
  );
  return {
    ...require("./domains/collect/image-urls").imageVariants(
      card.image_override || card.image_reference,
    ),
    image_attribution: card.image_override
      ? { source: "custom", author: card.image_credit_override || "" }
      : require("./domains/collect/illustrations").illustrationFor(
          card.family,
          card.source_entity_id || card.name,
        ),
    description: card.description_override ?? details.short_description,
    short_description: card.description_override ?? details.short_description,
    description_full:
      card.description_full_override ||
      (card.description_override
        ? `${card.description_override} ${details.detailed_description}`
        : details.description_full),
    wikipedia_url: require("./domains/collect/wikipedia-link").wikipediaLink(
      card.family,
      card.source_entity_id,
    ),
    location_label: details.location_label,
    location_full: details.location_full || details.location_label,
    description_source:
      card.description_override !== null &&
      card.description_override !== undefined
        ? null
        : details.description_source,
  };
}

async function saveCollectCardContent(cardId, body, client = pool) {
  if (
    !body ||
    !["image", "description", "credit"].every((key) =>
      Object.hasOwn(body, key),
    ) ||
    Object.keys(body).some(
      (key) =>
        !["image", "description", "descriptionFull", "credit"].includes(key),
    )
  )
    throw Object.assign(new Error("Contenu invalide"), {
      code: "INVALID_CARD_CONTENT",
    });
  const values = {};
  for (const [key, limit] of [
    ["image", 2048],
    ["description", 1000],
    ["credit", 500],
  ]) {
    if (
      body[key] !== null &&
      (typeof body[key] !== "string" || body[key].length > limit)
    )
      throw Object.assign(new Error("Contenu trop long ou invalide"), {
        code: "INVALID_CARD_CONTENT",
      });
    values[key] = body[key]?.trim() || null;
  }
  if (values.image && !/^\/(?!\/)[^\s\\]+$/.test(values.image)) {
    try {
      const url = new URL(values.image);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
    } catch (_error) {
      throw Object.assign(
        new Error(
          "Utilise une adresse d’image HTTPS ou un chemin local valide.",
        ),
        { code: "INVALID_CARD_CONTENT" },
      );
    }
  }
  const hasFull = Object.hasOwn(body, "descriptionFull");
  if (
    hasFull &&
    body.descriptionFull !== null &&
    (typeof body.descriptionFull !== "string" ||
      body.descriptionFull.length > 4000)
  )
    throw Object.assign(
      new Error("Description détaillée invalide (4 000 caractères maximum)."),
      { code: "INVALID_CARD_CONTENT" },
    );
  const result = await client.query(
    "UPDATE cards SET image_override=$2,description_override=$3,image_credit_override=$4,description_full_override=CASE WHEN $5 THEN $6 ELSE description_full_override END WHERE id=$1 RETURNING *",
    [
      cardId,
      values.image,
      values.description,
      values.credit,
      hasFull,
      body.descriptionFull?.trim() || null,
    ],
  );
  return result.rows[0]
    ? { ...result.rows[0], ...collectCardContent(result.rows[0]) }
    : null;
}

async function drawCollectGame(userId, random, streetGroups, client) {
  if (!streetGroups) {
    const { FAMOUS_STREET_NAMES, MAIN_STREET_NAMES } = require("../data_rules");
    streetGroups = resolveStreetGroups(require("./data/streets_index.json"), {
      famousStreets: [...FAMOUS_STREET_NAMES],
      mainStreets: [...MAIN_STREET_NAMES],
    });
  }
  const configResult = await client.query(
    "SELECT key, value_json FROM collect_config WHERE key IN ('family_weights', 'street_category_weights', 'rarity_draw_weights')",
  );
  const config = Object.fromEntries(
    configResult.rows.map((row) => [row.key, row.value_json]),
  );
  const weights = {
    ...DEFAULT_FAMILY_WEIGHTS,
    ...(config.family_weights || {}),
  };
  const rarityWeights = rarityDrawWeights(config.rarity_draw_weights);
  const family = chooseFamily(weights, random);
  const streetGroup =
    family === "street"
      ? chooseFamily(
          {
            ...STREET_GROUP_WEIGHTS,
            ...(config.street_category_weights || {}),
          },
          random,
        )
      : null;
  let cardResult = await client.query(
    `SELECT id, family, source_entity_id, collection_number, name, image_reference, image_override, description_override, image_credit_override, current_rarity, fragments_enabled
     FROM cards WHERE family = $1 AND status = 'active' AND catalog_present
       AND ($2::text IS NULL OR (CASE
         WHEN source_entity_id = ANY($3::text[]) THEN 'famous'
         WHEN source_entity_id = ANY($4::text[]) THEN 'main'
         ELSE 'other' END) = $2)
     ORDER BY -LN(GREATEST(RANDOM(), 1e-12)) /
       ($5::double precision[])[CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END] LIMIT 1`,
    [
      family,
      streetGroup,
      streetGroups.famous,
      streetGroups.main,
      rarityWeights,
    ],
  );
  // Archiving can empty a street category. Keep that family playable.
  if (!cardResult.rows.length && family === "street") {
    cardResult = await client.query(
      `SELECT * FROM cards WHERE family='street' AND status='active' AND catalog_present
      ORDER BY -LN(GREATEST(RANDOM(), 1e-12)) /
        ($1::double precision[])[CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END] LIMIT 1`,
      [rarityWeights],
    );
  }
  if (!cardResult.rows.length)
    throw new Error(`collect_family_empty:${family}`);
  const card = cardResult.rows[0];
  const gameId = crypto.randomUUID();
  const maxAttempts =
    require("./domains/collect/game-hints").placementAttemptLimit(
      card.family,
      require("./domains/collect/game-hints").attemptsForRarity(
        card.fragments_enabled ? 5 : card.current_rarity,
      ),
      card.name,
    );
  await client.query(
    "INSERT INTO collect_games(id, user_id, card_id, max_attempts) VALUES ($1, $2, $3, $4)",
    [gameId, userId, card.id, maxAttempts],
  );
  const quota = await getCollectQuota(userId, client);
  return {
    gameId,
    maxAttempts,
    guesses: [],
    card: {
      family: card.family,
      name: card.name,
      imageReference:
        collectCardContent(card).image_reference || "/apple-touch-icon.png",
      imageAttribution: collectCardContent(card).image_attribution,
    },
    quota,
  };
}

async function collectGamePayload(client, row, userId) {
  const content = collectCardContent(row);
  return {
    gameId: row.game_id || row.id,
    resumed: true,
    maxAttempts: require("./domains/collect/game-hints").placementAttemptLimit(
      row.family,
      Number(row.max_attempts) || 1,
      row.name,
    ),
    guesses: (row.placement_guesses || []).map(
      ({ answerEntityId, answerName, feedback, correct }) => ({
        answerEntityId,
        answerName,
        feedback,
        correct,
      }),
    ),
    card: {
      family: row.family,
      name: row.name,
      imageReference: content.image_reference || "/apple-touch-icon.png",
      imageAttribution: content.image_attribution,
    },
    ...(row.question_snapshot
      ? { questionPayload: publicCollectQuestion(row.question_snapshot) }
      : {}),
    quota: await getCollectQuota(userId, client),
  };
}
async function abandonCollectGame(userId, gameId, client = pool) {
  const result = await client.query(
    `UPDATE collect_games SET finished_at=NOW(),abandoned=TRUE,
    result_json=jsonb_build_object('correct',FALSE,'rewardGranted',FALSE,'abandoned',TRUE)
    WHERE user_id=$1 AND id=$2 AND finished_at IS NULL RETURNING card_id`,
    [userId, gameId],
  );
  if (result.rows.length) {
    await client.query(
      `INSERT INTO collect_attempts(user_id,card_id,correct,reward_available,reward_granted,request_id)
      VALUES($1,$2,FALSE,FALSE,FALSE,$3) ON CONFLICT(request_id) DO NOTHING`,
      [userId, result.rows[0].card_id, gameId],
    );
    await client.query(
      `INSERT INTO collect_events(user_id,game_id,kind) VALUES($1,$2,'abandon') ON CONFLICT DO NOTHING`,
      [userId, gameId],
    );
  }
  return { abandoned: result.rows.length > 0 };
}
async function getPendingCollectGame(userId, client = pool) {
  const expired = await client.query(
    `SELECT id FROM collect_games WHERE user_id=$1 AND finished_at IS NULL
    AND started_at<NOW()-INTERVAL '30 minutes'`,
    [userId],
  );
  for (const row of expired.rows)
    await abandonCollectGame(userId, row.id, client);
  const pending = await client.query(
    `SELECT g.id AS game_id,g.question_snapshot,g.max_attempts,g.placement_guesses,c.* FROM collect_games g JOIN cards c ON c.id=g.card_id
    WHERE g.user_id=$1 AND g.finished_at IS NULL ORDER BY g.started_at DESC LIMIT 1`,
    [userId],
  );
  if (!pending.rows.length) return null;
  const row = pending.rows[0];
  if (row.status !== "active" || !row.catalog_present) {
    await abandonCollectGame(userId, row.game_id, client);
    return null;
  }
  return collectGamePayload(client, row, userId);
}
async function startCollectGame(
  userId,
  random = Math.random,
  streetGroups = null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const pending = await getPendingCollectGame(userId, client);
    if (pending) {
      await client.query("COMMIT");
      return pending;
    }
    const recent = await client.query(
      `SELECT COUNT(*)::int AS count FROM collect_games WHERE user_id=$1 AND started_at>NOW()-INTERVAL '1 minute'`,
      [userId],
    );
    if (recent.rows[0].count >= 30)
      throw Object.assign(
        new Error("Trop de parties lancées. Réessaie dans une minute."),
        { code: "COLLECT_RATE_LIMIT" },
      );
    const result = await drawCollectGame(userId, random, streetGroups, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function awardCollectBadges(userId, client = pool) {
  const userIds = Array.isArray(userId) ? userId : [userId];
  if (!userIds.length) return [];
  await client.query(`INSERT INTO collect_badges(slug, name, description, rule_json)
    SELECT 'album-' || a.slug, 'Album complet · ' || a.name, 'Compléter l’album ' || a.name || '.',
      jsonb_build_object('type', 'album_complete', 'album_id', a.id)
    FROM albums a WHERE a.active AND a.slug NOT IN ('streets', 'districts', 'monuments', 'bus')
    ON CONFLICT (slug) DO NOTHING`);
  const result = await client.query(
    `WITH earned AS (INSERT INTO user_collect_badges(user_id, badge_id)
     SELECT target.user_id, b.id FROM collect_badges b
     CROSS JOIN unnest($1::integer[]) AS target(user_id)
     WHERE CASE b.rule_json->>'type'
       WHEN 'first_card' THEN EXISTS (SELECT 1 FROM card_copies cp WHERE cp.user_id = target.user_id)
       WHEN 'distinct_cards' THEN (
         SELECT COUNT(DISTINCT COALESCE(m.canonical_card_id,cp.card_id)) FROM card_copies cp
         LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
         JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
         WHERE cp.user_id = target.user_id AND c.status = 'active'
       ) >= (b.rule_json->>'count')::int
       WHEN 'family_complete' THEN EXISTS (
         SELECT 1 FROM cards c WHERE c.family = b.rule_json->>'family' AND c.status = 'active'
       ) AND NOT EXISTS (
         SELECT 1 FROM cards c WHERE c.family = b.rule_json->>'family' AND c.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM card_copies cp WHERE cp.user_id = target.user_id
             AND (cp.card_id=c.id OR cp.card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)))
       )
       WHEN 'album_complete' THEN EXISTS (
         SELECT 1 FROM album_cards ac JOIN cards c ON c.id = ac.card_id
         WHERE ac.album_id = (b.rule_json->>'album_id')::bigint AND c.status = 'active'
       ) AND NOT EXISTS (
         SELECT 1 FROM album_cards ac JOIN cards c ON c.id = ac.card_id
         WHERE ac.album_id = (b.rule_json->>'album_id')::bigint AND c.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM card_copies cp WHERE cp.user_id = target.user_id
             AND (cp.card_id=c.id OR cp.card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)))
       )
       WHEN 'all_active_cards' THEN EXISTS (SELECT 1 FROM cards WHERE status = 'active')
         AND NOT EXISTS (
           SELECT 1 FROM cards c WHERE c.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM card_copies cp WHERE cp.user_id = target.user_id
               AND (cp.card_id=c.id OR cp.card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)))
         )
       ELSE FALSE
     END
     ON CONFLICT (user_id, badge_id) DO NOTHING
     RETURNING user_id, badge_id) SELECT b.slug, b.name, b.description FROM earned e JOIN collect_badges b ON b.id = e.badge_id`,
    [userIds],
  );
  return result.rows;
}

async function refreshCollectBadges(client = pool) {
  const candidates = await client.query(
    "SELECT DISTINCT user_id FROM card_copies",
  );
  return awardCollectBadges(
    candidates.rows.map((row) => row.user_id),
    client,
  );
}

async function getCollectAlbums(userId) {
  const result = await pool.query(
    `SELECT a.id, a.slug, a.name, a.description,
            COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active')::int AS active_card_count,
            COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'active' AND cp.id IS NOT NULL)::int AS owned_active_card_count
            ${require("./domains/collect-social/service").schemaEnabled() ? ",COUNT(DISTINCT c.id) FILTER(WHERE c.status='active' AND cp.acquisition='earned')::int AS earned_active_card_count" : ""}
     FROM albums a LEFT JOIN album_cards ac ON ac.album_id = a.id
     LEFT JOIN cards c ON c.id = ac.card_id
     LEFT JOIN card_copies cp ON cp.user_id = $1 AND (cp.card_id = c.id OR cp.card_id IN
       (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))
     WHERE a.active = TRUE GROUP BY a.id ORDER BY a.id`,
    [userId],
  );
  return result.rows.map((album) => ({
    ...album,
    progress: Number(album.active_card_count)
      ? Math.round(
          (Number(album.owned_active_card_count) /
            Number(album.active_card_count)) *
            10000,
        ) / 100
      : 0,
    complete:
      Number(album.active_card_count) > 0 &&
      Number(album.owned_active_card_count) === Number(album.active_card_count),
  }));
}

async function getCollectAlbumCards(userId, slug, username = null) {
  if (username) {
    const user = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username],
    );
    if (!user.rows.length) return null;
    userId = user.rows[0].id;
  }
  const result = await pool.query(
    `SELECT c.id,c.family,c.name,c.collection_number,
    EXISTS(SELECT 1 FROM card_copies cp WHERE cp.user_id=$1 AND (cp.card_id=c.id OR cp.card_id IN
      (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))) AS owned
    FROM cards c JOIN album_cards ac ON ac.card_id=c.id JOIN albums a ON a.id=ac.album_id
    WHERE a.slug=$2 AND a.active AND c.status='active' ORDER BY c.collection_number`,
    [userId, slug],
  );
  return result.rows;
}

async function getCollectBadges(userId) {
  const result = await pool.query(
    `SELECT b.slug, b.name, b.description, b.rule_json, ub.earned_at
     FROM collect_badges b LEFT JOIN user_collect_badges ub ON ub.badge_id = b.id AND ub.user_id = $1
     ORDER BY ub.earned_at NULLS LAST, b.id`,
    [userId],
  );
  return result.rows.map((badge) => ({
    ...badge,
    earned: Boolean(badge.earned_at),
  }));
}

async function getCollectLeaderboard(limit = 25, userId = null) {
  if (require("./domains/collect-social/service").schemaEnabled()) {
    return (
      await pool.query(
        `WITH owned AS(
      SELECT DISTINCT cp.user_id,c.id,CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS rarity
      FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id) WHERE c.status='active'
    ),stats AS(SELECT u.id AS user_id,u.username,u.avatar,COUNT(o.id)::int AS owned_cards,SUM(o.rarity)::int AS rarity_sum,
      (SELECT COUNT(*) FROM card_copies WHERE user_id=u.id)::int AS total_copies FROM users u JOIN owned o ON o.user_id=u.id GROUP BY u.id),ranked AS(
      SELECT *,DENSE_RANK() OVER(ORDER BY owned_cards DESC,rarity_sum DESC)::int AS rank,ROW_NUMBER() OVER(ORDER BY owned_cards DESC,rarity_sum DESC,username,user_id) AS position FROM stats)
      SELECT *,user_id=$2 AS current_player FROM ranked WHERE position<=$1 OR user_id=$2 ORDER BY position`,
        [Math.max(1, Math.min(25, Number(limit) || 25)), userId],
      )
    ).rows;
  }
  const result = await pool.query(
    `WITH stats AS (
    SELECT u.id AS user_id,u.username,u.avatar,
      COUNT(DISTINCT COALESCE(m.canonical_card_id,c.id))::int AS owned_cards,COUNT(cp.id)::int AS total_copies
    FROM users u JOIN card_copies cp ON cp.user_id=u.id JOIN cards c ON c.id=cp.card_id
    LEFT JOIN collect_card_merges m ON m.source_card_id=c.id GROUP BY u.id
  ), ranked AS (
    SELECT *,DENSE_RANK() OVER(ORDER BY owned_cards DESC)::int AS rank,
      ROW_NUMBER() OVER(ORDER BY owned_cards DESC,username,user_id) AS position FROM stats
  ) SELECT *,user_id=$2 AS current_player FROM ranked WHERE position<=$1 OR user_id=$2 ORDER BY position`,
    [Math.max(1, Math.min(25, Number(limit) || 25)), userId],
  );
  return result.rows;
}
async function getCollectPerformanceLeaderboard(userId = null) {
  const config = await pool.query(
    "SELECT value_json FROM collect_config WHERE key = 'performance_ranking'",
  );
  const minimum = Number(config.rows[0]?.value_json?.minimum_attempts);
  if (!Number.isInteger(minimum) || minimum < 1)
    return { configured: false, minimumAttempts: null, rows: [] };
  const result = await pool.query(
    `WITH stats AS (
    SELECT u.id AS user_id,u.username,u.avatar,COUNT(*)::int AS attempts,
      COUNT(*) FILTER(WHERE a.correct)::int AS successes,COUNT(*) FILTER(WHERE a.correct)::numeric/COUNT(*) AS success_rate
    FROM users u JOIN collect_attempts a ON a.user_id=u.id GROUP BY u.id HAVING COUNT(*)>=$1
  ), ranked AS (
    SELECT *,DENSE_RANK() OVER(ORDER BY success_rate DESC)::int AS rank,
      ROW_NUMBER() OVER(ORDER BY success_rate DESC,username,user_id) AS position FROM stats
  ) SELECT *,user_id=$2 AS current_player FROM ranked WHERE position<=25 OR user_id=$2 ORDER BY position`,
    [minimum, userId],
  );
  return { configured: true, minimumAttempts: minimum, rows: result.rows };
}
async function getCollectAlbumLeaderboard(slug, userId = null) {
  const result = await pool.query(
    `WITH owned AS (
    SELECT DISTINCT cp.user_id,c.id,CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS current_rarity
    FROM albums a JOIN album_cards ac ON ac.album_id=a.id JOIN cards c ON c.id=ac.card_id
    JOIN card_copies cp ON cp.card_id=c.id OR cp.card_id IN(SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)
    WHERE a.slug=$1 AND a.active AND c.status='active'
  ), stats AS (
    SELECT u.id AS user_id,u.username,u.avatar,COUNT(*)::int AS owned_cards,SUM(o.current_rarity)::int AS rarity_sum
    FROM owned o JOIN users u ON u.id=o.user_id GROUP BY u.id
  ), ranked AS (
    SELECT *,DENSE_RANK() OVER(ORDER BY owned_cards DESC,rarity_sum DESC)::int AS rank,
      ROW_NUMBER() OVER(ORDER BY owned_cards DESC,rarity_sum DESC,username,user_id) AS position FROM stats
  ) SELECT *,user_id=$2 AS current_player FROM ranked WHERE position<=25 OR user_id=$2 ORDER BY position`,
    [slug, userId],
  );
  return result.rows;
}

async function finishCollectGame(
  userId,
  gameId,
  answerEntityId,
  answerContext = "",
  triviaAnswer = null,
  guessRequestId = null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    const gameResult = await client.query(
      `SELECT g.id, g.card_id, g.started_at, g.finished_at, c.family, c.source_entity_id, c.name,
              c.collection_number, c.image_reference, c.image_override, c.description_override, c.description_full_override, c.image_credit_override, c.current_rarity, c.status, c.catalog_present, c.fragments_enabled, c.fragments_required,
              g.max_attempts, g.placement_guesses, g.abandoned, g.question_snapshot, g.answer_entity_id, g.answer_context, g.correct AS placement_correct
       FROM collect_games g JOIN cards c ON c.id = g.card_id
       WHERE g.id = $1 AND g.user_id = $2 FOR UPDATE OF g FOR SHARE OF c`,
      [gameId, userId],
    );
    if (!gameResult.rows.length)
      throw Object.assign(new Error("collect_game_not_found"), {
        code: "COLLECT_GAME_NOT_FOUND",
      });
    const game = gameResult.rows[0];
    if (game.finished_at) {
      const stored = await client.query(
        "SELECT result_json FROM collect_games WHERE id = $1",
        [gameId],
      );
      if (!stored.rows[0]?.result_json)
        throw Object.assign(new Error("collect_game_already_finished"), {
          code: "COLLECT_GAME_ALREADY_FINISHED",
        });
      const response = stored.rows[0].result_json;
      response.quota = await getCollectQuota(userId, client);
      if (game.abandoned || response.abandoned) {
        await client.query("COMMIT");
        return response;
      }
      response.card.sourceEntityId = game.source_entity_id;
      response.card.rarity = game.fragments_enabled
        ? 5
        : Number(game.current_rarity);
      response.card.fragments_enabled = game.fragments_enabled;
      response.card.fragments_required = game.fragments_required;
      const labels = await client.query(
        "SELECT value_json FROM collect_config WHERE key = 'rarity'",
      );
      response.card.rarityLabel =
        labels.rows[0]?.value_json?.labels?.[String(response.card.rarity)] ||
        response.card.rarityLabel;
      await client.query("COMMIT");
      return response;
    }
    if (Date.now() - new Date(game.started_at).getTime() > 30 * 60 * 1000) {
      await abandonCollectGame(userId, gameId, client);
      await client.query("COMMIT");
      throw Object.assign(
        new Error("Cette partie a expiré. Lancez une nouvelle partie."),
        { code: "COLLECT_GAME_EXPIRED" },
      );
    }
    let correct =
      String(answerEntityId || "") === String(game.source_entity_id);
    if (!correct && game.family === "street") {
      const alias = await client.query(
        `SELECT 1 FROM card_answer_aliases
         WHERE card_id = $1 AND answer_entity_id = $2 AND answer_context = $3 LIMIT 1`,
        [
          game.card_id,
          String(answerEntityId || ""),
          String(answerContext || ""),
        ],
      );
      correct = alias.rows.length > 0;
    }
    const guesses = game.placement_guesses || [];
    if (!game.question_snapshot && triviaAnswer === null) {
      const replay =
        guessRequestId &&
        guesses.find((guess) => guess.requestId === guessRequestId);
      if (replay) {
        await client.query("COMMIT");
        return replay.response;
      }
      const maxAttempts =
        require("./domains/collect/game-hints").placementAttemptLimit(
          game.family,
          Number(game.max_attempts) || 1,
          game.name,
        );
      const feedback = correct
        ? null
        : require("./domains/collect/game-hints").guessFeedback(
            game.family,
            answerEntityId,
            game.source_entity_id,
          );
      const guessedCard = await client.query(
        "SELECT name FROM cards WHERE family=$1 AND source_entity_id=$2 LIMIT 1",
        [game.family, String(answerEntityId || "")],
      );
      const answerName =
        game.family === "bus"
          ? `Ligne ${answerEntityId}`
          : guessedCard.rows[0]?.name || answerEntityId;
      const guess = {
        requestId: guessRequestId,
        answerEntityId,
        answerName,
        answerContext,
        feedback,
        correct,
      };
      guesses.push(guess);
      if (!correct && guesses.length < maxAttempts) {
        const response = {
          stage: "guess",
          correct: false,
          attempts: guesses.length,
          maxAttempts,
          remainingAttempts: maxAttempts - guesses.length,
          feedback,
          guesses: guesses.map(
            ({ answerEntityId, answerName, feedback, correct }) => ({
              answerEntityId,
              answerName,
              feedback,
              correct,
            }),
          ),
        };
        guess.response = response;
        await client.query(
          "UPDATE collect_games SET placement_guesses=$2::jsonb WHERE id=$1",
          [gameId, JSON.stringify(guesses)],
        );
        await client.query("COMMIT");
        return response;
      }
      await client.query(
        "UPDATE collect_games SET placement_guesses=$2::jsonb WHERE id=$1",
        [gameId, JSON.stringify(guesses)],
      );
    }
    let fragmentResult = null;
    let eligibleForCopy = correct;
    if (game.question_snapshot) {
      correct = game.placement_correct;
      if (triviaAnswer === null) {
        await client.query("COMMIT");
        return publicCollectQuestion(game.question_snapshot);
      }
      const snapshot = game.question_snapshot;
      const triviaCorrect = triviaAnswer === snapshot.correct_index;
      const progress = await client.query(
        `INSERT INTO collect_fragment_progress(user_id,card_id,fragments)
        VALUES($1,$2,$3) ON CONFLICT(user_id,card_id) DO UPDATE
        SET fragments=LEAST(100,collect_fragment_progress.fragments + EXCLUDED.fragments) RETURNING fragments`,
        [userId, game.card_id, triviaCorrect ? 1 : 0],
      );
      const fragments = Number(progress.rows[0].fragments);
      fragmentResult = {
        correct: triviaCorrect,
        earned: triviaCorrect ? 1 : 0,
        count: Math.min(fragments, snapshot.required),
        required: snapshot.required,
        correctIndex: snapshot.correct_index,
        explanation: snapshot.explanation,
        sources: snapshot.sources || [],
        questionId: snapshot.id,
      };
      eligibleForCopy = triviaCorrect && fragments >= snapshot.required;
      await client.query(
        "UPDATE collect_question_history SET answered_at=NOW(),correct=$2 WHERE game_id=$1",
        [gameId, triviaCorrect],
      );
    } else {
      if (triviaAnswer !== null)
        throw Object.assign(new Error("Aucune question en attente"), {
          code: "COLLECT_QUESTION_NOT_PENDING",
        });
      if (
        correct &&
        game.fragments_enabled &&
        game.status === "active" &&
        game.catalog_present
      ) {
        await client.query(
          `INSERT INTO collect_fragment_progress(user_id,card_id,fragments)
          SELECT $1,$2,COALESCE(MAX(p.fragments),0) FROM collect_fragment_progress p
          JOIN collect_card_merges m ON m.source_card_id=p.card_id
          WHERE p.user_id=$1 AND m.canonical_card_id=$2 ON CONFLICT(user_id,card_id) DO NOTHING`,
          [userId, game.card_id],
        );
        const progress = await client.query(
          "SELECT fragments FROM collect_fragment_progress WHERE user_id=$1 AND card_id=$2",
          [userId, game.card_id],
        );
        const count = Number(progress.rows[0]?.fragments || 0);
        if (count < game.fragments_required) {
          const questions = await client.query(
            `SELECT q.* FROM collect_questions q LEFT JOIN LATERAL
            (SELECT COUNT(*) AS uses, MAX(g.started_at) AS last_used FROM collect_question_history h
             JOIN collect_games g ON g.id=h.game_id WHERE h.user_id=$1 AND h.question_id=q.id) h ON TRUE
            WHERE q.card_id=$2 ORDER BY h.uses ASC, h.last_used ASC NULLS FIRST, q.position LIMIT 1`,
            [userId, game.card_id],
          );
          if (!questions.rows.length)
            throw Object.assign(new Error("Banque de questions indisponible"), {
              code: "COLLECT_QUESTIONS_EMPTY",
            });
          const snapshot = {
            ...questions.rows[0],
            required: game.fragments_required,
            count,
          };
          delete snapshot.uses;
          delete snapshot.last_used;
          await client.query(
            `UPDATE collect_games SET answer_entity_id=$2,answer_context=$3,correct=TRUE,question_snapshot=$4::jsonb WHERE id=$1`,
            [gameId, answerEntityId, answerContext, JSON.stringify(snapshot)],
          );
          await client.query(
            `INSERT INTO collect_question_history(game_id,user_id,card_id,question_id) VALUES($1,$2,$3,$4)`,
            [gameId, userId, game.card_id, snapshot.id],
          );
          const quota = await getCollectQuota(userId, client);
          await client.query(
            `INSERT INTO collect_attempts(user_id,card_id,correct,reward_available,reward_granted,request_id)
            VALUES($1,$2,TRUE,$3,FALSE,$4)`,
            [userId, game.card_id, quota.copies < quota.limit, gameId],
          );
          await client.query("COMMIT");
          return publicCollectQuestion(snapshot);
        }
        fragmentResult = {
          correct: null,
          earned: 0,
          count: game.fragments_required,
          required: game.fragments_required,
        };
      }
    }
    const quotaBefore = await getCollectQuota(userId, client);
    const { rewardAvailable, rewardGranted: canGrantReward } = rewardDecision({
      correct,
      copiesInWindow: quotaBefore.copies,
      limit: quotaBefore.limit,
    });
    let rewardGranted = false;
    let copy = null;
    let newBadges = [];
    if (
      canGrantReward &&
      eligibleForCopy &&
      game.status === "active" &&
      game.catalog_present
    ) {
      const created = await client.query(
        `INSERT INTO card_copies(user_id, card_id, source)
         VALUES ($1, $2, 'collect') RETURNING id, obtained_at`,
        [userId, game.card_id],
      );
      copy = created.rows[0];
      rewardGranted = true;
      newBadges = await awardCollectBadges(userId, client);
      if (fragmentResult)
        await client.query(
          "UPDATE collect_fragment_progress SET fragments=0 WHERE user_id=$1 AND card_id=$2",
          [userId, game.card_id],
        );
    }
    await client.query(
      `INSERT INTO collect_attempts(user_id, card_id, correct, reward_available, reward_granted, request_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(request_id) DO UPDATE SET reward_available=EXCLUDED.reward_available,reward_granted=EXCLUDED.reward_granted`,
      [userId, game.card_id, correct, rewardAvailable, rewardGranted, gameId],
    );
    const owned = await client.query(
      "SELECT COUNT(*)::int AS count FROM card_copies WHERE user_id = $1 AND (card_id = $2 OR card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=$2))",
      [userId, game.card_id],
    );
    const quota = await getCollectQuota(userId, client);
    if (
      rewardGranted &&
      quotaBefore.copies < quota.limit &&
      quota.copies === quota.limit
    ) {
      await recordCollectQuotaFull(
        userId,
        copy.id,
        quota.nextAvailableAt,
        client,
      );
    }
    const rarityConfig = await client.query(
      "SELECT value_json FROM collect_config WHERE key = 'rarity'",
    );
    const rarityLabels = rarityConfig.rows[0]?.value_json?.labels || {};
    const cardContent = collectCardContent(game);
    let awardedDetail = null;
    if (rewardGranted) {
      const [history, statistics] = [
        await client.query(
          `SELECT cp.id, cp.source, cp.obtained_at AS "obtainedAt",
          cp.daily_attempt_count AS "dailyAttemptCount", cp.daily_date AS "dailyDate"
          FROM card_copies cp WHERE cp.user_id=$1 AND (cp.card_id=$2 OR cp.card_id IN
            (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=$2))
          ORDER BY cp.obtained_at`,
          [userId, game.card_id],
        ),
        await getCollectCardStatistics([game.card_id], client),
      ];
      awardedDetail = {
        copies: history.rows,
        statistics: statistics.get(Number(game.card_id)),
      };
    }
    const response = {
      correct,
      guesses: guesses.map(
        ({ answerEntityId, answerName, feedback, correct }) => ({
          answerEntityId,
          answerName,
          feedback,
          correct,
        }),
      ),
      attempts: guesses.length,
      maxAttempts:
        require("./domains/collect/game-hints").placementAttemptLimit(
          game.family,
          Number(game.max_attempts) || 1,
          game.name,
        ),
      fragments: fragmentResult,
      rewardAvailable,
      rewardGranted,
      rewardBlockedReason:
        game.status === "archived" || !game.catalog_present
          ? "archived"
          : !rewardAvailable
            ? "quota"
            : !eligibleForCopy && correct
              ? "fragments"
              : null,
      copy,
      newBadges,
      ownedCount: Number(owned.rows[0]?.count || 0),
      quota,
      ...(awardedDetail ? { awardedDetail } : {}),
      card: {
        id: game.card_id,
        family: game.family,
        name: game.name,
        sourceEntityId: game.source_entity_id,
        collectionNumber: game.collection_number,
        description: cardContent.description,
        short_description: cardContent.short_description,
        description_full: cardContent.description_full,
        location_label: cardContent.location_label,
        location_full: cardContent.location_full,
        description_source: cardContent.description_source,
        wikipedia_url: cardContent.wikipedia_url,
        imageReference: cardContent.image_reference || "/apple-touch-icon.png",
        imageAttribution: cardContent.image_attribution,
        rarity: game.fragments_enabled ? 5 : Number(game.current_rarity),
        fragments_enabled: game.fragments_enabled,
        fragments_required: game.fragments_required,
        rarityLabel:
          rarityLabels[
            String(game.fragments_enabled ? 5 : game.current_rarity)
          ] || "",
      },
    };
    await client.query(
      `UPDATE collect_games SET finished_at = NOW(), answer_entity_id = $2, answer_context = $3,
         correct = $4, result_json = $5::jsonb WHERE id = $1`,
      [
        gameId,
        String(
          game.question_snapshot ? game.answer_entity_id : answerEntityId || "",
        ).slice(0, 200),
        String(
          game.question_snapshot ? game.answer_context : answerContext || "",
        ).slice(0, 200),
        correct,
        JSON.stringify(response),
      ],
    );
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function grantDailyCardCopy(userId, date, streetName, _attemptCount) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
      userId,
    ]);
    if (
      require("./domains/collect-social/service").schemaEnabled() &&
      (
        await client.query(
          "SELECT id FROM collect_awards WHERE user_id=$1 AND source='daily' AND daily_date=$2",
          [userId, date],
        )
      ).rows.length
    ) {
      await client.query("COMMIT");
      return null;
    }
    const eligible = await client.query(
      `SELECT d.attempts_count FROM daily_user_attempts d
      JOIN app_settings s ON s.key = 'collect_launch_at'
      JOIN daily_targets t ON t.date = d.date AND t.street_name = $3
      WHERE d.user_id = $1 AND d.date = $2 AND d.success = TRUE
      AND d.last_attempt_at >= s.value_text::timestamptz`,
      [userId, date, streetName],
    );
    if (!eligible.rows.length) {
      await client.query("COMMIT");
      return null;
    }
    const target = await client.query(
      `SELECT * FROM cards WHERE family = 'street' AND status = 'active' AND catalog_present
       AND (source_entity_id = $1 OR LOWER(name) = LOWER($1)) LIMIT 1`,
      [streetName],
    );
    if (!target.rows.length) {
      await client.query("COMMIT");
      return null;
    }
    const copy = await client.query(
      `INSERT INTO card_copies(user_id, card_id, source, daily_date, daily_attempt_count)
       VALUES ($1, $2, 'daily', $3, $4)
       ON CONFLICT (${require("./domains/collect-social/service").schemaEnabled() ? "initial_owner_id" : "user_id"}, daily_date) WHERE source = 'daily' DO NOTHING
       RETURNING id, obtained_at`,
      [
        userId,
        target.rows[0].id,
        date,
        Number(eligible.rows[0].attempts_count),
      ],
    );
    const newBadges = copy.rows[0]
      ? await awardCollectBadges(userId, client)
      : [];
    const labels = await client.query(
      "SELECT value_json FROM collect_config WHERE key = 'rarity'",
    );
    const earnedCard = copy.rows[0]
      ? {
          ...target.rows[0],
          ...collectCardContent(target.rows[0]),
          copy_count: 1,
          daily_origin: true,
        }
      : null;
    await client.query("COMMIT");
    return copy.rows[0]
      ? {
          ...copy.rows[0],
          card: earnedCard,
          newBadges,
          name: target.rows[0].name,
          collectionNumber: target.rows[0].collection_number,
          rarity: Number(target.rows[0].current_rarity),
          rarityLabel:
            labels.rows[0]?.value_json?.labels?.[
              String(target.rows[0].current_rarity)
            ] || "",
          imageReference: target.rows[0].image_reference,
        }
      : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDailyEarnedCard(userId, date) {
  const result = await pool.query(
    `SELECT c.*,cp.id AS copy_id,cp.obtained_at FROM card_copies cp
    LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
    WHERE cp.user_id=$1 AND cp.source='daily' AND cp.daily_date=$2 ${require("./domains/collect-social/service").schemaEnabled() ? "AND cp.acquisition='earned'" : ""} LIMIT 1`,
    [userId, date],
  );
  if (!result.rows[0]) return null;
  const { copy_id, obtained_at, ...card } = result.rows[0];
  return {
    id: copy_id,
    obtained_at,
    card: {
      ...card,
      ...collectCardContent(card),
      copy_count: 1,
      daily_origin: true,
    },
  };
}

async function getCollectCollection(
  userId,
  {
    publicView = false,
    cardIds = null,
    ownedOnly = false,
    compact = false,
  } = {},
) {
  const result = await pool.query(
    `SELECT c.id, c.family, c.source_entity_id, c.collection_number,
            c.name,
            CASE WHEN COUNT(cp.id) > 0 THEN COALESCE(c.image_override,c.image_reference) END AS image_reference,
            c.image_override,c.description_override,c.description_full_override,c.image_credit_override,
            CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS current_rarity,
            CASE WHEN c.catalog_present THEN c.status ELSE 'archived' END AS status, c.fragments_enabled, c.fragments_required,
            (SELECT LEAST(COALESCE((SELECT cp.fragments FROM collect_fragment_progress cp WHERE cp.user_id=$1 AND cp.card_id=c.id),MAX(p.fragments),0),c.fragments_required) FROM collect_fragment_progress p WHERE p.user_id=$1
              AND (p.card_id=c.id OR p.card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))) AS fragment_count,
            COUNT(cp.id)::int AS copy_count,
            COALESCE(BOOL_OR(cp.source='daily'),false) AS daily_origin,
            CASE WHEN $2::boolean THEN false ELSE EXISTS (
              SELECT 1 FROM collect_favorites f WHERE f.user_id=$1 AND f.card_id=c.id
            ) END AS favorite,
            CASE WHEN $2::boolean OR $5::boolean THEN NULL ELSE COALESCE(json_agg(json_build_object('id', cp.id, 'source', cp.source, 'obtainedAt', cp.obtained_at,
              'dailyAttemptCount', cp.daily_attempt_count, 'dailyDate', cp.daily_date)
              ORDER BY cp.obtained_at) FILTER (WHERE cp.id IS NOT NULL), '[]'::json) END AS copies
     FROM cards c LEFT JOIN card_copies cp ON cp.user_id = $1 AND (cp.card_id = c.id OR cp.card_id IN
       (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))
     WHERE ((c.status = 'active' AND c.catalog_present) OR cp.id IS NOT NULL)
       AND ($3::bigint[] IS NULL OR c.id=ANY($3::bigint[]))
       AND (NOT $4::boolean OR cp.id IS NOT NULL)
       AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
     GROUP BY c.id ORDER BY c.family, c.collection_number`,
    [userId, publicView, cardIds, ownedOnly, compact],
  );
  const visibleIds = result.rows
    .filter((card) => Number(card.copy_count) > 0)
    .map((card) => card.id);
  const statistics = visibleIds.length
    ? await getCollectCardStatistics(visibleIds)
    : new Map();
  const cards = result.rows.map(
    ({
      source_entity_id,
      image_override,
      description_override,
      description_full_override,
      image_credit_override,
      ...card
    }) => {
      const metadata = require("./domains/collect/catalog-details").cardDetails(
        card.family,
        source_entity_id,
      );
      const content = collectCardContent({
        ...card,
        source_entity_id,
        image_override,
        description_override,
        description_full_override,
        image_credit_override,
      });
      return {
        ...card,
        ...metadata,
        image_reference: card.name
          ? content.image_reference
          : card.image_reference,
        image_thumbnail: card.name ? content.image_thumbnail : null,
        statistics: statistics.get(Number(card.id)),
        description: card.name ? content.description : null,
        short_description: card.name ? content.short_description : null,
        description_full: card.name ? content.description_full : null,
        wikipedia_url: card.name ? content.wikipedia_url : null,
        location_label: card.name ? content.location_label : null,
        location_full: card.name ? content.location_full : null,
        detailed_description: card.name ? metadata.detailed_description : null,
        description_source: card.name ? content.description_source : null,
        image_attribution: card.name ? content.image_attribution : null,
      };
    },
  );
  return cards.map((card) => {
    if (publicView) {
      delete card.copies;
      delete card.fragment_count;
      delete card.favorite;
    }
    if (compact) {
      delete card.copies;
      delete card.description_full;
      delete card.detailed_description;
      delete card.location_full;
    }
    return card;
  });
}

// Aggregate only the displayed, owned cards. No global table scan per card.
async function getCollectCardStatistics(cardIds, database = pool) {
  const result = await database.query(
    `WITH selected AS (
    SELECT id AS source_id,id AS card_id FROM cards WHERE id=ANY($1::bigint[])
    UNION ALL SELECT source_card_id,canonical_card_id FROM collect_card_merges WHERE canonical_card_id=ANY($1::bigint[])
  ), placements AS (
    SELECT s.card_id,COUNT(*)::int AS attempts,COUNT(*) FILTER(WHERE a.correct)::int AS successes
    FROM selected s JOIN collect_attempts a ON a.card_id=s.source_id GROUP BY s.card_id
  ), circulation AS (
    SELECT s.card_id,COUNT(*)::int AS copies,COUNT(DISTINCT cp.user_id)::int AS collectors
    FROM selected s JOIN card_copies cp ON cp.card_id=s.source_id GROUP BY s.card_id
  ) SELECT c.id,COALESCE(p.attempts,0) AS attempts,COALESCE(p.successes,0) AS successes,
    COALESCE(cp.copies,0) AS circulation,COALESCE(cp.collectors,0) AS collectors
    FROM cards c LEFT JOIN placements p ON p.card_id=c.id LEFT JOIN circulation cp ON cp.card_id=c.id
    WHERE c.id=ANY($1::bigint[])`,
    [cardIds],
  );
  return new Map(result.rows.map(({ id, ...stats }) => [Number(id), stats]));
}

async function setCollectFavorite(userId, cardId, favorite) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query(
      `SELECT 1 FROM cards c WHERE c.id=$2
      AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
      AND EXISTS(SELECT 1 FROM card_copies cp WHERE cp.user_id=$1
        AND (cp.card_id=c.id OR cp.card_id IN
          (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id)))`,
      [userId, cardId],
    );
    if (!owned.rows.length) {
      const error = new Error("Carte non possédée");
      error.code = "COLLECT_CARD_NOT_OWNED";
      throw error;
    }
    if (favorite)
      await client.query(
        `INSERT INTO collect_favorites(user_id,card_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [userId, cardId],
      );
    else
      await client.query(
        `DELETE FROM collect_favorites WHERE user_id=$1 AND card_id=$2`,
        [userId, cardId],
      );
    await client.query("COMMIT");
    return { cardId: Number(cardId), favorite };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// A detail sheet is available only for a card present in the selected inventory.
// Global placement statistics include Collect only; copy provenance stays private.
async function getCollectCardDetails(
  userId,
  cardId,
  { publicView = false, username = null } = {},
) {
  if (username !== null) {
    const user = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username],
    );
    if (!user.rows.length) return null;
    userId = user.rows[0].id;
  }
  const result = await pool.query(
    `SELECT c.*, COUNT(cp.id)::int AS copy_count,COALESCE(BOOL_OR(cp.source='daily'),false) AS daily_origin,
    (SELECT LEAST(COALESCE((SELECT cp.fragments FROM collect_fragment_progress cp WHERE cp.user_id=$1 AND cp.card_id=c.id),MAX(p.fragments),0),c.fragments_required) FROM collect_fragment_progress p WHERE p.user_id=$1
      AND (p.card_id=c.id OR p.card_id IN (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))) AS fragment_count,
    CASE WHEN $3::boolean THEN NULL ELSE json_agg(json_build_object(
      'id',cp.id,'source',cp.source,'obtainedAt',cp.obtained_at,
      'dailyAttemptCount',cp.daily_attempt_count,'dailyDate',cp.daily_date)
      ORDER BY cp.obtained_at) END AS copies
    FROM cards c JOIN card_copies cp ON cp.user_id=$1 AND (cp.card_id=c.id OR cp.card_id IN
      (SELECT source_card_id FROM collect_card_merges WHERE canonical_card_id=c.id))
    WHERE c.id=$2 GROUP BY c.id`,
    [userId, cardId, publicView],
  );
  if (!result.rows.length) return null;
  const card = result.rows[0];
  const statistics = (await getCollectCardStatistics([cardId])).get(
    Number(cardId),
  );
  const {
    image_override: _imageOverride,
    description_override: _descriptionOverride,
    description_full_override: _descriptionFullOverride,
    image_credit_override: _imageCreditOverride,
    copies,
    ...visible
  } = card;
  const content = collectCardContent(card);
  if (publicView) delete visible.fragment_count;
  return {
    ...visible,
    ...content,
    ...(publicView ? {} : { copies }),
    statistics,
  };
}

async function reportCollectCardContent(userId, cardId, contentType) {
  const result = await pool.query(
    `INSERT INTO collect_content_reports(card_id,user_id,content_type)
     SELECT id,$2,$3 FROM cards WHERE id=$1
     ON CONFLICT(card_id,user_id,content_type) DO UPDATE SET
       status='open',last_reported_at=NOW(),resolved_at=NULL
     RETURNING id,card_id,content_type,status,last_reported_at`,
    [cardId, userId, contentType],
  );
  return result.rows[0] || null;
}

async function listCollectContentReports() {
  const result = await pool.query(
    `SELECT c.id AS card_id,c.family,c.collection_number,c.name,r.content_type,
            COUNT(*) FILTER (WHERE r.status='open')::int AS report_count,
            MIN(r.first_reported_at) FILTER (WHERE r.status='open') AS first_reported_at,
            MAX(r.last_reported_at) FILTER (WHERE r.status='open') AS last_reported_at
     FROM collect_content_reports r JOIN cards c ON c.id=r.card_id
     GROUP BY c.id,r.content_type
     HAVING COUNT(*) FILTER (WHERE r.status='open') > 0
     ORDER BY COUNT(*) FILTER (WHERE r.status='open') DESC, MIN(r.first_reported_at) FILTER (WHERE r.status='open'),c.family,c.collection_number`,
  );
  return result.rows;
}

async function resolveCollectContentReports(cardId, contentType) {
  const result = await pool.query(
    `UPDATE collect_content_reports SET status='resolved',resolved_at=NOW()
     WHERE card_id=$1 AND content_type=$2 AND status='open' RETURNING card_id`,
    [cardId, contentType],
  );
  return { resolved: result.rowCount };
}

async function getCollectProfileStats(userId) {
  const [inventory, attempts, albums, badges] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT COALESCE(m.canonical_card_id,cp.card_id))::int AS unique_cards,
      COUNT(DISTINCT COALESCE(m.canonical_card_id,cp.card_id)) FILTER (WHERE canonical.status = 'active')::int AS active_unique_cards,
      COUNT(*)::int AS total_copies,
      COUNT(*) FILTER (WHERE cp.source = 'daily')::int AS daily_copies,
      COUNT(*) FILTER (WHERE cp.source = 'collect')::int AS collect_copies,
      (SELECT COUNT(*)::int FROM cards WHERE status = 'active') AS active_card_count
      FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
      JOIN cards canonical ON canonical.id=COALESCE(m.canonical_card_id,cp.card_id) WHERE cp.user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS attempts, COUNT(*) FILTER (WHERE correct)::int AS successes
      FROM collect_attempts WHERE user_id = $1`,
      [userId],
    ),
    getCollectAlbums(userId),
    getCollectBadges(userId),
  ]);
  const stats = { ...inventory.rows[0], ...attempts.rows[0] };
  return {
    ...stats,
    duplicates: stats.total_copies - stats.unique_cards,
    success_rate: stats.attempts
      ? Math.round((10000 * stats.successes) / stats.attempts) / 100
      : null,
    progress: stats.active_card_count
      ? Math.round(
          (10000 * stats.active_unique_cards) / stats.active_card_count,
        ) / 100
      : 0,
    albums,
    badges,
  };
}

async function getPublicCollectProfile(username) {
  const user = await pool.query(
    "SELECT id, username, avatar FROM users WHERE LOWER(username) = LOWER($1)",
    [username],
  );
  if (!user.rows.length) return null;
  const { id, ...identity } = user.rows[0];
  const {
    collectionPage,
    parseCollectionFilters,
  } = require("./domains/collect/collection-page");
  const [collect, collection] = await Promise.all([
    getCollectProfileStats(id),
    collectionPage(
      { ...module.exports, pool },
      id,
      parseCollectionFilters({}),
      { publicView: true },
    ),
  ]);
  return {
    ...identity,
    collect,
    cards: collection.cards,
    rarityLabels: collection.rarityLabels,
    collection,
  };
}

function publicCollectQuestion(snapshot) {
  return {
    correct: true,
    stage: "question",
    fragments: { count: snapshot.count, required: snapshot.required },
    question: {
      theme: snapshot.theme,
      text: snapshot.text,
      answers: snapshot.answers,
    },
  };
}

async function getCollectFragments(cardId) {
  const card = await pool.query(
    "SELECT id,name,family,fragments_enabled,fragments_required FROM cards WHERE id=$1",
    [cardId],
  );
  if (!card.rows.length) return null;
  const questions = await pool.query(
    "SELECT * FROM collect_questions WHERE card_id=$1 ORDER BY position",
    [cardId],
  );
  return { ...card.rows[0], questions: questions.rows };
}

async function saveCollectFragments(cardId, config) {
  const { validateFragmentConfig } = require("./domains/collect/fragments");
  const valid = validateFragmentConfig(config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id FROM cards WHERE id=$1 FOR UPDATE",
      [cardId],
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE cards SET fragments_enabled=$2,fragments_required=$3 WHERE id=$1",
      [cardId, valid.enabled, valid.required],
    );
    await client.query("DELETE FROM collect_questions WHERE card_id=$1", [
      cardId,
    ]);
    for (const [position, q] of valid.questions.entries()) {
      await client.query(
        `INSERT INTO collect_questions(id,card_id,position,theme,text,answers,correct_index,explanation,sources)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
        [
          q.id,
          cardId,
          position,
          q.theme,
          q.text,
          JSON.stringify(q.answers),
          q.correct_index,
          q.explanation,
          JSON.stringify(q.sources || []),
        ],
      );
    }
    await client.query("COMMIT");
    return await getCollectFragments(cardId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listCollectCards({
  search = "",
  family = "",
  status = "",
  rarity = "",
  quality = "",
  page = 1,
  sort = "number",
  order = "asc",
} = {}) {
  const offset = (Math.max(1, Number(page) || 1) - 1) * 50;
  const direction = order === "desc" ? "DESC" : "ASC";
  const sortExpressions = {
    number: `c.family ${direction}, CASE WHEN c.family='bus' THEN COALESCE(substring(c.name FROM '^([0-9]+)')::int,2147483647) ELSE c.collection_number END ${direction}`,
    name: `LOWER(c.name) ${direction}`,
    status: `CASE WHEN c.status='active' THEN 0 ELSE 1 END ${direction}`,
    copies: `copy_count ${direction}`,
    rarity: `effective_rarity ${direction}`,
    fragments: `c.fragments_required ${direction}, question_count ${direction}`,
  };
  const sortExpression = sortExpressions[sort] || sortExpressions.number;
  const result = await pool.query(
    `WITH copy_counts AS (
      SELECT COALESCE(m.canonical_card_id, cp.card_id) AS card_id, COUNT(*)::int AS copy_count
      FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
      GROUP BY COALESCE(m.canonical_card_id, cp.card_id)
    ), question_counts AS (
      SELECT card_id, COUNT(*)::int AS question_count FROM collect_questions GROUP BY card_id
    )
    SELECT c.*, COUNT(*) OVER()::int AS filtered_count,
    COALESCE(q.question_count,0)::int AS question_count,
    COALESCE(cc.copy_count,0)::int AS copy_count,
    CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS effective_rarity
    FROM cards c LEFT JOIN copy_counts cc ON cc.card_id=c.id
    LEFT JOIN question_counts q ON q.card_id=c.id
    WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%')
    AND ($2 = '' OR c.family = $2) AND ($3 = '' OR c.status = $3)
    AND ($4::int = 0 OR CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END = $4::int)
    AND ($6='' OR ($6='missing-image' AND COALESCE(c.image_override,c.image_reference,'/apple-touch-icon.png')='/apple-touch-icon.png')
      OR ($6='reported' AND EXISTS(SELECT 1 FROM collect_content_reports r WHERE r.card_id=c.id AND r.status='open'))
      OR ($6='verified' AND EXISTS(SELECT 1 FROM collect_content_corrections v WHERE v.card_id=c.id AND v.verified_entity IS NOT NULL))
      OR ($6='unverified' AND NOT EXISTS(SELECT 1 FROM collect_content_corrections v WHERE v.card_id=c.id AND v.verified_entity IS NOT NULL)))
    AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)
    ORDER BY ${sortExpression}, c.name ASC, c.id ASC LIMIT 50 OFFSET $5`,
    [search, family, status, Number(rarity) || 0, offset, quality],
  );
  if (!result.rows.length && offset > 0)
    return listCollectCards({
      search,
      family,
      status,
      rarity,
      quality,
      page: 1,
      sort,
      order,
    });
  return {
    rarityEditingVersion: 2,
    cards: result.rows.map((card) => ({
      ...card,
      ...collectCardContent(card),
    })),
    total: result.rows[0]?.filtered_count || 0,
    page: Math.floor(offset / 50) + 1,
    pageSize: 50,
    filters: { rarity: rarity ? String(rarity) : "" },
  };
}

async function setCollectCardStatus(cardId, status) {
  const result = await pool.query(
    `UPDATE cards SET status = $2,
    archived_at = CASE WHEN $2 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END
    WHERE id = $1 AND ($2 = 'archived' OR catalog_present)
    RETURNING id, family, collection_number, name, status, archived_at`,
    [cardId, status],
  );
  if (!result.rows.length && status === "active") {
    const existing = await pool.query(
      "SELECT catalog_present FROM cards WHERE id = $1",
      [cardId],
    );
    if (existing.rows[0]?.catalog_present === false)
      throw Object.assign(
        new Error(
          "La carte est sortie du référentiel ; elle ne peut pas être réactivée.",
        ),
        { code: "COLLECT_CARD_NOT_IN_CATALOG" },
      );
  }
  if (result.rows[0] && status === "archived") {
    // Archiving can complete an album by removing a missing card. Persist those
    // badges now; restoring or extending the album must never take them away.
    await refreshCollectBadges();
  }
  return result.rows[0] || null;
}

async function setCollectCardRarity(cardId, rarity) {
  const override = rarity == null ? null : Number(rarity);
  if (override !== null && ![1, 2, 3, 4].includes(override)) {
    throw Object.assign(new Error("Rareté invalide."), {
      code: "INVALID_COLLECT_RARITY",
    });
  }
  const result = await pool.query(
    `UPDATE cards SET rarity_override=$2,
       current_rarity=COALESCE($2, (SELECT new_rarity FROM card_rarity_history WHERE card_id=cards.id ORDER BY changed_at DESC,id DESC LIMIT 1), base_rarity)
     WHERE id=$1
     RETURNING id, family, collection_number, name, base_rarity, current_rarity,
       rarity_override, fragments_enabled, fragments_required`,
    [cardId, override],
  );
  return result.rows[0] || null;
}

async function configureCollectCardRarity(cardId, options) {
  const { initialRarity, automaticRarity, applyRarityNow = false } = options;
  if (
    !Number.isInteger(initialRarity) ||
    ![1, 2, 3, 4].includes(initialRarity) ||
    typeof automaticRarity !== "boolean" ||
    typeof applyRarityNow !== "boolean"
  ) {
    throw Object.assign(new Error("Configuration de rareté invalide."), {
      code: "INVALID_COLLECT_RARITY",
    });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "collect-rarity-monthly",
    ]);
    const result = await client.query(
      `UPDATE cards SET base_rarity_override=$2, base_rarity=$2,
         current_rarity=CASE WHEN $4 OR ($3 AND rarity_evaluated_at IS NULL)
           THEN $2 ELSE current_rarity END,
         rarity_override=CASE WHEN $3 THEN NULL WHEN $4 THEN $2 ELSE current_rarity END
       WHERE id=$1
       RETURNING *`,
      [cardId, initialRarity, automaticRarity, applyRarityNow],
    );
    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getCollectRarityLabels() {
  const result = await pool.query(
    "SELECT value_json FROM collect_config WHERE key = 'rarity'",
  );
  return (
    result.rows[0]?.value_json?.labels || {
      1: "Commune",
      2: "Peu commune",
      3: "Rare",
      4: "Épique",
      5: "Légendaire",
    }
  );
}

async function recalculateCollectRarity(monthKey) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "collect-rarity-monthly",
    ]);
    const configResult = await client.query(
      "SELECT value_json FROM collect_config WHERE key = 'rarity' FOR SHARE",
    );
    const thresholds =
      configResult.rows[0]?.value_json?.success_rate_thresholds;
    if (
      !Array.isArray(thresholds) ||
      thresholds.length !== 3 ||
      thresholds.some(
        (value) =>
          !Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 1,
      ) ||
      thresholds.some(
        (value, index) =>
          index > 0 && Number(value) >= Number(thresholds[index - 1]),
      )
    ) {
      await client.query("ROLLBACK");
      return {
        skipped: true,
        reason: "success_rate_thresholds_not_configured",
      };
    }
    const run = await client.query(
      `INSERT INTO collect_rarity_recalc_runs(month_key) VALUES ($1)
       ON CONFLICT (month_key) DO NOTHING RETURNING month_key`,
      [monthKey],
    );
    if (!run.rows.length) {
      await client.query("COMMIT");
      return { skipped: true, reason: "already_recalculated" };
    }
    const minimum = Math.max(
      1,
      Number(configResult.rows[0].value_json.minimum_attempts) || 20,
    );
    const cards = await client.query(
      `SELECT c.id,c.current_rarity,COUNT(g.id)::int AS attempts,
       AVG(CASE WHEN (g.placement_guesses->0->>'correct')::boolean THEN 1.0 ELSE 0.0 END) AS success_rate
       FROM collect_games g LEFT JOIN collect_card_merges m ON m.source_card_id=g.card_id
       JOIN cards c ON c.id=COALESCE(m.canonical_card_id,g.card_id)
       WHERE c.status='active' AND c.rarity_override IS NULL AND NOT c.fragments_enabled
       AND g.finished_at IS NOT NULL AND jsonb_array_length(COALESCE(g.placement_guesses,'[]'::jsonb))>0
       GROUP BY c.id HAVING COUNT(g.id)>=$1`,
      [minimum],
    );
    let changed = 0;
    for (const card of cards.rows) {
      const rate = Number(card.success_rate);
      const rarity =
        thresholds.findIndex((threshold) => rate >= Number(threshold)) + 1 || 4;
      await client.query(
        "UPDATE cards SET rarity_evaluated_at=NOW() WHERE id=$1",
        [card.id],
      );
      if (rarity === Number(card.current_rarity)) continue;
      await client.query("UPDATE cards SET current_rarity = $2 WHERE id = $1", [
        card.id,
        rarity,
      ]);
      await client.query(
        `INSERT INTO card_rarity_history(card_id, old_rarity, new_rarity, attempt_count, success_rate,evaluation_method)
         VALUES ($1, $2, $3, $4, $5,'first_attempt')`,
        [card.id, card.current_rarity, rarity, card.attempts, rate],
      );
      changed += 1;
    }
    await client.query(
      "UPDATE collect_rarity_recalc_runs SET completed_at = NOW(), cards_updated = $2 WHERE month_key = $1",
      [monthKey, changed],
    );
    await client.query("COMMIT");
    return {
      skipped: false,
      cardsEvaluated: cards.rows.length,
      cardsUpdated: changed,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCollectQuota,
  recordCollectQuotaFull,
  releaseDueCollectQuotas,
  getCollectNotificationStatus,
  markCollectNotificationPrompted,
  setCollectNotificationPreference,
  touchCollectNotificationPresence,
  clearCollectNotificationPresence,
  claimCollectPushDeliveries,
  markCollectPushDelivery,
  collectCardContent,
  saveCollectCardContent,
  drawCollectGame,
  collectGamePayload,
  abandonCollectGame,
  getPendingCollectGame,
  startCollectGame,
  awardCollectBadges,
  refreshCollectBadges,
  getCollectAlbums,
  getCollectAlbumCards,
  getCollectBadges,
  getCollectLeaderboard,
  getCollectPerformanceLeaderboard,
  getCollectAlbumLeaderboard,
  finishCollectGame,
  grantDailyCardCopy,
  getDailyEarnedCard,
  getCollectCollection,
  getCollectCardStatistics,
  setCollectFavorite,
  getCollectCardDetails,
  reportCollectCardContent,
  listCollectContentReports,
  resolveCollectContentReports,
  getCollectProfileStats,
  getPublicCollectProfile,
  publicCollectQuestion,
  getCollectFragments,
  saveCollectFragments,
  listCollectCards,
  setCollectCardStatus,
  setCollectCardRarity,
  configureCollectCardRarity,
  getCollectRarityLabels,
  recalculateCollectRarity,
};
