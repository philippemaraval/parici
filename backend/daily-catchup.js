// One-off recovery for the installed-webapp map outage. Never grants arbitrary dates.
function recoveryDates(user, today) {
    const username = String(user?.username || '').toLowerCase();
    if (today === '2026-09-11' && username === 'robz2295') {
        return ['2026-09-09', '2026-09-10'];
    }
    if (today === '2026-09-10' && ['mphil', 'robz2295', 'victoire'].includes(username)) {
        return ['2026-09-09'];
    }
    return [];
}

async function selectDailyDateForUser(db, user, today) {
    for (const date of recoveryDates(user, today)) {
        const status = await db.getDailyUserStatus(user.id, date);
        if (status?.success || Number(status?.attempts_count || 0) >= 7) continue;
        // Use the exact historical target, never regenerate yesterday's challenge.
        if (!await db.getDailyTarget(date)) {
            throw new Error('Historical Daily target unavailable for catch-up');
        }
        return date;
    }
    return today;
}

async function isCatchUpGuessAllowed(db, user, submittedDate, today) {
    if (!recoveryDates(user, today).includes(submittedDate)) return false;
    return submittedDate === await selectDailyDateForUser(db, user, today);
}

module.exports = { selectDailyDateForUser, isCatchUpGuessAllowed };
