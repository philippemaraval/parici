const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createObservability } = require('./observability');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const webPush = require('web-push');
const db = require('./database');
const {
    buildDailyAvailabilityPayload,
    buildDailyStreakReminderPayload,
} = require('./daily-streak');
const { sendPasswordResetEmail } = require('./mailer');
const { REFERRAL_EVENTS, createReferralService } = require('./referrals');
const {
    config,
    readEnvIntegerInRange,
    readFirstDefinedEnv,
} = require('./config');
const asyncHandler = require('./http/async-handler');
const { installOpenApi } = require('./openapi');
const { domains } = require('./domains/registry');
const { createProfileRepository } = require('./domains/profiles/repository');
const { createProfileService } = require('./domains/profiles/service');
const { createProfileController } = require('./domains/profiles/controller');
const { createProfileRouter } = require('./domains/profiles/routes');
const { shouldKeepStreetForGame } = require('../street_filter');
const {
    FAMOUS_STREET_NAMES: DEFAULT_FAMOUS_STREET_NAMES,
    MAIN_STREET_NAMES: DEFAULT_MAIN_STREET_NAMES,
    MONUMENT_NAMES: DEFAULT_MONUMENT_NAMES,
    ARRONDISSEMENT_PAR_QUARTIER,
} = require('../data_rules.js');

const DAILY_IMAGES_PUBLIC_DIR = '/data/daily_images';
const DAILY_IMAGES_ABSOLUTE_DIR = path.join(__dirname, '..', 'data', 'daily_images');
const DAILY_MANIFEST_ABSOLUTE_PATH = path.join(
    __dirname,
    'data',
    'daily_images',
    'manifest_next_30.csv',
);
const DAILY_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'webp', 'png'];
const BACKEND_STREETS_LIGHT_PATH = path.join(__dirname, 'data', 'paris_rues_light.geojson');
const BACKEND_STREETS_INDEX_PATH = path.join(__dirname, 'data', 'streets_index.json');
const BACKEND_QUARTIERS_GEOJSON_PATH = path.join(__dirname, 'data', 'paris_arrondissements.geojson');
const BACKEND_MONUMENTS_GEOJSON_PATH = path.join(__dirname, 'data', 'paris_monuments.geojson');
const STREET_GEOMETRY_CANDIDATE_PATHS = [
    path.join(__dirname, 'data', 'paris_rues_light.geojson'),
    path.join(__dirname, 'data', 'paris_rues_enrichi.geojson'),
    path.join(__dirname, '..', 'data', 'paris_rues_light.geojson'),
    path.join(__dirname, '..', 'data', 'paris_rues_enrichi.geojson'),
];

const app = express();
app.disable('x-powered-by');
const observability = createObservability({
    service: 'parici-api',
    metricsToken: process.env.METRICS_TOKEN || '',
    requireMetricsToken: process.env.NODE_ENV === 'production',
});
const PORT = process.env.PORT || 3000;
const startupState = {
    databaseReady: false,
    databaseError: null,
};
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET_KEY = process.env.SECRET_KEY || '';
const ENABLE_ADMIN_ROUTES = process.env.ENABLE_ADMIN_ROUTES === 'true';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const PUSH_REMINDER_HOUR = readEnvIntegerInRange('PUSH_REMINDER_HOUR', 10, 0, 23);
const PUSH_REMINDER_MINUTE = readEnvIntegerInRange('PUSH_REMINDER_MINUTE', 0, 0, 59);
const PUSH_STREAK_REMINDER_HOUR = readEnvIntegerInRange('PUSH_STREAK_REMINDER_HOUR', 16, 0, 23);
const PUSH_STREAK_REMINDER_MINUTE = readEnvIntegerInRange('PUSH_STREAK_REMINDER_MINUTE', 0, 0, 59);
const PUSH_REMINDER_TIMEZONE = process.env.PUSH_REMINDER_TIMEZONE || 'Europe/Paris';
const DAILY_TIMEZONE = process.env.DAILY_TIMEZONE || PUSH_REMINDER_TIMEZONE || 'Europe/Paris';
const DAILY_ROLLOVER_HOUR = readEnvIntegerInRange('DAILY_ROLLOVER_HOUR', 3, 0, 23);
const LOGIN_RATE_LIMIT_WINDOW_MS = readEnvIntegerInRange('LOGIN_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000, 1_000, 3_600_000);
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = readEnvIntegerInRange('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', 8, 1, 100);
const LOGIN_RATE_LIMIT_BLOCK_MS = readEnvIntegerInRange('LOGIN_RATE_LIMIT_BLOCK_MS', 10 * 60 * 1000, 1_000, 3_600_000);
const PASSWORD_RESET_EXPIRATION_HOURS = readEnvIntegerInRange('PASSWORD_RESET_EXPIRATION_HOURS', 24, 1, 168);
const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = readEnvIntegerInRange(
    'PASSWORD_RESET_RATE_LIMIT_WINDOW_MS',
    15 * 60 * 1000,
    60_000,
    24 * 60 * 60 * 1000,
);
const PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS = readEnvIntegerInRange(
    'PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS',
    5,
    1,
    50,
);
const PASSWORD_RESET_FRONTEND_URL = readFirstDefinedEnv([
    'PASSWORD_RESET_FRONTEND_URL',
    'FRONTEND_URL',
], 'https://parici-ajm.pages.dev');
const DEFAULT_EDITOR_USERNAMES = new Set(['mphil', 'mphil12', 'mgm']);
const DEFAULT_EDITOR_USERNAME_PATTERNS = [
    /^mphil\d*$/i,
    /^mgm\d*$/i,
];
const EDITOR_USERNAMES = new Set([
    ...DEFAULT_EDITOR_USERNAMES,
    ...config.admin.editorUsernames,
]);
const ENV_VAPID_SUBJECT = readFirstDefinedEnv([
    'VAPID_SUBJECT',
    'WEB_PUSH_VAPID_SUBJECT',
    'WEBPUSH_VAPID_SUBJECT',
], 'mailto:noreply@parici.app');
const ENV_VAPID_PUBLIC_KEY = readFirstDefinedEnv([
    'VAPID_PUBLIC_KEY',
    'WEB_PUSH_VAPID_PUBLIC_KEY',
    'WEBPUSH_VAPID_PUBLIC_KEY',
    'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    'PUBLIC_VAPID_KEY',
    'PUSH_PUBLIC_KEY',
]);
const ENV_VAPID_PRIVATE_KEY = readFirstDefinedEnv([
    'VAPID_PRIVATE_KEY',
    'WEB_PUSH_VAPID_PRIVATE_KEY',
    'WEBPUSH_VAPID_PRIVATE_KEY',
    'PUSH_PRIVATE_KEY',
]);
const pushRuntime = {
    enabled: false,
    subject: ENV_VAPID_SUBJECT,
    publicKey: '',
    privateKey: '',
    source: 'none',
};
let pushRuntimeSignature = '';
const loginRateLimitStore = new Map();
const passwordResetRateLimitStore = new Map();
const USER_ROLE_PLAYER = 'player';
const USER_ROLE_EDITOR = 'editor';
const USER_ROLE_ADMIN = 'admin';
const VALID_USER_ROLES = new Set([USER_ROLE_PLAYER, USER_ROLE_EDITOR, USER_ROLE_ADMIN]);
const CONTENT_EDITOR_ROLES = new Set([USER_ROLE_EDITOR, USER_ROLE_ADMIN]);
const SESSION_COOKIE_NAME = 'camino_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,30}$/u;
const RESERVED_USERNAMES = new Set([
    'admin',
    'administrator',
    'camino',
    'moderator',
    'mod',
    'root',
    'support',
    'system',
]);
const ALLOWED_AVATARS = new Set([
    '👤', '🧑', '👧', '🧒', '🛴', '🍕', '⚓', '🐟', '⛵', '🌊',
    '💪', '☀️', '🏖️', '😎', '🏛️', '🦅', '⚽', '👑',
    '🚀', '⭐️', '🛸', '👽', '🎮', '🔟', '💯', '💎', '⭐', '🏙️',
    '🗿', '🧭', '📅', '🔥', '⚡', '🏆', '🎯', '🌟',
    '🫃', '🧗‍♂️', '👴', '🥐',
]);
const STREET_INFOS_SETTING_KEY = 'content_street_infos_v1';
const CONTENT_LISTS_SETTING_KEY = 'content_lists_v1';
const CONTENT_MONUMENTS_SETTING_KEY = 'content_monuments_v1';
const MAP_SYNC_META_SETTING_KEY = 'map_sync_meta_v1';
const MAX_STREET_INFO_ENTRIES = 20000;
const MAX_LIST_ENTRIES = 20000;
const MAX_MONUMENT_ENTRIES = 20000;
const MAX_NAME_LENGTH = 160;
const MAX_INFO_LENGTH = 5000;
const OSM_SYNC_TIMEOUT_MS = readEnvIntegerInRange('OSM_SYNC_TIMEOUT_MS', 12 * 60 * 1000, 30_000, 30 * 60 * 1000);
const OSM_SYNC_LOG_MAX_CHARS = 120_000;
const OSM_SYNC_STALE_LOCK_MS = OSM_SYNC_TIMEOUT_MS + 60_000;
const GITHUB_OSM_SYNC_TOKEN = readFirstDefinedEnv([
    'GITHUB_OSM_SYNC_TOKEN',
    'GITHUB_SYNC_TOKEN',
    'GITHUB_TOKEN',
]);
const GITHUB_OSM_SYNC_REPOSITORY = readFirstDefinedEnv([
    'GITHUB_OSM_SYNC_REPOSITORY',
    'GITHUB_SYNC_REPOSITORY',
    'GITHUB_REPOSITORY',
], 'philippemaraval/parici');
const GITHUB_OSM_SYNC_WORKFLOW_ID = process.env.GITHUB_OSM_SYNC_WORKFLOW_ID || 'sync-osm.yml';
const GITHUB_OSM_SYNC_REF = process.env.GITHUB_OSM_SYNC_REF || 'main';
const GITHUB_API_TIMEOUT_MS = readEnvIntegerInRange('GITHUB_API_TIMEOUT_MS', 15_000, 1_000, 60_000);
const PUBLIC_CONTENT_CACHE_TTL_MS = readEnvIntegerInRange('PUBLIC_CONTENT_CACHE_TTL_MS', 5 * 60 * 1000, 0, 24 * 60 * 60 * 1000);
const LEADERBOARDS_CACHE_TTL_MS = readEnvIntegerInRange('LEADERBOARDS_CACHE_TTL_MS', 60 * 1000, 0, 24 * 60 * 60 * 1000);
const DAILY_LEADERBOARD_CACHE_TTL_MS = readEnvIntegerInRange('DAILY_LEADERBOARD_CACHE_TTL_MS', 60 * 1000, 0, 24 * 60 * 60 * 1000);
const OSM_SYNC_WATCHED_FILES = [
    path.join(__dirname, '..', 'data', 'paris_rues_enrichi.geojson'),
    path.join(__dirname, '..', 'data', 'paris_rues_light.geojson'),
    path.join(__dirname, 'data', 'paris_rues_light.geojson'),
    path.join(__dirname, 'data', 'streets_index.json'),
    path.join(__dirname, '..', 'data', 'map_sync_meta.json'),
];
const MAP_SYNC_META_FILE_PATH = path.join(__dirname, '..', 'data', 'map_sync_meta.json');
let osmSyncState = null;
const publicContentCache = createAsyncTtlCache(PUBLIC_CONTENT_CACHE_TTL_MS);
const allLeaderboardsCache = createAsyncTtlCache(LEADERBOARDS_CACHE_TTL_MS);
const monthlyLeaderboardsCache = createAsyncTtlCache(LEADERBOARDS_CACHE_TTL_MS);
const dailyLeaderboardCache = createAsyncTtlCache(DAILY_LEADERBOARD_CACHE_TTL_MS);
const dailyWeeklyLeaderboardCache = createAsyncTtlCache(DAILY_LEADERBOARD_CACHE_TTL_MS);
const dailyPodiumLeaderboardCache = createAsyncTtlCache(DAILY_LEADERBOARD_CACHE_TTL_MS);
const dailyAverageLeaderboardCache = createAsyncTtlCache(DAILY_LEADERBOARD_CACHE_TTL_MS);
const referralService = createReferralService(db);

if (!JWT_SECRET_KEY) {
    if (IS_PRODUCTION) {
        throw new Error('SECURITY: SECRET_KEY must be set in production');
    }
    console.warn('⚠️ SECRET_KEY is not set. Using a temporary in-memory key for development.');
}

const EFFECTIVE_JWT_SECRET = JWT_SECRET_KEY || crypto.randomBytes(32).toString('hex');

function cloneJsonValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function createAsyncTtlCache(ttlMs) {
    return {
        ttlMs: Math.max(0, Number(ttlMs) || 0),
        value: null,
        expiresAt: 0,
        inflight: null,
        key: '',
    };
}

async function readAsyncTtlCache(cache, loader, { key = '', force = false } = {}) {
    const now = Date.now();
    const hasFreshValue =
        !force &&
        cache.value !== null &&
        cache.key === key &&
        cache.expiresAt > now;
    if (hasFreshValue) {
        return cloneJsonValue(cache.value);
    }

    if (cache.inflight && cache.key === key) {
        const pendingValue = await cache.inflight;
        return cloneJsonValue(pendingValue);
    }

    cache.key = key;
    cache.inflight = Promise.resolve()
        .then(loader)
        .then((value) => {
            cache.value = cloneJsonValue(value);
            cache.expiresAt = Date.now() + cache.ttlMs;
            return cache.value;
        })
        .finally(() => {
            cache.inflight = null;
        });

    const value = await cache.inflight;
    return cloneJsonValue(value);
}

function invalidateAsyncTtlCache(cache) {
    cache.value = null;
    cache.expiresAt = 0;
    cache.inflight = null;
    cache.key = '';
}

function invalidatePublicContentCache() {
    invalidateAsyncTtlCache(publicContentCache);
}

function invalidateLeaderboardCaches() {
    invalidateAsyncTtlCache(allLeaderboardsCache);
    invalidateAsyncTtlCache(monthlyLeaderboardsCache);
    invalidateAsyncTtlCache(dailyLeaderboardCache);
    invalidateAsyncTtlCache(dailyWeeklyLeaderboardCache);
    invalidateAsyncTtlCache(dailyPodiumLeaderboardCache);
    invalidateAsyncTtlCache(dailyAverageLeaderboardCache);
}

async function getCachedPublicContentSnapshot() {
    return readAsyncTtlCache(publicContentCache, () => getEffectiveContentSnapshot(), {
        key: 'public-content',
    });
}

async function getCachedLeaderboards(period) {
    const normalizedPeriod = period === 'month' ? 'month' : 'all';
    const cache = normalizedPeriod === 'month' ? monthlyLeaderboardsCache : allLeaderboardsCache;
    return readAsyncTtlCache(
        cache,
        () => db.getAllLeaderboards(100, { period: normalizedPeriod }),
        { key: normalizedPeriod },
    );
}

async function getCachedDailyLeaderboard(dateStr) {
    return readAsyncTtlCache(
        dailyLeaderboardCache,
        () => db.getDailyLeaderboard(dateStr),
        { key: String(dateStr || '') },
    );
}

function getIsoWeekRangeForDateKey(dateStr) {
    const [year, month, day] = String(dateStr || '').split('-').map((part) => Number.parseInt(part, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(date.getTime())) {
        return { weekStart: dateStr, weekEnd: dateStr };
    }
    const isoDay = date.getUTCDay() || 7;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - isoDay + 1);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const format = (value) => value.toISOString().slice(0, 10);
    return { weekStart: format(monday), weekEnd: format(sunday) };
}

async function getCachedDailyWeeklyLeaderboard(dateStr) {
    return readAsyncTtlCache(
        dailyWeeklyLeaderboardCache,
        async () => {
            const range = getIsoWeekRangeForDateKey(dateStr);
            const rows = await db.getDailyWeeklyLeaderboard(dateStr);
            return { ...range, rows };
        },
        { key: String(dateStr || '') },
    );
}

async function getCachedDailyPodiumLeaderboard(dateStr) {
    return readAsyncTtlCache(
        dailyPodiumLeaderboardCache,
        () => db.getWeeklyDailyPodiumLeaderboard(dateStr),
        { key: String(dateStr || '') },
    );
}

async function getCachedDailyAverageLeaderboard() {
    return readAsyncTtlCache(
        dailyAverageLeaderboardCache,
        () => db.getDailyAverageLeaderboard(),
        { key: 'all-time' },
    );
}

function warmCriticalCachesInBackground() {
    Promise.allSettled([
        getCachedPublicContentSnapshot(),
        getCachedLeaderboards('all'),
        getCachedLeaderboards('month'),
        getCachedDailyLeaderboard(getDailyDateKey()),
        getCachedDailyWeeklyLeaderboard(getDailyDateKey()),
        getCachedDailyPodiumLeaderboard(getDailyDateKey()),
        getCachedDailyAverageLeaderboard(),
    ]).catch(() => {
        // Promise.allSettled should not reject, but keep background warming silent.
    });
}

function buildPushRuntimeSignature(subject, publicKey, privateKey) {
    return `${subject}::${publicKey}::${privateKey}`;
}

function applyPushRuntimeMaterial({ subject, publicKey, privateKey, source }) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    pushRuntime.enabled = true;
    pushRuntime.subject = subject;
    pushRuntime.publicKey = publicKey;
    pushRuntime.privateKey = privateKey;
    pushRuntime.source = source;
    pushRuntimeSignature = buildPushRuntimeSignature(subject, publicKey, privateKey);
}

async function resolvePushMaterialFromStorage() {
    let subject = ENV_VAPID_SUBJECT;
    let publicKey = ENV_VAPID_PUBLIC_KEY;
    let privateKey = ENV_VAPID_PRIVATE_KEY;
    let source = 'env';

    if (!(publicKey && privateKey)) {
        const [storedPublic, storedPrivate, storedSubject] = await Promise.all([
            db.getAppSetting('vapid_public_key'),
            db.getAppSetting('vapid_private_key'),
            db.getAppSetting('vapid_subject'),
        ]);

        if (!(storedPublic && storedPrivate)) {
            return null;
        }

        publicKey = storedPublic;
        privateKey = storedPrivate;
        subject = storedSubject || subject;
        source = 'db';
    }

    return { subject, publicKey, privateKey, source };
}

async function synchronizePushRuntimeFromStorage() {
    const material = await resolvePushMaterialFromStorage();
    if (!material) {
        return false;
    }

    const nextSignature = buildPushRuntimeSignature(
        material.subject,
        material.publicKey,
        material.privateKey,
    );
    if (pushRuntime.enabled && nextSignature === pushRuntimeSignature) {
        return true;
    }

    applyPushRuntimeMaterial(material);
    console.log(`Push notifications synchronized (source: ${material.source}).`);
    return true;
}

