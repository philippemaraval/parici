"use strict";
const crypto = require("node:crypto");
const templates =
  require("../../../data/collect_weekly_templates.json").templates;

function rewardPolicy(objectives) {
  const weights = {
    arrondissement: 2,
    quartier: 1.5,
    famous: 2,
    main: 1.5,
    monument: 1.5,
    bus: 2,
    district: 1,
  };
  const effort = objectives.reduce(
    (sum, o) => sum + Number(o.target) * (weights[o.kind] || 1),
    0,
  );
  const difficulty =
    effort > 20 ? "difficile" : effort > 12 ? "intermédiaire" : "accessible";
  const drawWeights =
    difficulty === "difficile"
      ? [0, 20, 44, 34, 2]
      : difficulty === "intermédiaire"
        ? [10, 40, 39, 10, 1]
        : [49, 35, 15, 0, 1];
  return {
    version: 2,
    difficulty,
    weights: drawWeights,
    minRarity: drawWeights.findIndex((w) => w > 0) + 1,
    maxRarity: 5,
  };
}
function pickReward(cards, policy, rng = crypto.randomInt) {
  const eligible = cards.filter(
    (c) => Number(policy.weights[Number(c.current_rarity) - 1]) > 0,
  );
  const buckets = [1, 2, 3, 4, 5].filter((r) =>
    eligible.some((c) => Number(c.current_rarity) === r),
  );
  const total = buckets.reduce((n, r) => n + policy.weights[r - 1], 0);
  if (!total) return null;
  let roll = rng(total),
    rarity = buckets.at(-1);
  for (const r of buckets) {
    roll -= policy.weights[r - 1];
    if (roll < 0) {
      rarity = r;
      break;
    }
  }
  const choices = eligible.filter((c) => Number(c.current_rarity) === rarity);
  return choices[rng(choices.length)];
}
async function ensureRewardPolicy(pool, challenge, objectives) {
  if (challenge.reward_policy?.version === 2 || challenge.finalized_at)
    return challenge.reward_policy;
  if (objectives.some((o) => !templates.some((t) => t.kind === o.kind)))
    return null;
  return (
    await pool.query(
      "UPDATE weekly_challenges SET reward_policy=$2::jsonb WHERE id=$1 RETURNING reward_policy",
      [challenge.id, JSON.stringify(rewardPolicy(objectives))],
    )
  ).rows[0].reward_policy;
}
async function awardWeeklyPrize(pool, challenge, userId, personal, policy) {
  if (!policy || Number(personal.score) !== 100 || !personal.completedAt)
    return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    let prize = (
      await client.query(
        "SELECT copy_id,awarded_rarity FROM collect_weekly_rewards WHERE challenge_id=$1 AND user_id=$2",
        [challenge.id, userId],
      )
    ).rows[0];
    let granted = false;
    if (!prize) {
      const cards = (
        await client.query(
          "SELECT id,CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END AS current_rarity FROM cards c WHERE status='active' AND catalog_present AND NOT EXISTS(SELECT 1 FROM collect_card_merges WHERE source_card_id=c.id)",
        )
      ).rows;
      const chosen = pickReward(cards, policy);
      if (!chosen) {
        await client.query("COMMIT");
        return null;
      }
      const available = (
        await client.query(
          "SELECT id,CASE WHEN fragments_enabled THEN 5 ELSE current_rarity END AS current_rarity FROM cards WHERE id=$1 AND status='active' AND catalog_present FOR SHARE",
          [chosen.id],
        )
      ).rows[0];
      if (
        !available ||
        Number(available.current_rarity) !== Number(chosen.current_rarity)
      ) {
        await client.query("COMMIT");
        return null;
      }
      const copy = (
        await client.query(
          "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'weekly') RETURNING id",
          [userId, chosen.id],
        )
      ).rows[0];
      prize = (
        await client.query(
          "INSERT INTO collect_weekly_rewards(challenge_id,user_id,copy_id,awarded_rarity) VALUES($1,$2,$3,$4) RETURNING copy_id,awarded_rarity",
          [challenge.id, userId, copy.id, chosen.current_rarity],
        )
      ).rows[0];
      granted = true;
    }
    const card = (
      await client.query(
        `SELECT c.id,c.name,c.family,c.collection_number,CASE WHEN c.fragments_enabled THEN 5 ELSE c.current_rarity END AS current_rarity,c.fragments_enabled,c.fragments_required,COALESCE(c.image_override,c.image_reference) AS image_reference,c.source_entity_id
      FROM card_copies cp LEFT JOIN collect_card_merges m ON m.source_card_id=cp.card_id JOIN cards c ON c.id=COALESCE(m.canonical_card_id,cp.card_id)
      WHERE cp.id=$1 AND cp.user_id=$2`,
        [prize.copy_id, userId],
      )
    ).rows[0];
    await client.query("COMMIT");
    if (!card)
      return {
        granted: false,
        copyId: prize.copy_id,
        awardedRarity: Number(prize.awarded_rarity),
        card: null,
        noLongerOwned: true,
      };
    const details = require("./catalog-details").cardDetails(
      card.family,
      card.source_entity_id,
    );
    return {
      granted,
      copyId: prize.copy_id,
      awardedRarity: Number(prize.awarded_rarity),
      card: { ...card, ...details, copy_count: 1, revealed: true },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {
  rewardPolicy,
  pickReward,
  ensureRewardPolicy,
  awardWeeklyPrize,
};
