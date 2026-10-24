#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { streetPhotoView } = require('./enrich_collect_paris_photos');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST_PATH = path.join(ROOT_DIR, 'data', 'daily_images', 'manifest_next_30.csv');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'daily_images');
const STREET_VIEW_BASE_URL = 'https://maps.googleapis.com/maps/api/streetview';
const STREET_VIEW_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const GEOJSON_CANDIDATE_PATHS = [
    path.join(ROOT_DIR, 'backend', 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'backend', 'data', 'paris_rues_enrichi.geojson'),
    path.join(ROOT_DIR, 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'data', 'paris_rues_enrichi.geojson'),
    path.join(ROOT_DIR, 'dist', 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'dist', 'data', 'paris_rues_enrichi.geojson'),
];

const DEFAULT_WIDTH = 430;
const DEFAULT_HEIGHT = 640;
const DEFAULT_FOV = 90;
const DEFAULT_PITCH = 15;
const DEFAULT_RADIUS = 50;
const DEFAULT_TIMEOUT_MS = 20000;

function loadLocalEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            return;
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    });
}

loadLocalEnvFile(path.join(ROOT_DIR, '.env'));
loadLocalEnvFile(path.join(ROOT_DIR, '.env.local'));

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            continue;
        }
        const key = token.slice(2);
        if (key === 'force' || key === 'dry-run' || key === 'only-missing' || key === 'refresh-generated') {
            args[key] = true;
            continue;
        }
        args[key] = argv[index + 1];
        index += 1;
    }
    return args;
}

function parseCsv(raw) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        const next = raw[index + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
            continue;
        }
        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') {
                index += 1;
            }
            row.push(field);
            if (row.some((value) => value.trim())) {
                rows.push(row);
            }
            row = [];
            field = '';
            continue;
        }
        field += char;
    }

    row.push(field);
    if (row.some((value) => value.trim())) {
        rows.push(row);
    }

    return rows;
}

function readManifest(manifestPath) {
    const rows = parseCsv(fs.readFileSync(manifestPath, 'utf8'));
    const header = rows.shift() || [];
    const headerIndex = new Map(header.map((name, index) => [name.trim(), index]));
    return rows
        .map((row) => ({
            date: String(row[headerIndex.get('date')] || '').trim(),
            streetName: String(row[headerIndex.get('street_name')] || '').trim(),
            quartier: String(
                row[headerIndex.get('arrondissement')] ||
                row[headerIndex.get('quartier')] ||
                ''
            ).trim(),
            fileName: String(row[headerIndex.get('file_name')] || '').trim(),
            missingImageStreet: String(row[headerIndex.get('missing_image_street')] || '').trim(),
            streetViewCoordinatesSupplied: Boolean(String(row[headerIndex.get('street_view_latitude')] || '').trim() || String(row[headerIndex.get('street_view_longitude')] || '').trim()),
            streetViewLatitude: Number.parseFloat(row[headerIndex.get('street_view_latitude')]),
            streetViewLongitude: Number.parseFloat(row[headerIndex.get('street_view_longitude')]),
            streetViewHeading: Number.parseFloat(row[headerIndex.get('street_view_heading')]),
            streetViewPanoId: String(row[headerIndex.get('street_view_pano_id')] || '').trim(),
        }))
        .filter((entry) => entry.date && entry.streetName && entry.fileName);
}

function getApiKey() {
    const key = process.env.GOOGLE_STREET_VIEW_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!key || !key.trim()) {
        throw new Error('Configure GOOGLE_STREET_VIEW_API_KEY ou GOOGLE_MAPS_API_KEY.');
    }
    return key.trim();
}

function getStreetViewLocation(entry) {
    if (isPoint(entry.streetViewCoordinate)) {
        const [lng, lat] = entry.streetViewCoordinate;
        return `${lat.toFixed(7)},${lng.toFixed(7)}`;
    }
    throw new Error(`Coordonnees manquantes pour ${entry.streetName}; recherche textuelle interdite.`);
}

