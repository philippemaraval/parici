"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const {
  FAMOUS_STREET_NAMES,
  MAIN_STREET_NAMES,
} = require("../../../data_rules");

const root = path.resolve(__dirname, "../../..");
const templates = require(
  path.join(root, "data/collect_weekly_templates.json"),
);
const arrondissements = require(
  path.join(root, "data/collect_quartier_arrondissement.json"),
);

function normalize(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}

function streetMetadata(categories = {}) {
  const streets = JSON.parse(
    fs.readFileSync(path.join(root, "backend/data/streets_index.json"), "utf8"),
  );
  const famous = new Set(
    (Array.isArray(categories.famousStreets)
      ? categories.famousStreets
      : [...FAMOUS_STREET_NAMES]
    ).map(normalize),
  );
  const main = new Set(
    (Array.isArray(categories.mainStreets)
      ? categories.mainStreets
      : [...MAIN_STREET_NAMES]
    ).map(normalize),
  );
  const byName = new Map();
  for (const street of streets) {
    const quartier = String(street.quartier || "").trim();
    for (const name of new Set([
      normalize(street.name),
      normalize(street.osmName),
    ])) {
      if (!name || byName.has(name)) continue;
      byName.set(name, {
        quartier: quartier || null,
        arrondissement: arrondissements[quartier] || null,
        famous: famous.has(name),
        main: !famous.has(name) && main.has(name),
      });
    }
  }
  return byName;
}

function unitKey(kind, dimension) {
  if (kind === "arrondissement")
    return dimension.family === "street" ? dimension.arrondissement : null;
  if (kind === "quartier")
    return dimension.family === "street" ? dimension.quartier : null;
  if (kind === "famous")
    return dimension.family === "street" && dimension.famous
      ? dimension.card_id
      : null;
  if (kind === "main")
    return dimension.family === "street" && dimension.main
      ? dimension.card_id
      : null;
  return dimension.family === kind ? dimension.card_id : null;
}

function chooseObjectives(dimensions, rng = crypto.randomInt) {
  const eligible = templates.templates.filter((template) => {
    if (
      !Number.isInteger(template.min) ||
      !Number.isInteger(template.max) ||
      template.min < 1 ||
      template.max < template.min
    ) {
      throw new Error(`Invalid weekly objective range: ${template.kind}`);
    }
    return (
      new Set(dimensions.map((d) => unitKey(template.kind, d)).filter(Boolean))
        .size >= template.min
    );
  });
  const street = eligible.filter((t) =>
    ["arrondissement", "quartier", "famous", "main"].includes(t.kind),
  );
  const other = eligible.filter((t) =>
    ["monument", "bus", "district"].includes(t.kind),
  );
  if (!street.length || !other.length || eligible.length < 3)
    throw new Error("Weekly challenge catalogue is too small");
  const selected = [street[rng(street.length)], other[rng(other.length)]];
  const count =
    templates.objectiveCounts[rng(templates.objectiveCounts.length)];
  if (![2, 3].includes(count))
    throw new Error("Weekly objective count must be 2 or 3");
  if (count === 3) {
    const remaining = eligible.filter((t) => !selected.includes(t));
    selected.push(remaining[rng(remaining.length)]);
  }
  return selected.map((template, position) => {
    const available = new Set(
      dimensions.map((d) => unitKey(template.kind, d)).filter(Boolean),
    ).size;
    const target =
      template.min + rng(Math.min(template.max, available) - template.min + 1);
    return {
      position: position + 1,
      kind: template.kind,
      target,
      label: template.label,
    };
  });
}

async function snapshotDimensions(client, challenge, cards) {
  if (!cards.length) return;
  const metadata = streetMetadata(challenge.category_snapshot);
  const dimensions = cards.map((card) => ({
    ...card,
    ...(card.family === "street" ? metadata.get(normalize(card.name)) : null),
  }));
  await client.query(
    `INSERT INTO weekly_challenge_card_dimensions
    (challenge_id,card_id,family,quartier,arrondissement,famous,main)
    SELECT $1, d.card_id,d.family,d.quartier,d.arrondissement,d.famous,d.main
    FROM unnest($2::bigint[],$3::text[],$4::text[],$5::smallint[],$6::boolean[],$7::boolean[])
    AS d(card_id,family,quartier,arrondissement,famous,main)
    ON CONFLICT (challenge_id,card_id) DO NOTHING`,
    [
      challenge.id,
      dimensions.map((d) => d.card_id),
      dimensions.map((d) => d.family),
      dimensions.map((d) => d.quartier || null),
      dimensions.map((d) => d.arrondissement || null),
      dimensions.map((d) => Boolean(d.famous)),
      dimensions.map((d) => Boolean(d.main)),
    ],
  );
}

