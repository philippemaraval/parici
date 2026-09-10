// One-off recovery for the installed-webapp map outage. Never grants arbitrary dates.
const RECOVERY_DAY = '2026-09-10';
const MISSED_DAY = '2026-09-09';
const RECOVERY_USERS = new Set(['mphil', 'robz2295', 'victoire']);

async function selectDailyDateForUser(db, user, today) {
    if (today !== RECOVERY_DAY || !RECOVERY_USERS.has(String(user.username).toLowerCase())) {
        return today;
    }
    const status = await db.getDailyUserStatus(user.id, MISSED_DAY);
    if (status?.success || Number(status?.attempts_count || 0) >= 7) return today;
    // Use the exact historical target, never regenerate yesterday's challenge.
    if (!await db.getDailyTarget(MISSED_DAY)) {
        throw new Error('Historical Daily target unavailable for catch-up');
    }
    return MISSED_DAY;
}

module.exports = { selectDailyDateForUser };
