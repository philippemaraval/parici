const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const dist = path.join(root, "dist");
const users = new Map();

const contentTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
};

function json(response, status, payload) {
  response.writeHead(status, {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "authorization, content-type, x-admin-key, x-request-id",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-origin": "http://127.0.0.1:4173",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(request, response) {
  if (request.method === "OPTIONS") {
    return json(response, 204, {});
  }

  const url = new URL(request.url, "http://127.0.0.1:3000");
  if (url.pathname === "/api/health") {
    return json(response, 200, { ok: true, database: "ready" });
  }
  if (url.pathname === "/api/register" && request.method === "POST") {
    const payload = await body(request);
    users.set(payload.username, payload);
    return json(response, 200, {
      id: users.size,
      username: payload.username,
      avatar: "👤",
      role: "player",
      token: "e2e-player-token",
    });
  }
  if (url.pathname === "/api/login" && request.method === "POST") {
    const payload = await body(request);
    const isAdmin = payload.username === "editor";
    return json(response, 200, {
      id: isAdmin ? 99 : 1,
      username: payload.username,
      avatar: "👤",
      role: isAdmin ? "admin" : "player",
      token: isAdmin ? "e2e-admin-token" : "e2e-player-token",
    });
  }
  if (url.pathname === "/api/editor/me") {
    return json(response, 200, {
      id: 99,
      username: "editor",
      role: "admin",
      canEdit: true,
      canManageUsers: true,
    });
  }
  if (url.pathname === "/api/profile") {
    return json(response, 200, {
      id: 1,
      username: "JoueurE2E",
      avatar: "👤",
      role: "player",
      scores: [],
      stats: {},
    });
  }
  if (url.pathname === "/api/leaderboards") {
    return json(response, 200, {});
  }
  if (url.pathname === "/api/visitors/count") {
    return json(response, 200, { count: 42 });
  }
  if (url.pathname === "/api/notifications/public-key") {
    return json(response, 200, { enabled: false, publicKey: null });
  }
  return json(response, 200, { success: true });
}

function safeStaticPath(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1:4173");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";
  const candidate = path.resolve(dist, `.${pathname}`);
  return candidate.startsWith(`${dist}${path.sep}`) ? candidate : null;
}

function handleStatic(request, response) {
  const url = new URL(request.url, "http://127.0.0.1:4173");
  if (url.pathname === "/__health") {
    return json(response, 200, { ok: true });
  }

  if (/\/assets\/map-dependencies\.[a-f0-9]+\.js$/.test(url.pathname)) {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
    });
    return response.end(
      "window.CaminoNeedsMapRuntime=false;window.CaminoMapDependencies=Promise.resolve(false);",
    );
  }

  const filePath = safeStaticPath(request.url);
  if (
    !filePath ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    response.writeHead(404);
    return response.end("Not found");
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type":
      contentTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
  });
  return fs.createReadStream(filePath).pipe(response);
}

const staticServer = http.createServer(handleStatic);
const apiServer = http.createServer((request, response) => {
  handleApi(request, response).catch((error) => {
    console.error(error);
    json(response, 500, { error: "fixture failure" });
  });
});

staticServer.listen(4173, "127.0.0.1");
apiServer.listen(3000, "127.0.0.1");

function shutdown() {
  staticServer.close();
  apiServer.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
