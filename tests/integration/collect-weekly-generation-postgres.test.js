const test = require("node:test");
const assert = require("node:assert/strict");
const templates = require("../../data/collect_weekly_templates.json").templates;
const url = process.env.TEST_DATABASE_URL;

test(
  "new weekly targets preserve existing Paris challenges on PostgreSQL",
  { skip: !url, timeout: 180000 },
  async (t) => {
    const isolated = await require("./test-database").createTestDatabase(
      url,
      "parici_weekly_generation",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    const db = require("../../backend/database");
    const weekly = require("../../backend/domains/collect/weekly-challenge");
    t.after(async () => {
      await db.pool.end();
      await isolated.cleanup();
    });
    await db.initDb();
    const old = (
      await db.pool.query(
        "INSERT INTO weekly_challenges(week_start,starts_at,ends_at,category_snapshot) VALUES('2026-10-19','2026-10-18T22:00:00Z','2026-10-25T23:00:00Z','{}') RETURNING *",
      )
    ).rows[0];
    await db.pool.query(
      "INSERT INTO weekly_challenge_objectives(challenge_id,position,kind,target,label) VALUES($1,1,'monument',2,'Deux monuments')",
      [old.id],
    );
    const objectives = async (id) =>
      (
        await db.pool.query(
          "SELECT kind,target,label FROM weekly_challenge_objectives WHERE challenge_id=$1 ORDER BY position",
          [id],
        )
      ).rows;
    const before = await objectives(old.id);
    const unchanged = await weekly.ensureCurrentChallenge(
      db.pool,
      "2026-10-20T12:00:00Z",
    );
    assert.equal(unchanged.id, old.id);
    assert.deepEqual(await objectives(old.id), before);
    const next = await weekly.ensureCurrentChallenge(
      db.pool,
      "2026-10-26T12:00:00Z",
    );
    const generated = await objectives(next.id);
    assert.ok([2, 3].includes(generated.length));
    for (const objective of generated) {
      const rule = templates.find((r) => r.kind === objective.kind);
      assert.ok(objective.target >= rule.min && objective.target <= rule.max);
      assert.equal(objective.label, rule.label);
    }
    const repeated = await weekly.ensureCurrentChallenge(
      db.pool,
      "2026-10-27T12:00:00Z",
    );
    assert.equal(repeated.id, next.id);
    assert.deepEqual(await objectives(next.id), generated);
    assert.deepEqual(await objectives(old.id), before);
    assert.ok(
      (
        await db.pool.query(
          "SELECT finalized_at FROM weekly_challenges WHERE id=$1",
          [old.id],
        )
      ).rows[0].finalized_at,
    );
  },
);
