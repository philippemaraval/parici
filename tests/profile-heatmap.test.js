const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../src/profile-heatmap.js')).toString('base64'));
test('quartier names match despite accents, spaces and hyphens', async () => {
  const { normalizeArea } = await modulePromise;
  assert.equal(normalizeArea('Quartier du Bel-Air'), normalizeArea('QUARTIER DU BEL AIR'));
});
test('map distinguishes missing measurements from a measured zero success rate', async () => {
  const { areaColor } = await modulePromise;
  assert.equal(areaColor({games_played: 4, success_rate: null}), '#e4e7eb');
  assert.equal(areaColor({games_played: 4, success_rate: 0}), '#db7951');
  assert.equal(areaColor({games_played: 4, success_rate: 45}), '#f2a900');
  assert.equal(areaColor({games_played: 4, success_rate: 70}), '#33865b');
});

test('the 20 districts cover historical quarters and weight measured games', async () => {
  const { aggregateArrondissementStats } = await modulePromise;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/paris_arrondissements_progress.geojson')));
  const quarters = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/paris_arrondissements.geojson')));
  assert.deepEqual(data.features.map(f => f.properties.number), Array.from({ length: 20 }, (_, i) => i + 1));
  for (const quarter of quarters.features) {
    const rows = aggregateArrondissementStats([{ arrondissement_name: quarter.properties.name, games_played: 1, success_rate: 100 }], data.features);
    assert.equal(rows.size, 1, quarter.properties.name);
  }
  const result = aggregateArrondissementStats([
    { arrondissement_name: 'Quartier du Bel-Air', games_played: 9, measured_games: 1, success_rate: 0 },
    { arrondissement_name: 'Quartier de Bercy', games_played: 3, measured_games: 3, success_rate: 100 },
    { arrondissement_name: '12e arrondissement', games_played: 2, measured_games: 0, success_rate: null },
    { arrondissement_name: '75001', games_played: 1, measured_games: 1, success_rate: 45 },
    { arrondissement_name: 'inconnu', games_played: 10, success_rate: 90 },
  ], data.features);
  assert.equal(result.size, 2);
  assert.equal(result.get(12).games_played, 14);
  assert.equal(result.get(12).success_rate, 75);
  assert.equal(result.get(1).success_rate, 45);
});
