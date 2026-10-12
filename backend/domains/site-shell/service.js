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
  return {
    items,
    unread: items.filter((item) => item.unread).length,
    snapshotAt: snapshot,
    socialThrough: null,
    keys: items.map((item) => item.key),
  };
}
async function opened(db, user, body) {
  if (
    !Array.isArray(body?.keys) ||
    body.keys.length > 10 ||
    body.keys.some(
      (key) =>
        typeof key !== "string" || !/^daily:\d{4}-\d{2}-\d{2}$/.test(key),
    )
  )
    throw invalid();
  const snapshot = new Date(body.snapshotAt);
  if (!Number.isFinite(snapshot.getTime()) || snapshot > new Date())
    throw invalid();
  await db.pool.query(
    "INSERT INTO site_notification_reads(user_id,event_key) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
    [user, body.keys],
  );
  return { unread: 0 };
}
async function settings(db, user, endpoint = "") {
  if (endpoint.length > 4096) throw invalid();
  const daily = await db.getPushSubscriptionStatusForUser(user, { endpoint });
  return { daily: !!daily?.active, socialEnabled: false };
}
module.exports = { inbox, opened, settings };