async function ensurePushRuntimeReady() {
    if (pushRuntime.enabled) {
        try {
            await synchronizePushRuntimeFromStorage();
            return true;
        } catch (error) {
            console.warn('Push runtime re-sync failed:', error.message);
            return true;
        }
    }

    try {
        const synced = await synchronizePushRuntimeFromStorage();
        if (synced) {
            return true;
        }
    } catch (error) {
        console.warn('Push runtime sync failed:', error.message);
    }

    return false;
}

async function initializePushRuntime() {
    try {
        const existingMaterial = await resolvePushMaterialFromStorage();
        if (existingMaterial) {
            applyPushRuntimeMaterial(existingMaterial);
            console.log(`Push notifications enabled (source: ${existingMaterial.source}).`);
            return;
        }

        const generated = webPush.generateVAPIDKeys();
        await Promise.all([
            db.setAppSettingIfMissing('vapid_public_key', generated.publicKey),
            db.setAppSettingIfMissing('vapid_private_key', generated.privateKey),
            db.setAppSettingIfMissing('vapid_subject', ENV_VAPID_SUBJECT),
        ]);

        const synced = await synchronizePushRuntimeFromStorage();
        if (!synced) {
            throw new Error('Could not persist/load VAPID keys');
        }

        if (pushRuntime.source === 'db') {
            console.warn('Push VAPID keys were auto-generated and saved in DB settings.');
        }
    } catch (error) {
        pushRuntime.enabled = false;
        pushRuntime.subject = ENV_VAPID_SUBJECT;
        pushRuntime.publicKey = '';
        pushRuntime.privateKey = '';
        pushRuntime.source = 'error';
        pushRuntimeSignature = '';
        console.error('Push notifications init failed:', error.message);
    }
}

// CORS configuration
const allowedOrigins = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://parici4.netlify.app',
    'https://parici5.netlify.app',
    'https://paris-parici6.netlify.app',
    'https://parici7.netlify.app',
    'https://parici8.netlify.app',
    'https://parici.netlify.app',
    'https://camino-paris.netlify.app',
    'https://parici-ajm.pages.dev',
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
].filter(Boolean));

function isAllowedOrigin(origin) {
    return !origin || allowedOrigins.has(origin);
}

app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 100);
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
        'Permissions-Policy',
        'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()'
    );
    if (IS_PRODUCTION) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});
app.use(observability.requestMiddleware);

app.use(cors({
    origin: function (origin, callback) {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            console.warn('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Admin-Key', 'X-Request-Id'],
    exposedHeaders: ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-Request-Id'],
    maxAge: 86400,
}));

app.use((err, req, res, next) => {
    if (err && err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'Origin not allowed by CORS policy' });
    }
    return next(err);
});

app.use(express.json({ limit: '8mb' }));
installOpenApi(app);

app.get('/api/health', (req, res) => {
    if (req.query?.prewarm === '1' || req.query?.prewarm === 'true') {
        if (startupState.databaseReady) {
            warmCriticalCachesInBackground();
        }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        ok: true,
        database: startupState.databaseReady ? 'ready' : 'initializing',
        uptimeSec: Math.round(process.uptime()),
        domains: Object.keys(domains),
    });
});

app.get('/api/ready', async (req, res) => {
    const startedAtMs = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    if (!startupState.databaseReady) {
        return res.status(503).json({
            ok: false,
            database: startupState.databaseError ? 'unavailable' : 'initializing',
            error: startupState.databaseError,
            durationMs: Date.now() - startedAtMs,
        });
    }
    try {
        await db.ping();
        return res.json({
            ok: true,
            database: 'ready',
            durationMs: Date.now() - startedAtMs,
        });
    } catch (error) {
        console.error('Readiness check failed:', error.message);
        return res.status(503).json({
            ok: false,
            database: 'unavailable',
            durationMs: Date.now() - startedAtMs,
        });
    }
});

app.use('/api', asyncHandler(async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    const ipHash = hashRequestIp(req);
    const result = await db.consumeApiRateLimit(`write:${ipHash}`, 60_000, 300);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
    if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        return res.status(429).json({
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
        });
    }
    return next();
}));

app.use(['/api/editor', '/api/admin'], (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    res.on('finish', () => {
        db.recordSecurityAuditLog({
            actorUserId: req.user?.id,
            actorUsername: req.user?.username || (req.headers['x-admin-key'] ? 'admin-api-key' : ''),
            action: `${req.method} ${req.baseUrl}${req.path}`,
            target: req.originalUrl,
            requestId: req.requestId,
            ipHash: hashRequestIp(req),
            statusCode: res.statusCode,
            details: {
                bodyFields: Object.keys(req.body || {}).sort().slice(0, 30),
            },
        }).catch((error) => {
            console.error('Security audit log write failed:', error.message);
        });
    });
    return next();
});

// Serve the fingerprinted build in production. Failing fast prevents Render
// from marking a deployment healthy when its JavaScript bundle is missing.
const frontendRoot = IS_PRODUCTION
    ? path.join(__dirname, '..', 'dist')
    : path.join(__dirname, '..');
if (IS_PRODUCTION && !fs.existsSync(frontendRoot)) {
    throw new Error('Production frontend build not found. Run npm run build before starting.');
}

// Compatibility bridge for pages cached before assets were fingerprinted.
// Loading the current bundle lets those clients update their service worker.
app.get('/main.js', (req, res, next) => {
    if (!IS_PRODUCTION) {
        return next();
    }
    try {
        const assetManifest = JSON.parse(
            fs.readFileSync(path.join(frontendRoot, 'asset-manifest.json'), 'utf8')
        );
        const mainAssetUrl = assetManifest['main.js'];
        if (!mainAssetUrl || !mainAssetUrl.startsWith('/assets/')) {
            return next();
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(path.join(frontendRoot, mainAssetUrl.slice(1)));
    } catch (error) {
        return next(error);
    }
});

app.use(express.static(frontendRoot));

async function initializeBackgroundServices() {
    try {
        await initializePushRuntime();
    } catch (error) {
        console.error('Push runtime init failed during background startup:', error);
    }

    try {
        startPushReminderScheduler();
    } catch (error) {
        console.error('Push reminder scheduler failed to start:', error);
    }

    try {
        startFriendChallengeCleanupScheduler();
    } catch (error) {
        console.error('Friend challenge cleanup scheduler failed to start:', error);
    }

    warmCriticalCachesInBackground();
}

async function initializeDatabase({ startBackgroundServices = true } = {}) {
    try {
        if (streetIndex.length === 0) {
            reloadDailyRuntimeIndexes();
        }
        await db.initDb();
        startupState.databaseReady = true;
        startupState.databaseError = null;
        console.log('Database ready.');

        if (startBackgroundServices) {
            await initializeBackgroundServices();
        }
    } catch (error) {
        startupState.databaseReady = false;
        startupState.databaseError = error.message;
        throw error;
    }
}

// Bind Render's port immediately. Database bootstrap can legitimately take longer
// than Render's health-check window (for example while PostgreSQL wakes or waits
// for a schema lock), and must not prevent the process from becoming reachable.
function startServer() {
    return app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        setImmediate(() => {
            reloadDailyRuntimeIndexes();
        });
        initializeDatabase().catch((error) => {
            console.error('Database init failed:', error);
        });
    });
}

// ----------------------
// Auth Middleware
// ----------------------

function issueAuthToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: normalizeUserRole(user.role),
            sessionVersion: Number(user.session_version || 1),
        },
        EFFECTIVE_JWT_SECRET,
        {
            expiresIn: SESSION_MAX_AGE_SECONDS,
            jwtid: crypto.randomUUID(),
        },
    );
}

const authenticateToken = asyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const cookieToken = parseCookieHeader(req).get(SESSION_COOKIE_NAME) || '';
    const token = bearerToken === '__cookie_session__' ? cookieToken : (bearerToken || cookieToken);

    if (!token) {
        return res.status(401).json({ error: 'Missing authentication token', code: 'AUTH_TOKEN_MISSING' });
    }

    try {
        const tokenUser = jwt.verify(token, EFFECTIVE_JWT_SECRET);
        const userId = Number.parseInt(tokenUser?.id, 10);
        const currentUser = Number.isInteger(userId) ? await db.getUserById(userId) : null;
        if (
            !currentUser
            || Number(currentUser.session_version || 1) !== Number(tokenUser?.sessionVersion || 1)
        ) {
            clearSessionCookie(res);
            return res.status(403).json({
                error: 'Session revoked',
                code: 'AUTH_SESSION_REVOKED',
            });
        }
        req.user = {
            id: currentUser.id,
            username: String(currentUser.username || ''),
            role: normalizeUserRole(currentUser.role),
        };
        return next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(403).json({ error: 'Session expired', code: 'AUTH_TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid authentication token', code: 'AUTH_TOKEN_INVALID' });
    }
});

function timingSafeSecretMatch(providedValue, expectedValue) {
    const provided = Buffer.from(String(providedValue || ''), 'utf8');
    const expected = Buffer.from(String(expectedValue || ''), 'utf8');
    if (provided.length !== expected.length || expected.length === 0) {
        return false;
    }
    return crypto.timingSafeEqual(provided, expected);
}

function requireAdminApiKey(req, res, next) {
    if (!ENABLE_ADMIN_ROUTES) {
        return res.status(404).json({ error: 'Not found' });
    }

    if (!ADMIN_API_KEY) {
        console.error('SECURITY: ENABLE_ADMIN_ROUTES=true but ADMIN_API_KEY is not configured');
        return res.status(503).json({ error: 'Admin route misconfigured' });
    }

    const headerValue = req.headers['x-admin-key'] || '';
    const bearerValue = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const providedSecret = headerValue || bearerValue;

    if (!timingSafeSecretMatch(providedSecret, ADMIN_API_KEY)) {
        return res.status(403).json({ error: 'Unauthorized route access' });
    }

    next();
}

const requireContentEditor = asyncHandler(async (req, res, next) => {
    const userId = Number.parseInt(req.user?.id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(401).json({ error: 'Invalid authentication token' });
    }

    const user = await db.getUserById(userId);
    if (!user) {
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }

    req.user = {
        id: user.id,
        username: user.username,
        role: normalizeUserRole(user.role),
    };

    if (!isEditorIdentity(req.user)) {
        return res.status(403).json({ error: 'Editor access required' });
    }

    return next();
});

const requireAdminUser = asyncHandler(async (req, res, next) => {
    const user = await db.getUserById(req.user?.id);
    if (!user) {
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }
    if (normalizeUserRole(user.role) !== USER_ROLE_ADMIN) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = {
        id: user.id,
        username: user.username,
        role: USER_ROLE_ADMIN,
    };
    return next();
});

async function getCurrentAuthenticatedUser(authUser) {
    const userId = Number.parseInt(authUser?.id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
        return null;
    }

    const user = await db.getUserById(userId);
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        username: String(user.username || ''),
        role: normalizeUserRole(user.role),
        avatar: user.avatar || '👤',
        referralCode: user.referral_code || null,
    };
}

function getTimePartsInZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const byType = {};
    parts.forEach((part) => {
        byType[part.type] = part.value;
    });

    return {
        dateStr: `${byType.year}-${byType.month}-${byType.day}`,
        hour: Number.parseInt(byType.hour, 10),
        minute: Number.parseInt(byType.minute, 10),
    };
}

function getDateKeyInZone(timeZone) {
    return getTimePartsInZone(new Date(), timeZone).dateStr;
}

function getDailyDateKey(date = new Date()) {
    return getTimePartsInZone(
        new Date(date.getTime() - DAILY_ROLLOVER_HOUR * 60 * 60 * 1000),
        DAILY_TIMEZONE
    ).dateStr;
}

function shiftIsoDateKey(dateKey, dayOffset) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const shiftedDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
    return shiftedDate.toISOString().slice(0, 10);
}

async function isDailyGuessDateAllowed(userId, submittedDate, expectedDate) {
    if (submittedDate === expectedDate) {
        return true;
    }

    const previousDailyDate = shiftIsoDateKey(expectedDate, -1);
    if (submittedDate !== previousDailyDate) {
        return false;
    }

    const previousStatus = await db.getDailyUserStatus(userId, submittedDate);
    return Boolean(
        previousStatus
        && previousStatus.success !== true
        && Number(previousStatus.attempts_count || 0) < 7
    );
}

function slugifyDailyStreetName(streetName) {
    return String(streetName || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’'`´]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function resolveDailyImageUrl(date, streetName, manifestEntry = null) {
    if (!date || !streetName) {
        return null;
    }

    const manifestFileName = path.basename(String(manifestEntry?.fileName || '').trim());
    if (manifestFileName) {
        const manifestImagePath = path.join(DAILY_IMAGES_ABSOLUTE_DIR, manifestFileName);
        if (fs.existsSync(manifestImagePath)) {
            return `${DAILY_IMAGES_PUBLIC_DIR}/${manifestFileName}`;
        }
    }

    const slug = slugifyDailyStreetName(streetName);
    if (!slug) {
        return null;
    }

    for (const ext of DAILY_IMAGE_EXTENSIONS) {
        const fileName = `${date}__${slug}.${ext}`;
        const absolutePath = path.join(DAILY_IMAGES_ABSOLUTE_DIR, fileName);
        if (fs.existsSync(absolutePath)) {
            return `${DAILY_IMAGES_PUBLIC_DIR}/${fileName}`;
        }
    }

    return null;
}

function parseCsvRows(raw) {
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
            if (row.some((value) => String(value || '').trim())) {
                rows.push(row);
            }
            row = [];
            field = '';
            continue;
        }

        field += char;
    }

    row.push(field);
    if (row.some((value) => String(value || '').trim())) {
        rows.push(row);
    }

    return rows;
}

function isValidPushSubscription(subscription) {
    if (!subscription || typeof subscription !== 'object') {
        return false;
    }
    const endpoint = String(subscription.endpoint || '').trim();
    const keys = subscription.keys || {};
    return Boolean(
        endpoint &&
        typeof keys === 'object' &&
        String(keys.p256dh || '').trim() &&
        String(keys.auth || '').trim()
    );
}

function getDailyReminderPayload() {
    return JSON.stringify(buildDailyAvailabilityPayload());
}

function getDailyStreakReminderPayload(streakCount) {
    return JSON.stringify(buildDailyStreakReminderPayload(streakCount));
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function normalizeOptionalText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, maxLength);
}

function normalizeUserRole(role) {
    const candidate = String(role || '').trim().toLowerCase();
    return VALID_USER_ROLES.has(candidate) ? candidate : USER_ROLE_PLAYER;
}

function normalizeUsername(value) {
    return String(value || '').normalize('NFKC').trim();
}

function validateUsername(value) {
    const username = normalizeUsername(value);
    if (!USERNAME_PATTERN.test(username)) {
        return {
            ok: false,
            error: 'Le pseudo doit contenir 3 à 30 lettres, chiffres, points, tirets ou underscores.',
        };
    }
    if (RESERVED_USERNAMES.has(username.toLocaleLowerCase('fr-FR'))) {
        return { ok: false, error: 'Ce pseudo est réservé.' };
    }
    return { ok: true, username };
}

function normalizeContentName(name) {
    return String(name || '').trim().toLowerCase();
}

function normalizeMonumentLookupName(name) {
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

function normalizeStreetLookupName(name) {
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

function normalizeFeatureId(value) {
    return String(value || '').trim();
}

function getStreetFeatureId(feature) {
    return normalizeFeatureId(
        feature?.properties?.id ||
        feature?.properties?.osm_id ||
        feature?.id ||
        ''
    );
}

function normalizeCoordinatePair(value) {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
    }
    return [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))];
}

function getStreetFeatureCentroid(feature) {
    return normalizeCoordinatePair(feature?.properties?.centroid || feature?.centroid);
}

function normalizeStreetInfoEntries(rawEntries, maxEntries = MAX_STREET_INFO_ENTRIES) {
    const normalized = {};
    if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
        return normalized;
    }

    let entryCount = 0;
    for (const [rawName, rawInfo] of Object.entries(rawEntries)) {
        if (entryCount >= maxEntries) {
            break;
        }
        const normalizedName = normalizeContentName(rawName).slice(0, MAX_NAME_LENGTH);
        if (!normalizedName) {
            continue;
        }
        if (typeof rawInfo !== 'string') {
            continue;
        }
        const infoText = rawInfo.trim();
        if (!infoText) {
            continue;
        }
        normalized[normalizedName] = infoText.slice(0, MAX_INFO_LENGTH);
        entryCount += 1;
    }

    return normalized;
}

function normalizeNameList(rawList, maxEntries = MAX_LIST_ENTRIES) {
    if (!Array.isArray(rawList)) {
        return [];
    }
    const normalized = [];
    const seen = new Set();
    for (const value of rawList) {
        const normalizedValue = normalizeContentName(value).slice(0, MAX_NAME_LENGTH);
        if (!normalizedValue || seen.has(normalizedValue)) {
            continue;
        }
        seen.add(normalizedValue);
        normalized.push(normalizedValue);
        if (normalized.length >= maxEntries) {
            break;
        }
    }
    return normalized;
}

function normalizeMonumentNameList(rawList, maxEntries = MAX_LIST_ENTRIES) {
    if (!Array.isArray(rawList)) {
        return [];
    }
    const normalized = [];
    const seen = new Set();
    for (const value of rawList) {
        const normalizedValue = normalizeMonumentLookupName(value).slice(0, MAX_NAME_LENGTH);
        if (!normalizedValue || seen.has(normalizedValue)) {
            continue;
        }
        seen.add(normalizedValue);
        normalized.push(normalizedValue);
        if (normalized.length >= maxEntries) {
            break;
        }
    }
    return normalized;
}

function appendLimitedLog(current, chunk, maxChars = OSM_SYNC_LOG_MAX_CHARS) {
    const incoming = String(chunk || '');
    if (!incoming) {
        return current;
    }
    if (current.length >= maxChars) {
        return current;
    }
    const remaining = maxChars - current.length;
    if (incoming.length <= remaining) {
        return current + incoming;
    }
    return current + incoming.slice(0, remaining);
}

function captureOsmWatchedFilesSnapshot() {
    const snapshot = {};
    for (const absolutePath of OSM_SYNC_WATCHED_FILES) {
        try {
            const stat = fs.statSync(absolutePath);
            snapshot[absolutePath] = {
                exists: true,
                mtimeMs: Number(stat.mtimeMs || 0),
            };
        } catch (error) {
            snapshot[absolutePath] = {
                exists: false,
                mtimeMs: null,
            };
        }
    }
    return snapshot;
}

function computeChangedOsmFiles(beforeSnapshot, afterSnapshot) {
    const projectRoot = path.join(__dirname, '..');
    return OSM_SYNC_WATCHED_FILES.filter((absolutePath) => {
        const before = beforeSnapshot[absolutePath] || { exists: false, mtimeMs: null };
        const after = afterSnapshot[absolutePath] || { exists: false, mtimeMs: null };
        return before.exists !== after.exists || before.mtimeMs !== after.mtimeMs;
    }).map((absolutePath) => path.relative(projectRoot, absolutePath));
}

