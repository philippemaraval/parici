const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("leaderboards never interpolate usernames or avatars into HTML", () => {
  const leaderboard = read("src/leaderboard.js");
  const app = read("src/app.js");

  assert.match(leaderboard, /avatarElement\.textContent/);
  assert.match(leaderboard, /document\.createTextNode\(String\(username/);
  assert.doesNotMatch(
    leaderboard,
    /innerHTML\s*=.*\$\{(?:row\.)?(?:username|avatar)/,
  );
  assert.doesNotMatch(
    app,
    /innerHTML\s*=.*\$\{(?:row\?*\.)?(?:username|avatar)/,
  );
});

test("registration and avatar updates are validated on the server", () => {
  const server = read("backend/server.js");
  const profileController = read("backend/domains/profiles/controller.js");

  assert.match(
    server,
    /USERNAME_PATTERN\s*=\s*\/\^\[\\p\{L\}\\p\{N\}\._-\]\{3,30\}\$\/u/,
  );
  assert.match(server, /RESERVED_USERNAMES/);
  assert.match(server, /validateUsername\(req\.body\?\.username\)/);
  assert.match(server, /allowedAvatars: ALLOWED_AVATARS/);
  assert.match(profileController, /allowedAvatars\.has\(avatar\)/);
});

test("sessions use HttpOnly cookies and revocation versions", () => {
  const server = read("backend/server.js");
  const database = read("backend/database.js");
  const auth = read("src/auth.js");

  assert.match(server, /SESSION_COOKIE_NAME\s*=\s*'camino_session'/);
  assert.match(server, /'HttpOnly'/);
  assert.match(server, /'SameSite=None'/);
  assert.match(server, /AUTH_SESSION_REVOKED/);
  assert.match(database, /session_version INTEGER NOT NULL DEFAULT 1/);
  assert.match(
    database,
    /session_version = COALESCE\(session_version, 1\) \+ 1/,
  );
  assert.match(
    auth,
    /window\.localStorage\.setItem\(PERSISTENT_TOKEN_STORAGE_KEY, token\)/,
  );
  assert.match(
    auth,
    /window\.sessionStorage\.setItem\(SESSION_TOKEN_STORAGE_KEY, token\)/,
  );
  assert.match(
    auth,
    /window\.localStorage\.removeItem\(PERSISTENT_TOKEN_STORAGE_KEY\)/,
  );
  assert.doesNotMatch(
    auth,
    /localStorage\.setItem\(USER_STORAGE_KEY,\s*JSON\.stringify\(user\)\)/,
  );
});

test("mobile webapps restore the persistent token after being reopened", () => {
  const auth = read("src/auth.js");

  assert.match(
    auth,
    /window\.localStorage\.getItem\(PERSISTENT_TOKEN_STORAGE_KEY\)\s*\|\|\s*window\.sessionStorage/,
  );
  assert.match(auth, /PERSISTENT_TOKEN_STORAGE_KEY = "camino_auth_token"/);
});

test("CORS, analytics, rate limiting, auditing and headers are hardened", () => {
  const server = read("backend/server.js");
  const database = read("backend/database.js");
  const headers = read("_headers");
  const render = read("render.yaml");

  assert.doesNotMatch(server, /dynamicAllowedOriginPatterns/);
  assert.match(server, /'https:\/\/parici-ajm\.pages\.dev'/);
  assert.match(render, /FRONTEND_URL\s+value: https:\/\/parici-ajm\.pages\.dev/);
  assert.match(
    server,
    /app\.get\('\/api\/analytics', authenticateToken, requireContentEditor/,
  );
  assert.match(database, /CREATE TABLE IF NOT EXISTS api_rate_limits/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS security_audit_logs/);
  assert.match(server, /app\.disable\('x-powered-by'\)/);
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Strict-Transport-Security:/);
  assert.match(headers, /Permissions-Policy:/);
  assert.match(headers, /frame-ancestors 'none'/);
});
