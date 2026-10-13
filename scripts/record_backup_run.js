"use strict";
const fs = require("node:fs");
const { Pool } = require("pg");
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const file = process.env.BACKUP_PATH || "",
      success =
        process.env.BACKUP_SUCCEEDED === "true" &&
        process.env.RESTORE_SUCCEEDED === "true" &&
        process.env.UPLOAD_SUCCEEDED === "true";
    const checksum =
      file && fs.existsSync(file + ".sha256")
        ? fs.readFileSync(file + ".sha256", "utf8").split(/\s/)[0]
        : null;
    await pool.query(
      "INSERT INTO admin_backup_runs(run_id,status,backup_name,checksum,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id) DO UPDATE SET status=EXCLUDED.status,checksum=EXCLUDED.checksum,detail=EXCLUDED.detail",
      [
        process.env.GITHUB_RUN_ID,
        success ? "success" : "failure",
        require("node:path").basename(file) || "indisponible",
        checksum,
        success
          ? "Sauvegarde chiffrée, restauration isolée et archivage réussis."
          : "Au moins une étape a échoué ; consulter le workflow.",
      ],
    );
    console.log("État de sauvegarde enregistré.");
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("Impossible d’enregistrer l’état de sauvegarde.");
  process.exitCode = 1;
});
