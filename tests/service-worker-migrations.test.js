const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("le service worker migre plusieurs générations de caches sans toucher aux autres", async () => {
  const handlers = new Map();
  const deleted = [];
  const navigated = [];
  const windowClients = [
    {
      url: "https://camino.test/?view=camino",
      navigate: (url) => {
        navigated.push(url);
        return new Promise(() => {});
      },
    },
  ];
  const context = {
    AbortController,
    Promise,
    URL,
    clearTimeout,
    console,
    fetch: async () => {
      throw new Error("network disabled in migration test");
    },
    setTimeout,
    clients: {
      claim: async () => undefined,
      matchAll: async () => windowClients,
    },
    caches: {
      delete: async (key) => {
        deleted.push(key);
        return true;
      },
      keys: async () => [
        "camino-paris-v12",
        "camino-paris-v19",
        "camino-paris-v20",
        "camino-v68-performance",
        "unrelated-application-cache",
      ],
      match: async () => undefined,
      open: async () => ({
        add: async () => undefined,
        match: async () => undefined,
        put: async () => undefined,
      }),
    },
    self: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      clients: null,
      location: { origin: "https://camino.test" },
      registration: {
        active: { scriptURL: "https://camino.test/sw.js?previous" },
        showNotification: async () => undefined,
      },
      skipWaiting: async () => undefined,
    },
  };
  context.self.clients = context.clients;

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "sw.js"), "utf8"),
    context,
    { filename: "sw.js" },
  );

  const activate = handlers.get("activate");
  assert.equal(typeof activate, "function");
  let activation;
  activate({
    waitUntil(promise) {
      activation = promise;
    },
  });
  await activation;

  assert.deepEqual(deleted.sort(), [
    "camino-paris-v12",
    "camino-paris-v19",
    "camino-paris-v20",
  ]);
  assert.equal(deleted.includes("unrelated-application-cache"), false);
  assert.deepEqual(navigated, ["https://camino.test/?view=camino"]);

  const freshHandlers = new Map();
  const freshClients = {
    claim: async () => undefined,
    matchAll: async () => {
      throw new Error("a first installation must not reload window clients");
    },
  };
  const freshContext = {
    ...context,
    clients: freshClients,
    self: {
      ...context.self,
      addEventListener: (type, handler) => freshHandlers.set(type, handler),
      clients: freshClients,
      registration: {
        active: null,
        showNotification: async () => undefined,
      },
    },
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "sw.js"), "utf8"),
    freshContext,
    { filename: "sw.js" },
  );

  let firstActivation;
  freshHandlers.get("activate")({
    waitUntil(promise) {
      firstActivation = promise;
    },
  });
  await firstActivation;
});

test("le bootstrap de base garde un marqueur versionné pour les migrations anciennes", () => {
  const database = fs.readFileSync(
    path.join(root, "backend", "database.js"),
    "utf8",
  );

  assert.match(
    database,
    /SCHEMA_BOOTSTRAP_VERSION\s*=\s*'\d{4}-\d{2}-\d{2}[^']+'/,
  );
  assert.match(database, /hasCurrentSchemaBootstrap/);
  assert.match(database, /markSchemaBootstrapComplete/);
  assert.match(database, /pg_advisory_lock/);
  assert.match(database, /pg_advisory_unlock/);
});
