#!/usr/bin/env node

"use strict";

const { Pool } = require("pg");

const CONFIRMATION = "ANONYMIZE_STAGING";
const INVALID_PASSWORD_HASH =
  "$2b$10$HYIYU3mGmQC3.2Gd/f5wMeavOy2iGZufkgNKPKgYZ/pBW/ffpyNt6";

function assertSafeEnvironment(env = process.env) {
  if (!env.STAGING_DATABASE_URL) {
    throw new Error("STAGING_DATABASE_URL is required");
  }
  if (env.CAMINO_STAGING_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set CAMINO_STAGING_CONFIRM=${CONFIRMATION} to confirm the staging-only operation`,
    );
  }
  if (env.DATABASE_URL && env.DATABASE_URL === env.STAGING_DATABASE_URL) {
    throw new Error(
      "Refusing to continue: DATABASE_URL and STAGING_DATABASE_URL are identical",
    );
  }
}

async function anonymizeStagingDatabase({
  connectionString = process.env.STAGING_DATABASE_URL,
} = {}) {
  assertSafeEnvironment({
    ...process.env,
    STAGING_DATABASE_URL: connectionString,
  });

  const pool = new Pool({
    connectionString,
    ssl:
      connectionString && !connectionString.includes("localhost")
        ? { rejectUnauthorized: false }
        : false,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026072707]);
    const users = await client.query(
      `UPDATE users
       SET username = 'joueur_' || id::text,
           recovery_email = NULL,
           password_hash = $1,
           avatar = '👤',
           session_version = COALESCE(session_version, 1) + 1
       RETURNING id`,
      [INVALID_PASSWORD_HASH],
    );
    await client.query(
      `UPDATE scores
       SET username = CASE
         WHEN user_id IS NULL THEN 'anonyme'
         ELSE 'joueur_' || user_id::text
       END`,
    );
    await client.query(
      `UPDATE friend_challenges
       SET created_by_username = 'joueur_' || created_by_user_id::text`,
    );
    const sensitiveTables = [
      "password_reset_tokens",
      "push_subscriptions",
      "security_audit_logs",
      "api_rate_limits",
      "visitor_sessions",
      "visitors_unique",
      "visitor_daily_uniques",
    ];
    for (const table of sensitiveTables) {
      await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
    }
    await client.query("COMMIT");
    return {
      anonymizedUsers: users.rowCount,
      clearedTables: sensitiveTables,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  anonymizeStagingDatabase()
    .then((result) => {
      console.log(
        `✓ Préproduction anonymisée : ${result.anonymizedUsers} comptes, ${result.clearedTables.length} tables sensibles purgées.`,
      );
    })
    .catch((error) => {
      console.error(`Anonymisation refusée ou échouée : ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  CONFIRMATION,
  anonymizeStagingDatabase,
  assertSafeEnvironment,
};