function runOsmSyncScript(timeoutMs = OSM_SYNC_TIMEOUT_MS) {
    const projectRoot = path.join(__dirname, '..');
    const projectNodeModulesPath = path.join(projectRoot, 'node_modules');
    const backendNodeModulesPath = path.join(__dirname, 'node_modules');
    const existingNodePathEntries = String(process.env.NODE_PATH || '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean);
    const nodePath = Array.from(
        new Set([projectNodeModulesPath, backendNodeModulesPath, ...existingNodePathEntries]),
    ).join(path.delimiter);

    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let didTimeout = false;
        let timeoutKillId = null;

        const child = spawn(process.execPath, ['scripts/sync_osm.js'], {
            cwd: projectRoot,
            env: {
                ...process.env,
                NODE_PATH: nodePath,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const timeoutId = setTimeout(() => {
            didTimeout = true;
            child.kill('SIGTERM');
            timeoutKillId = setTimeout(() => {
                child.kill('SIGKILL');
            }, 4_000);
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout = appendLimitedLog(stdout, chunk, OSM_SYNC_LOG_MAX_CHARS);
        });

        child.stderr.on('data', (chunk) => {
            stderr = appendLimitedLog(stderr, chunk, OSM_SYNC_LOG_MAX_CHARS);
        });

        child.on('error', (error) => {
            clearTimeout(timeoutId);
            if (timeoutKillId) {
                clearTimeout(timeoutKillId);
            }
            reject(error);
        });

        child.on('close', (exitCode, signal) => {
            clearTimeout(timeoutId);
            if (timeoutKillId) {
                clearTimeout(timeoutKillId);
            }
            resolve({
                exitCode: Number.isInteger(exitCode) ? exitCode : null,
                signal: signal || null,
                didTimeout,
                stdout,
                stderr,
            });
        });
    });
}

function getActiveLocalOsmSyncState() {
    if (!osmSyncState) {
        return null;
    }

    const startedAtMs = Number(osmSyncState.startedAtMs);
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
    if (ageMs > OSM_SYNC_STALE_LOCK_MS) {
        console.warn(`Resetting stale OSM sync lock after ${Math.round(ageMs / 1000)}s.`);
        osmSyncState = null;
        return null;
    }

    return {
        ...osmSyncState,
        ageMs,
    };
}

function startLocalOsmSyncState({ requestedBy = 'admin' } = {}) {
    const active = getActiveLocalOsmSyncState();
    if (active) {
        return null;
    }

    const startedAtMs = Date.now();
    osmSyncState = {
        target: 'local',
        requestedBy,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
    };
    return osmSyncState;
}

function clearLocalOsmSyncState() {
    osmSyncState = null;
}

function githubJsonRequest({ method, apiPath, token, body = null }) {
    return new Promise((resolve, reject) => {
        const requestBody = body ? JSON.stringify(body) : '';
        const req = https.request(
            {
                hostname: 'api.github.com',
                path: apiPath,
                method,
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody),
                    'User-Agent': 'Camino-Paris-OSM-Sync',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            },
            (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let payload = null;
                    if (text) {
                        try {
                            payload = JSON.parse(text);
                        } catch (error) {
                            payload = { message: text };
                        }
                    }

                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        resolve({ statusCode: response.statusCode, payload });
                        return;
                    }

                    const message = payload?.message || `GitHub API HTTP ${response.statusCode}`;
                    reject(new Error(message));
                });
            },
        );

        req.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
            req.destroy(new Error(`GitHub API timeout after ${Math.round(GITHUB_API_TIMEOUT_MS / 1000)}s`));
        });
        req.on('error', reject);
        if (requestBody) {
            req.write(requestBody);
        }
        req.end();
    });
}

async function dispatchOsmSyncWorkflow({ requestedBy = 'admin' } = {}) {
    if (!GITHUB_OSM_SYNC_TOKEN) {
        throw new Error('Token GitHub absent. Definir GITHUB_OSM_SYNC_TOKEN pour declencher la sync depot depuis l admin.');
    }

    const repository = GITHUB_OSM_SYNC_REPOSITORY.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
        throw new Error(`Depot GitHub invalide pour la sync OSM: ${repository || '(vide)'}`);
    }

    const encodedWorkflowId = encodeURIComponent(GITHUB_OSM_SYNC_WORKFLOW_ID);
    const apiPath = `/repos/${repository}/actions/workflows/${encodedWorkflowId}/dispatches`;
    await githubJsonRequest({
        method: 'POST',
        apiPath,
        token: GITHUB_OSM_SYNC_TOKEN,
        body: {
            ref: GITHUB_OSM_SYNC_REF,
            inputs: {
                source: requestedBy,
            },
        },
    });

    return {
        repository,
        workflow: GITHUB_OSM_SYNC_WORKFLOW_ID,
        ref: GITHUB_OSM_SYNC_REF,
    };
}

function normalizeGithubWorkflowRun(run) {
    if (!run || typeof run !== 'object') {
        return null;
    }
    return {
        id: run.id,
        number: run.run_number,
        name: run.name,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        branch: run.head_branch,
        headSha: run.head_sha,
        createdAt: run.created_at,
        startedAt: run.run_started_at,
        updatedAt: run.updated_at,
        url: run.html_url,
    };
}

function parseOptionalIsoDate(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return null;
    }
    const parsedMs = Date.parse(raw);
    if (Number.isNaN(parsedMs)) {
        return null;
    }
    return new Date(parsedMs);
}

async function getLatestOsmSyncWorkflowRun({ since = null } = {}) {
    if (!GITHUB_OSM_SYNC_TOKEN) {
        return null;
    }

    const repository = GITHUB_OSM_SYNC_REPOSITORY.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
        throw new Error(`Depot GitHub invalide pour la sync OSM: ${repository || '(vide)'}`);
    }

    const encodedWorkflowId = encodeURIComponent(GITHUB_OSM_SYNC_WORKFLOW_ID);
    const query = new URLSearchParams({
        branch: GITHUB_OSM_SYNC_REF,
        event: 'workflow_dispatch',
        per_page: '10',
    });
    const { payload } = await githubJsonRequest({
        method: 'GET',
        apiPath: `/repos/${repository}/actions/workflows/${encodedWorkflowId}/runs?${query.toString()}`,
        token: GITHUB_OSM_SYNC_TOKEN,
    });

    const sinceDate = parseOptionalIsoDate(since);
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const matchingRun = runs.find((run) => {
        if (!sinceDate) {
            return true;
        }
        const createdAtMs = Date.parse(run?.created_at || '');
        return !Number.isNaN(createdAtMs) && createdAtMs >= sinceDate.getTime() - 30_000;
    });

    return normalizeGithubWorkflowRun(matchingRun);
}

function parseMonumentCoordinates(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        return null;
    }

    if (rawEntry.type === 'Feature') {
        const coordinates = Array.isArray(rawEntry?.geometry?.coordinates)
            ? rawEntry.geometry.coordinates
            : [];
        const longitude = toFiniteNumber(coordinates[0]);
        const latitude = toFiniteNumber(coordinates[1]);
        if (longitude === null || latitude === null) {
            return null;
        }
        return { longitude, latitude };
    }

    const coordinates = Array.isArray(rawEntry.coordinates) ? rawEntry.coordinates : null;
    const longitude = toFiniteNumber(
        coordinates ? coordinates[0] : (rawEntry.longitude ?? rawEntry.lng),
    );
    const latitude = toFiniteNumber(
        coordinates ? coordinates[1] : (rawEntry.latitude ?? rawEntry.lat),
    );
    if (longitude === null || latitude === null) {
        return null;
    }
    return { longitude, latitude };
}

function extractMonumentRawName(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
        return '';
    }
    if (rawEntry.type === 'Feature') {
        return String(rawEntry?.properties?.name || '');
    }
    return String(rawEntry.name || '');
}

function normalizeMonumentEntries(rawEntries, maxEntries = MAX_MONUMENT_ENTRIES) {
    if (!Array.isArray(rawEntries)) {
        return [];
    }

    const normalized = [];
    const seen = new Set();
    for (const rawEntry of rawEntries) {
        const displayName = extractMonumentRawName(rawEntry).trim().slice(0, MAX_NAME_LENGTH);
        const normalizedName = normalizeMonumentLookupName(displayName).slice(0, MAX_NAME_LENGTH);
        if (!normalizedName || seen.has(normalizedName)) {
            continue;
        }

        const coordinates = parseMonumentCoordinates(rawEntry);
        if (!coordinates) {
            continue;
        }
        if (
            coordinates.longitude < -180 ||
            coordinates.longitude > 180 ||
            coordinates.latitude < -90 ||
            coordinates.latitude > 90
        ) {
            continue;
        }

        seen.add(normalizedName);
        normalized.push({
            name: displayName,
            normalizedName,
            longitude: coordinates.longitude,
            latitude: coordinates.latitude,
        });
        if (normalized.length >= maxEntries) {
            break;
        }
    }
    return normalized;
}

function serializeMonumentEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map((entry) => ({
        name: String(entry?.name || '').trim(),
        longitude: Number(entry?.longitude),
        latitude: Number(entry?.latitude),
    }));
}

function cloneStreetInfos(streetInfos) {
    return {
        famous: { ...(streetInfos?.famous || {}) },
        main: { ...(streetInfos?.main || {}) },
    };
}

function cloneContentLists(lists) {
    return {
        famousStreets: [...(lists?.famousStreets || [])],
        mainStreets: [...(lists?.mainStreets || [])],
        monuments: [...(lists?.monuments || [])],
    };
}

function cloneMonumentEntries(entries) {
    return (Array.isArray(entries) ? entries : []).map((entry) => ({
        name: String(entry?.name || ''),
        normalizedName: String(entry?.normalizedName || ''),
        longitude: Number(entry?.longitude),
        latitude: Number(entry?.latitude),
    }));
}

function parseJsonSetting(rawValue) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
        return null;
    }
    try {
        return JSON.parse(rawValue);
    } catch (error) {
        return null;
    }
}

function normalizeMapSyncMeta(rawValue) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        return null;
    }
    const lastSyncedAt = String(rawValue.lastSyncedAt || '').trim();
    if (!lastSyncedAt || Number.isNaN(Date.parse(lastSyncedAt))) {
        return null;
    }

    const normalized = {
        lastSyncedAt,
    };
    if (typeof rawValue.generatedBy === 'string' && rawValue.generatedBy.trim()) {
        normalized.generatedBy = rawValue.generatedBy.trim();
    }
    if (Array.isArray(rawValue.overpassEndpoints)) {
        normalized.overpassEndpoints = rawValue.overpassEndpoints
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }
    if (Number.isFinite(Number(rawValue.overpassElements))) {
        normalized.overpassElements = Number(rawValue.overpassElements);
    }
    if (Number.isFinite(Number(rawValue.keptSegments))) {
        normalized.keptSegments = Number(rawValue.keptSegments);
    }
    if (Number.isFinite(Number(rawValue.uniqueStreets))) {
        normalized.uniqueStreets = Number(rawValue.uniqueStreets);
    }
    return normalized;
}

function loadMapSyncMetaFromFile() {
    try {
        const raw = fs.readFileSync(MAP_SYNC_META_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeMapSyncMeta(parsed);
    } catch (error) {
        return null;
    }
}

function selectLatestMapSyncMeta(...candidates) {
    return candidates
        .filter(Boolean)
        .sort((left, right) => Date.parse(right.lastSyncedAt) - Date.parse(left.lastSyncedAt))[0] || null;
}

async function getEffectiveMapSyncMeta() {
    const fromDb = normalizeMapSyncMeta(parseJsonSetting(await db.getAppSetting(MAP_SYNC_META_SETTING_KEY)));
    const fromFile = loadMapSyncMetaFromFile();
    return selectLatestMapSyncMeta(fromDb, fromFile);
}

function loadDefaultStreetInfosFromFile() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'street_infos.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return {
            famous: normalizeStreetInfoEntries(parsed?.famous),
            main: normalizeStreetInfoEntries(parsed?.main),
        };
    } catch (error) {
        console.warn('Could not load default street infos file:', error.message);
        return { famous: {}, main: {} };
    }
}

function loadDefaultMonumentEntriesFromGeoJson() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '..', 'data', 'paris_monuments.geojson'), 'utf8');
        const parsed = JSON.parse(raw);
        return normalizeMonumentEntries(parsed?.features);
    } catch (error) {
        console.warn('Could not load default monuments from GeoJSON:', error.message);
        return [];
    }
}

function loadDefaultMonumentNamesFromGeoJson() {
    const entries = loadDefaultMonumentEntriesFromGeoJson();
    if (entries.length > 0) {
        return normalizeMonumentNameList(entries.map((entry) => entry.name));
    }
    return normalizeMonumentNameList(Array.from(DEFAULT_MONUMENT_NAMES || []));
}

const DEFAULT_CONTENT_SNAPSHOT = (() => {
    const defaultStreetInfos = loadDefaultStreetInfosFromFile();
    const defaultMonuments = loadDefaultMonumentEntriesFromGeoJson();
    const defaultLists = {
        famousStreets: normalizeNameList(Array.from(DEFAULT_FAMOUS_STREET_NAMES || [])),
        mainStreets: normalizeNameList(Array.from(DEFAULT_MAIN_STREET_NAMES || [])),
        monuments: loadDefaultMonumentNamesFromGeoJson(),
    };
    return {
        streetInfos: defaultStreetInfos,
        lists: defaultLists,
        monuments: defaultMonuments,
    };
})();

async function getEffectiveStreetInfos() {
    const fallback = cloneStreetInfos(DEFAULT_CONTENT_SNAPSHOT.streetInfos);
    const parsed = parseJsonSetting(await db.getAppSetting(STREET_INFOS_SETTING_KEY));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fallback;
    }

    const effective = {
        famous: Object.prototype.hasOwnProperty.call(parsed, 'famous')
            ? { ...fallback.famous, ...normalizeStreetInfoEntries(parsed.famous) }
            : fallback.famous,
        main: Object.prototype.hasOwnProperty.call(parsed, 'main')
            ? { ...fallback.main, ...normalizeStreetInfoEntries(parsed.main) }
            : fallback.main,
    };

    return effective;
}

async function getEffectiveContentLists({ monumentEntries = null } = {}) {
    const fallback = cloneContentLists(DEFAULT_CONTENT_SNAPSHOT.lists);
    const parsed = parseJsonSetting(await db.getAppSetting(CONTENT_LISTS_SETTING_KEY));
    const effectiveMonumentEntries = Array.isArray(monumentEntries)
        ? monumentEntries
        : await getEffectiveMonumentEntries();

    const normalizedMonumentList = effectiveMonumentEntries.length > 0
        ? normalizeMonumentNameList(effectiveMonumentEntries.map((entry) => entry.name))
        : fallback.monuments;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            ...fallback,
            monuments: normalizedMonumentList,
        };
    }

    const effective = {
        famousStreets: Object.prototype.hasOwnProperty.call(parsed, 'famousStreets')
            ? normalizeNameList(parsed.famousStreets)
            : fallback.famousStreets,
        mainStreets: Object.prototype.hasOwnProperty.call(parsed, 'mainStreets')
            ? normalizeNameList(parsed.mainStreets)
            : fallback.mainStreets,
        // Monument list follows the saved monument entries so admin edits cannot silently drift.
        monuments: normalizedMonumentList,
    };

    return effective;
}

async function getEffectiveMonumentEntries() {
    const fallback = cloneMonumentEntries(DEFAULT_CONTENT_SNAPSHOT.monuments);
    const parsed = parseJsonSetting(await db.getAppSetting(CONTENT_MONUMENTS_SETTING_KEY));
    if (!parsed) {
        return fallback;
    }

    const rawEntries = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.entries) ? parsed.entries : null);
    if (!rawEntries) {
        return fallback;
    }

    return normalizeMonumentEntries(rawEntries);
}

function computeContentStats(streetInfos, lists) {
    return {
        famousStreetInfoCount: Object.keys(streetInfos?.famous || {}).length,
        mainStreetInfoCount: Object.keys(streetInfos?.main || {}).length,
        famousStreetCount: Array.isArray(lists?.famousStreets) ? lists.famousStreets.length : 0,
        mainStreetCount: Array.isArray(lists?.mainStreets) ? lists.mainStreets.length : 0,
        monumentCount: Array.isArray(lists?.monuments) ? lists.monuments.length : 0,
    };
}

async function getEffectiveContentSnapshot() {
    const [streetInfos, monuments] = await Promise.all([
        getEffectiveStreetInfos(),
        getEffectiveMonumentEntries(),
    ]);
    const lists = await getEffectiveContentLists({ monumentEntries: monuments });
    return {
        streetInfos,
        lists,
        monuments: serializeMonumentEntries(monuments),
        stats: computeContentStats(streetInfos, lists),
    };
}

function isEditorIdentity(user) {
    const userRole = normalizeUserRole(user?.role);
    const username = String(user?.username || '').trim().toLowerCase();
    const isForcedEditorUsername = username && (
        EDITOR_USERNAMES.has(username) ||
        DEFAULT_EDITOR_USERNAME_PATTERNS.some((pattern) => pattern.test(username))
    );
    return CONTENT_EDITOR_ROLES.has(userRole) || Boolean(isForcedEditorUsername);
}

const ADMIN_RANK_THRESHOLDS = {
    classique: {
        'rues-celebres': [60, 100, 140, 180],
        'arrondissements-ville': [60, 100, 140, 180],
        'lignes-transports-idf': [60, 100, 140, 180],
        'rues-principales': [50, 90, 130, 170],
        arrondissement: [40, 80, 120, 160],
        ville: [30, 70, 110, 150],
        monuments: [40, 80, 120, 160],
    },
    marathon: {
        'rues-celebres': [10, 20, 35, 55],
        'arrondissements-ville': [10, 20, 35, 55],
        'lignes-transports-idf': [10, 20, 35, 55],
        'rues-principales': [9, 18, 30, 48],
        ville: [8, 16, 28, 44],
        monuments: [9, 18, 30, 46],
    },
    chrono: {
        'rues-celebres': [7, 11, 16, 22],
        'arrondissements-ville': [7, 11, 16, 22],
        'lignes-transports-idf': [7, 11, 16, 22],
        'rues-principales': [6, 10, 14, 19],
        arrondissement: [5, 8, 12, 16],
        ville: [4, 7, 10, 14],
        monuments: [5, 8, 12, 16],
    },
};
const ADMIN_RANK_NAMES = ['Touriste', 'Titi Parisien', 'Habitué des Quais', 'Vrai Parigot', 'Préfet de Paris'];
const ADMIN_RANK_GAME_TYPES = ['classique', 'marathon', 'chrono'];
const ADMIN_RANK_ZONES = ['rues-celebres', 'rues-principales', 'arrondissement', 'monuments', 'arrondissements-ville', 'lignes-transports-idf'];

function buildAdminArrondissementMarathonThresholds(maxItems) {
    const total = Math.max(1, Number.parseInt(maxItems, 10) || 55);
    const titi = Math.min(total, Math.max(1, Math.ceil(0.1 * total)));
    const habitue = Math.min(total, Math.max(titi + 1, Math.ceil(0.2 * total)));
    const vrai = Math.min(total, Math.max(habitue + 1, Math.ceil(0.35 * total)));
    const prefet = Math.min(total, Math.max(vrai + 1, Math.ceil(0.55 * total)));
    return [titi, habitue, vrai, prefet];
}

