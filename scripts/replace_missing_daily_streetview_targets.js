#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');
const { shouldKeepStreetForGame } = require('../street_filter');
const { ARRONDISSEMENT_PAR_QUARTIER } = require('../data_rules');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'data', 'daily_images', 'manifest_next_30.csv');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'daily_images');
const STREETS_INDEX_PATH = path.join(ROOT_DIR, 'backend', 'data', 'streets_index.json');
const STREET_VIEW_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const GEOJSON_CANDIDATE_PATHS = [
    path.join(ROOT_DIR, 'backend', 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'backend', 'data', 'paris_rues_enrichi.geojson'),
    path.join(ROOT_DIR, 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'data', 'paris_rues_enrichi.geojson'),
    path.join(ROOT_DIR, 'dist', 'data', 'paris_rues_light.geojson'),
    path.join(ROOT_DIR, 'dist', 'data', 'paris_rues_enrichi.geojson'),
];

const DEFAULT_FROM = '2026-05-11';
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

function getApiKey() {
    const key = process.env.GOOGLE_STREET_VIEW_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!key || !key.trim()) {
        throw new Error('Configure GOOGLE_STREET_VIEW_API_KEY ou GOOGLE_MAPS_API_KEY.');
    }
    return key.trim();
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            continue;
        }
        const key = token.slice(2);
        if (key === 'dry-run' || key === 'unsuitable-generated' || key === 'delete-old-images') {
            args[key] = true;
            continue;
        }
        args[key] = argv[index + 1];
        index += 1;
    }
    return args;
}

