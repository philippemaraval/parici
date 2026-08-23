function normalizeStreakCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

function buildDailyAvailabilityPayload() {
  return {
    title: 'Parici Daily',
    body: 'Le Daily est dispo. Lance ta partie du jour !',
    url: '/?view=daily',
    tag: 'parici-daily-reminder',
  };
}

function buildDailyStreakReminderPayload(streakCount) {
  const count = normalizeStreakCount(streakCount);
  const dailyLabel = count === 1 ? 'Daily' : 'Dailies';
  const body = count > 0
    ? `Attention, tu vas briser ta série de ${count} ${dailyLabel} d’affilée ! Termine celui d’aujourd’hui pour garder ta flamme.`
    : 'Le Daily du jour t’attend. Termine-le avant demain pour démarrer ta série !';

  return {
    title: count > 0 ? '🔥 Ta série Parici est en jeu' : '🔥 Lance ta série Parici',
    body,
    url: '/?view=daily',
    tag: 'parici-daily-streak-reminder',
  };
}

module.exports = {
  buildDailyAvailabilityPayload,
  buildDailyStreakReminderPayload,
  normalizeStreakCount,
};
