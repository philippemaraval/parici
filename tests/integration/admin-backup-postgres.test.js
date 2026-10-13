const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { Pool } = require("pg");
test(
  "encrypted backup restores data in isolation and refuses source/remote destinations",
  {
    skip: !process.env.TEST_BACKUP_TOOLS || !process.env.TEST_DATABASE_URL,
    timeout: 60000,
  },
  async (t) => {
    const create = require("./test-database").createTestDatabase,
      source = await create(
        process.env.TEST_DATABASE_URL,
        "admin_backup_source",
      ),
      target = await create(
        process.env.TEST_DATABASE_URL,
        "admin_backup_target",
      );
    const sourcePool = new Pool({ connectionString: source.url }),
      targetPool = new Pool({ connectionString: target.url }),
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "camino-backup-test-"));
    t.after(async () => {
      await sourcePool.end();
      await targetPool.end();
      await source.cleanup();
      await target.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    await sourcePool.query(
      "CREATE TABLE restore_proof(id INTEGER PRIMARY KEY,value TEXT NOT NULL); INSERT INTO restore_proof VALUES(1,'Camino restauration vérifiée')",
    );
    const env = {
      ...process.env,
      DATABASE_URL: source.url,
      RESTORE_DATABASE_URL: target.url,
      CAMINO_RESTORE_ISOLATED: "1",
      BACKUP_ENCRYPTION_PASSPHRASE: "isolated-test-passphrase-not-production",
      BACKUP_DIR: dir,
    };
    const archive = execFileSync("bash", ["scripts/postgres_backup.sh"], {
      env,
      encoding: "utf8",
    }).trim();
    assert.ok(fs.existsSync(archive));
    assert.ok(fs.existsSync(archive + ".sha256"));
    execFileSync("bash", ["scripts/postgres_restore_test.sh", archive], {
      env,
      stdio: "pipe",
    });
    assert.equal(
      (await targetPool.query("SELECT value FROM restore_proof")).rows[0].value,
      "Camino restauration vérifiée",
    );
    assert.throws(() =>
      execFileSync("bash", ["scripts/postgres_restore_test.sh", archive], {
        env: { ...env, RESTORE_DATABASE_URL: source.url },
        stdio: "pipe",
      }),
    );
    assert.throws(() =>
      execFileSync("bash", ["scripts/postgres_restore_test.sh", archive], {
        env: {
          ...env,
          RESTORE_DATABASE_URL: "postgresql://example.test/production",
        },
        stdio: "pipe",
      }),
    );
    fs.appendFileSync(archive, "corruption");
    assert.throws(() =>
      execFileSync("bash", ["scripts/postgres_restore_test.sh", archive], {
        env,
        stdio: "pipe",
      }),
    );
  },
);