function getAdminRankThresholds(entry) {
    if (entry.game_type === 'marathon' && entry.mode === 'arrondissement') {
        return buildAdminArrondissementMarathonThresholds(entry.best_items_total || entry.items_total || 55);
    }
    return ADMIN_RANK_THRESHOLDS[entry.game_type]?.[entry.mode] || null;
}

function getProfileRankForAdmin(modeStats) {
    const combos = new Map(
        (Array.isArray(modeStats) ? modeStats : []).map((entry) => [
            `${entry.mode}|${entry.game_type}`,
            entry,
        ])
    );
    for (let level = ADMIN_RANK_NAMES.length - 1; level >= 1; level -= 1) {
        const hasReachedLevel = ADMIN_RANK_GAME_TYPES.every((gameType) =>
            ADMIN_RANK_ZONES.every((mode) => {
                const entry = combos.get(`${mode}|${gameType}`);
                const thresholds = entry ? getAdminRankThresholds(entry) : null;
                if (!thresholds) {
                    return false;
                }
                const score = gameType === 'classique'
                    ? Number(entry.high_score || 0)
                    : Number(entry.best_items_correct || entry.high_score || 0);
                return score >= thresholds[level - 1];
            })
        );
        if (hasReachedLevel) {
            return ADMIN_RANK_NAMES[level];
        }
    }
    return ADMIN_RANK_NAMES[0];
}

const SCORE_MODE_ALIASES = {
    main: 'rues-principales',
    famous: 'rues-celebres',
};
const ALLOWED_SCORE_MODES = new Set(['ville', 'arrondissement', 'arrondissements-ville', 'rues-principales', 'rues-celebres', 'monuments', 'lignes-transports-idf']);
const ALLOWED_SCORE_GAME_TYPES = new Set(['classique', 'marathon', 'chrono']);
const ALLOWED_FRIEND_CHALLENGE_MODES = new Set(['ville', 'arrondissement', 'arrondissements-ville', 'rues-principales', 'rues-celebres', 'monuments', 'lignes-transports-idf']);
const ALLOWED_FRIEND_CHALLENGE_GAME_TYPES = new Set(['classique', 'marathon', 'chrono']);
const MAX_SCORE_ITEMS = 100000;
const MAX_SCORE_SECONDS = 24 * 60 * 60;
const MAX_DAILY_DISTANCE_METERS = 1000000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FRIEND_CHALLENGE_CODE_LENGTH = 10;
const FRIEND_CHALLENGE_CODE_PATTERN = /^[A-Z0-9]{10}$/;
const FRIEND_CHALLENGE_EXPIRATION_HOURS = 24;
const FRIEND_CHALLENGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const FRIEND_CHALLENGE_CLASSIQUE_SIZE = 20;

function normalizeArrondissementChallengeKey(value) {
    let normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }
    const legacySuffixMatch = normalized.match(/^(.+)\s+\((L'|L’|La|Le|Les)\)$/i);
    if (legacySuffixMatch) {
        let body = legacySuffixMatch[1].trim();
        let article = legacySuffixMatch[2].trim();
        article = /^l[’']/i.test(article)
            ? "L'"
            : article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
        normalized = `${article} ${body}`;
    }
    return normalized
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’`´]/g, "'")
        .replace(/[-‐‑‒–—]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function shuffleCopy(items) {
    const copy = Array.isArray(items) ? [...items] : [];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }
    return copy;
}

function normalizeChallengeCode(rawCode) {
    return String(rawCode || '').trim().toUpperCase();
}

function generateFriendChallengeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(FRIEND_CHALLENGE_CODE_LENGTH);
    for (let index = 0; index < FRIEND_CHALLENGE_CODE_LENGTH; index += 1) {
        code += alphabet[bytes[index] % alphabet.length];
    }
    return code;
}

function getFriendChallengeExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + FRIEND_CHALLENGE_EXPIRATION_HOURS);
    return expiresAt;
}

function parseScoreSubmission(body) {
    const rawMode = String(body?.mode || '').trim();
    const mode = SCORE_MODE_ALIASES[rawMode] || rawMode;
    const gameType = String(body?.gameType || '').trim();
    if (!ALLOWED_SCORE_MODES.has(mode) || !ALLOWED_SCORE_GAME_TYPES.has(gameType)) {
        return { ok: false, error: 'Invalid mode or gameType' };
    }

    const score = toFiniteNumber(body?.score);
    const itemsCorrect = toFiniteInteger(body?.itemsCorrect);
    const itemsTotal = toFiniteInteger(body?.itemsTotal);
    const timeSec = toFiniteNumber(body?.timeSec);

    if (score === null || itemsCorrect === null || itemsTotal === null || timeSec === null) {
        return { ok: false, error: 'Score payload contains invalid numeric values' };
    }
    if (itemsTotal < 1 || itemsTotal > MAX_SCORE_ITEMS) {
        return { ok: false, error: 'itemsTotal out of allowed range' };
    }
    if (itemsCorrect < 0 || itemsCorrect > itemsTotal) {
        return { ok: false, error: 'itemsCorrect must be between 0 and itemsTotal' };
    }
    if (timeSec < 0 || timeSec > MAX_SCORE_SECONDS) {
        return { ok: false, error: 'timeSec out of allowed range' };
    }

    let normalizedScore = score;
    if (gameType === 'classique') {
        const maxClassiqueScore = itemsTotal * 10;
        if (normalizedScore < 0 || normalizedScore > maxClassiqueScore + 0.001) {
            return { ok: false, error: 'score out of allowed range for classique mode' };
        }
    } else {
        if (score < 0 || score > MAX_SCORE_ITEMS) {
            return { ok: false, error: 'score out of allowed range' };
        }
        normalizedScore = itemsCorrect;
    }

    const arrondissementNameRaw = normalizeOptionalText(body?.arrondissementName, 120);
    const arrondissementName = mode === 'arrondissement' ? arrondissementNameRaw : null;
    if (mode === 'arrondissement' && !arrondissementName) {
        return { ok: false, error: 'arrondissementName is required for arrondissement mode' };
    }

    const sessionIdRaw = normalizeOptionalText(body?.sessionId, 96);
    if (sessionIdRaw && !/^[a-zA-Z0-9_-]{8,96}$/.test(sessionIdRaw)) {
        return { ok: false, error: 'Invalid sessionId format' };
    }

    return {
        ok: true,
        value: {
            mode,
            gameType,
            score: normalizedScore,
            itemsCorrect,
            itemsTotal,
            timeSec,
            arrondissementName,
            sessionId: sessionIdRaw,
        },
    };
}

function parseFriendChallengeCreateSubmission(body) {
    const rawMode = String(body?.mode || '').trim();
    const mode = SCORE_MODE_ALIASES[rawMode] || rawMode;
    const gameType = String(body?.gameType || '').trim();
    if (!ALLOWED_FRIEND_CHALLENGE_MODES.has(mode) || !ALLOWED_FRIEND_CHALLENGE_GAME_TYPES.has(gameType)) {
        return { ok: false, error: 'Invalid mode or gameType' };
    }

    const arrondissementName = mode === 'arrondissement'
        ? normalizeOptionalText(body?.arrondissementName, 120)
        : null;

    if (mode === 'arrondissement' && !arrondissementName) {
        return { ok: false, error: 'arrondissementName is required for arrondissement mode' };
    }

    return {
        ok: true,
        value: {
            mode,
            gameType,
            arrondissementName,
        },
    };
}

function parseFriendChallengeScoreSubmission(body, gameType) {
    const score = toFiniteNumber(body?.score);
    const itemsCorrect = toFiniteInteger(body?.itemsCorrect);
    const itemsTotal = toFiniteInteger(body?.itemsTotal);
    const timeSec = toFiniteNumber(body?.timeSec);

    if (score === null || itemsCorrect === null || itemsTotal === null || timeSec === null) {
        return { ok: false, error: 'Score payload contains invalid numeric values' };
    }
    if (itemsTotal < 1 || itemsTotal > MAX_SCORE_ITEMS) {
        return { ok: false, error: 'itemsTotal out of allowed range' };
    }
    if (itemsCorrect < 0 || itemsCorrect > itemsTotal) {
        return { ok: false, error: 'itemsCorrect must be between 0 and itemsTotal' };
    }
    if (timeSec < 0 || timeSec > MAX_SCORE_SECONDS) {
        return { ok: false, error: 'timeSec out of allowed range' };
    }

    let normalizedScore = score;
    if (gameType === 'classique') {
        const maxClassiqueScore = itemsTotal * 10;
        if (normalizedScore < 0 || normalizedScore > maxClassiqueScore + 0.001) {
            return { ok: false, error: 'score out of allowed range for classique mode' };
        }
    } else {
        if (score < 0 || score > MAX_SCORE_ITEMS) {
            return { ok: false, error: 'score out of allowed range' };
        }
        normalizedScore = itemsCorrect;
    }

    return {
        ok: true,
        value: {
            score: normalizedScore,
            itemsCorrect,
            itemsTotal,
            timeSec,
        },
    };
}

function serializeFriendChallenge(challenge) {
    const rawTargets = Array.isArray(challenge?.targets_json) ? challenge.targets_json : [];
    const targets = rawTargets
        .map((value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const name = String(value.name || '').trim();
                if (!name) {
                    return null;
                }
                return {
                    name,
                    featureId: normalizeFeatureId(value.featureId || value.id || value.osmId || value.osm_id),
                    centroid: normalizeCoordinatePair(value.centroid),
                    arrondissementName: normalizeOptionalText(value.arrondissementName || value.arrondissement, 120),
                };
            }
            const name = String(value || '').trim();
            return name ? { name, featureId: '', centroid: null, arrondissementName: null } : null;
        })
        .filter(Boolean);
    const targetNames = targets.map((target) => target.name);
    const serialNumber = Number.parseInt(challenge?.id, 10);
    const safeSerialNumber = Number.isInteger(serialNumber) && serialNumber > 0 ? serialNumber : null;
    const serialCode = safeSerialNumber === null
        ? ''
        : `#${String(safeSerialNumber).padStart(5, '0')}`;

    return {
        code: challenge.code,
        serialNumber: safeSerialNumber,
        serialCode,
        mode: challenge.mode,
        gameType: challenge.game_type,
        arrondissementName: challenge.arrondissement_name || null,
        targetType: challenge.target_type,
        itemCount: challenge.item_count || targetNames.length,
        targetNames,
        targets,
        createdAt: challenge.created_at,
        expiresAt: challenge.expires_at,
        createdBy: {
            userId: challenge.created_by_user_id,
            username: challenge.created_by_username,
        },
    };
}

function parseDailyGuessSubmission(body) {
    const date = String(body?.date || '').trim();
    if (!ISO_DATE_PATTERN.test(date)) {
        return { ok: false, error: 'Invalid date format' };
    }

    const distanceMeters = toFiniteNumber(body?.distanceMeters);
    if (distanceMeters === null || distanceMeters < 0 || distanceMeters > MAX_DAILY_DISTANCE_METERS) {
        return { ok: false, error: 'Invalid distanceMeters value' };
    }

    if (typeof body?.isSuccess !== 'boolean') {
        return { ok: false, error: 'isSuccess must be a boolean' };
    }

    const attemptsCount =
        body?.attemptsCount === undefined || body?.attemptsCount === null
            ? null
            : Number(body.attemptsCount);
    if (
        attemptsCount !== null
        && (!Number.isInteger(attemptsCount) || attemptsCount < 1 || attemptsCount > 7)
    ) {
        return { ok: false, error: 'Invalid attemptsCount value' };
    }

    return {
        ok: true,
        value: {
            date,
            distanceMeters: Math.round(distanceMeters),
            isSuccess: body.isSuccess,
            attemptsCount,
        },
    };
}

function getRequestIp(req) {
    const forwardedRaw = req.headers['x-forwarded-for'];
    if (typeof forwardedRaw === 'string' && forwardedRaw.trim()) {
        return forwardedRaw.split(',')[0].trim();
    }
    if (Array.isArray(forwardedRaw) && forwardedRaw.length > 0) {
        return String(forwardedRaw[0] || '').trim();
    }
    return (req.ip || req.socket?.remoteAddress || 'unknown').trim();
}

function hashRequestIp(req) {
    return crypto
        .createHash('sha256')
        .update(`${EFFECTIVE_JWT_SECRET}:${getRequestIp(req)}`, 'utf8')
        .digest('hex');
}

function createPersistentRateLimit({ name, windowMs, maxRequests, key = (req) => hashRequestIp(req) }) {
    return asyncHandler(async (req, res, next) => {
        const bucketIdentity = String(key(req) || 'anonymous').slice(0, 180);
        const result = await db.consumeApiRateLimit(
            `${name}:${bucketIdentity}`,
            windowMs,
            maxRequests,
        );
        res.setHeader('X-RateLimit-Limit', String(result.limit));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
        if (!result.allowed) {
            res.setHeader('Retry-After', String(result.retryAfterSec));
            return res.status(429).json({
                error: 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED',
            });
        }
        return next();
    });
}

function parseCookieHeader(req) {
    const rawHeader = String(req.headers.cookie || '');
    const cookies = new Map();
    for (const part of rawHeader.split(';')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex <= 0) continue;
        const name = part.slice(0, separatorIndex).trim();
        const rawValue = part.slice(separatorIndex + 1).trim();
        try {
            cookies.set(name, decodeURIComponent(rawValue));
        } catch (error) {
            cookies.set(name, rawValue);
        }
    }
    return cookies;
}

function setSessionCookie(res, token) {
    const attributes = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        IS_PRODUCTION ? 'Secure' : '',
        IS_PRODUCTION ? 'SameSite=None' : 'SameSite=Lax',
    ].filter(Boolean);
    res.append('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
    const attributes = [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        IS_PRODUCTION ? 'Secure' : '',
        IS_PRODUCTION ? 'SameSite=None' : 'SameSite=Lax',
    ].filter(Boolean);
    res.append('Set-Cookie', attributes.join('; '));
}

function buildLoginRateLimitKey(req, username) {
    return `${getRequestIp(req)}::${String(username || '').trim().toLowerCase() || '<empty>'}`;
}

function getRateLimitEntry(now, key) {
    const existing = loginRateLimitStore.get(key);
    const entry = existing || { attempts: [], blockedUntil: 0 };
    entry.attempts = entry.attempts.filter((ts) => now - ts <= LOGIN_RATE_LIMIT_WINDOW_MS);
    if (entry.blockedUntil < now) {
        entry.blockedUntil = 0;
    }
    loginRateLimitStore.set(key, entry);
    return entry;
}

function isLoginRateLimited(now, key) {
    const entry = getRateLimitEntry(now, key);
    if (entry.blockedUntil > now) {
        return Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
    }
    return 0;
}

function registerLoginFailure(now, key) {
    const entry = getRateLimitEntry(now, key);
    entry.attempts.push(now);
    if (entry.attempts.length >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        entry.blockedUntil = now + LOGIN_RATE_LIMIT_BLOCK_MS;
        entry.attempts = [];
    }
    loginRateLimitStore.set(key, entry);
}

function clearLoginRateLimit(key) {
    loginRateLimitStore.delete(key);
}

function hashPasswordResetToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function normalizeRecoveryEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isValidRecoveryEmail(value) {
    const email = normalizeRecoveryEmail(value);
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function consumePasswordResetRateLimit(req, username) {
    const now = Date.now();
    const ip = getRequestIp(req);
    const keys = [`ip:${ip}`, `account:${String(username || '').trim().toLowerCase()}`];
    let retryAfterSec = 0;

    for (const key of keys) {
        const recentAttempts = (passwordResetRateLimitStore.get(key) || [])
            .filter((timestamp) => now - timestamp <= PASSWORD_RESET_RATE_LIMIT_WINDOW_MS);
        if (recentAttempts.length >= PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS) {
            const retryAt = recentAttempts[0] + PASSWORD_RESET_RATE_LIMIT_WINDOW_MS;
            retryAfterSec = Math.max(retryAfterSec, Math.ceil((retryAt - now) / 1000));
        } else {
            recentAttempts.push(now);
        }
        passwordResetRateLimitStore.set(key, recentAttempts);
    }

    if (passwordResetRateLimitStore.size > 10_000) {
        for (const [key, attempts] of passwordResetRateLimitStore.entries()) {
            if (!attempts.some((timestamp) => now - timestamp <= PASSWORD_RESET_RATE_LIMIT_WINDOW_MS)) {
                passwordResetRateLimitStore.delete(key);
            }
        }
    }
    return Math.max(0, retryAfterSec);
}

function createPasswordResetUrl(token) {
    const resetUrl = new URL('/reset-password.html', PASSWORD_RESET_FRONTEND_URL);
    resetUrl.searchParams.set('token', token);
    return resetUrl.toString();
}

async function waitForPasswordResetResponseFloor(startedAt, floorMs = 400) {
    const remainingMs = floorMs - (Date.now() - startedAt);
    if (remainingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
    }
}

// ----------------------
// Auth Routes
// ----------------------

app.post(
    '/api/register',
    createPersistentRateLimit({ name: 'register', windowMs: 60 * 60 * 1000, maxRequests: 8 }),
    asyncHandler(async (req, res) => {
    const usernameValidation = validateUsername(req.body?.username);
    const username = usernameValidation.username;
    const password = String(req.body?.password || '');
    const recoveryEmail = normalizeRecoveryEmail(req.body?.recoveryEmail);
    const referralCode = String(req.body?.referralCode || '').trim();
    if (!usernameValidation.ok) {
        return res.status(400).json({ error: usernameValidation.error, code: 'USERNAME_INVALID' });
    }
    if (!password || !recoveryEmail) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must contain between 8 and 200 characters' });
    }
    if (!isValidRecoveryEmail(recoveryEmail)) {
        return res.status(400).json({ error: 'Invalid recovery email' });
    }

    try {
        const userId = await db.createUser(username, password, recoveryEmail);
        let referral = null;
        let referralWarning = null;
        if (referralCode) {
            try {
                referral = await db.createReferralByCode(userId, referralCode);
            } catch (referralError) {
                referralWarning = referralError?.code || 'REFERRAL_LINK_FAILED';
            }
        }
        const role = USER_ROLE_PLAYER;
        const createdReferralCode = await db.ensureReferralCodeForUser(userId);
        const token = issueAuthToken({ id: userId, username, role, session_version: 1 });
        setSessionCookie(res, token);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ token, id: userId, username, avatar: '👤', role, referralCode: createdReferralCode, referral, referralWarning });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}));

app.post('/api/referrals/claim', authenticateToken, asyncHandler(async (req, res) => {
    const referralCode = String(req.body?.referralCode || '').trim();
    if (!referralCode) {
        return res.status(400).json({ error: 'Missing referral code', code: 'REFERRAL_CODE_MISSING' });
    }

    try {
        const result = await db.createReferralByCode(req.user.id, referralCode);
        return res.json({ success: true, ...result });
    } catch (error) {
        const status = error?.code === 'REFERRER_NOT_FOUND' ? 404 : 400;
        return res.status(status).json({
            error: error?.message || 'Failed to claim referral code',
            code: error?.code || 'REFERRAL_LINK_FAILED',
        });
    }
}));

app.post('/api/admin/referrals/progress', requireAdminApiKey, asyncHandler(async (req, res) => {
    const filleulId = Number.parseInt(req.body?.filleulId, 10);
    const eventType = String(req.body?.eventType || '').trim();
    if (!Number.isInteger(filleulId) || filleulId <= 0) {
        return res.status(400).json({ error: 'Invalid filleul id', code: 'REFERRAL_FILLEUL_INVALID' });
    }
    if (!REFERRAL_EVENTS.has(eventType)) {
        return res.status(400).json({ error: 'Unsupported referral event', code: 'REFERRAL_EVENT_UNSUPPORTED' });
    }

    const result = await referralService.checkReferralProgress(filleulId, eventType);
    return res.json({ success: true, ...result });
}));

app.post(
    '/api/login',
    createPersistentRateLimit({ name: 'login', windowMs: 10 * 60 * 1000, maxRequests: 30 }),
    asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || '');
    if (!username || !password) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    const now = Date.now();
    const rateKey = buildLoginRateLimitKey(req, username);
    const retryAfterSec = isLoginRateLimited(now, rateKey);
    if (retryAfterSec > 0) {
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ error: 'Too many login attempts, try again later' });
    }

    const user = await db.getUser(username);

    const passwordIsValid = db.verifyPassword(user, password);
    if (!user || !passwordIsValid) {
        registerLoginFailure(now, rateKey);
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearLoginRateLimit(rateKey);
    const role = normalizeUserRole(user.role);
    const referralCode = await db.ensureReferralCodeForUser(user.id);
    const token = issueAuthToken(user);
    setSessionCookie(res, token);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token, id: user.id, username: user.username, avatar: user.avatar || '👤', role, referralCode });
}));

