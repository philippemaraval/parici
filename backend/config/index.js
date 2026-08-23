"use strict";

function integerInRange(name, fallback, min, max) {
  const raw = Number.parseInt(process.env[name], 10);
  return Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
}

function firstDefined(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function csvSet(name) {
  return new Set(
    String(process.env[name] || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

const config = Object.freeze({
  port: integerInRange("PORT", 3000, 1, 65535),
  isProduction: process.env.NODE_ENV === "production",
  jwtSecret: process.env.SECRET_KEY || "",
  admin: Object.freeze({
    enabled: process.env.ENABLE_ADMIN_ROUTES === "true",
    apiKey: process.env.ADMIN_API_KEY || "",
    editorUsernames: csvSet("EDITOR_USERNAMES"),
  }),
  urls: Object.freeze({
    frontend: firstDefined(
      ["PASSWORD_RESET_FRONTEND_URL", "FRONTEND_URL"],
      "https://parici.netlify.app",
    ),
  }),
});

module.exports = {
  config,
  readEnvCsvSet: csvSet,
  readEnvIntegerInRange: integerInRange,
  readFirstDefinedEnv: firstDefined,
};
