const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { contains } = require('../scripts/enrich_collect_paris_photos');
const { distance } = require('../scripts/lib/collect-street-view');
const { photoManifest, photoRevision, applyPhotographs } = require('../backend/domains/collect/photo-sync');

test('reviewed Paris photographs retain source, location and unchanged image evidence', () => {
  const catalog = require('../data/collect_paris_catalog.json');
  const illustrations = require('../data/collect_images/manifest.json');
  const cards = new Map(catalog.records.map(c => [c.family + ':' + c.source_entity_id, c]));
  const manifest = photoManifest();
  assert.ok(Object.keys(manifest).length >= 477);
  const streets = catalog.records.filter(c => c.family === 'street');
  const photographicStreets = streets.filter(c => c.illustration.kind === 'photograph');
  assert.ok(photographicStreets.length >= Math.ceil(streets.length * 0.93), 'Street photo coverage must remain at least 93%');
  assert.ok(Object.values(manifest).filter(entry => entry.source === 'panoramax').length > 0);
  for (const card of catalog.records.filter(c => c.family !== 'street')) {
    assert.equal(card.illustration.kind, 'photograph', card.name);
  }
  for (const [key, entry] of Object.entries(manifest)) {
    const card = cards.get(key), v = entry.verification;
    assert.ok(card, key);
    assert.equal(card.image_reference, entry.image, key);
    assert.equal(illustrations[key].image, entry.image);
    assert.equal(entry.verifiedEntity, key);
    assert.equal(entry.kind, 'photograph');
    assert.ok(v.evidence && v.reviewedAt);
    if (entry.source !== 'wikipedia') {
      assert.ok(v.captureDate);
      assert.ok(v.coordinate.every(Number.isFinite));
      assert.ok(v.distanceMeters <= (card.family === 'street' ? 18 : card.family === 'district' ? 25 : 150));
    }
    const source = new URL(entry.sourcePage);
    if (entry.source === 'wikipedia') {
      assert.ok(entry.author && entry.license);
      assert.match(entry.license, /^(CC BY|CC0|Public domain)/);
      assert.ok(['commons.wikimedia.org', 'fr.wikipedia.org'].includes(source.hostname));
      assert.equal(v.method, 'article-identity-and-visual-review');
      assert.ok(v.articleTitle && v.articleURL && v.commonsFile);
      assert.equal(new URL(v.originalURL).hostname, 'upload.wikimedia.org');
      if (card.family === 'bus') assert.equal(entry.caption, 'Matériel roulant de la ligne');
      if (card.family === 'street') assert.ok(distance(v.articleCoordinate, card.centroid) <= 350, key);
    } else if (entry.source === 'panoramax') {
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
    assert.ok(bytes.readUInt16BE(0) === 0xffd8 || bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), v.sha256, key);
  }
});

test('Wikimedia rolling stock retains its author credit and an uncropped artwork frame', async () => {
  const { renderCardArtwork } = await import('../src/public/js/collect-card-art.js');
  const html = renderCardArtwork({family:'bus',collection_number:1,current_rarity:1,image_reference:'/data/collect_images/wikimedia-probe.jpg',image_attribution:{source:'wikipedia',author:'Alice & Bob'}});
  assert.match(html, /collect-card-art--transport-photo/);
  assert.match(html, /Wikimedia · Alice &amp; Bob/);
  assert.doesNotMatch(html, /Google Street View/);
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

test('discarded photo views cannot return through Daily or Explorer fallbacks', () => {
  const exclusions = require('../data/collect_photo_exclusions_paris.json');
  const catalog = require('../data/collect_paris_catalog.json').records;
  const reviewed = photoManifest();
  assert.ok(Object.keys(exclusions).length > 100);
  for (const [key, exclusion] of Object.entries(exclusions)) {
    const card = catalog.find(c => c.family + ':' + c.source_entity_id === key);
    assert.ok(card && exclusion.images.length && exclusion.reason);
    assert.ok(!exclusion.images.includes(card.image_reference), key);
    if (!reviewed[key]) {
      assert.equal(card.image_reference, '/apple-touch-icon.png', key);
      assert.equal(card.illustration.kind, 'logo', key);
    }
  }
  assert.notEqual(photoRevision({}, {}), photoRevision({}, { 'street:Example': {images:['/rejected.jpg']} }));
  assert.equal(photoRevision({}, {a:{images:['a']},b:{images:['b']}}), photoRevision({}, {b:{images:['b']},a:{images:['a']}}));
});

test('every displayed photograph has a visual audit tied to its actual image bytes', () => {
  const audit = require('../data/collect_images/view-audit-20261014.json');
  const catalog = require('../data/collect_paris_catalog.json').records;
  for (const card of catalog.filter(c => c.illustration.kind === 'photograph')) {
    const key = card.family + ':' + card.source_entity_id, entry = audit.cards[key];
    assert.ok(entry, key);
    assert.equal(entry.image, card.image_reference, key);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',card.image_reference))).digest('hex'), key);
    assert.ok(entry.visualReview && entry.framing, key);
  }
});
