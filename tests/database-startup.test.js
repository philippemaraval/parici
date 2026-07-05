const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('database startup skips migrations when the schema version is current', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql).trim(), params });
      if (queries.length === 1) {
        return { rows: [{ app_settings_table: 'app_settings' }] };
      }
      return { rows: [{ value_text: '2026-07-05-mphil-admin' }] };
    },
    release() {
      released = true;
    },
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockDependencies(request, parent, isMain) {
    if (request === 'pg') {
      return { Pool: function Pool() { return pool; } };
    }
    if (request === 'bcrypt') {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let database;
  try {
    const databasePath = require.resolve('../backend/database');
    delete require.cache[databasePath];
    database = require(databasePath);
    await database.initDb();
    delete require.cache[databasePath];
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /to_regclass\('public\.app_settings'\)/);
  assert.deepEqual(queries[1].params, ['schema_bootstrap_version']);
  assert.equal(released, true);
});