function normalizeLookupName(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’`´]/g, "'")
        .replace(/[-‐‑‒–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ');
}

function isPoint(coords) {
    return Array.isArray(coords)
        && coords.length >= 2
        && Number.isFinite(coords[0])
        && Number.isFinite(coords[1]);
}

function lineDistanceMeters(a, b) {
    const lonScale = 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const latScale = 110540;
    const dx = (b[0] - a[0]) * lonScale;
    const dy = (b[1] - a[1]) * latScale;
    return Math.sqrt(dx * dx + dy * dy);
}

function lineLengthMeters(line) {
    const points = line.filter(isPoint);
    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
        distance += lineDistanceMeters(points[index - 1], points[index]);
    }
    return distance;
}

function midpointAlongLine(line) {
    const points = line.filter(isPoint);
    if (points.length === 0) {
        return null;
    }
    if (points.length === 1) {
        return points[0].slice(0, 2);
    }

    const total = lineLengthMeters(points);
    const target = total / 2;
    let walked = 0;
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const segment = lineDistanceMeters(start, end);
        if (walked + segment >= target && segment > 0) {
            const ratio = (target - walked) / segment;
            return [
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio,
            ];
        }
        walked += segment;
    }
    return points[Math.floor(points.length / 2)].slice(0, 2);
}

function collectLinesFromGeometry(geometry) {
    if (!geometry) {
        return [];
    }
    if (geometry.type === 'Feature') {
        return collectLinesFromGeometry(geometry.geometry);
    }
    if (geometry.type === 'FeatureCollection') {
        return (geometry.features || []).flatMap((feature) => collectLinesFromGeometry(feature));
    }
    if (geometry.type === 'LineString') {
        return [geometry.coordinates || []];
    }
    if (geometry.type === 'MultiLineString') {
        return geometry.coordinates || [];
    }
    if (geometry.type === 'Polygon') {
        return (geometry.coordinates || []).slice(0, 1);
    }
    if (geometry.type === 'MultiPolygon') {
        return (geometry.coordinates || []).flatMap((polygon) => (polygon || []).slice(0, 1));
    }
    if (geometry.type === 'Point') {
        return [isPoint(geometry.coordinates) ? [geometry.coordinates] : []];
    }
    return [];
}

function bearingDegrees(start, end) {
    const lon1 = (start[0] * Math.PI) / 180;
    const lat1 = (start[1] * Math.PI) / 180;
    const lon2 = (end[0] * Math.PI) / 180;
    const lat2 = (end[1] * Math.PI) / 180;
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

function findDominantLine(features) {
    return features
        .flatMap((feature) => collectLinesFromGeometry(feature.geometry))
        .map((line) => line.filter(isPoint))
        .filter((line) => line.length >= 2)
        .map((line) => ({ line, distance: lineLengthMeters(line) }))
        .sort((a, b) => b.distance - a.distance)[0]?.line || null;
}

function loadStreetGeometryIndex() {
    const byName = new Map();
    for (const geojsonPath of GEOJSON_CANDIDATE_PATHS) {
        if (!fs.existsSync(geojsonPath)) {
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
        } catch (error) {
            console.warn(`[warn] GeoJSON ignore car illisible: ${path.relative(ROOT_DIR, geojsonPath)}`);
            continue;
        }
        for (const feature of parsed.features || []) {
            const normalized = normalizeLookupName(feature?.properties?.name);
            if (!normalized || !feature?.geometry) {
                continue;
            }
            if (!byName.has(normalized)) {
                byName.set(normalized, []);
            }
            byName.get(normalized).push(feature);
        }
        if (byName.size > 0) {
            return byName;
        }
    }
    return byName;
}

function addStreetViewGeometry(entry, streetGeometryIndex) {
    const canonical = require('../backend/data/streets_index.json').find(street => normalizeLookupName(street.name) === normalizeLookupName(entry.streetName));
    const features = streetGeometryIndex.get(normalizeLookupName(canonical?.osmName || entry.streetName)) || [];
    const hasLatitude = Number.isFinite(entry.streetViewLatitude);
    const hasLongitude = Number.isFinite(entry.streetViewLongitude);
    if ((entry.streetViewCoordinatesSupplied && (!hasLatitude || !hasLongitude)) || hasLatitude !== hasLongitude) throw new Error(`Coordonnees incompletes pour ${entry.streetName}`);
    if (hasLatitude) {
        if (Math.abs(entry.streetViewLatitude) > 90 || Math.abs(entry.streetViewLongitude) > 180) throw new Error(`Coordonnees invalides pour ${entry.streetName}`);
        return { ...entry, streetViewCoordinate: [entry.streetViewLongitude, entry.streetViewLatitude], streetViewFeatures: features };
    }
    const line = findDominantLine(features);
    if (!line) {
        return entry;
    }
    const coordinate = midpointAlongLine(line);
    const points = line.filter(isPoint);
    if (!coordinate || points.length < 2) {
        return entry;
    }
    return {
        ...entry,
        streetViewCoordinate: coordinate,
        streetViewHeading: Number.isFinite(entry.streetViewHeading) ? entry.streetViewHeading : bearingDegrees(points[0], points[points.length - 1]),
        streetViewFeatures: features,
    };
}

function readJpegDimensions(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
    }
    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2) {
            return null;
        }
        if (
            marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ||
            marker === 0xc3 || marker === 0xc5 || marker === 0xc6 ||
            marker === 0xc7 || marker === 0xc9 || marker === 0xca ||
            marker === 0xcb || marker === 0xcd || marker === 0xce ||
            marker === 0xcf
        ) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7),
            };
        }
        offset += 2 + length;
    }
    return null;
}

function buildStreetViewParams(entry, args, apiKey) {
    const params = new URLSearchParams();
    const width = Number.parseInt(args.width, 10) || DEFAULT_WIDTH;
    const height = Number.parseInt(args.height, 10) || DEFAULT_HEIGHT;
    params.set('size', `${width}x${height}`);
    getStreetViewLocation(entry); // Require a geographic pin even for a pinned panorama.
    const requestedView = streetPhotoView(entry.streetViewCoordinate, { features: entry.streetViewFeatures || [], target: entry.streetViewCoordinate });
    if (!requestedView || requestedView.distanceMeters > 18) throw new Error(`Coordonnees hors geometrie de ${entry.streetName}`);
    if (entry.streetViewPanoId) params.set('pano', entry.streetViewPanoId);
    else params.set('location', getStreetViewLocation(entry));
    params.set('fov', String(Number.parseInt(args.fov, 10) || DEFAULT_FOV));
    params.set('pitch', String(args.pitch !== undefined ? Number(args.pitch) : DEFAULT_PITCH));
    params.set('radius', String(Number.parseInt(args.radius, 10) || DEFAULT_RADIUS));
    params.set('source', 'outdoor');
    params.set('return_error_code', 'true');
    params.set('key', apiKey);

    if (args.heading !== undefined) {
        params.set('heading', String(args.heading));
    } else if (Number.isFinite(entry.streetViewHeading)) {
        params.set('heading', String(Math.round(entry.streetViewHeading)));
    }

    return params;
}

function requestBuffer(requestUrl, timeoutMs) {
    return new Promise((resolve, reject) => {
        const request = https.get(requestUrl, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode || 0,
                    headers: response.headers,
                    body: Buffer.concat(chunks),
                });
            });
        });
        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Timeout apres ${timeoutMs} ms`));
        });
        request.on('error', reject);
    });
}

