const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const adminScripts = ["admin/home.js", "admin/admin.js", "admin/users.js"];
const sessionTokenDeclaration =
  'const SESSION_TOKEN_STORAGE_KEY = "camino_paris_editor_token";';

test("all admin pages share the same tab-scoped authentication token", () => {
  for (const relativePath of adminScripts) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(source, new RegExp(sessionTokenDeclaration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(source, /sessionStorage\.getItem\(SESSION_TOKEN_STORAGE_KEY\)/);
  }

  const homeSource = fs.readFileSync(path.join(repositoryRoot, "admin/home.js"), "utf8");
  assert.match(homeSource, /sessionStorage\.setItem\(SESSION_TOKEN_STORAGE_KEY, state\.token\)/);
  assert.doesNotMatch(homeSource, /JSON\.stringify\(\{\s*token: state\.token/);
});