app.get('/api/session', authenticateToken, asyncHandler(async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        id: user.id,
        username: user.username,
        avatar: ALLOWED_AVATARS.has(user.avatar) ? user.avatar : '👤',
        role: normalizeUserRole(user.role),
        authenticated: true,
    });
}));

app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    return res.json({ success: true });
});

app.post('/api/password-reset', asyncHandler(async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || !password) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    if (token.length < 32 || token.length > 256) {
        return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must contain between 8 and 200 characters' });
    }

    const didReset = await db.resetPasswordWithToken(hashPasswordResetToken(token), password);
    if (!didReset) {
        return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    clearSessionCookie(res);
    return res.json({ success: true });
}));

app.post(
    '/api/password-reset/request',
    createPersistentRateLimit({ name: 'password-reset', windowMs: 15 * 60 * 1000, maxRequests: 10 }),
    asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    const username = String(req.body?.username || '').trim();
    const recoveryEmail = normalizeRecoveryEmail(req.body?.recoveryEmail);
    const genericResponse = {
        success: true,
        message: 'Si ces informations correspondent à un compte, un e-mail a été envoyé.',
    };

    const retryAfterSec = consumePasswordResetRateLimit(req, username);
    if (retryAfterSec > 0) {
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
            error: 'Too many password reset requests',
            retryAfterSec,
        });
    }

    if (!username || !isValidRecoveryEmail(recoveryEmail)) {
        await waitForPasswordResetResponseFloor(startedAt);
        return res.json(genericResponse);
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);
    const user = await db.createPasswordResetTokenForRecovery(
        username,
        recoveryEmail,
        hashPasswordResetToken(token),
        expiresAt,
    );

    if (user) {
        try {
            const delivery = await sendPasswordResetEmail({
                to: user.recovery_email,
                username: user.username,
                resetUrl: createPasswordResetUrl(token),
                expiresInHours: PASSWORD_RESET_EXPIRATION_HOURS,
            });
            console.info(
                `Password reset email accepted for user ${user.id}`,
                { provider: delivery?.provider || 'smtp', messageId: delivery?.messageId || null },
            );
        } catch (error) {
            console.error(`Password reset email failed for user ${user.id}:`, error.message);
        }
    }

    await waitForPasswordResetResponseFloor(startedAt);
    return res.json(genericResponse);
}));

function normalizeStreetInfoMode(mode) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    return normalizedMode === 'famous' || normalizedMode === 'main' ? normalizedMode : '';
}

function getStreetListKeyForMode(mode) {
    return mode === 'main' ? 'mainStreets' : 'famousStreets';
}

app.get('/api/content/public', asyncHandler(async (req, res) => {
    const snapshot = await getCachedPublicContentSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        streetInfos: snapshot.streetInfos,
        lists: snapshot.lists,
        monuments: snapshot.monuments,
    });
}));

app.get('/api/streets-light', asyncHandler(async (req, res) => {
    const candidatePaths = [
        BACKEND_STREETS_LIGHT_PATH,
        path.join(__dirname, '..', 'data', 'paris_rues_light.geojson'),
    ];

    let selectedPath = null;
    for (const candidatePath of candidatePaths) {
        try {
            const stat = fs.statSync(candidatePath);
            if (stat.isFile()) {
                selectedPath = candidatePath;
                break;
            }
        } catch (error) {
            // Try next path.
        }
    }

    if (!selectedPath) {
        return res.status(404).json({ error: 'Streets file unavailable' });
    }

    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.type('application/geo+json');
    return res.sendFile(selectedPath);
}));

app.get('/api/map-sync-meta', asyncHandler(async (req, res) => {
    const meta = await getEffectiveMapSyncMeta();
    if (!meta) {
        return res.status(404).json({ error: 'Map sync metadata unavailable' });
    }
    return res.json(meta);
}));

app.get('/api/editor/me', authenticateToken, asyncHandler(async (req, res) => {
    const user = await db.getUserById(req.user.id);
    if (!user) {
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }

    const payload = {
        id: user.id,
        username: user.username,
        role: normalizeUserRole(user.role),
    };

    return res.json({
        ...payload,
        canEdit: isEditorIdentity(payload),
        canManageUsers: payload.role === USER_ROLE_ADMIN,
    });
}));

app.get('/api/editor/users', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const users = await db.listUsersForAdmin();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        users: users.map((user) => ({
            id: user.id,
            username: user.username,
            recoveryEmail: user.recovery_email || '',
            role: normalizeUserRole(user.role),
            avatar: user.avatar || '👤',
            createdAt: user.created_at,
            gamesPlayed: Number(user.games_played || 0),
            lastGameAt: user.last_game_at,
            rank: getProfileRankForAdmin(user.modes),
            dailyDaysPlayed: Number(user.daily_days_played || 0),
            dailySuccesses: Number(user.daily_successes || 0),
            dailyFrequency: Math.min(
                100,
                Math.round((Number(user.daily_days_played || 0) / Number(user.membership_days || 1)) * 100)
            ),
            lastDailyAt: user.last_daily_at,
            reminderEnabled: Boolean(user.reminder_enabled),
            referralCount: Number(user.referral_count || 0),
        })),
    });
}));

app.post('/api/editor/users/:userId/password-reset-link', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const target = await db.getUserById(req.params.userId);
    if (!target) {
        return res.status(404).json({ error: 'User not found' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);
    await db.createPasswordResetToken(target.username, hashPasswordResetToken(token), expiresAt);
    const resetUrl = new URL('/reset-password.html', PASSWORD_RESET_FRONTEND_URL);
    resetUrl.searchParams.set('token', token);
    return res.json({
        success: true,
        username: target.username,
        resetUrl: resetUrl.toString(),
        expiresAt: expiresAt.toISOString(),
    });
}));

app.put('/api/editor/users/:userId/recovery-email', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const recoveryEmail = normalizeRecoveryEmail(req.body?.recoveryEmail);
    if (recoveryEmail && !isValidRecoveryEmail(recoveryEmail)) {
        return res.status(400).json({ error: 'Invalid recovery email' });
    }
    const user = await db.updateUserRecoveryEmail(req.params.userId, recoveryEmail || null);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            recoveryEmail: user.recovery_email,
        },
    });
}));

app.delete('/api/editor/users/:userId', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const targetUserId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetUserId === req.user.id) {
        return res.status(400).json({ error: 'You cannot delete your own account from the admin page' });
    }
    const deletedUser = await db.deleteUserById(targetUserId);
    if (!deletedUser) {
        return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ success: true, username: deletedUser.username });
}));

app.get('/api/editor/content', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const snapshot = await getEffectiveContentSnapshot();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(snapshot);
}));

app.get('/api/editor/visits/daily', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const stats = await db.getDailyVisitStats();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        ...stats,
        note: 'Les visiteurs uniques sont retrocalcules depuis first_seen. Les visites totales par jour sont suivies uniquement depuis la mise en place de visitor_daily_stats.',
    });
}));

app.get('/api/editor/osm-sync/status', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const active = getActiveLocalOsmSyncState();
    let githubRun = null;
    let githubError = null;
    try {
        githubRun = await getLatestOsmSyncWorkflowRun({
            since: req.query?.since,
        });
    } catch (error) {
        githubError = error.message;
    }

    return res.json({
        inProgress: Boolean(active),
        active,
        github: {
            run: githubRun,
            error: githubError,
        },
    });
}));

app.post('/api/editor/osm-sync', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const requestedTarget = String(req.body?.target || 'github').trim().toLowerCase();
    const shouldUseGitHubWorkflow = requestedTarget !== 'local';
    const currentUser = await getCurrentAuthenticatedUser(req.user);
    const requestedBy = currentUser?.username || req.user?.username || 'admin';

    if (shouldUseGitHubWorkflow) {
        try {
            const dispatch = await dispatchOsmSyncWorkflow({
                requestedBy,
            });
            return res.status(202).json({
                success: true,
                dispatched: true,
                target: 'github',
                dispatch,
                output: `Workflow GitHub lance: ${dispatch.repository}/${dispatch.workflow} sur ${dispatch.ref}.`,
            });
        } catch (error) {
            if (requestedTarget === 'github') {
                return res.status(503).json({
                    error: `Impossible de declencher la synchronisation GitHub: ${error.message}`,
                });
            }
            console.warn('GitHub OSM sync dispatch unavailable, falling back to local sync:', error.message);
        }
    }

    const startedState = startLocalOsmSyncState({ requestedBy });
    if (!startedState) {
        const active = getActiveLocalOsmSyncState();
        return res.status(409).json({
            error: 'Une synchronisation OSM locale est deja en cours.',
            active,
        });
    }

    const startedAtIso = new Date().toISOString();
    const startedAtMs = Date.now();
    const beforeSnapshot = captureOsmWatchedFilesSnapshot();

    try {
        const runResult = await runOsmSyncScript(OSM_SYNC_TIMEOUT_MS);
        const finishedAtIso = new Date().toISOString();
        const durationMs = Date.now() - startedAtMs;
        const afterSnapshot = captureOsmWatchedFilesSnapshot();
        const changedFiles = computeChangedOsmFiles(beforeSnapshot, afterSnapshot);
        const output = [runResult.stdout, runResult.stderr]
            .filter(Boolean)
            .join('\n')
            .trim();

        const payload = {
            startedAt: startedAtIso,
            finishedAt: finishedAtIso,
            durationMs,
            changedFiles,
            output,
            timedOut: runResult.didTimeout,
            exitCode: runResult.exitCode,
            signal: runResult.signal,
        };

        if (runResult.didTimeout) {
            return res.status(504).json({
                error: 'Synchronisation OSM interrompue (timeout).',
                ...payload,
            });
        }

        if (runResult.exitCode !== 0) {
            return res.status(500).json({
                error: 'Synchronisation OSM en echec.',
                ...payload,
            });
        }

        const runtimeReload = reloadDailyRuntimeIndexes();
        let dailyTargetsRefresh = null;
        try {
            dailyTargetsRefresh = await refreshDailyTargetsFromCurrentStreetData();
            console.log(
                `[Daily] Geometry refresh after OSM sync: ${dailyTargetsRefresh.refreshed}/${dailyTargetsRefresh.totalTargets} targets updated (${dailyTargetsRefresh.missingGeometry} missing geometry).`
            );
        } catch (error) {
            console.error('Daily target geometry refresh failed after OSM sync:', error.message);
            dailyTargetsRefresh = {
                error: error.message,
            };
        }

        let mapSyncMeta = loadMapSyncMetaFromFile();
        if (mapSyncMeta) {
            try {
                await db.setAppSetting(MAP_SYNC_META_SETTING_KEY, JSON.stringify(mapSyncMeta));
            } catch (error) {
                console.warn('Could not persist map sync metadata in app_settings:', error.message);
            }
        } else {
            mapSyncMeta = await getEffectiveMapSyncMeta();
        }

        return res.json({
            success: true,
            ...payload,
            mapSyncMeta: mapSyncMeta || null,
            runtimeReload,
            dailyTargetsRefresh,
        });
    } catch (error) {
        return res.status(500).json({
            error: `Impossible de lancer la synchronisation OSM: ${error.message}`,
        });
    } finally {
        clearLocalOsmSyncState();
    }
}));

app.put('/api/editor/street-info', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const mode = normalizeStreetInfoMode(req.body?.mode);
    if (!mode) {
        return res.status(400).json({ error: 'Invalid mode. Use "famous" or "main".' });
    }

    const streetName = normalizeContentName(req.body?.streetName).slice(0, MAX_NAME_LENGTH);
    if (!streetName) {
        return res.status(400).json({ error: 'Missing streetName' });
    }

    const previousStreetName = normalizeContentName(req.body?.previousStreetName).slice(0, MAX_NAME_LENGTH);
    if (typeof req.body?.infoText !== 'string') {
        return res.status(400).json({ error: 'Missing infoText' });
    }
    const infoText = req.body.infoText.trim();

    const streetInfos = await getEffectiveStreetInfos();
    const lists = await getEffectiveContentLists();
    let listsUpdated = false;
    if (previousStreetName && previousStreetName !== streetName) {
        delete streetInfos[mode][previousStreetName];

        const listKey = getStreetListKeyForMode(mode);
        const currentList = Array.isArray(lists?.[listKey]) ? lists[listKey] : [];
        const renamedList = normalizeNameList(
            currentList.map((name) => (name === previousStreetName ? streetName : name)),
        );
        const listChanged =
            renamedList.length !== currentList.length ||
            renamedList.some((name, index) => name !== currentList[index]);
        if (listChanged) {
            lists[listKey] = renamedList;
            listsUpdated = true;
        }
    }

    if (infoText) {
        streetInfos[mode][streetName] = infoText.slice(0, MAX_INFO_LENGTH);
    } else {
        delete streetInfos[mode][streetName];
    }
    await db.setAppSetting(STREET_INFOS_SETTING_KEY, JSON.stringify(streetInfos));
    if (listsUpdated) {
        await db.setAppSetting(CONTENT_LISTS_SETTING_KEY, JSON.stringify(lists));
    }
    invalidatePublicContentCache();

    return res.json({
        success: true,
        streetInfos,
        lists,
        stats: computeContentStats(streetInfos, lists),
    });
}));

app.delete('/api/editor/street-info', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const mode = normalizeStreetInfoMode(req.body?.mode);
    if (!mode) {
        return res.status(400).json({ error: 'Invalid mode. Use "famous" or "main".' });
    }

    const streetName = normalizeContentName(req.body?.streetName).slice(0, MAX_NAME_LENGTH);
    if (!streetName) {
        return res.status(400).json({ error: 'Missing streetName' });
    }

    const streetInfos = await getEffectiveStreetInfos();
    delete streetInfos[mode][streetName];
    await db.setAppSetting(STREET_INFOS_SETTING_KEY, JSON.stringify(streetInfos));
    invalidatePublicContentCache();

    const lists = await getEffectiveContentLists();
    return res.json({
        success: true,
        streetInfos,
        stats: computeContentStats(streetInfos, lists),
    });
}));

app.put('/api/editor/street-infos', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const mode = normalizeStreetInfoMode(req.body?.mode);
    if (!mode) {
        return res.status(400).json({ error: 'Invalid mode. Use "famous" or "main".' });
    }
    if (!req.body || typeof req.body.entries !== 'object' || Array.isArray(req.body.entries)) {
        return res.status(400).json({ error: 'entries must be an object map streetName -> infoText' });
    }

    const streetInfos = await getEffectiveStreetInfos();
    streetInfos[mode] = normalizeStreetInfoEntries(req.body.entries);
    await db.setAppSetting(STREET_INFOS_SETTING_KEY, JSON.stringify(streetInfos));
    invalidatePublicContentCache();

    const lists = await getEffectiveContentLists();
    return res.json({
        success: true,
        streetInfos,
        stats: computeContentStats(streetInfos, lists),
    });
}));

app.put('/api/editor/lists', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const hasFamous = Object.prototype.hasOwnProperty.call(req.body || {}, 'famousStreets');
    const hasMain = Object.prototype.hasOwnProperty.call(req.body || {}, 'mainStreets');
    const hasMonuments = Object.prototype.hasOwnProperty.call(req.body || {}, 'monuments');
    if (!hasFamous || !hasMain || !hasMonuments) {
        return res.status(400).json({ error: 'Missing lists payload. Provide famousStreets, mainStreets and monuments.' });
    }

    const lists = {
        famousStreets: normalizeNameList(req.body.famousStreets),
        mainStreets: normalizeNameList(req.body.mainStreets),
        monuments: normalizeMonumentNameList(req.body.monuments),
    };

    const currentMonuments = await getEffectiveMonumentEntries();
    const currentMonumentsByName = new Map(
        currentMonuments.map((entry) => [entry.normalizedName, entry]),
    );
    const defaultMonumentsByName = new Map(
        (Array.isArray(DEFAULT_CONTENT_SNAPSHOT.monuments) ? DEFAULT_CONTENT_SNAPSHOT.monuments : [])
            .map((entry) => [entry.normalizedName, entry]),
    );
    let monumentsSettingUpdated = false;
    for (const normalizedMonumentName of lists.monuments) {
        if (currentMonumentsByName.has(normalizedMonumentName)) {
            continue;
        }
        const fallbackEntry = defaultMonumentsByName.get(normalizedMonumentName);
        if (!fallbackEntry) {
            continue;
        }
        currentMonuments.push({
            name: fallbackEntry.name,
            normalizedName: fallbackEntry.normalizedName,
            longitude: fallbackEntry.longitude,
            latitude: fallbackEntry.latitude,
        });
        currentMonumentsByName.set(normalizedMonumentName, fallbackEntry);
        monumentsSettingUpdated = true;
    }

    if (monumentsSettingUpdated) {
        await db.setAppSetting(
            CONTENT_MONUMENTS_SETTING_KEY,
            JSON.stringify(serializeMonumentEntries(currentMonuments)),
        );
    }

    // The admin UI edits monument rows, not a separate monument whitelist.
    // Always realign the list with the effective monument dataset.
    lists.monuments = normalizeMonumentNameList(currentMonuments.map((entry) => entry.name));

    await db.setAppSetting(CONTENT_LISTS_SETTING_KEY, JSON.stringify(lists));
    invalidatePublicContentCache();

    const streetInfos = await getEffectiveStreetInfos();
    return res.json({
        success: true,
        lists,
        monuments: serializeMonumentEntries(currentMonuments),
        stats: computeContentStats(streetInfos, lists),
    });
}));

