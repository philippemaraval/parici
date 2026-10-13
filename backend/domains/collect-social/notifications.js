"use strict";
const { tick, enabled } = require("./service");
async function dispatch(pool, send, publicKey) {
  await tick(pool);
  if (!send || !publicKey) return;
  const c = await pool.connect();
  let rows;
  try {
    await c.query("BEGIN");
    rows = (
      await c.query(
        `SELECT n.id,n.user_id,n.kind,n.payload FROM collect_social_notifications n JOIN users u ON u.id=n.user_id
   WHERE n.push_status='pending' AND u.collect_social_push AND EXISTS(SELECT 1 FROM push_subscriptions ps WHERE ps.user_id=u.id AND ps.enabled AND ps.collect_enabled AND(ps.vapid_public_key IS NULL OR ps.vapid_public_key=$1))
   ORDER BY n.id LIMIT 50 FOR UPDATE OF n SKIP LOCKED`,
        [publicKey],
      )
    ).rows;
    await c.query(
      "UPDATE collect_social_notifications SET push_status='sending' WHERE id=ANY($1::bigint[])",
      [rows.map((r) => r.id)],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  for (const n of rows) {
    // At-most-once notification dispatch; tags also collapse OS-level duplicates.
    const subscriptions = (
      await pool.query(
        `SELECT ps.endpoint,ps.subscription_json FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE ps.user_id=$1 AND u.collect_social_push AND ps.enabled AND ps.collect_enabled AND(ps.vapid_public_key IS NULL OR ps.vapid_public_key=$2)`,
        [n.user_id, publicKey],
      )
    ).rows;
    let failed = false;
    for (const ps of subscriptions)
      try {
        await send(
          ps.subscription_json,
          JSON.stringify({
            title: "Collect · Amis et échanges",
            body: message(n.kind),
            url: "/collect.html?notifications=1",
            tag: `collect-social-${n.id}`,
          }),
          { TTL: 86400 },
        );
      } catch (e) {
        failed = true;
        if ([404, 410].includes(Number(e.statusCode)))
          await pool.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [
            ps.endpoint,
          ]);
      }
    await pool.query(
      "UPDATE collect_social_notifications SET push_status=$2 WHERE id=$1",
      [n.id, failed ? "failed" : "sent"],
    );
  }
}
function message(kind) {
  return (
    {
      friend_request: "Une demande d’ami t’attend.",
      friend_accepted: "Ta demande d’ami a été acceptée.",
      proposal: "Une proposition d’échange t’attend.",
      counter: "Une contre-proposition t’attend.",
      accepted: "Un échange a été conclu.",
      refused: "Une proposition a été refusée.",
      expired: "Une offre a expiré.",
      reminder: "Une offre expire dans moins de 24 heures.",
    }[kind] || "Tu as une notification Collect."
  );
}
function start(pool, runtime, send) {
  if (!enabled()) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const p = runtime();
      await dispatch(pool, p.enabled ? send : null, p.publicKey);
    } catch (e) {
      console.error("[Collect V2] notifications:", e.message);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, 60000);
  timer.unref?.();
  return () => clearInterval(timer);
}
module.exports = { dispatch, message, start };
