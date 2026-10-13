"use strict";
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { httpError } = require("./content");
const permissions = [
  "read",
  "edit",
  "publish",
  "support",
  "quality",
  "balance",
  "events",
  "notify",
  "security",
  "operations",
  "backups",
];
let secret;
function configure(value) {
  secret = crypto.createHash("sha256").update(value).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
  return Buffer.concat([
    iv,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
function decrypt(value) {
  const data = Buffer.from(value, "base64"),
    cipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secret,
      data.subarray(0, 12),
    );
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    cipher.update(data.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
function base32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "",
    out = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5)
    out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function unbase32(value) {
  let bits = "";
  for (const c of value)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(value, counter) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", unbase32(value)).update(b).digest(),
    o = h.at(-1) & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function equal(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function verifyCode(client, userId, code, enrolling = false) {
  const row = (
    await client.query("SELECT * FROM admin_mfa WHERE user_id=$1 FOR UPDATE", [
      userId,
    ])
  ).rows[0];
  if (!row || (!enrolling && !row.enabled))
    throw httpError(403, "Double authentification non configurée.");
  const now = Math.floor(Date.now() / 30000),
    value = String(code || "").trim();
  for (const counter of [now - 1, now, now + 1])
    if (
      counter > Number(row.last_counter) &&
      equal(totp(decrypt(row.secret_encrypted), counter), value)
    ) {
      await client.query(
        "UPDATE admin_mfa SET last_counter=$2,enabled=TRUE,updated_at=NOW() WHERE user_id=$1",
        [userId, counter],
      );
      return;
    }
  if (!enrolling) {
    const match = row.recovery_hashes.find((h) => equal(h, hash(value)));
    if (match) {
      await client.query(
        "UPDATE admin_mfa SET recovery_hashes=$2::jsonb WHERE user_id=$1",
        [
          userId,
          JSON.stringify(row.recovery_hashes.filter((h) => h !== match)),
        ],
      );
      return;
    }
  }
  throw httpError(403, "Code incorrect ou déjà utilisé.");
}
async function allowed(pool, user, permission) {
  if (!permissions.includes(permission)) return false;
  const row = (
    await pool.query(
      "SELECT allowed FROM admin_permissions WHERE user_id=$1 AND permission=$2",
      [user.id, permission],
    )
  ).rows[0];
  return row
    ? row.allowed
    : user.role === "admin" ||
        (user.role === "editor" &&
          ["read", "edit", "publish", "quality"].includes(permission));
}
async function requireAccess(pool, user, permission, proof = "") {
  if (!(await allowed(pool, user, permission)))
    throw httpError(403, "Permission requise : " + permission);
  const row = (
    await pool.query("SELECT enabled FROM admin_mfa WHERE user_id=$1", [
      user.id,
    ])
  ).rows[0];
  if (row?.enabled) {
    try {
      const p = jwt.verify(proof, secret);
      if (
        p.purpose !== "admin-mfa" ||
        p.user !== user.id ||
        p.version !==
          Number(
            (
              await pool.query(
                "SELECT session_version FROM users WHERE id=$1",
                [user.id],
              )
            ).rows[0].session_version,
          )
      )
        throw Error();
    } catch {
      throw Object.assign(
        httpError(403, "Confirmez votre double authentification."),
        { code: "ADMIN_MFA_REQUIRED" },
      );
    }
  }
}
function proof(user, version) {
  return jwt.sign({ purpose: "admin-mfa", user, version }, secret, {
    expiresIn: "30m",
  });
}
function legacyPermission(path, method) {
  if (
    path.startsWith("/api/editor/studio/") ||
    path === "/api/editor/me" ||
    path === "/api/editor/confirm-action"
  )
    return null;
  if (path.startsWith("/api/explorer/admin"))
    return method === "GET" ? "read" : "publish";
  if (path.startsWith("/api/collect/v2/admin/"))
    return path.includes("/reports") ? "quality" : "security";
  if (!path.startsWith("/api/editor/")) return null;
  if (path.includes("/users")) return "support";
  if (path.includes("/osm-sync") || path.includes("/audit-log"))
    return "operations";
  if (method === "GET") return "read";
  if (path.includes("/rarity")) return "balance";
  if (path.includes("/reports/")) return "quality";
  return "publish";
}
module.exports = {
  permissions,
  configure,
  encrypt,
  decrypt,
  base32,
  totp,
  hash,
  equal,
  verifyCode,
  allowed,
  requireAccess,
  proof,
  legacyPermission,
};
