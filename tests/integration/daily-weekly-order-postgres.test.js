const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDatabase } = require("./test-database");

test(
  "weekly Daily ranking matches Monday and breaks multi-day ties by cumulative playing time",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 120000,
  },
  async (t) => {
    const isolated = await createTestDatabase(
      process.env.TEST_DATABASE_URL,
      "parici_weekly_order",
    );
    process.env.DATABASE_URL = isolated.url;
    const db = require("../../backend/database");
    t.after(async () => {
      await db.pool.end();
      await isolated.cleanup();
    });
    await db.initDb();
    async function add(
      username,
      date,
      {
        attempts = 1,
        success = true,
        distance = 0,
        seconds = 10,
        hour = 10,
      } = {},
    ) {
      const user = await db.pool.query(
        "INSERT INTO users(username,password_hash) VALUES($1,'unused-test-password') ON CONFLICT(username) DO UPDATE SET username=EXCLUDED.username RETURNING id",
        [username],
      );
      const ended = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
      const started =
        seconds === null ? null : new Date(ended.getTime() - seconds * 1000);
      await db.pool.query(
        "INSERT INTO daily_user_attempts(user_id,date,attempts_count,success,best_distance_meters,started_at,last_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [user.rows[0].id, date, attempts, success, distance, started, ended],
      );
    }
    const names = (rows) => rows.map((row) => row.username);
    await t.test(
      "Monday: speed wins over finishing earlier; attempts and failure distances keep priority",
      async () => {
        const day = "2099-10-19";
        assert.equal(new Date(`${day}T12:00:00Z`).getUTCDay(), 1);
        await add("later_fast", day, { seconds: 8.482191, hour: 14 });
        await add("earlier_slow", day, { seconds: 19.833691, hour: 8 });
        await add("two_fast", day, { attempts: 2, seconds: 5, hour: 15 });
        await add("two_slow", day, { attempts: 2, seconds: 50, hour: 7 });
        await add("unknown_time", day, { seconds: null, hour: 6 });
        await add("failed_close_slow", day, {
          attempts: 7,
          success: false,
          distance: 100,
          seconds: 90,
          hour: 9,
        });
        await add("failed_close_fast", day, {
          attempts: 7,
          success: false,
          distance: 100,
          seconds: 40,
          hour: 16,
        });
        await add("failed_far", day, {
          attempts: 7,
          success: false,
          distance: 200,
          seconds: 2,
          hour: 5,
        });
        await add("unfinished", day, {
          attempts: 6,
          success: false,
          distance: 1,
          seconds: 1,
        });
        const daily = names(await db.getDailyLeaderboard(day));
        assert.deepEqual(daily, [
          "later_fast",
          "earlier_slow",
          "unknown_time",
          "two_fast",
          "two_slow",
          "failed_close_fast",
          "failed_close_slow",
          "failed_far",
        ]);
        assert.deepEqual(names(await db.getDailyWeeklyLeaderboard(day)), daily);
      },
    );
    await t.test(
      "later days: cumulative gaps precede cumulative time and unknown times do not gain an advantage",
      async () => {
        // A separate week prevents Monday's players from affecting this comparison.
        for (const [username, distance, seconds, hour] of [
          ["fast_total", 100, 10, 15],
          ["slow_total", 100, 30, 8],
          ["closer", 50, 50, 7],
          ["unknown_total", 100, null, 6],
          ["farther", 200, 1, 5],
        ]) {
          await add(username, "2099-10-26", {
            attempts: 2,
            seconds: seconds === null ? 1 : seconds,
            hour,
          });
          await add(username, "2099-10-27", {
            attempts: 7,
            success: false,
            distance,
            seconds,
            hour,
          });
        }
        const weekly = await db.getDailyWeeklyLeaderboard("2099-10-27");
        assert.deepEqual(names(weekly), [
          "closer",
          "fast_total",
          "slow_total",
          "unknown_total",
          "farther",
        ]);
        assert.deepEqual(
          weekly.map((row) => row.total_distance_meters),
          [50, 100, 100, 100, 200],
        );
        assert.ok(
          weekly.every(
            (row) =>
              row.days_played === 2 &&
              row.successes === 1 &&
              row.total_attempts === 9,
          ),
        );
      },
    );
  },
);
