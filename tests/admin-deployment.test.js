const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAdminDeployment } = require("../scripts/check_admin_deployment");

test("deployment checks require available pages and protected admin routes", async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url.pathname);
    return new Response("", { status: url.pathname.startsWith("/api/") ? 401 : 200 });
  };
  await checkAdminDeployment("https://example.test");
  assert.ok(requests.includes("/admin/visit-stats.js"));
  assert.ok(requests.includes("/api/editor/operations-tools/daily-calendar"));
  for (const status of [404, 200, 500]) {
    global.fetch = async (url) => new Response("", {
      status: url.pathname.startsWith("/api/") ? status : 200,
    });
    await assert.rejects(checkAdminDeployment("https://example.test"), /attendu 401/);
  }
});
