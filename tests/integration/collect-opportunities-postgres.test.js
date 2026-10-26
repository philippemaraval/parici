const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const url = process.env.TEST_DATABASE_URL;

test(
  "reciprocal duplicate exchanges on isolated PostgreSQL",
  { skip: !url, timeout: 180000 },
  async (t) => {
    const isolated = await require("./test-database").createTestDatabase(
      url,
      "parici_opportunities",
    );
    process.env.DATABASE_URL = isolated.url;
    delete process.env.COLLECT_V2_ENABLED;
    const db = require("../../backend/database");
    const s = require("../../backend/domains/collect-social/service");
    const suggestions = require("../../backend/domains/collect-social/opportunities");
    const q = (sql, args) => db.pool.query(sql, args);
    t.after(async () => {
      await db.pool.end();
      await isolated.cleanup();
    });
    process.env.NODE_ENV = "production";
    await db.initDb();
    Object.assign(db, require("../../backend/collect-database"));
    await q(
      "INSERT INTO users(id,username,password_hash) VALUES(1,'Alice','local-test-hash'),(2,'Bob','local-test-hash'),(3,'Carol','local-test-hash')",
    );
    const legacyOffer = crypto.randomUUID();
    await q(
      "INSERT INTO collect_trade_offers(id,maker_id,receiver_id,kind,state,offered_ids,requested_ids,request_id) VALUES($1,1,2,'direct','withdrawn',ARRAY[11::bigint],ARRAY[12::bigint],$2)",
      [legacyOffer, crypto.randomUUID()],
    );
    await require("../../backend/domains/collect-social/migrate").migrate(
      db.pool,
    );
    await require("../../backend/domains/collect-social/migrate").migrate(
      db.pool,
    );
    await q(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../migrations/20261026_collect_simple_trades.sql",
        ),
        "utf8",
      ),
    );
    assert.equal(
      (
        await q(
          "SELECT simple_exchange FROM collect_trade_offers WHERE id=$1",
          [legacyOffer],
        )
      ).rows[0].simple_exchange,
      false,
    );
    assert.equal(
      (
        await q(
          "SELECT value_text FROM app_settings WHERE key='collect_simple_trades_schema'",
        )
      ).rows[0].value_text,
      "20261026-1",
    );
    assert.equal(
      (
        await q(
          "SELECT COUNT(*)::int AS n FROM cards WHERE id BETWEEN 1 AND 5 AND family='street'",
        )
      ).rows[0].n,
      5,
    );
    await q(
      "UPDATE cards SET base_rarity=CASE id WHEN 3 THEN 3 WHEN 4 THEN 4 ELSE 2 END WHERE id BETWEEN 1 AND 5",
    );
    const mint = async (user, card, n = 2) =>
      (
        await q(
          `INSERT INTO card_copies(user_id,card_id,source) SELECT $1,$2,'weekly' FROM generate_series(1,$3::int) RETURNING *`,
          [user, card, n],
        )
      ).rows;
    const reset = async () => {
      await q(`DELETE FROM collect_copy_transfers;DELETE FROM collect_trades;DELETE FROM collect_trade_offers;
      DELETE FROM card_copies;DELETE FROM collect_awards;DELETE FROM collect_card_social_settings;
      DELETE FROM collect_blocks;DELETE FROM collect_friendships;DELETE FROM collect_album_goals;
      DELETE FROM collect_personal_albums;DELETE FROM collect_card_merges;
      UPDATE users SET collect_visibility='public',collect_exchange_policy='everyone';
      UPDATE cards SET status='active',catalog_present=TRUE,fragments_enabled=FALSE,fragments_required=0,current_rarity=base_rarity WHERE id BETWEEN 1 AND 5;
      UPDATE cards SET fragments_enabled=TRUE,fragments_required=2 WHERE id=4;`);
      await mint(1, 1);
      await mint(2, 2);
    };
    const choose = async () =>
      (await suggestions.opportunities(db.pool, 1)).opportunities[0];
    const offer = async (row, extra = {}) =>
      s.createOffer(db.pool, 1, {
        simple: true,
        kind: "direct",
        receiverId: row.partner.id,
        offeredIds: [row.give.copyId],
        requestedIds: [row.receive.copyId],
        requestId: crypto.randomUUID(),
        ...extra,
      });

    await t.test(
      "canonical spare copies, matching rarity, album priorities and pagination",
      async () => {
        await reset();
        await mint(1, 4);
        await mint(3, 3);
        await q(
          "INSERT INTO collect_card_merges(source_card_id,canonical_card_id) VALUES(5,1)",
        );
        await mint(1, 5, 1);
        const d = await suggestions.duplicates(db.pool, 1);
        assert.equal(d.total, 1);
        assert.equal(d.cards[0].count, 3);
        assert.equal(d.cards[0].spare, 2);
        const personal = require("../../backend/domains/collect/personal-albums");
        const a = await personal.createAlbum(db.pool, 1, "Mon objectif");
        await personal.addCards(db.pool, 1, a.id, [1, 2]);
        await require("../../backend/domains/collect/player-goals").setAlbumGoal(
          db,
          1,
          "personal-" + a.id,
        );
        const row = await choose();
        assert.equal(row.partner.id, 2);
        assert.equal(row.give.id, 1);
        assert.equal(row.receive.id, 2);
        assert.equal(row.give.rarity, row.receive.rarity);
        assert.equal(row.album.targeted, true);
        assert.deepEqual(
          [row.album.before, row.album.after, row.album.total],
          [1, 2, 2],
        );
        assert.equal(
          (await suggestions.opportunities(db.pool, 1, { cardId: 4 }))
            .opportunities.length,
          0,
        );
        await q(
          "INSERT INTO users(id,username,password_hash) SELECT i,'Partenaire '||i,'local-test-hash' FROM generate_series(10,34)i",
        );
        await q(
          "INSERT INTO card_copies(user_id,card_id,source) SELECT u.id,2,'weekly' FROM users u CROSS JOIN generate_series(1,2) WHERE u.id>=10",
        );
        const first = await suggestions.opportunities(db.pool, 1),
          second = await suggestions.opportunities(db.pool, 1, { page: 2 });
        assert.equal(first.opportunities.length, 20);
        assert.equal(first.hasMore, true);
        assert.equal(second.opportunities.length, 6);
        assert.equal(second.hasMore, false);
        assert.equal(
          new Set(
            [...first.opportunities, ...second.opportunities].map(
              (r) => r.partner.id,
            ),
          ).size,
          26,
        );
        await q("DELETE FROM card_copies WHERE user_id>=10");
        await q("DELETE FROM users WHERE id>=10");
      },
    );
    await t.test(
      "privacy, friendship, exchange policy and block gates work in both directions",
      async () => {
        await reset();
        for (const user of [1, 2])
          for (const column of [
            "collect_visibility",
            "collect_exchange_policy",
          ]) {
            await q(`UPDATE users SET ${column}=$2 WHERE id=$1`, [
              user,
              column === "collect_visibility" ? "private" : "nobody",
            ]);
            assert.equal(
              (await suggestions.opportunities(db.pool, 1)).opportunities
                .length,
              0,
            );
            await q(`UPDATE users SET ${column}=$2 WHERE id=$1`, [
              user,
              column === "collect_visibility" ? "public" : "everyone",
            ]);
          }
        await q(
          "UPDATE users SET collect_visibility='friends',collect_exchange_policy='friends' WHERE id=2",
        );
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
        await s.friendAction(db.pool, 1, 2, "request");
        await s.friendAction(db.pool, 2, 1, "accept");
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          1,
        );
        await s.block(db.pool, 2, 1, true);
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
      },
    );
    await t.test(
      "hidden and protected cards, locked copies, owned targets and fragments are excluded",
      async () => {
        await reset();
        const row = await choose();
        await s.cardSetting(db.pool, 1, 1, {
          locked: false,
          hidden: true,
          open: false,
          wanted: false,
        });
        assert.equal((await suggestions.duplicates(db.pool, 1)).total, 0);
        await assert.rejects(() => offer(row), { status: 409 });
        await s.cardSetting(db.pool, 1, 1, {
          locked: true,
          hidden: false,
          open: false,
          wanted: false,
        });
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
        await s.cardSetting(db.pool, 1, 1, {
          locked: false,
          hidden: false,
          open: false,
          wanted: false,
        });
        await q("UPDATE card_copies SET locked=TRUE WHERE user_id=2");
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
        await q("UPDATE card_copies SET locked=FALSE WHERE user_id=2");
        await mint(1, 2, 1);
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
        await assert.rejects(() => offer(row), { status: 409 });
      },
    );
    await t.test(
      "creation rejects unequal rarities, single copies and legendary cards even with crafted requests",
      async () => {
        await reset();
        const row = await choose();
        await q("UPDATE cards SET current_rarity=3 WHERE id=2");
        await assert.rejects(() => offer(row), { status: 409 });
        await q("UPDATE cards SET current_rarity=2 WHERE id=2");
        await q("DELETE FROM card_copies WHERE user_id=2 AND id<>$1", [
          row.receive.copyId,
        ]);
        await assert.rejects(() => offer(row), { status: 409 });
        const legendary = await mint(2, 4);
        await mint(1, 4);
        await assert.rejects(
          () => offer({ ...row, receive: { copyId: String(legendary[0].id) } }),
          { status: 409 },
        );
        await assert.rejects(
          () =>
            offer(row, {
              offeredIds: [
                row.give.copyId,
                ...legendary.map((c) => String(c.id)),
              ],
            }),
          { status: 409 },
        );
      },
    );
    await t.test(
      "offers are idempotent, hidden from suggestions and revalidated before acceptance",
      async () => {
        await reset();
        const row = await choose(),
          requestId = crypto.randomUUID();
        const o = await offer(row, { requestId });
        assert.equal(o.simple_exchange, true);
        assert.equal((await offer(row, { requestId })).id, o.id);
        assert.equal(
          (await suggestions.opportunities(db.pool, 1)).opportunities.length,
          0,
        );
        await q("DELETE FROM card_copies WHERE user_id=2 AND id<>$1", [
          row.receive.copyId,
        ]);
        await assert.rejects(
          () => s.offerAction(db.pool, 2, o.id, "accept", true),
          { status: 409 },
        );
        assert.equal(
          (await q("SELECT COUNT(*)::int AS n FROM collect_trades")).rows[0].n,
          0,
        );
        assert.equal(
          (
            await q("SELECT user_id FROM card_copies WHERE id=$1", [
              row.give.copyId,
            ])
          ).rows[0].user_id,
          1,
        );
        await s.offerAction(db.pool, 2, o.id, "refuse");
        await reset();
        const r = await choose(),
          pending = await offer(r);
        await q("UPDATE cards SET current_rarity=3 WHERE id=1");
        await assert.rejects(
          () => s.offerAction(db.pool, 2, pending.id, "accept", true),
          { status: 409 },
        );
      },
    );
    await t.test(
      "concurrent acceptances transfer once, keep a copy, retain provenance and save both album summaries",
      async () => {
        await reset();
        await mint(3, 2);
        const personal = require("../../backend/domains/collect/personal-albums");
        for (const owner of [1, 2, 3]) {
          const a = await personal.createAlbum(
            db.pool,
            owner,
            "Album " + owner,
          );
          await personal.addCards(db.pool, owner, a.id, [1, 2]);
        }
        const rows = (await suggestions.opportunities(db.pool, 1))
          .opportunities;
        const one = await offer(rows.find((r) => r.partner.id === 2)),
          two = await offer(rows.find((r) => r.partner.id === 3));
        const receipts = (
          await q("SELECT COUNT(*)::int AS n FROM collect_awards")
        ).rows[0].n;
        const results = await Promise.allSettled([
          s.offerAction(db.pool, 2, one.id, "accept", true),
          s.offerAction(db.pool, 3, two.id, "accept", true),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          (await q("SELECT COUNT(*)::int AS n FROM collect_trades")).rows[0].n,
          1,
        );
        assert.equal(
          (
            await q(
              "SELECT COUNT(*)::int AS n FROM card_copies WHERE user_id=1 AND card_id=1",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await q(
              "SELECT COUNT(*)::int AS n FROM card_copies WHERE user_id=1 AND card_id=2",
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (await q("SELECT COUNT(*)::int AS n FROM collect_awards")).rows[0].n,
          receipts,
        );
        const trade = (await q("SELECT * FROM collect_trades")).rows[0];
        assert.deepEqual(
          [
            trade.summary.progress.maker.collection.before,
            trade.summary.progress.maker.collection.after,
          ],
          [1, 2],
        );
        assert.equal(
          trade.summary.progress.maker.albums.find((a) => a.name === "Album 1")
            .complete,
          true,
        );
        const repeat = await s.offerAction(
          db.pool,
          trade.receiver_id,
          trade.offer_id,
          "accept",
          true,
        );
        assert.equal(repeat.duplicate, true);
        assert.deepEqual(
          repeat.trade.summary.progress.receiver,
          trade.summary.progress.receiver,
        );
        assert.equal(repeat.trade.summary.progress.maker, undefined);
        const makerHistory = (await s.history(db.pool, 1))[0];
        const receiverHistory = (
          await s.history(db.pool, trade.receiver_id)
        )[0];
        assert.deepEqual(
          makerHistory.summary.progress.maker,
          trade.summary.progress.maker,
        );
        assert.equal(makerHistory.summary.progress.receiver, undefined);
        assert.equal(receiverHistory.summary.progress.maker, undefined);
        assert.ok(!JSON.stringify(receiverHistory).includes("Album 1"));
        assert.ok(
          !JSON.stringify(makerHistory).includes("Album " + trade.receiver_id),
        );
        assert.equal(
          (
            await q(
              "SELECT COUNT(*)::int AS n FROM card_copies WHERE acquisition='trade'",
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "HTTP endpoints require authentication and return private non-cacheable suggestions",
      async () => {
        await reset();
        const express = require("express"),
          app = express();
        app.use(express.json());
        app.use(
          "/api/collect/v2",
          require("../../backend/domains/collect-social/router").router(
            db,
            (req, res, next) => {
              if (req.headers.authorization !== "Bearer local-test")
                return res
                  .status(401)
                  .json({ error: "Authentification requise" });
              req.user = { id: 1 };
              next();
            },
            (_req, _res, next) => next(),
          ),
        );
        app.use((err, _req, res, _next) =>
          res.status(err.status || 500).json({ error: err.message }),
        );
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          const endpoint = `http://127.0.0.1:${server.address().port}/api/collect/v2`;
          assert.equal((await fetch(endpoint + "/opportunities")).status, 401);
          const r = await fetch(endpoint + "/opportunities", {
            headers: { authorization: "Bearer local-test" },
          });
          assert.equal(r.status, 200);
          assert.match(r.headers.get("cache-control"), /no-store/);
          assert.equal((await r.json()).opportunities.length, 1);
          assert.equal(
            (
              await fetch(endpoint + "/duplicates?page=-1", {
                headers: { authorization: "Bearer local-test" },
              })
            ).status,
            400,
          );
        } finally {
          await new Promise((r) => server.close(r));
        }
      },
    );
  },
);
