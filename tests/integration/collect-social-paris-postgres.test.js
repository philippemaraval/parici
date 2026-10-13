const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const url = process.env.TEST_DATABASE_URL;
test(
  "Collect V2: privacy, friends, copy destruction and atomic trades on real PostgreSQL",
  { skip: !url, timeout: 180000 },
  async (t) => {
    const isolated = await require("./test-database").createTestDatabase(
      url,
      "parici_v2",
    );
    process.env.DATABASE_URL = isolated.url;
    process.env.NODE_ENV = "production";
    delete process.env.COLLECT_V2_ENABLED;
    process.env.SECRET_KEY =
      "collect-v2-test-secret-at-least-thirty-two-characters";
    const db = require("../../backend/database"),
      s = require("../../backend/domains/collect-social/service");
    const { app, initializeDatabase } = require("../../backend/server");
    await initializeDatabase({ startBackgroundServices: false });
    await initializeDatabase({ startBackgroundServices: false });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(async () => {
      await new Promise((r) => server.close(r));
      await db.pool.end();
      await isolated.cleanup();
    });
    const request = async (path, user, body, method = "GET") => {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method,
          headers: {
            "content-type": "application/json",
            ...(user ? { authorization: "Bearer " + user.token } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: r.status, body: await r.json() };
    };
    assert.equal((await request("/api/collect/v2/config")).body.enabled, true);
    const people = [];
    for (const name of ["alice", "bob", "carol"]) {
      const r = await request(
        "/api/register",
        null,
        {
          username: "v2_" + name,
          password: "password-v2-test-long",
          recoveryEmail: name + "@example.test",
        },
        "POST",
      );
      assert.equal(r.status, 200);
      people.push(r.body);
    }
    const [a, b, c] = people,
      _me = () => s.settings(db.pool, a.id);
    const cards = (
      await db.pool.query(
        "SELECT id,name,family FROM cards WHERE family='monument' AND status='active' ORDER BY id LIMIT 6",
      )
    ).rows;
    const mint = async (user, card, source = "weekly", day = null) =>
      (
        await db.pool.query(
          "INSERT INTO card_copies(user_id,card_id,source,daily_date,daily_attempt_count) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [user.id, card.id, source, day, day ? 2 : null],
        )
      ).rows[0];
    let aa = await mint(a, cards[0], "daily", "2026-10-08"),
      ab = await mint(a, cards[1]),
      bb = await mint(b, cards[2], "daily", "2026-10-08"),
      bc = await mint(b, cards[3]);
    const offer = (maker, receiver, give, take, extra = {}) =>
      s.createOffer(db.pool, maker.id, {
        kind: "direct",
        receiverId: receiver.id,
        offeredIds: give.map((x) => x.id),
        requestedIds: take.map((x) => x.id),
        requestId: crypto.randomUUID(),
        ...extra,
      });
    await t.test(
      "reciprocal friendship and private/friends visibility enforced on all profile paths",
      async () => {
        await s.settings(db.pool, b.id, {
          visibility: "friends",
          exchanges: "friends",
          push: false,
        });
        assert.equal(
          (await request("/api/collect/profiles/v2_bob", a)).status,
          404,
        );
        await s.friendAction(db.pool, a.id, b.id, "request");
        await assert.rejects(
          () => s.friendAction(db.pool, a.id, b.id, "accept"),
          { status: 403 },
        );
        await s.friendAction(db.pool, b.id, a.id, "accept");
        assert.equal(
          (await request("/api/collect/profiles/v2_bob", a)).status,
          200,
        );
        for (const suffix of [
          "",
          "/collection/page",
          "/albums",
          `/cards/${cards[2].id}`,
        ])
          assert.equal(
            (await request("/api/collect/profiles/v2_bob" + suffix, c)).status,
            404,
          );
        await s.settings(db.pool, b.id, {
          visibility: "private",
          exchanges: "everyone",
          push: false,
        });
        assert.equal(
          (await request("/api/collect/profiles/v2_bob", a)).status,
          404,
        );
        assert.equal(
          (await request("/api/collect/profiles/v2_bob", b)).status,
          200,
        );
        await s.settings(db.pool, b.id, {
          visibility: "public",
          exchanges: "everyone",
          push: false,
        });
      },
    );
    await t.test(
      "specific Daily copies transfer atomically; double accept is idempotent and origin immutable through multiple swaps",
      async () => {
        const o = await offer(a, b, [aa], [bb]);
        await assert.rejects(
          () => s.offerAction(db.pool, c.id, o.id, "accept", true),
          { status: 404 },
        );
        const accept = await Promise.all([
          s.offerAction(db.pool, b.id, o.id, "accept", true),
          s.offerAction(db.pool, b.id, o.id, "accept", true),
        ]);
        assert.equal(accept.filter((v) => v.duplicate).length, 1);
        const row = (
          await db.pool.query("SELECT * FROM card_copies WHERE id=$1", [aa.id])
        ).rows[0];
        assert.equal(row.user_id, b.id);
        assert.equal(row.source, "daily");
        assert.equal(row.daily_attempt_count, 2);
        assert.equal(row.initial_owner_id, a.id);
        assert.equal(row.acquisition, "trade");
        const reverse = await offer(b, a, [aa], [bb]);
        await s.offerAction(db.pool, a.id, reverse.id, "accept", true);
        const returned = (
          await db.pool.query("SELECT * FROM card_copies WHERE id=$1", [aa.id])
        ).rows[0];
        assert.equal(returned.user_id, a.id);
        assert.equal(returned.acquisition, "trade");
        assert.equal(returned.daily_date, "2026-10-08");
        const inventory = await s.inventory(db.pool, a.id, a.id, {
          cardId: cards[0].id,
        });
        assert.equal(inventory.cards[0].earned, 0);
        assert.equal((await s.statistics(db.pool, cards[0].id)).trades, 2);
      },
    );
    await t.test(
      "overlapping proposals are not reserved but only one concurrent acceptance executes",
      async () => {
        const cc = await mint(c, cards[4]);
        const one = await offer(a, b, [ab], [bc]),
          two = await offer(a, c, [ab], [cc]);
        const outcomes = await Promise.allSettled([
          s.offerAction(db.pool, b.id, one.id, "accept", true),
          s.offerAction(db.pool, c.id, two.id, "accept", true),
        ]);
        assert.equal(
          outcomes.filter((x) => x.status === "fulfilled").length,
          1,
        );
        const rows = (
          await db.pool.query(
            "SELECT state FROM collect_trade_offers WHERE id=ANY($1::uuid[])",
            [[one.id, two.id]],
          )
        ).rows;
        assert.deepEqual(rows.map((r) => r.state).sort(), [
          "accepted",
          "invalid",
        ]);
      },
    );
    await t.test(
      "locks, no gifts, no duplicate IDs, no unconfirmed or foreign destruction",
      async () => {
        await assert.rejects(() => offer(a, b, [aa, aa], [bb]), {
          status: 400,
        });
        await assert.rejects(() => offer(a, b, [aa], []), { status: 400 });
        await s.lockCopy(db.pool, a.id, aa.id, true);
        await assert.rejects(() => offer(a, b, [aa], [bb]), { status: 409 });
        await assert.rejects(() => s.destroy(db.pool, a.id, [aa.id], true), {
          status: 409,
        });
        await s.lockCopy(db.pool, a.id, aa.id, false);
        await s.cardSetting(db.pool, a.id, cards[0].id, {
          locked: true,
          hidden: false,
          open: true,
          wanted: false,
        });
        await assert.rejects(() => offer(a, b, [aa], [bb]), { status: 409 });
        await s.cardSetting(db.pool, a.id, cards[0].id, {
          locked: false,
          hidden: false,
          open: true,
          wanted: false,
        });
        await assert.rejects(() => s.destroy(db.pool, c.id, [aa.id], true), {
          status: 409,
        });
        await assert.rejects(() => s.destroy(db.pool, a.id, [aa.id], false), {
          status: 400,
        });
      },
    );
    await t.test(
      "independent 25 direct / 25 market quotas, withdrawal, expiration and reminders deduplicated",
      async () => {
        const x = await mint(a, cards[4]),
          y = await mint(b, cards[5]);
        await db.pool.query(
          "UPDATE collect_trade_offers SET state='withdrawn' WHERE state='active'",
        );
        const direct = [];
        for (let i = 0; i < 25; i++) direct.push(await offer(a, b, [x], [y]));
        await assert.rejects(() => offer(a, b, [x], [y]), { status: 409 });
        const market = [];
        for (let i = 0; i < 25; i++)
          market.push(
            await s.createOffer(db.pool, a.id, {
              kind: "market",
              offeredIds: [x.id],
              wanted: [],
              requestId: crypto.randomUUID(),
            }),
          );
        await assert.rejects(
          () =>
            s.createOffer(db.pool, a.id, {
              kind: "market",
              offeredIds: [x.id],
              requestId: crypto.randomUUID(),
            }),
          { status: 409 },
        );
        await s.offerAction(db.pool, a.id, direct[0].id, "withdraw");
        await offer(a, b, [x], [y]);
        await db.pool.query(
          "UPDATE collect_trade_offers SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [direct[1].id],
        );
        await s.tick(db.pool);
        await s.tick(db.pool);
        const expired = (
          await db.pool.query(
            "SELECT COUNT(*)::int AS n FROM collect_social_notifications WHERE event_key=$1",
            ["offer-expired:" + direct[1].id],
          )
        ).rows[0];
        assert.equal(expired.n, 2);
        await db.pool.query(
          "UPDATE collect_trade_offers SET expires_at=NOW()+INTERVAL '23 hours' WHERE id=$1",
          [direct[2].id],
        );
        await s.tick(db.pool);
        await s.tick(db.pool);
        assert.equal(
          (
            await db.pool.query(
              "SELECT COUNT(*)::int AS n FROM collect_social_notifications WHERE event_key=$1",
              ["offer-reminder:" + direct[2].id],
            )
          ).rows[0].n,
          2,
        );
        await db.pool.query(
          "UPDATE collect_trade_offers SET state='withdrawn' WHERE state='active'",
        );
      },
    );
    await t.test(
      "counterproposal closes original and blocks forbid friendship, offers and acceptance",
      async () => {
        const x = await mint(a, cards[1]),
          y = await mint(b, cards[3]);
        const o = await offer(a, b, [x], [y]);
        const counter = await offer(b, a, [y], [x], { parentId: o.id });
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [o.id],
            )
          ).rows[0].state,
          "countered",
        );
        await s.block(db.pool, a.id, b.id, true);
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [counter.id],
            )
          ).rows[0].state,
          "invalid",
        );
        await assert.rejects(
          () => s.friendAction(db.pool, b.id, a.id, "request"),
          { status: 403 },
        );
        await assert.rejects(() => offer(b, a, [y], [x]), { status: 403 });
        await s.block(db.pool, a.id, b.id, false);
      },
    );
    await t.test(
      "market stays active while quantities exist, accepts exact selected copies and invalidates after last copy leaves",
      async () => {
        const x = await mint(a, cards[4]),
          x2 = await mint(a, cards[4]),
          y = await mint(b, cards[5]);
        const listing = await s.createOffer(db.pool, a.id, {
          kind: "market",
          offeredIds: [x.id],
          wanted: [{ cardId: cards[5].id, quantity: 1 }],
          requestId: crypto.randomUUID(),
        });
        const response = await offer(b, a, [y], [x], {
          parentId: listing.id,
          exact: true,
        });
        await s.offerAction(db.pool, a.id, response.id, "accept", true);
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [listing.id],
            )
          ).rows[0].state,
          "active",
        );
        const y2 = await mint(b, cards[5]),
          response2 = await offer(b, a, [y2], [x2], {
            parentId: listing.id,
            exact: true,
          });
        await s.offerAction(db.pool, a.id, response2.id, "accept", true);
        // Additional copies from earlier scenarios can keep a quantity-based listing alive.
        const rest = (
          await db.pool.query(
            "SELECT id FROM card_copies WHERE user_id=$1 AND card_id=$2",
            [a.id, cards[4].id],
          )
        ).rows;
        if (rest.length)
          await s.destroy(
            db.pool,
            a.id,
            rest.map((r) => r.id),
            true,
          );
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [listing.id],
            )
          ).rows[0].state,
          "invalid",
        );
      },
    );
    await s.settings(db.pool, a.id, {
      visibility: "public",
      exchanges: "everyone",
      push: false,
    });
    await t.test(
      "archived cards exchange, active rarity tie-break and personal album progress are based on currently held copies",
      async () => {
        const x = await mint(a, cards[1]),
          y = await mint(b, cards[3]);
        await db.pool.query("UPDATE cards SET status='archived' WHERE id=$1", [
          cards[1].id,
        ]);
        const o = await offer(a, b, [x], [y]);
        await s.offerAction(db.pool, b.id, o.id, "accept", true);
        const rows = await db.getCollectLeaderboard(25, a.id);
        for (const row of rows) {
          const count = (
            await db.pool.query(
              "SELECT COUNT(DISTINCT card_id)::int AS n FROM card_copies cp JOIN cards c ON c.id=cp.card_id WHERE cp.user_id=$1 AND c.status='active'",
              [row.user_id],
            )
          ).rows[0].n;
          assert.equal(row.owned_cards, count);
        }
        await db.pool.query("UPDATE cards SET status='active' WHERE id=$1", [
          cards[1].id,
        ]);
        const album = (
          await db.pool.query(
            "INSERT INTO collect_personal_albums(user_id,name) VALUES($1,'V2 test') RETURNING id",
            [a.id],
          )
        ).rows[0];
        await db.pool.query(
          "INSERT INTO collect_personal_album_cards(album_id,card_id) VALUES($1,$2)",
          [album.id, cards[0].id],
        );
        const progress = (await s.personalProgress(db.pool, a.id)).find(
          (p) => p.id === album.id,
        );
        assert.equal(progress.owned, 1);
        assert.equal(progress.earned, 0);
      },
    );
    await t.test(
      "destruction changes circulation, invalidates proposals and does not reset award quotas",
      async () => {
        const x = await mint(a, cards[5]),
          y = await mint(b, cards[2]);
        const before = await s.statistics(db.pool, cards[5].id),
          o = await offer(a, b, [x], [y]);
        await s.destroy(db.pool, a.id, [x.id], true);
        assert.equal(
          (await s.statistics(db.pool, cards[5].id)).circulation,
          before.circulation - 1,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [o.id],
            )
          ).rows[0].state,
          "invalid",
        );
        const quotaUser = c;
        await db.pool.query(
          "UPDATE collect_awards SET obtained_at=NOW()-INTERVAL '1 day' WHERE user_id=$1",
          [quotaUser.id],
        );
        const q = [];
        for (let i = 0; i < 4; i++)
          q.push(await mint(quotaUser, cards[0], "collect"));
        const weekly = require("../../backend/domains/collect/weekly-challenge");
        const challenge = (
          await db.pool.query(
            "INSERT INTO weekly_challenges(week_start,starts_at,ends_at,category_snapshot) VALUES('2099-01-05',NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day','{}') RETURNING *",
          )
        ).rows[0];
        await db.pool.query(
          "INSERT INTO weekly_challenge_objectives(challenge_id,position,kind,target,label) VALUES($1,1,'monument',2,'Deux monuments')",
          [challenge.id],
        );
        const weeklyBefore = (await weekly.scoreChallenge(db.pool, challenge))
          .rows;
        const scoreBefore = weeklyBefore.find(
          (row) => row.userId === quotaUser.id,
        ).score;
        assert.ok(scoreBefore > 0);
        const tradeReward = await offer(quotaUser, b, [q[0]], [y]);
        await s.offerAction(db.pool, b.id, tradeReward.id, "accept", true);
        const weeklyAfterTrade = (
          await weekly.scoreChallenge(db.pool, challenge)
        ).rows;
        assert.equal(
          weeklyAfterTrade.find((row) => row.userId === quotaUser.id).score,
          scoreBefore,
        );
        assert.ok(
          !weeklyAfterTrade.some((row) => row.userId === b.id),
          "Received copies never create weekly performance",
        );
        await s.destroy(db.pool, b.id, [q[0].id], true);
        await s.destroy(
          db.pool,
          quotaUser.id,
          q.slice(1).map((r) => r.id),
          true,
        );
        assert.equal(
          (await weekly.scoreChallenge(db.pool, challenge)).rows.find(
            (row) => row.userId === quotaUser.id,
          ).score,
          scoreBefore,
        );
        assert.equal((await db.getCollectQuota(quotaUser.id)).copies, 4);
        await assert.rejects(
          () => mint(quotaUser, cards[0], "collect"),
          /collect_reward_quota_reached/,
        );
        await s.destroy(db.pool, a.id, [aa.id], true);
        assert.equal(
          (
            await db.pool.query(
              "SELECT COUNT(*)::int AS n FROM collect_awards WHERE user_id=$1 AND source='daily' AND daily_date='2026-10-08'",
              [a.id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "database failure rolls back every copy, receipt and notification",
      async () => {
        const x = await mint(a, cards[1]),
          y = await mint(b, cards[2]),
          o = await offer(a, b, [x], [y]);
        await db.pool.query(
          `CREATE FUNCTION v2_test_reject_second_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id=${Number(a.id)} AND OLD.user_id<>NEW.user_id THEN RAISE EXCEPTION 'test_transfer_abort'; END IF;RETURN NEW; END $$;CREATE TRIGGER v2_test_abort AFTER UPDATE OF user_id ON card_copies FOR EACH ROW EXECUTE FUNCTION v2_test_reject_second_transfer()`,
        );
        try {
          await assert.rejects(
            () => s.offerAction(db.pool, b.id, o.id, "accept", true),
            /test_transfer_abort/,
          );
        } finally {
          await db.pool.query(
            "DROP TRIGGER v2_test_abort ON card_copies;DROP FUNCTION v2_test_reject_second_transfer()",
          );
        }
        const copies = (
          await db.pool.query(
            "SELECT id,user_id FROM card_copies WHERE id=ANY($1::bigint[]) ORDER BY id",
            [[x.id, y.id]],
          )
        ).rows;
        assert.equal(copies[0].user_id, a.id);
        assert.equal(copies[1].user_id, b.id);
        assert.equal(
          (
            await db.pool.query(
              "SELECT COUNT(*)::int AS n FROM collect_trades WHERE offer_id=$1",
              [o.id],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT state FROM collect_trade_offers WHERE id=$1",
              [o.id],
            )
          ).rows[0].state,
          "active",
        );
        await s.offerAction(db.pool, a.id, o.id, "withdraw");
      },
    );
    await t.test(
      "real Daily reward cannot be reissued after destruction; V2 can be hidden without breaking V1",
      async () => {
        await db.pool.query(
          "UPDATE app_settings SET value_text=NOW()::text WHERE key='collect_launch_at'",
        );
        const registration = await request(
            "/api/register",
            null,
            {
              username: "v2_daily",
              password: "password-v2-test-long",
              recoveryEmail: "daily@example.test",
            },
            "POST",
          ),
          d = registration.body;
        const daily = (await request("/api/daily", d)).body,
          guess = {
            date: daily.date,
            answerName: daily.displayStreetName || daily.streetName,
            requestId: crypto.randomUUID(),
          };
        const won = await request("/api/daily/guess", d, guess, "POST");
        assert.equal(won.status, 200);
        assert.equal(won.body.success, true);
        const cp = (
          await db.pool.query(
            "SELECT id FROM card_copies WHERE user_id=$1 AND source='daily'",
            [d.id],
          )
        ).rows[0];
        assert.ok(cp);
        await s.destroy(db.pool, d.id, [cp.id], true);
        assert.equal(
          (await request("/api/daily/guess", d, guess, "POST")).status,
          200,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT COUNT(*)::int AS n FROM card_copies WHERE user_id=$1",
              [d.id],
            )
          ).rows[0].n,
          0,
        );
        process.env.COLLECT_V2_ENABLED = "false";
        assert.equal(
          (await request("/api/collect/v2/config", d)).body.enabled,
          false,
        );
        assert.equal((await request("/api/collect/v2/me", d)).status, 404);
        assert.equal((await request("/api/collect/quota", d)).status, 200);
        assert.equal((await request("/api/daily", d)).status, 200);
        process.env.COLLECT_V2_ENABLED = "true";
        const personal = await request(
            "/api/collect/collection/page?ownership=earned",
            a,
          ),
          traded = await request(
            "/api/collect/collection/page?ownership=trade",
            a,
          );
        assert.equal(personal.status, 200);
        assert.equal(traded.status, 200);
        assert.ok(
          (await request("/api/collect/albums", a)).body.albums.every((x) =>
            Number.isInteger(x.earned_active_card_count),
          ),
        );
        assert.equal(
          (await request("/api/collect/v2/admin/reports", b)).status,
          403,
        );
        const one = await mint(b, cards[0], "daily", "2026-10-09");
        await assert.rejects(
          () =>
            db.pool.query(
              "UPDATE card_copies SET source='collect',daily_date=NULL,daily_attempt_count=NULL WHERE id=$1",
              [one.id],
            ),
          /collect_copy_origin_immutable/,
        );
      },
    );
    await t.test(
      "push opt-in, reminders, public market privacy and owner availability",
      async () => {
        const {
          dispatch,
        } = require("../../backend/domains/collect-social/notifications");
        await db.pool.query(
          "INSERT INTO push_subscriptions(user_id,endpoint,subscription_json,enabled,collect_enabled,vapid_public_key) VALUES($1,'https://push.example.test/v2','{\"endpoint\":\"https://push.example.test/v2\"}',TRUE,TRUE,'test-vapid')",
          [b.id],
        );
        await s.settings(db.pool, b.id, {
          visibility: "public",
          exchanges: "everyone",
          push: true,
        });
        const sent = [];
        await dispatch(
          db.pool,
          async (_subscription, payload) => sent.push(JSON.parse(payload)),
          "test-vapid",
        );
        assert.ok(sent.length);
        const before = sent.length;
        await dispatch(
          db.pool,
          async (_subscription, payload) => sent.push(JSON.parse(payload)),
          "test-vapid",
        );
        assert.equal(sent.length, before);
        await s.settings(db.pool, b.id, {
          visibility: "public",
          exchanges: "everyone",
          push: false,
        });
        await s.notify(db.pool, b.id, "test-opt-out", "proposal");
        await dispatch(db.pool, async () => sent.push({}), "test-vapid");
        assert.equal(sent.length, before);
        const x = await mint(c, cards[2]);
        const listing = await s.createOffer(db.pool, c.id, {
          kind: "market",
          offeredIds: [x.id],
          requestId: crypto.randomUUID(),
        });
        await s.settings(db.pool, c.id, {
          visibility: "private",
          exchanges: "everyone",
          push: false,
        });
        assert.ok(
          !(await s.offerRows(db.pool, a.id, {}, true)).offers.some(
            (o) => o.id === listing.id,
          ),
        );
        assert.ok(
          (await s.offerRows(db.pool, c.id, {}, true)).offers.some(
            (o) => o.id === listing.id,
          ),
        );
        await s.settings(db.pool, c.id, {
          visibility: "public",
          exchanges: "everyone",
          push: false,
        });
      },
    );
    await t.test(
      "manual matching honours wanted priorities and changing rarity keeps offers executable",
      async () => {
        const given = await mint(a, cards[4]);
        const received = await mint(b, cards[5]);
        for (const [owner, card] of [
          [a, cards[4]],
          [b, cards[5]],
        ])
          await s.cardSetting(db.pool, owner.id, card.id, {
            locked: false,
            hidden: false,
            open: true,
            wanted: false,
          });
        for (const [owner, card] of [
          [a, cards[5]],
          [b, cards[4]],
        ])
          await s.cardSetting(db.pool, owner.id, card.id, {
            locked: false,
            hidden: false,
            open: false,
            wanted: true,
          });
        const match = await s.matching(db.pool, a.id, b.id);
        assert.ok(
          match.give.some((card) => String(card.id) === String(cards[4].id)),
        );
        assert.ok(
          match.receive.some((card) => String(card.id) === String(cards[5].id)),
        );
        const proposed = await offer(a, b, [given], [received]);
        const previous = (
          await db.pool.query("SELECT current_rarity FROM cards WHERE id=$1", [
            cards[4].id,
          ])
        ).rows[0].current_rarity;
        await db.pool.query("UPDATE cards SET current_rarity=$2 WHERE id=$1", [
          cards[4].id,
          previous === 1 ? 2 : 1,
        ]);
        const row = (await s.offerRows(db.pool, b.id)).offers.find(
          (row) => row.id === proposed.id,
        );
        assert.equal(row.state, "active");
        assert.equal(
          row.cards.find((card) => String(card.id) === String(cards[4].id))
            .rarity,
          previous === 1 ? 2 : 1,
        );
        assert.equal(
          (await s.offerAction(db.pool, b.id, proposed.id, "accept", true))
            .state,
          "accepted",
        );
        await db.pool.query("UPDATE cards SET current_rarity=$2 WHERE id=$1", [
          cards[4].id,
          previous,
        ]);
      },
    );
    await t.test(
      "wanted availability, notifications, reporting, feed privacy and account deletion",
      async () => {
        const x = await mint(a, cards[0]);
        await s.cardSetting(db.pool, a.id, cards[0].id, {
          locked: false,
          hidden: false,
          open: true,
          wanted: false,
        });
        assert.ok(
          (await s.owners(db.pool, b.id, cards[0].id)).some(
            (u) => u.id === a.id,
          ),
        );
        await s.cardSetting(db.pool, a.id, cards[0].id, {
          locked: false,
          hidden: true,
          open: true,
          wanted: false,
        });
        assert.ok(
          !(await s.owners(db.pool, b.id, cards[0].id)).some(
            (u) => u.id === a.id,
          ),
        );
        const n = await s.notifications(db.pool, b.id);
        assert.ok(n.some((x) => x.kind === "accepted"));
        assert.equal(new Set(n.map((x) => String(x.id))).size, n.length);
        await s.report(db.pool, a.id, b.id, { reason: "spam" });
        await s.report(db.pool, a.id, b.id, { reason: "spam" });
        assert.equal((await s.adminReports(db.pool)).length, 1);
        await assert.rejects(
          () => s.report(db.pool, a.id, b.id, { reason: "unbalanced" }),
          { status: 400 },
        );
        await s.friendAction(db.pool, a.id, b.id, "request");
        await s.friendAction(db.pool, b.id, a.id, "accept");
        await db.pool.query(
          "INSERT INTO collect_social_activity(user_id,event_key,kind,payload) VALUES($1,'test-milestone','milestone','{\"count\":100}')",
          [b.id],
        );
        assert.ok((await s.activity(db.pool, a.id)).length);
        await s.settings(db.pool, b.id, {
          visibility: "private",
          exchanges: "everyone",
          push: false,
        });
        assert.equal((await s.activity(db.pool, a.id)).length, 0);
        await s.settings(db.pool, b.id, {
          visibility: "public",
          exchanges: "everyone",
          push: false,
        });
        const before = await s.statistics(db.pool, cards[0].id);
        await db.deleteUserById(a.id);
        assert.equal(
          (
            await db.pool.query(
              "SELECT COUNT(*)::int AS n FROM card_copies WHERE user_id=$1",
              [a.id],
            )
          ).rows[0].n,
          0,
        );
        assert.ok(
          (await s.statistics(db.pool, cards[0].id)).circulation <
            before.circulation,
        );
        assert.ok(
          (await s.history(db.pool, b.id)).some((h) => h.other_name === null),
        );
        assert.ok((await s.statistics(db.pool, cards[0].id)).trades >= 2);
        assert.ok(x.id);
      },
    );
  },
);
