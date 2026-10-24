#!/usr/bin/env node
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
// Render's single-variable endpoint preserves all unrelated environment values.
async function metricsToken({
  apiKey,
  serviceId,
  create = false,
  transport = fetch,
}) {
  if (!apiKey || !serviceId)
    throw Error("Render credentials are required for the metrics token");
  const url = `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/env-vars/METRICS_TOKEN`;
  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
  const response = await transport(url, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (response.ok) {
    const payload = await response.json();
    const value = payload.value ?? payload.envVar?.value;
    if (typeof value === "string" && value.trim()) return value;
    throw Error("Render returned an empty metrics token");
  }
  if (response.status !== 404)
    throw Error(
      "Render metrics configuration returned HTTP " + response.status,
    );
  if (!create)
    throw Error(
      "METRICS_TOKEN is not configured on Render; run delivery first",
    );
  const value = crypto.randomBytes(32).toString("hex");
  const saved = await transport(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ value }),
    signal: AbortSignal.timeout(30000),
  });
  if (!saved.ok)
    throw Error("Render metrics configuration returned HTTP " + saved.status);
  return value;
}
async function main() {
  const value = await metricsToken({
    apiKey: process.env.RENDER_API_KEY,
    serviceId: process.env.RENDER_SERVICE_ID,
    create: process.argv.includes("--ensure"),
  });
  if (process.argv.includes("--load")) {
    if (!process.env.GITHUB_ENV) throw Error("GITHUB_ENV is required");
    // Never emit a token to normal logs or shell command interpolation.
    if (/[\r\n]/.test(value))
      throw Error("Metrics token must be a single line");
    process.stdout.write(`::add-mask::${value}\n`);
    fs.appendFileSync(process.env.GITHUB_ENV, `METRICS_TOKEN=${value}\n`);
  }
  console.log("Protected metrics token is configured.");
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { metricsToken };