function calculateResults(challenge, objectives, participants, units) {
  const byUser = new Map(
    participants.map((user) => [
      Number(user.id),
      {
        userId: Number(user.id),
        username: user.username,
        avatar: user.avatar,
        progress: objectives.map((objective) => ({ ...objective, current: 0 })),
        score: 0,
        completedAt: null,
      },
    ]),
  );
  const startsAt = new Date(challenge.starts_at).getTime();
  const endsAt = new Date(challenge.ends_at).getTime();
  const unitTimes = new Map();
  for (const unit of units) {
    const obtainedAt = new Date(unit.first_at).getTime();
    if (!Number.isFinite(obtainedAt)) continue;
    if (Number.isFinite(startsAt) && obtainedAt < startsAt) continue;
    if (Number.isFinite(endsAt) && obtainedAt >= endsAt) continue;
    const key = `${unit.user_id}:${unit.objective_id}`;
    if (!unitTimes.has(key)) unitTimes.set(key, []);
    unitTimes.get(key).push(new Date(unit.first_at).getTime());
  }
  for (const row of byUser.values()) {
    const completions = [];
    row.progress.forEach((progress, index) => {
      const times = (
        unitTimes.get(`${row.userId}:${objectives[index].id}`) || []
      ).sort((a, b) => a - b);
      progress.current = Math.min(times.length, Number(progress.target));
      if (times.length >= Number(progress.target))
        completions.push(times[Number(progress.target) - 1]);
    });
    row.score = Number(
      (
        (row.progress.reduce(
          (sum, progress) => sum + progress.current / Number(progress.target),
          0,
        ) /
          objectives.length) *
        100
      ).toFixed(5),
    );
    if (completions.length === objectives.length)
      row.completedAt = new Date(Math.max(...completions)).toISOString();
  }
  const rows = [...byUser.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (a.score === 100
        ? new Date(a.completedAt) - new Date(b.completedAt)
        : 0) ||
      a.userId - b.userId,
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return rows;
}

async function scoreChallenge(client, challenge) {
  // Weekly performance follows earned rewards, never subsequent ownership changes.
  const rewardsTable = require("../collect-social/service").schemaEnabled()
    ? "collect_awards"
    : "card_copies";
  const missing = (
    await client.query(
      `SELECT DISTINCT c.id AS card_id,c.family,c.name FROM ${rewardsTable} cp
    LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
    JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
    LEFT JOIN weekly_challenge_card_dimensions d ON d.challenge_id=$1 AND d.card_id=c.id
    WHERE cp.source='collect' AND cp.obtained_at >= $2 AND cp.obtained_at < $3
      AND d.card_id IS NULL`,
      [challenge.id, challenge.starts_at, challenge.ends_at],
    )
  ).rows;
  await snapshotDimensions(client, challenge, missing);
  const objectives = (
    await client.query(
      `SELECT id, position, kind, target, label FROM weekly_challenge_objectives
    WHERE challenge_id=$1 ORDER BY position`,
      [challenge.id],
    )
  ).rows;
  const participants = (
    await client.query(
      `SELECT DISTINCT u.id,u.username,u.avatar FROM ${rewardsTable} cp
    JOIN users u ON u.id=cp.user_id
    WHERE cp.source='collect' AND cp.obtained_at >= $1 AND cp.obtained_at < $2`,
      [challenge.starts_at, challenge.ends_at],
    )
  ).rows;
  const units = (
    await client.query(
      `WITH matched AS (
    SELECT cp.user_id, o.id AS objective_id, cp.obtained_at,
      CASE o.kind
        WHEN 'arrondissement' THEN CASE WHEN d.family='street' THEN d.arrondissement::text END
        WHEN 'quartier' THEN CASE WHEN d.family='street' THEN d.quartier END
        WHEN 'famous' THEN CASE WHEN d.family='street' AND d.famous THEN d.card_id::text END
        WHEN 'main' THEN CASE WHEN d.family='street' AND d.main THEN d.card_id::text END
        ELSE CASE WHEN d.family=o.kind THEN d.card_id::text END
      END AS unit_key
    FROM ${rewardsTable} cp
    LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id
    JOIN weekly_challenge_card_dimensions d ON d.challenge_id=$1
      AND d.card_id=COALESCE(m.canonical_card_id,cp.card_id)
    JOIN weekly_challenge_objectives o ON o.challenge_id=d.challenge_id
    WHERE cp.source='collect' AND cp.obtained_at >= $2 AND cp.obtained_at < $3
  ) SELECT user_id,objective_id,unit_key,MIN(obtained_at) AS first_at FROM matched
    WHERE unit_key IS NOT NULL GROUP BY user_id,objective_id,unit_key`,
      [challenge.id, challenge.starts_at, challenge.ends_at],
    )
  ).rows;
  return {
    objectives,
    rows: calculateResults(challenge, objectives, participants, units),
  };
}

async function getWeekBounds(client, at = null) {
  return (
    await client.query(
      `WITH local_week AS (
    SELECT date_trunc('week', timezone('Europe/Paris', COALESCE($1::timestamptz, NOW()))) AS monday
  ) SELECT to_char(monday, 'YYYY-MM-DD') AS week_start,
    monday AT TIME ZONE 'Europe/Paris' AS starts_at,
    (monday + interval '7 days') AT TIME ZONE 'Europe/Paris' AS ends_at FROM local_week`,
      [at],
    )
  ).rows[0];
}

async function ensureCurrentChallenge(pool, at = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('collect-weekly-challenge'))",
    );
    const week = await getWeekBounds(client, at);
    const previous = (
      await client.query(
        `SELECT * FROM weekly_challenges
      WHERE week_start < $1 AND finalized_at IS NULL ORDER BY week_start`,
        [week.week_start],
      )
    ).rows;
    for (const old of previous) {
      const scored = await scoreChallenge(client, old);
      for (const row of scored.rows) {
        await client.query(
          `INSERT INTO weekly_challenge_results(challenge_id,user_id,score,completed_at,rank,progress)
          VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(challenge_id,user_id) DO NOTHING`,
          [
            old.id,
            row.userId,
            row.score,
            row.completedAt,
            row.rank,
            JSON.stringify(row.progress),
          ],
        );
      }
      await client.query(
        "UPDATE weekly_challenges SET finalized_at=NOW() WHERE id=$1",
        [old.id],
      );
    }
    let challenge = (
      await client.query(
        "SELECT * FROM weekly_challenges WHERE week_start=$1",
        [week.week_start],
      )
    ).rows[0];
    if (!challenge) {
      const categorySetting = (
        await client.query(
          "SELECT value_text FROM app_settings WHERE key='content_lists_v1'",
        )
      ).rows[0]?.value_text;
      let categories = {};
      try {
        categories = categorySetting ? JSON.parse(categorySetting) : {};
      } catch {
        categories = {};
      }
      const cards = (
        await client.query(`SELECT id AS card_id,family,name FROM cards
        WHERE status='active' AND catalog_present
          AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=cards.id)`)
      ).rows;
      const metadata = streetMetadata(categories);
      const dimensions = cards.map((card) => ({
        ...card,
        ...(card.family === "street"
          ? metadata.get(normalize(card.name))
          : null),
      }));
      const planned = (
        await client.query(
          "SELECT objectives FROM admin_events WHERE week_start=$1",
          [week.week_start],
        )
      ).rows[0];
      const objectives = planned
        ? planned.objectives
        : chooseObjectives(dimensions);
      if (
        planned &&
        objectives.some(
          (o) =>
            new Set(dimensions.map((d) => unitKey(o.kind, d)).filter(Boolean))
              .size < o.target,
        )
      )
        throw new Error(
          "Le défi planifié ne correspond plus au catalogue actif",
        );
      challenge = (
        await client.query(
          `INSERT INTO weekly_challenges(week_start,starts_at,ends_at,category_snapshot)
        VALUES($1,$2,$3,$4::jsonb) RETURNING *`,
          [
            week.week_start,
            week.starts_at,
            week.ends_at,
            JSON.stringify({
              famousStreets: categories.famousStreets,
              mainStreets: categories.mainStreets,
            }),
          ],
        )
      ).rows[0];
      for (const objective of objectives) {
        await client.query(
          `INSERT INTO weekly_challenge_objectives(challenge_id,position,kind,target,label)
          VALUES($1,$2,$3,$4,$5)`,
          [
            challenge.id,
            objective.position,
            objective.kind,
            objective.target,
            objective.label,
          ],
        );
      }
      await snapshotDimensions(client, challenge, dimensions);
    }
    await client.query("COMMIT");
    return { ...challenge, week_start: week.week_start };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function awardWeeklyBadges(pool, rows) {
  await pool.query(`INSERT INTO collect_badges(slug,name,description,rule_json) VALUES
    ('collect-weekly-participant','Premier défi','Participer à un défi hebdomadaire avec un exemplaire Collect.','{"type":"weekly_participation"}'),
    ('collect-weekly-complete','Défi accompli','Terminer tous les objectifs d’un défi hebdomadaire.','{"type":"weekly_complete"}') ON CONFLICT(slug) DO NOTHING`);
  for (const [slug, ids] of [
    ["collect-weekly-participant", rows.map((r) => r.userId)],
    [
      "collect-weekly-complete",
      rows.filter((r) => Number(r.score) === 100).map((r) => r.userId),
    ],
  ]) {
    if (ids.length)
      await pool.query(
        `INSERT INTO user_collect_badges(user_id,badge_id) SELECT unnest($2::integer[]),id FROM collect_badges WHERE slug=$1 ON CONFLICT DO NOTHING`,
        [slug, ids],
      );
  }
}
async function getWeeklyHistory(pool, userId) {
  await ensureCurrentChallenge(pool);
  const weeks = (
    await pool.query(
      `SELECT to_char(w.week_start,'YYYY-MM-DD') AS week_start,w.starts_at,w.ends_at,w.finalized_at,r.score,r.rank,r.completed_at
    FROM weekly_challenges w LEFT JOIN weekly_challenge_results r ON r.challenge_id=w.id AND r.user_id=$1
    ORDER BY w.week_start DESC LIMIT 26`,
      [userId],
    )
  ).rows;
  const past = (
    await pool.query(
      `SELECT user_id AS "userId",score FROM weekly_challenge_results WHERE user_id=$1`,
      [userId],
    )
  ).rows;
  await awardWeeklyBadges(pool, past);
  return weeks;
}
async function getWeeklyChallenge(pool, userId, weekStart = null) {
  let challenge = await ensureCurrentChallenge(pool);
  if (weekStart && weekStart !== challenge.week_start) {
    challenge = (
      await pool.query(
        "SELECT *,to_char(week_start,'YYYY-MM-DD') AS week_start FROM weekly_challenges WHERE week_start=$1 AND finalized_at IS NOT NULL",
        [weekStart],
      )
    ).rows[0];
    if (!challenge)
      throw Object.assign(new Error("Défi introuvable"), { status: 404 });
  }
  let scored;
  if (challenge.finalized_at) {
    const objectives = (
      await pool.query(
        "SELECT id,position,kind,target,label FROM weekly_challenge_objectives WHERE challenge_id=$1 ORDER BY position",
        [challenge.id],
      )
    ).rows;
    const rows = (
      await pool.query(
        `SELECT r.user_id AS "userId",u.username,u.avatar,r.score,r.rank,r.progress,r.completed_at AS "completedAt"
      FROM weekly_challenge_results r JOIN users u ON u.id=r.user_id WHERE r.challenge_id=$1 ORDER BY r.rank`,
        [challenge.id],
      )
    ).rows;
    scored = { objectives, rows };
  } else scored = await scoreChallenge(pool, challenge);
  await awardWeeklyBadges(pool, scored.rows);
  const { ensureRewardPolicy, awardWeeklyPrize } = require("./weekly-rewards");
  const rewardPolicy = await ensureRewardPolicy(
    pool,
    challenge,
    scored.objectives,
  );
  const personal = scored.rows.find((row) => row.userId === Number(userId)) || {
    userId: Number(userId),
    score: 0,
    rank: null,
    completedAt: null,
    progress: scored.objectives.map((objective) => ({
      ...objective,
      current: 0,
    })),
  };
  const reward = await awardWeeklyPrize(
    pool,
    challenge,
    userId,
    personal,
    rewardPolicy,
  );
  return {
    weekStart: challenge.week_start,
    startsAt: challenge.starts_at,
    endsAt: challenge.ends_at,
    objectives: scored.objectives,
    rewardPolicy,
    reward,
    personal,
    leaderboard: scored.rows.slice(0, 25),
  };
}

module.exports = {
  normalize,
  unitKey,
  chooseObjectives,
  calculateResults,
  scoreChallenge,
  getWeekBounds,
  ensureCurrentChallenge,
  getWeeklyChallenge,
  getWeeklyHistory,
};

Object.assign(module.exports, { streetMetadata, normalize, unitKey });
