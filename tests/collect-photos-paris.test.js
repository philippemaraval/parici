const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { contains } = require('../scripts/enrich_collect_paris_photos');
const { photoManifest, photoRevision, applyPhotographs } = require('../backend/domains/collect/photo-sync');

test('reviewed Paris photographs retain source, location and unchanged image evidence', () => {
  const catalog = require('../data/collect_paris_catalog.json');
  const illustrations = require('../data/collect_images/manifest.json');
  const cards = new Map(catalog.records.map(c => [c.family + ':' + c.source_entity_id, c]));
  const manifest = photoManifest();
  assert.ok(Object.keys(manifest).length >= 477);
  const streets = catalog.records.filter(c => c.family === 'street');
  const photographicStreets = streets.filter(c => c.illustration.kind === 'photograph');
  assert.ok(photographicStreets.length >= Math.ceil(streets.length * 0.8), 'Street photo coverage must remain at least 80%');
  assert.ok(Object.values(manifest).filter(entry => entry.source === 'panoramax').length >= 160);
  for (const [key, entry] of Object.entries(manifest)) {
    const card = cards.get(key), v = entry.verification;
    assert.ok(card, key);
    assert.equal(card.image_reference, entry.image, key);
    assert.equal(illustrations[key].image, entry.image);
    assert.equal(entry.verifiedEntity, key);
    assert.equal(entry.kind, 'photograph');
    assert.ok(v.evidence && v.reviewedAt && v.captureDate);
    assert.ok(v.coordinate.every(Number.isFinite));
    assert.ok(v.distanceMeters <= (card.family === 'street' ? 18 : card.family === 'district' ? 25 : 150));
    const source = new URL(entry.sourcePage);
    if (entry.source === 'panoramax') {
      assert.ok(entry.author);
      assert.equal(entry.license, 'CC-BY-SA-4.0');
      assert.equal(source.hostname, 'api.panoramax.xyz');
      assert.equal(source.searchParams.get('pic'), v.pictureId);
      assert.ok(v.metadataPage.includes(v.pictureId));
      if (v.azimuth != null) assert.ok(v.azimuth >= 0 && v.azimuth < 360);
    } else {
      assert.equal(entry.author, 'Google Street View');
      assert.match(v.copyright, /Google/);
      assert.ok(v.panoId);
      assert.ok(v.heading >= 0 && v.heading < 360);
      assert.equal(source.hostname, 'www.google.com');
      assert.equal(source.searchParams.get('pano'), v.panoId);
    }
    const bytes = fs.readFileSync(path.join(__dirname, '..', entry.image));
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), v.sha256, key);
  }
});

test('photo revision is independent of manifest order and skips an already applied upgrade', async () => {
  const manifest = photoManifest();
  assert.equal(photoRevision(manifest), photoRevision(Object.fromEntries(Object.entries(manifest).reverse())));
  let calls = 0;
  await applyPhotographs({ async query(sql) {
    calls++;
    assert.match(sql, /parici_collect_photo_revision/);
    return {rows:[{value_text:photoRevision(manifest)}]};
  }});
  assert.equal(calls,1);
});

test('quarter photo geometry rejects points outside the polygon and inside holes', () => {
  const features = [{geometry:{type:'Polygon', coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]}}];
  assert.equal(contains([0.5,0.5],features), true);
  assert.equal(contains([2,2],features), false);
  assert.equal(contains([5,2],features), false);
});
