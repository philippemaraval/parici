"use strict";
const invalid = () =>
  Object.assign(new Error("Notifications invalides"), { status: 400 });
async function inbox(db, user, dailyDate) {
  const { day: calendarDay, snapshot } = (
    await db.pool.query(
      "SELECT to_char(timezone('Europe/Paris',NOW()),'YYYY-MM-DD') AS day, clock_timestamp() AS snapshot",
    )
  ).rows[0];
  const day = dailyDate || calendarDay;
  const status = await db.getDailyUserStatus(user, day);
  const key = `daily:${day}`;
  const reads = await db.pool.query(
    "SELECT event_key FROM site_notification_reads WHERE user_id=$1 AND event_key=$2",
    [user, key],
  );
  const items =
    status?.success || Number(status?.attempts_count || 0) >= 7
      ? []
      : [
          {
            key,
            kind: "daily",
            title: "Ton Daily du jour t’attend",
            detail: `${day.split("-").reverse().join("/")} · ${status?.attempts_count ? "Reprendre la partie" : "À toi de jouer"}`,
            url: "/?view=daily",
            createdAt: snapshot,
            unread: !reads.rows.length,
          },
        ];
  const announcements = (
    await db.pool.query(
      `SELECT c.id,c.title,c.body,c.url,d.delivered_at,d.read_at,d.test FROM admin_campaign_deliveries d JOIN admin_campaigns c ON c.id=d.campaign_id WHERE d.user_id=$1 AND d.delivered_at>NOW()-INTERVAL '30 days' ORDER BY d.delivered_at DESC LIMIT 5`,
      [user],
    )
  ).rows;
  for (const n of announcements)
    items.push({
      key: `announcement:${n.id}:${n.test ? "test" : "live"}`,
      kind: "announcement",
      title: n.test ? "Test · " + n.title : n.title,
      detail: n.body,
      url: n.url,
      createdAt: n.delivered_at,
      unread: !n.read_at,
    });
  let socialThrough = null,
    socialUnread = 0;
  const publicCollect = (await require("./public-modes").publicModes(db.pool))
    .collect;
  const social = require("../collect-social/service");
  if (publicCollect) {
    await db.releaseDueCollectQuotas();
    const quota = (
      await db.pool.query(
        "SELECT cycle_copy_id,released_at,seen_at FROM collect_quota_notifications WHERE user_id=$1 AND released_at IS NOT NULL",
        [user],
      )
    ).rows[0];
    if (quota)
      items.push({
        key: `quota:${quota.cycle_copy_id}`,
        kind: "collect",
        title: "De nouvelles cartes Collect sont disponibles",
        detail: "Ton quota est de nouveau disponible.",
        url: "/collect.html?panel=play",
        createdAt: quota.released_at,
        unread: !quota.seen_at,
      });
    if (social.enabled() && social.schemaEnabled()) {
      const rows = (
        await db.pool.query(
          "SELECT id,kind,created_at,read_at FROM collect_social_notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100",
          [user],
        )
      ).rows;
      socialThrough = rows[0]?.id || null;
      socialUnread = Number(
        (
          await db.pool.query(
            "SELECT COUNT(*)::int AS n FROM collect_social_notifications WHERE user_id=$1 AND read_at IS NULL",
            [user],
          )
        ).rows[0].n,
      );
      const labels = {
        friend_request: "Demande d’ami",
        friend_accepted: "Demande d’ami acceptée",
        proposal: "Proposition d’échange",
        counter: "Contre-proposition",
        accepted: "Échange accepté",
        refused: "Proposition refusée",
        expired: "Offre expirée",
        reminder: "Une offre expire bientôt",
      };
      for (const row of rows)
        items.push({
          key: `social:${row.id}`,
          kind: row.kind.startsWith("friend") ? "friend" : "trade",
          title: labels[row.kind] || "Notification Collect",
          detail: "Collect · Amis et échanges",
          url: `/collect.html?panel=social&tab=${row.kind.startsWith("friend") ? "friends" : "offers"}`,
          createdAt: row.created_at,
          unread: !row.read_at,
        });
    }
  }
  items.sort(
    (a, b) =>
      Number(b.unread) - Number(a.unread) ||
      new Date(b.createdAt) - new Date(a.createdAt),
  );
  return {
    items,
    unread:
      items.filter((item) => item.unread && !item.key.startsWith("social:"))
        .length + socialUnread,
    snapshotAt: (await db.pool.query("SELECT clock_timestamp() AS snapshot"))
      .rows[0].snapshot,
    socialThrough,
    keys: items
      .filter((item) => !item.key.startsWith("social:"))
      .map((item) => item.key),
  };
}
async function opened(db, user, body) {
  if (
    !Array.isArray(body?.keys) ||
    body.keys.length > 10 ||
    body.keys.some(
      (key) =>
        typeof key !== "string" ||
        !/^(?:daily:\d{4}-\d{2}-\d{2}|quota:[1-9]\d*|announcement:[1-9]\d*:(?:test|live))$/.test(
          key,
        ),
    )
  )
    throw invalid();
  if (
    body.socialThrough != null &&
    !/^[1-9]\d{0,17}$/.test(String(body.socialThrough))
  )
    throw invalid();
  const snapshot = new Date(body.snapshotAt);
  if (!Number.isFinite(snapshot.getTime()) || snapshot > new Date())
    throw invalid();
  await db.pool.query(
    "INSERT INTO site_notification_reads(user_id,event_key) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
    [user, body.keys],
  );
  for (const key of body.keys.filter((k) => k.startsWith("announcement:"))) {
    const [, id, mode] = key.split(":");
    await db.pool.query(
      "UPDATE admin_campaign_deliveries SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1 AND campaign_id=$2 AND test=$3 AND delivered_at<=$4",
      [user, id, mode === "test", snapshot],
    );
  }
  if ((await require("./public-modes").publicModes(db.pool)).collect) {
    await db.pool.query(
      "UPDATE collect_quota_notifications SET seen_at=COALESCE(seen_at,NOW()) WHERE user_id=$1 AND ('quota:'||cycle_copy_id::text)=ANY($2::text[]) AND released_at<=$3",
      [user, body.keys, snapshot],
    );
    if (body.socialThrough != null)
      await db.pool.query(
        "UPDATE collect_social_notifications SET read_at=COALESCE(read_at,NOW()) WHERE user_id=$1 AND id<=$2 AND created_at<=$3",
        [user, body.socialThrough, snapshot],
      );
  }
  return { unread: 0 };
}
async function settings(db, user, endpoint = "") {
  if (endpoint.length > 4096) throw invalid();
  const daily = await db.getPushSubscriptionStatusForUser(user, { endpoint });
  const row = (
    await db.pool.query("SELECT admin_announcements FROM users WHERE id=$1", [
      user,
    ])
  ).rows[0];
  const publicCollect = (await require("./public-modes").publicModes(db.pool))
    .collect;
  const social = require("../collect-social/service");
  const socialEnabled =
    publicCollect && social.enabled() && social.schemaEnabled();
  const preferences = socialEnabled ? await social.settings(db.pool, user) : {};
  const collect = publicCollect
    ? await db.getCollectNotificationStatus(user)
    : null;
  return {
    daily: !!daily?.active,
    collectPublic: publicCollect,
    collect: !!collect?.pushEnabled,
    socialEnabled,
    ...preferences,
    announcements: row?.admin_announcements !== false,
  };
}
async function saveSettings(db, user, body) {
  if (
    !body ||
    Object.keys(body).some((k) => k !== "announcements") ||
    typeof body.announcements !== "boolean"
  )
    throw invalid();
  await db.pool.query("UPDATE users SET admin_announcements=$2 WHERE id=$1", [
    user,
    body.announcements,
  ]);
  return { saved: true };
}
module.exports = { inbox, opened, settings, saveSettings };
