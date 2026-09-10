const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDailyDateForUser } = require('../backend/daily-catchup');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('catch-up guesses use the existing yesterday permission and stop after completion', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const functions = source.slice(source.indexOf('function shiftIsoDateKey('), source.indexOf('function slugifyDailyStreetName('));
    let status = { attempts_count: 0, success: false };
    const context = vm.createContext({ db: { getDailyUserStatus: async () => status } });
    vm.runInContext(functions, context);
    assert.equal(await context.isDailyGuessDateAllowed(42, '2026-09-09', '2026-09-10'), true);
    status = { attempts_count: 2, success: true };
    assert.equal(await context.isDailyGuessDateAllowed(42, '2026-09-09', '2026-09-10'), false);
    assert.equal(await context.isDailyGuessDateAllowed(42, '2026-09-10', '2026-09-10'), true);
    assert.equal(await context.isDailyGuessDateAllowed(42, '2026-09-08', '2026-09-10'), false);
});

for (const username of ['MPhil', 'Robz2295', 'Victoire']) {
    test(`${username}: yesterday first, then today after success or seven guesses`, async () => {
        let status = null;
        const db = {
            getDailyUserStatus: async (id, date) => {
                assert.equal(id, 42);
                assert.equal(date, '2026-09-09');
                return status;
            },
            getDailyTarget: async date => ({ date, street_name: 'Historical street' }),
        };
        const user = { id: 42, username };
        assert.equal(await selectDailyDateForUser(db, user, '2026-09-10'), '2026-09-09');
        status = { attempts_count: 3, success: false };
        assert.equal(await selectDailyDateForUser(db, user, '2026-09-10'), '2026-09-09');
        for (const completed of [{ attempts_count: 3, success: true }, { attempts_count: 7, success: false }]) {
            status = completed;
            assert.equal(await selectDailyDateForUser(db, user, '2026-09-10'), '2026-09-10');
        }
    });
}

test('other users and other dates are unaffected', async () => {
    for (const [username, date] of [['Corentin', '2026-09-10'], ['MPhil', '2026-09-11'], ['Victoire', '2026-09-09']]) {
        assert.equal(await selectDailyDateForUser({}, { username }, date), date);
    }
});

test('missing historical target fails safely rather than replacing yesterday', async () => {
    const db = { getDailyUserStatus: async () => null, getDailyTarget: async () => null };
    await assert.rejects(selectDailyDateForUser(db, { username: 'MPhil' }, '2026-09-10'), /Historical/);
});

test('finishing catch-up offers today only after server confirmation', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
    const functionSource = source.slice(source.indexOf('function applyDailyGuessSyncResult('), source.indexOf('function submitDailyGuessToServer('));
    let button;
    const actions = [];
    const context = vm.createContext({
        dailyTargetData: { catchUp: true },
        document: {
            getElementById: id => id === 'daily-guesses-history' ? { appendChild: el => { button = el; } } : null,
            createElement: () => ({}),
        },
        loadAllLeaderboards() {}, showMessage() {},
        endSession: () => actions.push('end'),
        handleDailyModeClick: () => actions.push('load'),
    });
    vm.runInContext(functionSource, context);
    context.applyDailyGuessSyncResult({ success: false, attempts_count: 1 });
    assert.equal(button, undefined);
    context.applyDailyGuessSyncResult({ success: true, attempts_count: 2 });
    assert.equal(button.textContent, 'Jouer au Daily d’aujourd’hui');
    button.onclick();
    assert.deepEqual(actions, ['end', 'load']);
});