app.put('/api/editor/monuments', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const rawEntries = req.body?.entries;
    if (!Array.isArray(rawEntries)) {
        return res.status(400).json({ error: 'entries must be an array of {name, longitude, latitude}' });
    }

    const monuments = normalizeMonumentEntries(rawEntries);
    const serializedMonuments = serializeMonumentEntries(monuments);
    await db.setAppSetting(CONTENT_MONUMENTS_SETTING_KEY, JSON.stringify(serializedMonuments));

    const lists = await getEffectiveContentLists();
    lists.monuments = normalizeMonumentNameList(monuments.map((entry) => entry.name));
    await db.setAppSetting(CONTENT_LISTS_SETTING_KEY, JSON.stringify(lists));
    invalidatePublicContentCache();

    const streetInfos = await getEffectiveStreetInfos();
    return res.json({
        success: true,
        monuments: serializedMonuments,
        lists,
        stats: computeContentStats(streetInfos, lists),
    });
}));

// ----------------------
// Push Notification Routes
// ----------------------

app.get('/api/notifications/public-key', asyncHandler(async (req, res) => {
    await ensurePushRuntimeReady();
    res.json({
        enabled: pushRuntime.enabled,
        publicKey: pushRuntime.enabled ? pushRuntime.publicKey : null,
        source: pushRuntime.source,
        reminder: {
            hour: PUSH_REMINDER_HOUR,
            minute: PUSH_REMINDER_MINUTE,
            timezone: PUSH_REMINDER_TIMEZONE,
        },
        streakReminder: {
            hour: PUSH_STREAK_REMINDER_HOUR,
            minute: PUSH_STREAK_REMINDER_MINUTE,
            timezone: PUSH_REMINDER_TIMEZONE,
        },
    });
}));

app.get('/api/notifications/status', authenticateToken, async (req, res) => {
    try {
        await ensurePushRuntimeReady();
        const endpoint = String(req.query?.endpoint || '').trim();
        if (!pushRuntime.enabled) {
            return res.json({
                enabled: false,
                subscribed: false,
                currentSubscribed: false,
                reminder: {
                    hour: PUSH_REMINDER_HOUR,
                    minute: PUSH_REMINDER_MINUTE,
                    timezone: PUSH_REMINDER_TIMEZONE,
                },
            });
        }

        const subscription = await db.getPushSubscriptionStatusForUser(req.user.id, {
            endpoint,
            vapidPublicKey: pushRuntime.publicKey,
        });
        const subscribed = Boolean(subscription?.active);
        return res.json({
            enabled: true,
            subscribed,
            currentSubscribed: endpoint ? Boolean(subscription?.active && subscription.endpoint === endpoint) : subscribed,
            endpoint: subscription?.endpoint || null,
            staleVapidKey: Boolean(subscription?.stale_vapid_key),
            source: pushRuntime.source,
            reminder: {
                hour: PUSH_REMINDER_HOUR,
                minute: PUSH_REMINDER_MINUTE,
                timezone: PUSH_REMINDER_TIMEZONE,
            },
        });
    } catch (err) {
        console.error('Push status error:', err);
        return res.json({
            enabled: false,
            subscribed: false,
            currentSubscribed: false,
            warning: 'notification_status_unavailable',
            reminder: {
                hour: PUSH_REMINDER_HOUR,
                minute: PUSH_REMINDER_MINUTE,
                timezone: PUSH_REMINDER_TIMEZONE,
            },
        });
    }
});

app.post('/api/notifications/subscribe', authenticateToken, asyncHandler(async (req, res) => {
    await ensurePushRuntimeReady();
    if (!pushRuntime.enabled) {
        return res.status(503).json({ error: 'Push notifications are not configured on server' });
    }

    const { subscription } = req.body || {};
    if (!isValidPushSubscription(subscription)) {
        return res.status(400).json({ error: 'Invalid push subscription payload' });
    }

    try {
        await db.upsertPushSubscription(req.user.id, subscription, {
            vapidPublicKey: pushRuntime.publicKey,
        });
        return res.json({
            success: true,
            reminder: {
                hour: PUSH_REMINDER_HOUR,
                minute: PUSH_REMINDER_MINUTE,
                timezone: PUSH_REMINDER_TIMEZONE,
            },
        });
    } catch (err) {
        console.error('Push subscribe error:', err);
        return res.status(500).json({ error: 'Failed to save push subscription' });
    }
}));

app.post('/api/notifications/prompted', authenticateToken, asyncHandler(async (req, res) => {
    await db.markDailyReminderPromptedForUser(req.user.id);
    return res.json({ success: true });
}));

app.post('/api/notifications/unsubscribe', authenticateToken, async (req, res) => {
    const endpoint = String(req.body?.endpoint || '').trim();
    try {
        await ensurePushRuntimeReady();
        if (endpoint) {
            await db.removePushSubscriptionForUser(req.user.id, endpoint);
        } else {
            await db.removeAllPushSubscriptionsForUser(req.user.id);
        }
        return res.json({ success: true });
    } catch (err) {
        console.error('Push unsubscribe error:', err);
        return res.status(500).json({ error: 'Failed to remove push subscription' });
    }
});

// ----------------------
// Score / Leaderboard Routes
// ----------------------

app.get('/api/leaderboard', async (req, res) => {
    try {
        const mode = req.query.mode || req.query.zone_mode;
        const gameType = req.query.gameType || req.query.game_mode;
        if (!mode || !gameType) return res.status(400).json({ error: 'Missing mode or gameType' });
        const period = req.query.period === 'month' ? 'month' : 'all';

        const rows = await db.getLeaderboard(mode, gameType, null, 10, { period });
        res.json(rows);
    } catch (err) {
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

app.get('/api/leaderboards', async (req, res) => {
    try {
        const period = req.query.period === 'month' ? 'month' : 'all';
        const data = await getCachedLeaderboards(period);
        res.json(data);
    } catch (err) {
        console.error('Leaderboards error:', err);
        res.status(500).json({ error: 'Failed to load leaderboards' });
    }
});

app.post(
    '/api/scores',
    createPersistentRateLimit({ name: 'scores', windowMs: 60_000, maxRequests: 60 }),
    authenticateToken,
    asyncHandler(async (req, res) => {
    const parsed = parseScoreSubmission(req.body);
    if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
    }

    const currentUser = await getCurrentAuthenticatedUser(req.user);
    if (!currentUser) {
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }

    const saved = await db.addScore(
        currentUser.id,
        currentUser.username,
        parsed.value.mode,
        parsed.value.gameType,
        parsed.value.score,
        parsed.value.itemsCorrect,
        parsed.value.itemsTotal,
        parsed.value.timeSec,
        parsed.value.arrondissementName,
        parsed.value.sessionId,
    );

    if (saved) {
        invalidateLeaderboardCaches();
    }

    return res.json({ success: true, duplicate: !saved });
}));

app.post(
    '/api/friend-challenges',
    createPersistentRateLimit({ name: 'friend-challenges', windowMs: 60_000, maxRequests: 20 }),
    authenticateToken,
    asyncHandler(async (req, res) => {
    const parsed = parseFriendChallengeCreateSubmission(req.body);
    if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
    }

    const currentUser = await getCurrentAuthenticatedUser(req.user);
    if (!currentUser) {
        return res.status(401).json({ error: 'Unknown authenticated user' });
    }

    const lists = await getEffectiveContentLists();
    const built = await buildFriendChallengeTargets({
        mode: parsed.value.mode,
        gameType: parsed.value.gameType,
        arrondissementName: parsed.value.arrondissementName,
        lists,
    });
    if (!built.ok) {
        return res.status(400).json({ error: built.error });
    }

    let created = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generateFriendChallengeCode();
        try {
            created = await db.createFriendChallenge({
                code,
                createdByUserId: currentUser.id,
                createdByUsername: currentUser.username,
                mode: built.value.mode,
                gameType: built.value.gameType,
                arrondissementName: built.value.arrondissementName,
                targetType: built.value.targetType,
                targetNames: built.value.targetNames,
                expiresAt: getFriendChallengeExpiryDate(),
            });
            break;
        } catch (error) {
            if (error?.code === '23505') {
                continue;
            }
            throw error;
        }
    }

    if (!created) {
        return res.status(500).json({ error: 'Could not allocate a unique challenge code' });
    }

    const payload = serializeFriendChallenge(created);
    return res.json({
        ...payload,
        sharePath: `/?defi=${payload.code}`,
    });
}));

app.get('/api/friend-challenges/:code', asyncHandler(async (req, res) => {
    const code = normalizeChallengeCode(req.params.code);
    if (!FRIEND_CHALLENGE_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Invalid challenge code format' });
    }

    const challenge = await db.getFriendChallengeByCode(code);
    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
    }

    return res.json({
        ...serializeFriendChallenge(challenge),
        sharePath: `/?defi=${challenge.code}`,
    });
}));

app.post(
    '/api/friend-challenges/:code/score',
    createPersistentRateLimit({ name: 'friend-challenge-score', windowMs: 60_000, maxRequests: 60 }),
    authenticateToken,
    asyncHandler(async (req, res) => {
    const code = normalizeChallengeCode(req.params.code);
    if (!FRIEND_CHALLENGE_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Invalid challenge code format' });
    }

    const challenge = await db.getFriendChallengeByCode(code);
    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
    }

    const parsed = parseFriendChallengeScoreSubmission(req.body, challenge.game_type);
    if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error });
    }

    const updated = await db.addFriendChallengeScore(
        challenge.id,
        req.user.id,
        parsed.value.score,
        parsed.value.itemsCorrect,
        parsed.value.itemsTotal,
        parsed.value.timeSec,
        challenge.game_type,
    );

    return res.json({ success: true, updated });
}));

app.get('/api/friend-challenges/:code/leaderboard', authenticateToken, asyncHandler(async (req, res) => {
    const code = normalizeChallengeCode(req.params.code);
    if (!FRIEND_CHALLENGE_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Invalid challenge code format' });
    }

    const challenge = await db.getFriendChallengeByCode(code);
    if (!challenge) {
        return res.status(404).json({ error: 'Challenge not found or expired' });
    }

    const hasPlayed = await db.hasPlayedFriendChallenge(challenge.id, req.user.id);
    const isCreator = Number.parseInt(challenge.created_by_user_id, 10) === Number.parseInt(req.user.id, 10);
    if (!hasPlayed && !isCreator) {
        return res.status(403).json({ error: 'Leaderboard available after first completed run' });
    }

    const rows = await db.getFriendChallengeLeaderboard(challenge.id, challenge.game_type, 20);
    return res.json({
        challenge: serializeFriendChallenge(challenge),
        rows,
    });
}));

// ----------------------
// Profile Route
// ----------------------

function getEmptyProfileStats() {
    return {
        memberSince: null,
        overall: { total_games: 0, best_score: 0, avg_score: 0 },
        bestMode: null,
        modes: [],
        weekly_progress: [],
        arrondissement_stats: [],
        difficulty_stats: [],
        daily: {
            total_days: 0,
            successes: 0,
            avg_attempts: 0,
            current_streak: 0,
            max_streak: 0,
        },
    };
}

const profileRepository = createProfileRepository(db);
const profileService = createProfileService({ repository: profileRepository });
const profileController = createProfileController({
    allowedAvatars: ALLOWED_AVATARS,
    emptyStats: getEmptyProfileStats,
    getAuthenticatedUser: getCurrentAuthenticatedUser,
    service: profileService,
});
app.use('/api/profile', createProfileRouter({
    asyncHandler,
    authenticateToken,
    controller: profileController,
}));

// ----------------------
// Analytics Routes
// ----------------------

app.post(
    '/api/analytics/track',
    createPersistentRateLimit({ name: 'analytics-track', windowMs: 60_000, maxRequests: 120 }),
    async (req, res) => {
    const { streetName, mode, correct, timeSec } = req.body;
    if (!streetName || !mode) return res.status(400).json({ error: 'Missing data' });
    try {
        await db.trackStreetAnswer(streetName, mode, !!correct, timeSec || 0);
        res.json({ ok: true });
    } catch (err) {
        // Fire-and-forget: don't crash on analytics errors
        console.warn('Analytics track error:', err.message);
        res.json({ ok: true });
    }
});