function parseDateSet(value) {
    return new Set(
        String(value || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
    );
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

function serializeCsvField(value) {
    const raw = String(value ?? '');
    if (!/[",\r\n]/.test(raw)) {
        return raw;
    }
    return `"${raw.replace(/"/g, '""')}"`;
}

function serializeRows(rows) {
    return `${rows.map((row) => row.map(serializeCsvField).join(',')).join('\n')}\n`;
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’'`´]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function normalizeName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’`´]/g, "'")
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
    return Math.hypot((b[0] - a[0]) * lonScale, (b[1] - a[1]) * latScale);
}

function lineLengthMeters(line) {
    const points = (line || []).filter(isPoint);
    let distance = 0;
    for (let index = 1; index < points.length; index += 1) {
        distance += lineDistanceMeters(points[index - 1], points[index]);
    }
    return distance;
}

function geometryLengthMeters(geometry) {
    if (!geometry) return 0;
    if (geometry.type === 'LineString') return lineLengthMeters(geometry.coordinates);
    if (geometry.type === 'MultiLineString') return Math.max(0, ...(geometry.coordinates || []).map(lineLengthMeters));
    if (geometry.type === 'Polygon') return lineLengthMeters((geometry.coordinates || [])[0] || []);
    if (geometry.type === 'MultiPolygon') {
        const rings = (geometry.coordinates || []).flatMap((polygon) => [(polygon || [])[0] || []]);
        return Math.max(0, ...rings.map(lineLengthMeters));
    }
    return 0;
}

function collectLinesFromGeometry(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'LineString') return [geometry.coordinates || []];
    if (geometry.type === 'MultiLineString') return geometry.coordinates || [];
    if (geometry.type === 'Polygon') return (geometry.coordinates || []).slice(0, 1);
    if (geometry.type === 'MultiPolygon') {
        return (geometry.coordinates || []).flatMap((polygon) => (polygon || []).slice(0, 1));
    }
    return [];
}

function findDominantLine(features) {
    return features
        .flatMap((feature) => collectLinesFromGeometry(feature.geometry))
        .map((line) => line.filter(isPoint))
        .filter((line) => line.length >= 2)
        .map((line) => ({ line, distance: lineLengthMeters(line) }))
        .sort((a, b) => b.distance - a.distance)[0]?.line || null;
}

function midpointAlongLine(line) {
    const points = (line || []).filter(isPoint);
    if (points.length === 0) return null;
    if (points.length === 1) return points[0].slice(0, 2);
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

function getStreetViewGeometry(streetName, geometryIndex) {
    const features = geometryIndex.get(normalizeName(streetName)) || [];
    const line = findDominantLine(features);
    const coordinate = midpointAlongLine(line);
    const points = (line || []).filter(isPoint);
    if (!coordinate || points.length < 2) {
        return null;
    }
    return {
        location: `${coordinate[1].toFixed(7)},${coordinate[0].toFixed(7)}`,
        heading: Math.round(bearingDegrees(points[0], points[points.length - 1])),
    };
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
            const normalized = normalizeName(feature?.properties?.name);
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

function getStreetImageSuitability(streetName, geometryIndex) {
    const features = geometryIndex.get(normalizeName(streetName)) || [];
    const lengthMeters = Math.max(0, ...features.map((feature) => geometryLengthMeters(feature.geometry)));
    const highwayValues = new Set(features.map((feature) => String(feature?.properties?.highway || '')).filter(Boolean));
    const hasOnlyFootOrSteps = highwayValues.size > 0
        && [...highwayValues].every((value) => ['steps', 'footway'].includes(value));
    return {
        ok: features.length > 0 && lengthMeters >= 50 && !hasOnlyFootOrSteps,
        lengthMeters,
        highwayValues,
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

function isGeneratedStreetViewImage(fileName) {
    const dimensions = readJpegDimensions(path.join(OUTPUT_DIR, fileName));
    return dimensions?.width === DEFAULT_WIDTH && dimensions?.height === DEFAULT_HEIGHT;
}

function normalizeQuartierKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-\s]/g, '');
}

function buildArrondissementLookup() {
    const lookup = new Map();
    for (const [quartier, arrondissement] of Object.entries(ARRONDISSEMENT_PAR_QUARTIER)) {
        lookup.set(normalizeQuartierKey(quartier), arrondissement);
    }
    return lookup;
}

function getArrondissementForQuartier(quartier, arrondissementLookup) {
    return arrondissementLookup.get(normalizeQuartierKey(quartier)) || '';
}

function dateHash(dateStr) {
    let hash = 0;
    for (let index = 0; index < dateStr.length; index += 1) {
        hash = ((hash << 5) - hash + dateStr.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
}

function requestBuffer(requestUrl, timeoutMs) {
    return new Promise((resolve, reject) => {
        const request = https.get(requestUrl, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode || 0,
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

async function fetchStreetViewMetadata(streetName, geometryIndex, apiKey, timeoutMs) {
    const streetViewGeometry = getStreetViewGeometry(streetName, geometryIndex);
    const params = new URLSearchParams();
    params.set('size', `${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`);
    params.set('location', streetViewGeometry?.location || `${streetName}, Paris, France`);
    params.set('fov', String(DEFAULT_FOV));
    params.set('pitch', String(DEFAULT_PITCH));
    params.set('radius', String(DEFAULT_RADIUS));
    params.set('source', 'outdoor');
    params.set('return_error_code', 'true');
    params.set('key', apiKey);
    if (Number.isFinite(streetViewGeometry?.heading)) {
        params.set('heading', String(streetViewGeometry.heading));
    }
    const response = await requestBuffer(`${STREET_VIEW_METADATA_URL}?${params.toString()}`, timeoutMs);
    const text = response.body.toString('utf8');
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Metadata JSON invalide (${response.statusCode}): ${text.slice(0, 160)}`);
    }
}

function readManifestRows() {
    const rows = parseCsv(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const header = rows[0] || [];
    const column = new Map(header.map((name, index) => [name, index]));
    return { rows, column };
}

function getRecentArrondissements(rows, rowIndex, column, arrondissementLookup) {
    const quartierIndex = column.get('quartier');
    const forbidden = new Set();
    for (let index = rowIndex - 1; index >= 1 && forbidden.size < 5; index -= 1) {
        const arrondissement = getArrondissementForQuartier(rows[index][quartierIndex], arrondissementLookup);
        if (arrondissement) {
            forbidden.add(arrondissement);
        }
    }
    return forbidden;
}

async function selectReplacementByDailyRule({
    date,
    rows,
    rowIndex,
    column,
    streetIndex,
    arrondissementLookup,
    usedNames,
    geometryIndex,
    apiKey,
    timeoutMs,
}) {
    const forbiddenArrondissements = getRecentArrondissements(rows, rowIndex, column, arrondissementLookup);
    let hashSeed = date;
    for (let attempts = 0; attempts < 500; attempts += 1) {
        const candidate = streetIndex[dateHash(hashSeed) % streetIndex.length];
        if (usedNames.has(normalizeName(candidate.name))) {
            hashSeed += '_retry';
            continue;
        }
        const suitability = getStreetImageSuitability(candidate.name, geometryIndex);
        if (!suitability.ok) {
            hashSeed += '_retry';
            continue;
        }
        const arrondissement = getArrondissementForQuartier(candidate.quartier, arrondissementLookup);
        if (arrondissement && forbiddenArrondissements.has(arrondissement)) {
            hashSeed += '_retry';
            continue;
        }
        const metadata = await fetchStreetViewMetadata(candidate.name, geometryIndex, apiKey, timeoutMs);
        if (metadata.status === 'OK') {
            return { ...candidate, metadata };
        }
        hashSeed += '_retry';
    }
    throw new Error(`Aucun remplacement trouve par la regle Daily pour ${date}`);
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const from = args.from || DEFAULT_FROM;
    const explicitDates = parseDateSet(args.dates);
    const timeoutMs = Number.parseInt(args.timeout, 10) || DEFAULT_TIMEOUT_MS;
    const apiKey = getApiKey();
    const { rows, column } = readManifestRows();
    const dateIndex = column.get('date');
    const streetIndex = column.get('street_name');
    const quartierIndex = column.get('quartier');
    const fileIndex = column.get('file_name');
    const missingIndex = column.get('missing_image_street');
    const geometryIndex = loadStreetGeometryIndex();
    const targetRows = rows
        .slice(1)
        .map((row, index) => ({ row, rowIndex: index + 1 }))
        .filter(({ row }) => {
            const date = row[dateIndex];
            const fileName = row[fileIndex];
            if (explicitDates.size > 0) {
                return explicitDates.has(date);
            }
            if (date < from || !fileName) {
                return false;
            }
            if (!fs.existsSync(path.join(OUTPUT_DIR, fileName))) {
                return true;
            }
            if (!args['unsuitable-generated'] || !isGeneratedStreetViewImage(fileName)) {
                return false;
            }
            return !getStreetImageSuitability(row[streetIndex], geometryIndex).ok;
        });

    if (targetRows.length === 0) {
        console.log('Aucune date a remplacer.');
        return;
    }

    const targetRowIndexes = new Set(targetRows.map(({ rowIndex }) => rowIndex));
    const usedNames = new Set(
        rows
            .slice(1)
            .map((row, index) => ({ row, rowIndex: index + 1 }))
            .filter(({ rowIndex }) => !targetRowIndexes.has(rowIndex))
            .map(({ row }) => normalizeName(row[streetIndex]))
            .filter(Boolean)
    );
    const streetIndexForDaily = JSON.parse(fs.readFileSync(STREETS_INDEX_PATH, 'utf8'))
        .filter((entry) => shouldKeepStreetForGame({ name: entry?.name }));
    const arrondissementLookup = buildArrondissementLookup();

    const replacements = [];

    for (const missing of targetRows) {
        const oldStreet = missing.row[streetIndex];
        const oldFileName = missing.row[fileIndex];
        const replacement = await selectReplacementByDailyRule({
            date: missing.row[dateIndex],
            rows,
            rowIndex: missing.rowIndex,
            column,
            streetIndex: streetIndexForDaily,
            arrondissementLookup,
            usedNames,
            geometryIndex,
            apiKey,
            timeoutMs,
        });
        usedNames.add(normalizeName(replacement.name));
        replacements.push({ missing, replacement, oldFileName });
        console.log(
            `[replace] ${missing.row[dateIndex]} ${oldStreet} -> ${replacement.name} (${replacement.metadata.date || 'date inconnue'})`
        );
    }

    if (args['dry-run']) {
        return;
    }

    for (const { missing, replacement, oldFileName } of replacements) {
        const date = missing.row[dateIndex];
        missing.row[streetIndex] = replacement.name;
        missing.row[quartierIndex] = replacement.quartier;
        missing.row[fileIndex] = `${date}__${slugify(replacement.name)}.jpg`;
        missing.row[missingIndex] = '';
        if (args['delete-old-images'] && oldFileName && oldFileName !== missing.row[fileIndex]) {
            const oldPath = path.join(OUTPUT_DIR, oldFileName);
            if (isGeneratedStreetViewImage(oldFileName) && fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
                console.log(`[delete] ${path.relative(ROOT_DIR, oldPath)}`);
            }
        }
    }

    fs.writeFileSync(MANIFEST_PATH, serializeRows(rows), 'utf8');
    console.log(`Manifest mis a jour: ${replacements.length} remplacements.`);
}

run().catch((error) => {
    console.error(`[replace-daily] ${error.message}`);
    process.exitCode = 1;
});
