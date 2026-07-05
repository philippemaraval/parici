const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin/admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const database = fs.readFileSync(path.join(root, "backend/database.js"), "utf8");

test("all editor routes require an authenticated administrator", () => {
  const editorRoutes = server.match(
    /app\.(?:get|post|put|delete)\('\/api\/editor\/[^;]+/g,
  ) || [];
  const protectedRoutes = editorRoutes.filter((route) => route.includes("/api/editor/me"));
  const adminRoutes = editorRoutes.filter((route) => !route.includes("/api/editor/me"));
  assert.equal(protectedRoutes.length, 1);
  assert.ok(adminRoutes.length >= 10);
  adminRoutes.forEach((route) => {
    assert.match(route, /authenticateToken, requireAdminUser/);
  });
});

test("admin UI rejects non-admin accounts and exposes user management", () => {
  assert.match(adminJs, /if \(!me\?\.canManageUsers\)/);
  assert.match(adminHtml, /href="\/admin\/users\.html">Gérer les utilisateurs</);
  assert.doesNotMatch(adminHtml, /id="manage-users-link"[^>]*\bhidden\b/);
});

test("database bootstrap restores MPhil as administrator", () => {
  assert.match(database, /20260705_restore_mphil_admin\.sql/);
  const migration = fs.readFileSync(
    path.join(root, "migrations/20260705_restore_mphil_admin.sql"),
    "utf8",
  );
  assert.match(migration, /SET role = 'admin'/);
  assert.match(migration, /LOWER\(TRIM\(username\)\) = 'mphil'/);
});
