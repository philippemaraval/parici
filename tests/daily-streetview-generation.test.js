const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readManifest, addStreetViewGeometry, getStreetViewLocation, buildStreetViewParams, validatePanorama, downloadStreetViewImage } = require('../scripts/generate_daily_streetview_images');
const feature = { geometry: { type: 'LineString', coordinates: [[2.35, 48.85], [2.351, 48.85]] } };
const index = new Map([['rue test', [feature]]]);
const pin = { date: '2026-10-24', streetName: 'Rue test', fileName: 'test.jpg', streetViewLatitude: 48.85, streetViewLongitude: 2.3501, streetViewHeading: 0, streetViewPanoId: 'imposed-pano' };
const metadata = { status: 'OK', pano_id: pin.streetViewPanoId, location: { lng: 2.3501, lat: 48.85 }, date: '2026-01', copyright: 'Test provider' };

test('Daily manifest pins, heading zero and panorama are preserved in service requests', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parici-daily-pins-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const manifest = path.join(dir, 'manifest.csv');
  fs.writeFileSync(manifest, 'date,street_name,arrondissement,file_name,street_view_latitude,street_view_longitude,street_view_heading,street_view_pano_id\n2026-10-24,Rue test,5e arrondissement,test.jpg,48.85,2.3501,0,imposed-pano\n');
  const entry = addStreetViewGeometry(readManifest(manifest)[0], index);
  assert.deepEqual(entry.streetViewCoordinate, [2.3501, 48.85]);
  const params = buildStreetViewParams(entry, {pitch: '0'}, 'fake-key');
  assert.equal(params.get('pano'), pin.streetViewPanoId);
  assert.equal(params.has('location'), false);
  assert.equal(params.get('heading'), '0');
  assert.equal(params.get('pitch'), '0');
  const requests = [];
  const body = Buffer.from('mock image bytes');
  await downloadStreetViewImage(entry, {pitch: '0'}, 'fake-key', dir, {
    requestJson: async url => { requests.push(new URL(url)); return metadata; },
    requestBuffer: async url => { requests.push(new URL(url)); return {statusCode: 200, headers: {'content-type': 'image/jpeg'}, body}; },
  });
  assert.equal(requests.length, 2);
  for (const url of requests) { assert.equal(url.searchParams.get('pano'), pin.streetViewPanoId); assert.equal(url.searchParams.has('location'), false); }
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'test.jpg.generation.json')));
  assert.equal(receipt.panoId, pin.streetViewPanoId);
  assert.equal(receipt.sha256, crypto.createHash('sha256').update(body).digest('hex'));
  assert.ok(receipt.geometrySha256);
  assert.equal(receipt.distanceMeters, 0);
});

test('Daily generation rejects absent/partial coordinates, substituted or off-street panoramas', () => {
  assert.throws(() => getStreetViewLocation({streetName: 'Unknown'}), /Coordonnees/);
  assert.throws(() => addStreetViewGeometry({...pin, streetViewLongitude: NaN}, index), /incompletes/);
  const entry = addStreetViewGeometry(pin, index);
  assert.doesNotThrow(() => validatePanorama(entry, metadata));
  assert.throws(() => validatePanorama(entry, {...metadata, pano_id: 'other'}), /impose/);
  assert.throws(() => validatePanorama(entry, {...metadata, location: {lng: 3, lat: 48.85}}), /eloigne/);
  assert.throws(() => validatePanorama(entry, {...metadata, location: {lng: 2.3501, lat: 48.8503}}), /geometrie/);
  assert.throws(() => validatePanorama({...entry, streetViewFeatures: []}, metadata), /geometrie/);
});

test('location metadata is pinned to its validated panorama before downloading', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parici-daily-location-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const entry = addStreetViewGeometry({...pin, streetViewPanoId: ''}, index);
  let downloads = 0;
  const transport = {
    requestJson: async url => { assert.ok(new URL(url).searchParams.has('location')); return metadata; },
    requestBuffer: async url => { const params = new URL(url).searchParams; assert.equal(params.has('location'), false); assert.equal(params.get('pano'), metadata.pano_id); downloads++; return {statusCode: 200, headers: {'content-type': 'image/jpeg'}, body: Buffer.from('image')}; },
  };
  await downloadStreetViewImage(entry, {}, 'fake-key', dir, transport);
  assert.equal(downloads, 1);
  await assert.rejects(downloadStreetViewImage({...entry, streetViewPanoId: 'other'}, {}, 'fake-key', dir, {...transport, requestJson: async () => metadata}), /impose/);
  assert.equal(downloads, 1);
});
