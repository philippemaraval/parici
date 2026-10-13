"use strict";
let started = false;
async function tick(db, runtime, send) {
  await db.releaseDueCollectQuotas();
  await require("../collect-social/notifications").dispatch(
    db.pool,
    runtime.enabled ? send : null,
    runtime.publicKey,
  );
  if (!runtime.enabled) return;
  for (const delivery of await db.claimCollectPushDeliveries(
    runtime.publicKey,
  )) {
    try {
      await send(
        delivery.subscription_json,
        JSON.stringify({
          title: "Collect est de nouveau disponible",
          body: "Tu peux gagner une nouvelle carte.",
          url: "/collect.html?panel=play",
          tag: "collect-quota-" + delivery.cycle_copy_id,
        }),
        { TTL: 3600 },
      );
      await db.markCollectPushDelivery(
        delivery.cycle_copy_id,
        delivery.endpoint,
        true,
      );
    } catch (error) {
      if ([404, 410].includes(Number(error.statusCode)))
        await db.removePushSubscriptionByEndpoint(delivery.endpoint);
      await db.markCollectPushDelivery(
        delivery.cycle_copy_id,
        delivery.endpoint,
        [404, 410].includes(Number(error.statusCode)),
      );
    }
  }
}
function start(db, runtime, send) {
  if (started) return;
  started = true;
  let running = false,
    lastMonth = "";
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick(db, runtime(), send);
      await require("./weekly-challenge").ensureCurrentChallenge(db.pool);
      const month = new Intl.DateTimeFormat("fr-CA", {
        timeZone: "Europe/Paris",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      if (month !== lastMonth) {
        await db.recalculateCollectRarity(month);
        lastMonth = month;
      }
    } catch (error) {
      console.error("[Collect] Background:", error.message);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(run, 30000);
  timer.unref?.();
}
module.exports = { start, tick };
