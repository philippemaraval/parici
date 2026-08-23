#!/usr/bin/env node

"use strict";

const API_ORIGIN = "https://api.render.com/v1";
const SUCCESS_STATUS = "live";
const FAILURE_STATUSES = new Set([
  "build_failed",
  "canceled",
  "deactivated",
  "update_failed",
]);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function unwrapDeploy(entry) {
  return entry?.deploy || entry;
}

function selectPreviousLiveDeploy(entries, excludedDeployId = "") {
  return entries
    .map(unwrapDeploy)
    .find(
      (deploy) =>
        deploy?.id &&
        deploy.id !== excludedDeployId &&
        deploy.status === SUCCESS_STATUS,
    );
}

async function fetchJson(url, { token, ...options } = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Render API ${response.status}: ${payload.message || payload.error || response.statusText}`,
    );
  }
  return payload;
}

async function waitForDeploy({
  apiKey,
  deployId,
  serviceId,
  timeoutMs = 20 * 60 * 1000,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deploy = unwrapDeploy(
      await fetchJson(
        `${API_ORIGIN}/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
        { token: apiKey },
      ),
    );
    console.log(`Render deploy ${deployId}: ${deploy.status || "unknown"}`);
    if (deploy.status === SUCCESS_STATUS) return deploy;
    if (FAILURE_STATUSES.has(deploy.status)) {
      throw new Error(`Deploy ${deployId} ended with ${deploy.status}`);
    }
    await delay(10_000);
  }
  throw new Error(`Deploy ${deployId} did not become live before timeout`);
}

async function assertHealthy(healthcheckUrl, attempts = 12) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(healthcheckUrl, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (
        response.ok &&
        payload.ok === true &&
        (!payload.database || payload.database === "ready")
      ) {
        return payload;
      }
      lastError = new Error(
        `healthcheck ${response.status}: ${JSON.stringify(payload)}`,
      );
    } catch (error) {
      lastError = error;
    }
    await delay(5_000);
  }
  throw lastError || new Error("Healthcheck failed");
}

async function rollback({ apiKey, deployId, serviceId }) {
  console.error(`Rolling back ${serviceId} to ${deployId}.`);
  return fetchJson(
    `${API_ORIGIN}/services/${encodeURIComponent(serviceId)}/rollback`,
    {
      token: apiKey,
      method: "POST",
      body: JSON.stringify({ deployId }),
    },
  );
}

async function deployWithRollback({
  apiKey,
  commitId,
  healthcheckUrl,
  serviceId,
}) {
  if (!apiKey || !commitId || !healthcheckUrl || !serviceId) {
    throw new Error(
      "RENDER_API_KEY, RENDER_SERVICE_ID, DEPLOY_COMMIT and HEALTHCHECK_URL are required",
    );
  }

  const recentEntries = await fetchJson(
    `${API_ORIGIN}/services/${encodeURIComponent(serviceId)}/deploys?limit=20`,
    { token: apiKey },
  );
  const previous = selectPreviousLiveDeploy(recentEntries);
  if (!previous) {
    throw new Error("No previous live deploy is available for rollback");
  }

  const created = unwrapDeploy(
    await fetchJson(
      `${API_ORIGIN}/services/${encodeURIComponent(serviceId)}/deploys`,
      {
        token: apiKey,
        method: "POST",
        body: JSON.stringify({
          clearCache: "do_not_clear",
          commitId,
        }),
      },
    ),
  );
  if (!created?.id) {
    throw new Error("Render did not return a deploy id");
  }

  try {
    await waitForDeploy({
      apiKey,
      deployId: created.id,
      serviceId,
    });
    await assertHealthy(healthcheckUrl);
    console.log(`✓ ${serviceId} is live and healthy on ${commitId}.`);
    return created;
  } catch (error) {
    await rollback({
      apiKey,
      deployId: previous.id,
      serviceId,
    });
    throw new Error(
      `${error.message}; rollback triggered to deploy ${previous.id}`,
    );
  }
}

if (require.main === module) {
  deployWithRollback({
    apiKey: process.env.RENDER_API_KEY,
    commitId: process.env.DEPLOY_COMMIT,
    healthcheckUrl: process.env.HEALTHCHECK_URL,
    serviceId: process.env.RENDER_SERVICE_ID,
  }).catch((error) => {
    console.error(`Delivery failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertHealthy,
  deployWithRollback,
  selectPreviousLiveDeploy,
  unwrapDeploy,
};
