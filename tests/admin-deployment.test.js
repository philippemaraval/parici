const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAdminDeployment } = require("../scripts/check_admin_deployment");

test("deployment checks require available pages and protected admin routes", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url.pathname);
    if (url.pathname === "/api/health")
      return Response.json({
        ok: true,
        database: "ready",
        backendCommit: "expected",
      });
    if (url.pathname === "/admin/build-info.json")
      return Response.json({ commit: "expected" });
    return new Response("", {
      status: url.pathname.startsWith("/api/") ? 401 : 200,
    });
  };
  await checkAdminDeployment("https://example.test", "expected");
  assert.ok(requests.includes("/admin/visit-stats.js"));
  assert.ok(requests.includes("/api/editor/operations-tools/daily-calendar"));
  for (const status of [404, 200, 500]) {
    global.fetch = async (url) => {
      if (url.pathname === "/api/health")
        return Response.json({
          ok: true,
          database: "ready",
          backendCommit: "expected",
        });
      if (url.pathname === "/admin/build-info.json")
        return Response.json({ commit: "expected" });
      return new Response("", {
        status: url.pathname.startsWith("/api/") ? status : 200,
      });
    };
    await assert.rejects(
      checkAdminDeployment("https://example.test"),
      /attendu 401/,
    );
  }
});

test("delivery rejects successful HTTP responses serving the wrong frontend commit", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = async (url) =>
    Response.json(
      url.pathname === "/api/health"
        ? { ok: true, database: "ready", backendCommit: "expected" }
        : { commit: "old" },
    );
  await assert.rejects(
    checkAdminDeployment("https://example.test", "expected"),
    /Versions/,
  );
  global.fetch = async (url) =>
    Response.json(
      url.pathname === "/api/health"
        ? { ok: true, database: "ready", backendCommit: "old" }
        : { commit: "old" },
    );
  await assert.rejects(
    checkAdminDeployment("https://example.test", "expected"),
    /Versions/,
  );
});
