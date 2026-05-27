const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function cleanLeaderboard() {
  const client = await pool.connect();
  try {
    console.log('--- Nettoyage du Leaderboard ---');
    
    // 1. Supprimer le quartier "HORS QUARTIER"
    console.log('Suppression des scores du quartier "HORS QUARTIER"...');
    const res1 = await client.query(`DELETE FROM scores WHERE quartier_name = 'HORS QUARTIER'`);
    console.log(`✅ Supprimé : ${res1.rowCount} ligne(s).`);

    // 2. Supprimer les scores non attribués à un quartier pour MGM et MPhil12
    console.log('Suppression des scores sans quartier pour MGM et MPhil12...');
    const res2 = await client.query(`DELETE FROM scores WHERE username IN ('MGM', 'MPhil12') AND quartier_name IS NULL`);
    console.log(`✅ Supprimé : ${res2.rowCount} ligne(s).`);
    
    console.log('--- Nettoyage Terminé ! ---');
  } catch (err) {
    console.error('Erreur lors du nettoyage :', err);
  } finally {
    client.release();
    pool.end();
  }
}

cleanLeaderboard();