async function requestJson(requestUrl, timeoutMs) {
    const response = await requestBuffer(requestUrl, timeoutMs);
    const text = response.body.toString('utf8');
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Reponse JSON invalide (${response.statusCode}): ${text.slice(0, 160)}`);
    }
}

function filterEntries(entries, args, outputDir) {
    const from = args.from || new Date().toISOString().slice(0, 10);
    const to = args.to || '9999-99-99';
    const limit = Number.parseInt(args.limit, 10);
    let filtered = entries.filter((entry) => entry.date >= from && entry.date <= to);

    if (args['only-missing']) {
        filtered = filtered.filter((entry) => !fs.existsSync(path.join(outputDir, entry.fileName)));
    }

    if (args['refresh-generated']) {
        const width = Number.parseInt(args.width, 10) || DEFAULT_WIDTH;
        const height = Number.parseInt(args.height, 10) || DEFAULT_HEIGHT;
        filtered = filtered.filter((entry) => {
            const dimensions = readJpegDimensions(path.join(outputDir, entry.fileName));
            return dimensions?.width === width && dimensions?.height === height;
        });
    }

    if (Number.isInteger(limit) && limit > 0) {
        filtered = filtered.slice(0, limit);
    }

    return filtered;
}

function validatePanorama(entry, metadata) {
    const coordinate = [metadata.location?.lng, metadata.location?.lat];
    if (!isPoint(entry.streetViewCoordinate) || !isPoint(coordinate) || !metadata.pano_id
        || lineDistanceMeters(entry.streetViewCoordinate, coordinate) > 80) {
        throw new Error(`Panorama trop eloigne des coordonnees de ${entry.streetName}`);
    }
    if (entry.streetViewPanoId && metadata.pano_id !== entry.streetViewPanoId) {
        throw new Error(`Panorama impose non respecte pour ${entry.streetName}`);
    }
    const view = streetPhotoView(coordinate, { features: entry.streetViewFeatures || [], target: entry.streetViewCoordinate });
    if (!view || view.distanceMeters > 18) throw new Error(`Panorama hors geometrie de ${entry.streetName}`);
    return view;
}

async function downloadStreetViewImage(entry, args, apiKey, outputDir, transport = { requestJson, requestBuffer }) {
    const timeoutMs = Number.parseInt(args.timeout, 10) || DEFAULT_TIMEOUT_MS;
    const params = buildStreetViewParams(entry, args, apiKey);
    const metadataUrl = `${STREET_VIEW_METADATA_URL}?${params.toString()}`;
    let imageUrl = `${STREET_VIEW_BASE_URL}?${params.toString()}`;

    if (args['dry-run']) {
        console.log(`[dry-run] ${entry.fileName}: ${getStreetViewLocation(entry)}`);
        if (Number.isFinite(entry.streetViewHeading)) {
            console.log(`          heading=${Math.round(entry.streetViewHeading)}`);
        }
        console.log(`          ${imageUrl.replace(apiKey, 'GOOGLE_STREET_VIEW_API_KEY')}`);
        return { status: 'dry-run' };
    }

    const metadata = await transport.requestJson(metadataUrl, timeoutMs);
    if (metadata.status !== 'OK') {
        if (['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR'].includes(metadata.status)) {
            throw new Error(`Street View metadata ${metadata.status}: ${metadata.error_message || 'sans detail'}`);
        }
        console.warn(`[skip] ${entry.fileName}: Street View metadata ${metadata.status || 'UNKNOWN'}`);
        return { status: 'skipped', reason: metadata.status || 'UNKNOWN' };
    }

    const view = validatePanorama(entry, metadata);
    params.delete('location');
    params.set('pano', metadata.pano_id);
    imageUrl = `${STREET_VIEW_BASE_URL}?${params.toString()}`;
    const response = await transport.requestBuffer(imageUrl, timeoutMs);
    const contentType = String(response.headers['content-type'] || '');
    if (response.statusCode !== 200 || !contentType.startsWith('image/')) {
        const message = response.body.toString('utf8').slice(0, 200);
        throw new Error(
            `${entry.fileName}: image HTTP ${response.statusCode}, content-type ${contentType || 'inconnu'} ${message}`
        );
    }

    const outputPath = path.join(outputDir, entry.fileName);
    const temporaryPath = `${outputPath}.tmp`;
    fs.writeFileSync(temporaryPath, response.body);
    fs.renameSync(temporaryPath, outputPath);
    // Separate generation evidence; existing editorial/visual audits remain intact.
    fs.writeFileSync(`${outputPath}.generation.json`, JSON.stringify({
        date: entry.date, street: entry.streetName, fileName: entry.fileName,
        sha256: crypto.createHash('sha256').update(response.body).digest('hex'),
        requestedCoordinate: entry.streetViewCoordinate, coordinate: [metadata.location.lng, metadata.location.lat],
        panoId: metadata.pano_id, heading: params.get('heading'), pitch: params.get('pitch'),
        captureDate: metadata.date, copyright: metadata.copyright,
        geometrySha256: crypto.createHash('sha256').update(JSON.stringify(entry.streetViewFeatures)).digest('hex'),
        distanceMeters: view.distanceMeters, generatedAt: new Date().toISOString(),
    }, null, 2) + '\n');
    console.log(`[ok] ${path.relative(ROOT_DIR, outputPath)} (${metadata.date || 'date inconnue'})`);
    return { status: 'ok' };
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST_PATH);
    const outputDir = path.resolve(args.output || DEFAULT_OUTPUT_DIR);
    const force = Boolean(args.force);
    const apiKey = getApiKey();
    const streetGeometryIndex = loadStreetGeometryIndex();
    const entries = filterEntries(readManifest(manifestPath), args, outputDir)
        .map((entry) => addStreetViewGeometry(entry, streetGeometryIndex));

    fs.mkdirSync(outputDir, { recursive: true });

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of entries) {
        const outputPath = path.join(outputDir, entry.fileName);
        if (!force && !args['refresh-generated'] && fs.existsSync(outputPath)) {
            skipped += 1;
            console.log(`[skip] ${entry.fileName}: existe deja`);
            continue;
        }

        try {
            const result = await downloadStreetViewImage(entry, args, apiKey, outputDir);
            if (result.status === 'ok') {
                generated += 1;
            } else if (result.status !== 'dry-run') {
                skipped += 1;
            }
        } catch (error) {
            failed += 1;
            console.error(`[fail] ${entry.fileName}: ${error.message}`);
        }
    }

    console.log(`Termine: ${generated} generees, ${skipped} ignorees, ${failed} echecs.`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) run().catch((error) => {
    console.error(`[daily-streetview] ${error.message}`);
    process.exitCode = 1;
});

module.exports = { readManifest, addStreetViewGeometry, getStreetViewLocation, buildStreetViewParams, validatePanorama, downloadStreetViewImage };
