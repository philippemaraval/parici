"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createTestDatabase } = require("./test-database");
test(
  "fragment bank upgrade preserves copies, progress, history, snapshots and manual content",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 180000 },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_fragment_bank",
    );
    process.env.DATABASE_URL = isolated.url;
    const db = require("../../backend/database");
    const collect = require("../../backend/collect-database");
    t.after(async () => {
      await db.pool.end();
      await isolated.cleanup();
    });
    await db.initDb();
    const pool = db.pool;
    assert.equal(
      Number(
        (await pool.query("SELECT COUNT(*) FROM cards WHERE fragments_enabled"))
          .rows[0].count,
      ),
      102,
    );
    assert.equal(
      Number(
        (await pool.query("SELECT COUNT(*) FROM collect_questions")).rows[0]
          .count,
      ),
      299,
    );
    const user = (
      await pool.query(
        "INSERT INTO users(username,password_hash) VALUES('fragment_upgrade_test','isolated-unused-password') RETURNING id",
      )
    ).rows[0];
    const card = (
      await pool.query(
        "SELECT * FROM cards WHERE family='street' AND name='Place des Vosges'",
      )
    ).rows[0];
    const old = (
      await pool.query(
        "SELECT * FROM collect_questions WHERE card_id=$1 ORDER BY position LIMIT 1",
        [card.id],
      )
    ).rows[0];
    await pool.query(
      "UPDATE collect_questions SET text='Ancienne formulation conservée dans un instantané' WHERE id=$1",
      [old.id],
    );
    await pool.query(
      "INSERT INTO card_copies(user_id,card_id,source) VALUES($1,$2,'collect')",
      [user.id, card.id],
    );
    await pool.query(
      "INSERT INTO collect_fragment_progress(user_id,card_id,fragments) VALUES($1,$2,1)",
      [user.id, card.id],
    );
    const game = crypto.randomUUID();
    await pool.query(
      "INSERT INTO collect_games(id,user_id,card_id,question_snapshot) VALUES($1,$2,$3,$4)",
      [
        game,
        user.id,
        card.id,
        JSON.stringify({ ...old, required: 3, count: 1 }),
      ],
    );
    await pool.query(
      "INSERT INTO collect_question_history(game_id,user_id,card_id,question_id) VALUES($1,$2,$3,$4)",
      [game, user.id, card.id, old.id],
    );
    const manual = (
      await pool.query(
        "SELECT * FROM cards WHERE family='bus' AND name='Métro 6'",
      )
    ).rows[0];
    await pool.query(
      "UPDATE collect_questions SET text='Texte manuel protégé' WHERE card_id=$1",
      [manual.id],
    );
    await pool.query(
      "INSERT INTO collect_content_corrections(card_id,before_json,after_json) VALUES($1,'{}','{}')",
      [manual.id],
    );
    const manuallyConfigured = (
      await pool.query(
        "SELECT id FROM cards WHERE family='bus' AND name='Métro 14'",
      )
    ).rows[0];
    const manualConfig = await collect.getCollectFragments(
      manuallyConfigured.id,
    );
    manualConfig.questions[0].text = "Question administrateur à conserver";
    await collect.saveCollectFragments(manuallyConfigured.id, {
      enabled: true,
      required: 4,
      questions: manualConfig.questions,
    });
    await pool.query(
      "DELETE FROM app_settings WHERE key='parici_fragment_bank_revision'",
    );
    // Recreate an existing pre-upgrade catalogue rather than replaying the same revision.
    await pool.query("DELETE FROM collect_fragment_bank_archives");
    await pool.query(
      "UPDATE cards SET base_rarity=LEAST(base_rarity,4),current_rarity=LEAST(current_rarity,4)",
    );
    await pool.query(
      "ALTER TABLE cards DROP CONSTRAINT cards_base_rarity_check; ALTER TABLE cards ADD CONSTRAINT cards_base_rarity_check CHECK(base_rarity BETWEEN 1 AND 4)",
    );
    await pool.query(
      "DELETE FROM app_settings WHERE key='parici_curated_rarity_revision'",
    );
    await pool.query("UPDATE cards SET fragments_required=3 WHERE id=$1", [
      card.id,
    ]);
    await pool.query(
      "INSERT INTO collect_questions(id,card_id,position,theme,text,answers,correct_index,explanation,sources) VALUES($1,$2,2,'Histoire','Question ancienne supplémentaire','[\"a\",\"b\",\"c\",\"d\"]',0,'Archive à conserver','[]')",
      [crypto.randomUUID(), card.id],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await require("../../backend/domains/collect/curated-rarities").applyCuratedRarities(
        client,
      );
      await require("../../backend/domains/collect/fragment-bank").applyFragmentBank(
        client,
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT COUNT(*) FROM card_copies WHERE user_id=$1",
            [user.id],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT fragments FROM collect_fragment_progress WHERE user_id=$1 AND card_id=$2",
          [user.id, card.id],
        )
      ).rows[0].fragments,
      1,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT question_snapshot FROM collect_games WHERE id=$1",
          [game],
        )
      ).rows[0].question_snapshot,
      { ...old, required: 3, count: 1 },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT question_id FROM collect_question_history WHERE game_id=$1",
          [game],
        )
      ).rows[0].question_id,
      old.id,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT id FROM collect_questions WHERE card_id=$1 AND position=0",
          [card.id],
        )
      ).rows[0].id,
      old.id,
    );
    assert.match(
      (
        await pool.query(
          "SELECT question_json->>'text' AS text FROM collect_fragment_bank_archives WHERE question_id=$1",
          [old.id],
        )
      ).rows[0].text,
      /Ancienne formulation/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT text FROM collect_questions WHERE card_id=$1 LIMIT 1",
          [manual.id],
        )
      ).rows[0].text,
      "Texte manuel protégé",
    );
    assert.equal(
      (await collect.getCollectFragments(manuallyConfigured.id)).questions[0]
        .text,
      "Question administrateur à conserver",
    );
    const before = (
      await pool.query("SELECT COUNT(*) FROM collect_fragment_bank_archives")
    ).rows[0].count;
    await db.initDb();
    assert.equal(
      (await pool.query("SELECT COUNT(*) FROM collect_fragment_bank_archives"))
        .rows[0].count,
      before,
    );
    assert.equal(
      Number(
        (await pool.query("SELECT COUNT(*) FROM collect_questions")).rows[0]
          .count,
      ),
      299,
    );
  },
);