app.get('/api/analytics', authenticateToken, requireContentEditor, async (req, res) => {
    try {
        const data = await db.getAnalytics();
        res.json(data);
    } catch (err) {
        console.error('Analytics error:', err);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

function extractVisitorId(req) {
    if (typeof req.body?.visitorId === 'string') {
        return req.body.visitorId.trim();
    }
    if (typeof req.query?.visitorId === 'string') {
        return req.query.visitorId.trim();
    }
    return '';
}

function extractVisitId(req) {
    if (typeof req.body?.visitId === 'string') {
        return req.body.visitId.trim();
    }
    if (typeof req.query?.visitId === 'string') {
        return req.query.visitId.trim();
    }
    return '';
}

async function handleVisitorHit(req, res) {
    const visitorId = extractVisitorId(req);
    const visitId = extractVisitId(req);

    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(visitorId)) {
        return res.status(400).json({ error: 'Invalid visitor id' });
    }
    if (visitId && !/^[a-zA-Z0-9_-]{16,128}$/.test(visitId)) {
        return res.status(400).json({ error: 'Invalid visit id' });
    }

    try {
        const visitorHash = crypto.createHash('sha256').update(visitorId).digest('hex');
        const visitHash = crypto
            .createHash('sha256')
            .update(visitId || `legacy:${visitorHash}`)
            .digest('hex');
        const visits = await db.recordVisitHit(visitorHash, visitHash);
        res.json({ visits });
    } catch (err) {
        console.error('Visitor counter error:', err);
        res.status(500).json({ error: 'Failed to update visitor counter' });
    }
}

const visitorHitRateLimit = createPersistentRateLimit({
    name: 'visitor-hit',
    windowMs: 60_000,
    maxRequests: 60,
});
app.post('/api/visitors/hit', visitorHitRateLimit, handleVisitorHit);
app.get('/api/visitors/hit', visitorHitRateLimit, handleVisitorHit);

app.get('/api/visitors/count', async (req, res) => {
    try {
        const visits = await db.getVisitCount();
        res.json({ visits });
    } catch (err) {
        console.error('Visitor count read error:', err);
        res.status(500).json({ error: 'Failed to load visitor counter' });
    }
});

// ----------------------
// Daily Challenge Routes
// ----------------------

let streetIndex = [];
let streetChallengeIndex = [];
let arrondissementChallengeIndex = [];
let monumentChallengeIndex = [];
const streetIndexByNormalizedName = new Map();
const streetIndexByNormalizedOsmName = new Map();
const dailyManifestCache = {
    mtimeMs: null,
    byDate: new Map(),
};
function reloadStreetChallengeIndex() {
    const rawStreetIndex = JSON.parse(fs.readFileSync(BACKEND_STREETS_INDEX_PATH, 'utf8'));
    let rawStreetFeatures = [];
    try {
        const rawStreetGeoJson = JSON.parse(fs.readFileSync(BACKEND_STREETS_LIGHT_PATH, 'utf8'));
        rawStreetFeatures = Array.isArray(rawStreetGeoJson?.features) ? rawStreetGeoJson.features : [];
    } catch (error) {
        rawStreetFeatures = [];
        console.warn('Could not load street geometry index for friend challenges:', error.message);
    }
    const streetFeaturesByNormalizedName = new Map();
    rawStreetFeatures.forEach((feature) => {
        const normalizedName = normalizeStreetLookupName(feature?.properties?.name);
        if (!normalizedName) {
            return;
        }
        const candidates = streetFeaturesByNormalizedName.get(normalizedName) || [];
        candidates.push({
            feature,
            centroid: getStreetFeatureCentroid(feature),
        });
        streetFeaturesByNormalizedName.set(normalizedName, candidates);
    });
    streetIndex = rawStreetIndex.filter((entry) =>
        shouldKeepStreetForGame({
            name: entry?.name,
        })
    );
    streetChallengeIndex = streetIndex
        .map((entry) => {
            const targetCentroid = normalizeCoordinatePair(entry?.centroid);
            const normalizedEntryName = normalizeStreetLookupName(entry?.name);
            const candidateFeatures = streetFeaturesByNormalizedName.get(normalizedEntryName) || [];
            const matchingCandidate = candidateFeatures.find((candidate) => {
                if (!targetCentroid) {
                    return true;
                }
                const featureCentroid = candidate.centroid;
                return (
                    featureCentroid &&
                    Math.abs(featureCentroid[0] - targetCentroid[0]) <= 0.00001 &&
                    Math.abs(featureCentroid[1] - targetCentroid[1]) <= 0.00001
                );
            });
            const matchingFeature = matchingCandidate?.feature;
            const target = {
                name: String(entry?.name || '').trim(),
                featureId: matchingFeature ? getStreetFeatureId(matchingFeature) : '',
                centroid: targetCentroid,
                arrondissementName: String(entry?.arrondissement || '').trim() || null,
            };
            if (!target || !shouldKeepStreetForGame({ name: target.name })) {
                return null;
            }
            return {
                ...target,
                normalizedName: normalizeContentName(target.name),
                arrondissementKey: normalizeArrondissementChallengeKey(target.arrondissementName),
            };
        })
        .filter((entry) => entry && entry.name && entry.normalizedName);

    streetIndexByNormalizedName.clear();
    streetIndexByNormalizedOsmName.clear();
    streetChallengeIndex.forEach((entry) => {
        if (streetIndexByNormalizedName.has(entry.normalizedName)) {
            return;
        }
        const source = streetIndex.find(
            (candidate) => normalizeContentName(candidate?.name) === entry.normalizedName
        );
        if (source) {
            streetIndexByNormalizedName.set(entry.normalizedName, source);
        }
    });
    streetIndex.forEach((entry) => {
        const normalizedOsmName = normalizeContentName(entry?.osmName || entry?.name);
        if (!normalizedOsmName) {
            return;
        }
        if (!streetIndexByNormalizedOsmName.has(normalizedOsmName)) {
            streetIndexByNormalizedOsmName.set(normalizedOsmName, []);
        }
        streetIndexByNormalizedOsmName.get(normalizedOsmName).push(entry);
    });

    return {
        loaded: rawStreetIndex.length,
        kept: streetIndex.length,
        excluded: rawStreetIndex.length - streetIndex.length,
    };
}

function reloadArrondissementChallengeIndex() {
    const rawArrondissements = fs.readFileSync(BACKEND_QUARTIERS_GEOJSON_PATH, 'utf8');
    const parsedArrondissements = JSON.parse(rawArrondissements);
    const seen = new Set();
    arrondissementChallengeIndex = (Array.isArray(parsedArrondissements?.features) ? parsedArrondissements.features : [])
        .map((feature) => String(feature?.properties?.nom_qua || '').trim())
        .filter(Boolean)
        .filter((name) => {
            const key = normalizeArrondissementChallengeKey(name);
            if (!key || seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        })
        .map((name) => ({
            name,
            key: normalizeArrondissementChallengeKey(name),
        }));

    return { loaded: arrondissementChallengeIndex.length };
}

function reloadMonumentChallengeIndex() {
    const rawMonuments = fs.readFileSync(BACKEND_MONUMENTS_GEOJSON_PATH, 'utf8');
    const parsedMonuments = JSON.parse(rawMonuments);
    const seen = new Set();
    monumentChallengeIndex = (Array.isArray(parsedMonuments?.features) ? parsedMonuments.features : [])
        .filter((feature) => feature?.geometry?.type === 'Point')
        .map((feature) => String(feature?.properties?.name || '').trim())
        .filter(Boolean)
        .filter((name) => {
            const normalized = normalizeContentName(name);
            if (!normalized || seen.has(normalized)) {
                return false;
            }
            seen.add(normalized);
            return true;
        })
        .map((name) => ({
            name,
            normalizedName: normalizeContentName(name),
        }));

    return { loaded: monumentChallengeIndex.length };
}

function reloadDailyRuntimeIndexes() {
    const summary = {
        streetIndex: null,
        arrondissementIndex: null,
        monumentIndex: null,
        errors: [],
    };

    try {
        summary.streetIndex = reloadStreetChallengeIndex();
        console.log(
            `[Daily] Street index reloaded: ${summary.streetIndex.kept}/${summary.streetIndex.loaded} streets (${summary.streetIndex.excluded} excluded by gameplay filter).`
        );
    } catch (error) {
        const message = `street index: ${error.message}`;
        summary.errors.push(message);
        console.error('Could not reload street index for daily:', error.message);
    }

    try {
        summary.arrondissementIndex = reloadArrondissementChallengeIndex();
        console.log(`[Daily] Arrondissement index reloaded: ${summary.arrondissementIndex.loaded} arrondissements.`);
    } catch (error) {
        const message = `arrondissement index: ${error.message}`;
        summary.errors.push(message);
        console.error('Could not reload arrondissements index for friend challenges:', error.message);
    }

    try {
        summary.monumentIndex = reloadMonumentChallengeIndex();
        console.log(`[Daily] Monument index reloaded: ${summary.monumentIndex.loaded} monuments.`);
    } catch (error) {
        const message = `monument index: ${error.message}`;
        summary.errors.push(message);
        console.error('Could not reload monuments index for friend challenges:', error.message);
    }

    return summary;
}

async function buildFriendChallengeTargets({ mode, gameType, arrondissementName, lists }) {
    const normalizedMode = SCORE_MODE_ALIASES[mode] || mode;
    const normalizedGameType = String(gameType || '').trim();
    const famousStreetSet = new Set(Array.isArray(lists?.famousStreets) ? lists.famousStreets : []);
    const mainStreetSet = new Set(Array.isArray(lists?.mainStreets) ? lists.mainStreets : []);
    const monumentSet = new Set(Array.isArray(lists?.monuments) ? lists.monuments : []);

    let targetType = 'street';
    let pool = [];
    let effectiveArrondissementName = null;

    if (normalizedMode === 'arrondissements-ville') {
        targetType = 'arrondissement';
        pool = arrondissementChallengeIndex.map((entry) => entry.name);
    } else if (normalizedMode === 'monuments') {
        targetType = 'monument';
        let dynamicMonumentIndex = monumentChallengeIndex;
        try {
            const monuments = await getEffectiveMonumentEntries();
            if (Array.isArray(monuments) && monuments.length > 0) {
                dynamicMonumentIndex = monuments.map((entry) => ({
                    name: entry.name,
                    normalizedName: normalizeContentName(entry.name),
                }));
            }
        } catch (error) {
            console.warn('Could not resolve effective monuments for friend challenges:', error.message);
        }

        if (monumentSet.size > 0) {
            pool = dynamicMonumentIndex
                .filter((entry) => monumentSet.has(entry.normalizedName))
                .map((entry) => entry.name);
        } else {
            pool = dynamicMonumentIndex.map((entry) => entry.name);
        }
    } else {
        targetType = 'street';
        if (normalizedMode === 'rues-principales') {
            pool = streetChallengeIndex
                .filter((entry) => mainStreetSet.has(entry.normalizedName))
                .map(({ name, featureId, centroid, arrondissementName }) => ({ name, featureId, centroid, arrondissementName }));
        } else if (normalizedMode === 'rues-celebres') {
            pool = streetChallengeIndex
                .filter((entry) => famousStreetSet.has(entry.normalizedName))
                .map(({ name, featureId, centroid, arrondissementName }) => ({ name, featureId, centroid, arrondissementName }));
        } else if (normalizedMode === 'arrondissement') {
            const arrondissementKey = normalizeArrondissementChallengeKey(arrondissementName);
            if (!arrondissementKey) {
                return { ok: false, error: 'arrondissementName is required for arrondissement mode' };
            }
            const streetPool = streetChallengeIndex.filter((entry) => entry.arrondissementKey === arrondissementKey);
            if (streetPool.length > 0) {
                effectiveArrondissementName = streetPool[0].arrondissementName || arrondissementName;
            } else {
                effectiveArrondissementName = arrondissementName;
            }
            pool = streetPool.map(({ name, featureId, centroid, arrondissementName }) => ({ name, featureId, centroid, arrondissementName }));
        } else {
            pool = streetChallengeIndex.map(({ name, featureId, centroid, arrondissementName }) => ({ name, featureId, centroid, arrondissementName }));
        }
    }

    if (!Array.isArray(pool) || pool.length === 0) {
        return { ok: false, error: 'No targets available for this configuration' };
    }

    const shuffledPool = shuffleCopy(pool);
    const targetNames = normalizedGameType === 'classique'
        ? shuffledPool.slice(0, Math.min(FRIEND_CHALLENGE_CLASSIQUE_SIZE, shuffledPool.length))
        : shuffledPool;

    return {
        ok: true,
        value: {
            mode: normalizedMode,
            gameType: normalizedGameType,
            arrondissementName: normalizedMode === 'arrondissement' ? effectiveArrondissementName : null,
            targetType,
            targetNames,
        },
    };
}

function extractStreetGeometry(streetName) {
    try {
        const normalizedTarget = normalizeStreetLookupName(streetName);
        if (!normalizedTarget) {
            return null;
        }

        let features = [];
        for (const geoPath of STREET_GEOMETRY_CANDIDATE_PATHS) {
            try {
                const raw = fs.readFileSync(geoPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.features)) {
                    features = parsed.features.filter((feature) => {
                        const featureName = feature?.properties?.name;
                        return normalizeStreetLookupName(featureName) === normalizedTarget && feature?.geometry;
                    });
                    if (features.length > 0) {
                        break;
                    }
                }
            } catch (readErr) {
                // Try next candidate file.
            }
        }
        if (features.length === 0) {
            return null;
        }
        if (features.length === 1) {
            return features[0].geometry || null;
        }
        return {
            type: 'FeatureCollection',
            features: features.map((feature) => ({
                type: 'Feature',
                properties: {
                    name: feature?.properties?.name || String(streetName || ''),
                },
                geometry: feature.geometry,
            })),
        };
    } catch (err) {
        console.error('Error extracting geometry:', err.message);
    }
    return null;
}

function computeRepresentativeCoordinatesFromGeometry(geometry) {
    if (!geometry) {
        return null;
    }

    if (geometry.type === 'FeatureCollection' && Array.isArray(geometry.features)) {
        const points = [];
        geometry.features.forEach((feature) => {
            const candidate = computeRepresentativeCoordinatesFromGeometry(feature?.geometry);
            if (candidate) {
                points.push(candidate);
            }
        });
        if (points.length === 0) {
            return null;
        }
        return points[Math.floor(points.length / 2)];
    }

    if (geometry.type === 'Feature' && geometry.geometry) {
        return computeRepresentativeCoordinatesFromGeometry(geometry.geometry);
    }

    if (!Array.isArray(geometry.coordinates)) {
        return null;
    }

    const isPointLike = (coords) =>
        Array.isArray(coords) &&
        coords.length >= 2 &&
        Number.isFinite(coords[0]) &&
        Number.isFinite(coords[1]);

    if (geometry.type === 'Point') {
        return isPointLike(geometry.coordinates) ? geometry.coordinates.slice(0, 2) : null;
    }

    if (geometry.type === 'LineString') {
        const line = geometry.coordinates;
        if (!Array.isArray(line) || line.length < 1) return null;
        const mid = line[Math.floor(line.length / 2)];
        return isPointLike(mid) ? mid.slice(0, 2) : null;
    }

    if (geometry.type === 'MultiLineString') {
        const line = (geometry.coordinates || []).find((entry) => Array.isArray(entry) && entry.length > 0);
        if (!line) return null;
        const mid = line[Math.floor(line.length / 2)];
        return isPointLike(mid) ? mid.slice(0, 2) : null;
    }

    if (geometry.type === 'Polygon') {
        const ring = (geometry.coordinates || [])[0];
        if (!Array.isArray(ring) || ring.length < 1) return null;
        const mid = ring[Math.floor(ring.length / 2)];
        return isPointLike(mid) ? mid.slice(0, 2) : null;
    }

    if (geometry.type === 'MultiPolygon') {
        const polygon = (geometry.coordinates || []).find(
            (entry) => Array.isArray(entry) && Array.isArray(entry[0]) && entry[0].length > 0
        );
        if (!polygon) return null;
        const ring = polygon[0];
        const mid = ring[Math.floor(ring.length / 2)];
        return isPointLike(mid) ? mid.slice(0, 2) : null;
    }

    return null;
}

function parseCoordinatesJson(rawCoordinates) {
    if (!rawCoordinates) {
        return null;
    }
    try {
        const parsed = typeof rawCoordinates === 'string'
            ? JSON.parse(rawCoordinates)
            : rawCoordinates;
        if (
            Array.isArray(parsed) &&
            parsed.length >= 2 &&
            Number.isFinite(parsed[0]) &&
            Number.isFinite(parsed[1])
        ) {
            return [parsed[0], parsed[1]];
        }
    } catch (error) {
        return null;
    }
    return null;
}

function parseGeometryJson(rawGeometry) {
    if (!rawGeometry) {
        return null;
    }
    try {
        const parsed = typeof rawGeometry === 'string' ? JSON.parse(rawGeometry) : rawGeometry;
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function shouldRefreshStoredDailyGeometry(storedGeometry) {
    if (!storedGeometry || typeof storedGeometry !== 'object') {
        return true;
    }
    if (storedGeometry.type === 'FeatureCollection') {
        return !Array.isArray(storedGeometry.features) || storedGeometry.features.length === 0;
    }
    if (storedGeometry.type === 'Feature') {
        return !storedGeometry.geometry;
    }
    if (storedGeometry.type && Array.isArray(storedGeometry.coordinates)) {
        return false;
    }
    return true;
}

function normalizeDailyTargetGeometryPayload(rawGeometry, streetName) {
    const storedGeometry = parseGeometryJson(rawGeometry);
    if (!shouldRefreshStoredDailyGeometry(storedGeometry)) {
        return storedGeometry;
    }
    return extractStreetGeometry(streetName) || storedGeometry || null;
}

async function refreshDailyTargetsFromCurrentStreetData() {
    const targets = await db.listDailyTargets();
    let refreshed = 0;
    let missingGeometry = 0;

    for (const target of targets) {
        const geometry = extractStreetGeometry(target?.street_name);
        if (!geometry) {
            missingGeometry += 1;
            continue;
        }

        let coordinates = parseCoordinatesJson(target?.coordinates_json);
        if (!coordinates) {
            coordinates = computeRepresentativeCoordinatesFromGeometry(geometry);
        }
        if (!coordinates) {
            coordinates = [2.3522, 48.8566];
        }

        await db.setDailyTarget(
            target.date,
            target.street_name,
            target.arrondissement,
            coordinates,
            geometry
        );
        refreshed += 1;
    }

    return {
        totalTargets: targets.length,
        refreshed,
        missingGeometry,
    };
}

function loadDailyManifestByDate() {
    try {
        if (!fs.existsSync(DAILY_MANIFEST_ABSOLUTE_PATH)) {
            dailyManifestCache.byDate = new Map();
            dailyManifestCache.mtimeMs = null;
            return dailyManifestCache.byDate;
        }

        const stat = fs.statSync(DAILY_MANIFEST_ABSOLUTE_PATH);
        if (
            dailyManifestCache.mtimeMs !== null &&
            stat.mtimeMs === dailyManifestCache.mtimeMs &&
            dailyManifestCache.byDate.size > 0
        ) {
            return dailyManifestCache.byDate;
        }

        const raw = fs.readFileSync(DAILY_MANIFEST_ABSOLUTE_PATH, 'utf8');
        const rows = parseCsvRows(raw);
        const header = rows[0] || [];
        const columnIndex = new Map(header.map((name, index) => [String(name || '').trim(), index]));
        const byDate = new Map();

        rows.slice(1).forEach((row) => {
            const date = row[columnIndex.get('date')];
            const streetName = row[columnIndex.get('street_name')];
            const arrondissement = row[columnIndex.get('arrondissement')];
            const fileName = row[columnIndex.get('file_name')];
            const missingImageStreet = row[columnIndex.get('missing_image_street')];
            const normalizedDate = String(date || '').trim();
            const normalizedStreetName = String(streetName || '').trim();
            if (!normalizedDate || !normalizedStreetName) {
                return;
            }
            byDate.set(normalizedDate, {
                date: normalizedDate,
                streetName: normalizedStreetName,
                arrondissement: String(arrondissement || '').trim(),
                fileName: String(fileName || '').trim(),
                missingImageStreet: String(missingImageStreet || '').trim(),
            });
        });

        dailyManifestCache.byDate = byDate;
        dailyManifestCache.mtimeMs = stat.mtimeMs;
        return dailyManifestCache.byDate;
    } catch (error) {
        console.warn('[Daily] Could not read manifest_next_30.csv:', error.message);
        dailyManifestCache.byDate = new Map();
        dailyManifestCache.mtimeMs = null;
        return dailyManifestCache.byDate;
    }
}

function getDailyManifestEntryByDate(dateStr) {
    const byDate = loadDailyManifestByDate();
    return byDate.get(dateStr) || null;
}

function getCoordinatesFromStreetIndex(streetName) {
    const normalized = normalizeContentName(streetName);
    if (!normalized) {
        return null;
    }
    const source = streetIndexByNormalizedName.get(normalized);
    if (!source || !Array.isArray(source.centroid) || source.centroid.length < 2) {
        return null;
    }
    const [lng, lat] = source.centroid;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return [lng, lat];
}

function resolveStreetIndexEntry(streetName, quartier = null, coordinates = null) {
    const normalizedName = normalizeContentName(streetName);
    if (!normalizedName) {
        return null;
    }

    const exact = streetIndexByNormalizedName.get(normalizedName);
    if (exact) {
        return exact;
    }

    const aliases = streetIndexByNormalizedOsmName.get(normalizedName) || [];
    if (aliases.length === 0) {
        return null;
    }

    const normalizedQuartier = normalizeContentName(quartier);
    const quartierMatches = normalizedQuartier
        ? aliases.filter((entry) => normalizeContentName(entry?.quartier) === normalizedQuartier)
        : [];
    const candidates = quartierMatches.length > 0 ? quartierMatches : aliases;

    if (Array.isArray(coordinates) && coordinates.length >= 2 && candidates.length > 1) {
        return candidates
            .filter((entry) => Array.isArray(entry?.centroid) && entry.centroid.length >= 2)
            .sort(
                (left, right) =>
                    getCoordinateDistanceMeters(left.centroid, coordinates)
                    - getCoordinateDistanceMeters(right.centroid, coordinates)
            )[0] || null;
    }

    return candidates[0] || null;
}

function resolveDailyTargetFromManifest(manifestEntry, currentTarget = null) {
    if (!manifestEntry?.streetName) {
        return null;
    }

    const currentCoordinates = parseCoordinatesJson(currentTarget?.coordinates_json);
    const streetSource = resolveStreetIndexEntry(
        manifestEntry.streetName,
        manifestEntry.quartier,
        currentCoordinates
    );
    const canonicalStreetName = streetSource?.name || manifestEntry.streetName;
    const normalizedManifestStreet = normalizeContentName(canonicalStreetName);
    const normalizedCurrentStreet = normalizeContentName(currentTarget?.street_name);
    const canReuseCurrentCoordinates =
        normalizeContentName(manifestEntry.streetName) &&
        normalizedCurrentStreet &&
        normalizeContentName(manifestEntry.streetName) === normalizedCurrentStreet &&
        currentTarget?.coordinates_json;

    let coordinates = getCoordinatesFromStreetIndex(canonicalStreetName);
    let geometry = null;

    if (!coordinates && canReuseCurrentCoordinates) {
        if (currentCoordinates) {
            coordinates = currentCoordinates;
        }
    }

    if (!coordinates) {
        geometry = extractStreetGeometry(canonicalStreetName);
        coordinates = computeRepresentativeCoordinatesFromGeometry(geometry);
    }

    if (!coordinates) {
        coordinates = [2.3522, 48.8566];
    }

    const arrondissement =
        manifestEntry.arrondissement
        || streetSource?.arrondissement
        || streetSource?.quartier
        || currentTarget?.arrondissement
        || null;
    return {
        streetName: canonicalStreetName,
        arrondissement,
        coordinates,
        geometry: geometry || null,
    };
}

function getCoordinateDistanceMeters(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        a.length < 2 ||
        b.length < 2 ||
        !Number.isFinite(a[0]) ||
        !Number.isFinite(a[1]) ||
        !Number.isFinite(b[0]) ||
        !Number.isFinite(b[1])
    ) {
        return Number.POSITIVE_INFINITY;
    }

    const lonScale = 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
    const latScale = 110540;
    return Math.hypot((b[0] - a[0]) * lonScale, (b[1] - a[1]) * latScale);
}

function shouldSyncDailyTargetFromManifest(target, desired) {
    if (!target) {
        return true;
    }

    if (normalizeContentName(target.street_name) !== normalizeContentName(desired.streetName)) {
        return true;
    }

    if (normalizeContentName(target.arrondissement) !== normalizeContentName(desired.arrondissement)) {
        return true;
    }

    const storedCoordinates = parseCoordinatesJson(target.coordinates_json);
    if (!storedCoordinates) {
        return true;
    }

    return getCoordinateDistanceMeters(storedCoordinates, desired.coordinates) > 25;
}

function dateHash(dateStr) {
    let h = 0;
    for (let i = 0; i < dateStr.length; i++) {
        h = ((h << 5) - h + dateStr.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

async function ensureDailyTarget() {
    const date = getDailyDateKey();
    let target = await db.getDailyTarget(date);
    const manifestEntry = getDailyManifestEntryByDate(date);

    if (manifestEntry) {
        const desired = resolveDailyTargetFromManifest(manifestEntry, target);
        if (desired) {
            const sameStreet =
                target &&
                normalizeContentName(target.street_name) === normalizeContentName(desired.streetName);
            const needsSync = shouldSyncDailyTargetFromManifest(target, desired);

            if (needsSync) {
                const canSyncWithoutChangingStartedChallenge = !target || sameStreet;
                let canSync = canSyncWithoutChangingStartedChallenge;

                if (!canSync) {
                    const attemptCount = await db.countDailyUserAttemptsForDate(date);
                    canSync = attemptCount === 0;
                    if (!canSync) {
                        console.warn(
                            `[Daily] Keeping existing target for ${date}: "${target.street_name}" ` +
                            `instead of manifest "${desired.streetName}" because ${attemptCount} player(s) already started.`
                        );
                    }
                }

                if (canSync) {
                    await db.setDailyTarget(
                        date,
                        desired.streetName,
                        desired.arrondissement,
                        desired.coordinates,
                        desired.geometry
                    );
                    target = await db.getDailyTarget(date);
                    console.log(`[Daily] Synced target from manifest for ${date}: ${desired.streetName}`);
                }
            }
        }
    }

    if (target && !manifestEntry && !shouldKeepStreetForGame({ name: target.street_name })) {
        const attemptCount = await db.countDailyUserAttemptsForDate(date);
        if (attemptCount > 0) {
            console.warn(
                `[Daily] Keeping excluded existing target for ${date}: "${target.street_name}" ` +
                `because ${attemptCount} player(s) already started.`
            );
        } else {
            console.warn(`[Daily] Existing target excluded by filter for ${date}: "${target.street_name}". Regenerating.`);
            target = null;
        }
    }
    
    if (!target && streetIndex.length > 0) {
        // Find recent arrondissements to avoid
        const recentTargets = await db.getRecentDailyTargets(5);
        const forbiddenArrondissements = new Set();
        
        // Normalize function for keys (remove accents, dashes, lowercase)
        const normalizeStr = (str) => {
            if (!str) return '';
            return str
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[-\s]/g, "")
                .toLowerCase();
        };

        // Normalize the map keys for robust lookup
        const normalizedMap = {};
        for (const [key, val] of Object.entries(ARRONDISSEMENT_PAR_QUARTIER)) {
            normalizedMap[normalizeStr(key)] = val;
        }

        recentTargets.forEach(t => {
            const arr = normalizedMap[normalizeStr(t.arrondissement)];
            if (arr) forbiddenArrondissements.add(arr);
        });

        let attempts = 0;
        let street;
        let hashSeed = date;

        while (attempts < 100) {
            const idx = dateHash(hashSeed) % streetIndex.length;
            street = streetIndex[idx];

            const arr = normalizedMap[normalizeStr(street.arrondissement)];
            if (!forbiddenArrondissements.has(arr)) {
                break; // Found a good street!
            }

            // Street belongs to a recently used arrondissement, retry
            hashSeed += "_retry";
            attempts++;
        }
        
        if (attempts >= 100) {
            console.warn(`[Daily] Could not find a street in a new arrondissement after 100 attempts for date ${date}. Using fallback.`);
        }

        await db.setDailyTarget(date, street.name, street.arrondissement, street.centroid, null);
    } else if (!target) {
        await db.setDailyTarget(date, 'Avenue des Champs-Élysées', '8e arrondissement', [2.30782, 48.8698], null);
    }
    return date;
}

async function getTargetGeometry(target) {
    const normalizedGeometry = normalizeDailyTargetGeometryPayload(
        target?.geometry_json,
        target?.street_name
    );

    if (normalizedGeometry) {
        const currentStored = parseGeometryJson(target?.geometry_json);
        const hasChanged =
            !currentStored || JSON.stringify(currentStored) !== JSON.stringify(normalizedGeometry);
        if (hasChanged) {
            const coordinates =
                parseCoordinatesJson(target?.coordinates_json) ||
                computeRepresentativeCoordinatesFromGeometry(normalizedGeometry) ||
                [2.3522, 48.8566];
            await db.setDailyTarget(
                target.date,
                target.street_name,
                target.arrondissement,
                coordinates,
                normalizedGeometry
            );
        }
        return JSON.stringify(normalizedGeometry);
    }

    return null;
}

app.get('/api/daily/health', asyncHandler(async (req, res) => {
    const date = await ensureDailyTarget();
    const target = await db.getDailyTarget(date);
    const manifestEntry = getDailyManifestEntryByDate(date);
    const imageUrl = resolveDailyImageUrl(date, target?.street_name, manifestEntry);
    const targetReady = Boolean(target && parseCoordinatesJson(target.coordinates_json));
    const streetIndexReady = streetIndex.length > 0;
    const imageReady = Boolean(imageUrl);
    const ok = targetReady && streetIndexReady && imageReady;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(ok ? 200 : 503).json({
        ok,
        date,
        targetReady,
        streetIndexReady,
        imageReady,
    });
}));

app.get('/api/daily/streak', authenticateToken, asyncHandler(async (req, res) => {
    const date = getDailyDateKey();
    const dailyStreak = await db.getDailyStreakForUser(req.user.id, date);
    return res.json({ date, dailyStreak });
}));

app.get('/api/daily', authenticateToken, async (req, res) => {
    try {
        const date = await ensureDailyTarget();
        const target = await db.getDailyTarget(date);
        const manifestEntry = getDailyManifestEntryByDate(date);
        const userStatus = await db.startDailyUserAttempt(req.user.id, date);
        const dailyStreak = await db.getDailyStreakForUser(req.user.id, date);
        await ensurePushRuntimeReady();
        const reminderPromptStatus = await db.getDailyReminderPromptStatusForUser(req.user.id);

        const response = {
            date,
            streetName: target.street_name,
            displayStreetName:
                resolveStreetIndexEntry(target.street_name, target.arrondissement)?.osmName
                || target.street_name,
            arrondissement: target.arrondissement,
            dailyImageUrl: resolveDailyImageUrl(date, target.street_name, manifestEntry),
            targetGeoJson: target.coordinates_json,
            userStatus,
            dailyStreak,
            reminderAutoPromptEligible:
                pushRuntime.enabled
                && !reminderPromptStatus.prompted
                && !reminderPromptStatus.hasActiveSubscription,
        };

        if (userStatus.success || userStatus.attempts_count >= 7) {
            response.targetGeometry = await getTargetGeometry(target);
        }

        res.json(response);
    } catch (err) {
        console.error('Daily status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post(
    '/api/daily/guess',
    createPersistentRateLimit({ name: 'daily-guess', windowMs: 60_000, maxRequests: 90 }),
    authenticateToken,
    asyncHandler(async (req, res) => {
    try {
        const parsed = parseDailyGuessSubmission(req.body);
        if (!parsed.ok) {
            return res.status(400).json({ error: parsed.error });
        }

        const expectedDate = await ensureDailyTarget();
        const isAllowedDate = await isDailyGuessDateAllowed(
            req.user.id,
            parsed.value.date,
            expectedDate,
        );
        if (!isAllowedDate) {
            return res.status(400).json({ error: 'Invalid daily date for current challenge' });
        }

        const result = await db.updateDailyUserAttempt(
            req.user.id,
            parsed.value.date,
            parsed.value.distanceMeters,
            parsed.value.isSuccess,
            parsed.value.attemptsCount,
        );

        if (result.success || result.attempts_count >= 7) {
            result.dailyStreak = await db.getDailyStreakForUser(req.user.id, expectedDate);
        }

        if (result.success || result.attempts_count >= 7) {
            const target = await db.getDailyTarget(parsed.value.date);
            result.targetGeometry = target ? await getTargetGeometry(target) : null;
        }

        if (result.success || result.attempts_count >= 7) {
            invalidateAsyncTtlCache(dailyLeaderboardCache);
            invalidateAsyncTtlCache(dailyWeeklyLeaderboardCache);
            invalidateAsyncTtlCache(dailyPodiumLeaderboardCache);
            invalidateAsyncTtlCache(dailyAverageLeaderboardCache);
        }

        if (result.success) {
            result.referralProgress = await referralService.checkReferralProgress(req.user.id, 'daily_completed');
        }

        return res.json(result);
    } catch (err) {
        console.error('Daily guess error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/daily/leaderboard', async (req, res) => {
    try {
        const date = getDailyDateKey();
        const rows = await getCachedDailyLeaderboard(date);
        res.json(rows);
    } catch (err) {
        console.error('Daily leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load daily leaderboard' });
    }
});

app.get('/api/daily/leaderboard/weekly', async (req, res) => {
    try {
        const date = getDailyDateKey();
        const payload = await getCachedDailyWeeklyLeaderboard(date);
        res.json(payload);
    } catch (err) {
        console.error('Daily weekly leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load weekly daily leaderboard' });
    }
});

app.get('/api/daily/leaderboard/podiums', async (req, res) => {
    try {
        const rows = await getCachedDailyPodiumLeaderboard(getDailyDateKey());
        res.json(rows);
    } catch (err) {
        console.error('Daily podium leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load daily podium leaderboard' });
    }
});

app.get('/api/daily/leaderboard/averages', async (req, res) => {
    try {
        const rows = await getCachedDailyAverageLeaderboard();
        res.json(rows);
    } catch (err) {
        console.error('Daily average leaderboard error:', err);
        res.status(500).json({ error: 'Failed to load daily average leaderboard' });
    }
});

app.get('/api/editor/daily-history', authenticateToken, requireAdminUser, asyncHandler(async (req, res) => {
    const date = req.query?.date ? String(req.query.date).trim() : null;
    if (date !== null && !ISO_DATE_PATTERN.test(date)) {
        return res.status(400).json({ error: 'Invalid date format' });
    }
    const requestedLimit = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? requestedLimit : 500;
    const rows = await db.getDailyHistory(date, limit);
    return res.json({ date, players: rows });
}));

const DAILY_REMINDER_KIND_AVAILABILITY = 'availability';
const DAILY_REMINDER_KIND_STREAK = 'streak';

async function sendDailyReminderPushesForDate(dateStr, reminderKind = DAILY_REMINDER_KIND_AVAILABILITY) {
    if (!pushRuntime.enabled) {
        return { sent: 0, removed: 0, failed: 0 };
    }

    const isStreakReminder = reminderKind === DAILY_REMINDER_KIND_STREAK;
    const subscriptions = isStreakReminder
        ? await db.listPushSubscriptionsDueForStreakDate(dateStr, {
            vapidPublicKey: pushRuntime.publicKey,
        })
        : await db.listPushSubscriptionsDueForDate(dateStr, {
            vapidPublicKey: pushRuntime.publicKey,
        });

    let sent = 0;
    let removed = 0;
    let failed = 0;

    for (const row of subscriptions) {
        const endpoint = row.endpoint;
        const subscription = row.subscription_json;
        const payload = isStreakReminder
            ? getDailyStreakReminderPayload(row.streak_count)
            : getDailyReminderPayload();

        try {
            await webPush.sendNotification(subscription, payload, { TTL: 60 * 60 });
            if (isStreakReminder) {
                await db.markPushSubscriptionStreakNotified(endpoint, dateStr);
            } else {
                await db.markPushSubscriptionNotified(endpoint, dateStr);
            }
            sent += 1;
        } catch (err) {
            const statusCode = Number(err?.statusCode || 0);
            // 404/410 means the push service says the endpoint is gone.
            // 401/403 can also be transient server/VAPID auth trouble, so keep the row and retry.
            if (statusCode === 404 || statusCode === 410) {
                await db.removePushSubscriptionByEndpoint(endpoint);
                removed += 1;
            } else {
                failed += 1;
                console.warn('Push send failure:', {
                    endpoint,
                    statusCode,
                    message: err?.message || 'Unknown push error',
                });
            }
        }
    }

    return { sent, removed, failed };
}

const PUSH_REMINDER_RETRY_BACKOFF_MS = 10 * 60 * 1000;
const reminderSchedulerStates = {
    [DAILY_REMINDER_KIND_AVAILABILITY]: { lastDateKey: '', retryNotBeforeMs: 0 },
    [DAILY_REMINDER_KIND_STREAK]: { lastDateKey: '', retryNotBeforeMs: 0 },
};

function hasReachedReminderTime(nowParts, hour, minute) {
    return (
        nowParts.hour > hour ||
        (nowParts.hour === hour && nowParts.minute >= minute)
    );
}

async function runScheduledDailyReminder(nowParts, { kind, hour, minute }) {
    if (!hasReachedReminderTime(nowParts, hour, minute)) {
        return;
    }

    const state = reminderSchedulerStates[kind];
    if (nowParts.dateStr === state.lastDateKey) {
        return;
    }
    if (Date.now() < state.retryNotBeforeMs) {
        return;
    }

    try {
        const result = await sendDailyReminderPushesForDate(nowParts.dateStr, kind);
        if (result.failed > 0) {
            state.retryNotBeforeMs = Date.now() + PUSH_REMINDER_RETRY_BACKOFF_MS;
            console.warn(
                `[Push Daily ${kind} ${nowParts.dateStr}] sent=${result.sent} removed=${result.removed} failed=${result.failed} (retry in ${Math.round(PUSH_REMINDER_RETRY_BACKOFF_MS / 60000)} min)`
            );
            return;
        }

        state.retryNotBeforeMs = 0;
        state.lastDateKey = nowParts.dateStr;
        console.log(
            `[Push Daily ${kind} ${nowParts.dateStr}] sent=${result.sent} removed=${result.removed} failed=${result.failed}`
        );
    } catch (err) {
        state.lastDateKey = '';
        state.retryNotBeforeMs = Date.now() + PUSH_REMINDER_RETRY_BACKOFF_MS;
        console.error(`Daily push scheduler error (${kind}):`, err);
    }
}

async function runPushReminderSchedulerTick() {
    await ensurePushRuntimeReady();
    if (!pushRuntime.enabled) {
        return;
    }

    const nowParts = getTimePartsInZone(new Date(), PUSH_REMINDER_TIMEZONE);
    const streakWindowStarted = hasReachedReminderTime(
        nowParts,
        PUSH_STREAK_REMINDER_HOUR,
        PUSH_STREAK_REMINDER_MINUTE,
    );

    if (!streakWindowStarted) {
        await runScheduledDailyReminder(nowParts, {
            kind: DAILY_REMINDER_KIND_AVAILABILITY,
            hour: PUSH_REMINDER_HOUR,
            minute: PUSH_REMINDER_MINUTE,
        });
    }

    await runScheduledDailyReminder(nowParts, {
        kind: DAILY_REMINDER_KIND_STREAK,
        hour: PUSH_STREAK_REMINDER_HOUR,
        minute: PUSH_STREAK_REMINDER_MINUTE,
    });
}

function startPushReminderScheduler() {
    if (!pushRuntime.enabled) {
        console.warn('Push reminder scheduler starting in degraded mode: push runtime is not ready yet.');
    }
    runPushReminderSchedulerTick().catch((err) => {
        console.error('Initial push scheduler tick failed:', err);
    });
    setInterval(() => {
        runPushReminderSchedulerTick().catch((err) => {
            console.error('Push scheduler tick failed:', err);
        });
    }, 30 * 1000);
    console.log(
        `Push reminder scheduler enabled at ${String(PUSH_REMINDER_HOUR).padStart(2, '0')}:${String(PUSH_REMINDER_MINUTE).padStart(2, '0')} and ${String(PUSH_STREAK_REMINDER_HOUR).padStart(2, '0')}:${String(PUSH_STREAK_REMINDER_MINUTE).padStart(2, '0')} (${PUSH_REMINDER_TIMEZONE}).`
    );
}

async function cleanupExpiredFriendChallengesTick() {
    try {
        const removed = await db.deleteExpiredFriendChallenges();
        if (removed > 0) {
            console.log(`[Friend challenges] Removed ${removed} expired challenge(s).`);
        }
    } catch (err) {
        console.error('Friend challenge cleanup failed:', err);
    }
}

function startFriendChallengeCleanupScheduler() {
    cleanupExpiredFriendChallengesTick().catch((err) => {
        console.error('Initial friend challenge cleanup failed:', err);
    });
    setInterval(() => {
        cleanupExpiredFriendChallengesTick().catch((err) => {
            console.error('Friend challenge cleanup tick failed:', err);
        });
    }, FRIEND_CHALLENGE_CLEANUP_INTERVAL_MS);
    console.log(
        `[Friend challenges] TTL is ${FRIEND_CHALLENGE_EXPIRATION_HOURS}h; cleanup every ${Math.round(FRIEND_CHALLENGE_CLEANUP_INTERVAL_MS / 60000)} min.`,
    );
}

// ----------------------
// Admin Routes (Temporary for DB cleanup)
// ----------------------
app.post('/api/admin/users/role', requireAdminApiKey, asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const role = String(req.body?.role || '').trim().toLowerCase();

    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }
    if (!VALID_USER_ROLES.has(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    const updatedUser = await db.setUserRole(username, role);
    if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
        success: true,
        user: updatedUser,
    });
}));

app.post('/api/admin/users/password-reset-link', requireAdminApiKey, asyncHandler(async (req, res) => {
    const username = String(req.body?.username || '').trim();
    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);
    const user = await db.createPasswordResetToken(username, hashPasswordResetToken(token), expiresAt);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const resetUrl = new URL('/reset-password.html', PASSWORD_RESET_FRONTEND_URL);
    resetUrl.searchParams.set('token', token);
    return res.json({
        success: true,
        username: user.username,
        resetUrl: resetUrl.toString(),
        expiresAt: expiresAt.toISOString(),
    });
}));

app.post('/api/admin/push/send-daily-now', requireAdminApiKey, async (req, res) => {
    try {
        await ensurePushRuntimeReady();
        if (!pushRuntime.enabled) {
            return res.status(503).json({ error: 'Push notifications are not configured on server' });
        }

        const dateInput = String(req.body?.date || '').trim();
        const fallbackDate = getTimePartsInZone(new Date(), PUSH_REMINDER_TIMEZONE).dateStr;
        const targetDate = dateInput || fallbackDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
        }

        const result = await sendDailyReminderPushesForDate(targetDate);
        if (targetDate === fallbackDate && result.failed === 0) {
            reminderSchedulerStates[DAILY_REMINDER_KIND_AVAILABILITY].lastDateKey = targetDate;
            reminderSchedulerStates[DAILY_REMINDER_KIND_AVAILABILITY].retryNotBeforeMs = 0;
        }

        return res.json({
            success: true,
            date: targetDate,
            result,
            runtimeSource: pushRuntime.source,
        });
    } catch (err) {
        console.error('Admin push trigger error:', err);
        return res.status(500).json({ error: 'Failed to trigger push notifications' });
    }
});

app.post('/api/admin/clean-leaderboard', requireAdminApiKey, async (req, res) => {
    try {
        await db.clearAllScores();
        invalidateLeaderboardCaches();

        res.json({
            success: true,
            removed_scores: "all",
            message: 'Nettoyage terminé avec succès. Tous les scores ont été supprimés.'
        });
    } catch (err) {
        console.error('Erreur lors du nettoyage API:', err);
        res.status(500).json({ error: 'Erreur lors du nettoyage de la base.' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled route error:', err);
    if (res.headersSent) {
        return next(err);
    }
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
        return res.status(err.status).json({
            error: err.message || 'Invalid request',
            details: Array.isArray(err.errors) ? err.errors : undefined,
        });
    }
    return res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    initializeDatabase,
    startServer,
};
