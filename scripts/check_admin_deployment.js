"use strict";

const routes = [
  ["/admin/operations.html", 200],
  ["/admin/visit-stats.js", 200],
  ["/admin/studio.html", 200],
  ["/admin/admin-fetch.js", 200],
  ["/api/editor/studio/tasks", 401],
  ["/api/editor/operations-tools/operations", 401],
  ["/api/editor/operations-tools/revisions", 401],
  ["/api/editor/operations-tools/daily-calendar", 401],
  ["/api/editor/operations-tools/audit-log", 401],
];

async function checkAdminDeployment(
  origin,
  expectedCommit,
  frontendOrigin = origin,
) {
  const [backend, frontend] = await Promise.all(
    ["/api/health", "/admin/build-info.json"].map(async (route) => {
      const response = await fetch(
        new URL(route, route.startsWith("/api/") ? origin : frontendOrigin),
        {
          signal: AbortSignal.timeout(20000),
          headers: { "Cache-Control": "no-cache" },
        },
      );
      if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
      return response.json();
    }),
  );
  const backendCommit = backend.backendCommit || backend.release;
  if (
    !backend.ok ||
    backend.database !== "ready" ||
    !backendCommit ||
    !frontend.commit ||
    backendCommit !== frontend.commit ||
    (expectedCommit && backendCommit !== expectedCommit)
  )
    throw new Error(
      "Versions frontend/backend incohérentes ou commit attendu non livré",
    );
  for (const [route, expected] of routes) {
    const response = await fetch(
      new URL(route, route.startsWith("/api/") ? origin : frontendOrigin),
      {
        signal: AbortSignal.timeout(20000),
        headers: { "Cache-Control": "no-cache" },
      },
    );
    await response.body?.cancel();
    if (response.status !== expected)
      throw new Error(`${route}: HTTP ${response.status}, attendu ${expected}`);
  }
}

async function waitForAdminDeployment(
  origin,
  timeoutMs = 15 * 60 * 1000,
  expectedCommit = process.env.DEPLOY_COMMIT,
  frontendOrigin = process.env.PRODUCTION_FRONTEND_URL || origin,
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await checkAdminDeployment(origin, expectedCommit, frontendOrigin);
      console.log(
        "Administration déployée : pages disponibles et API protégées.",
      );
      return;
    } catch (error) {
      lastError = error;
      console.log(`En attente de Render : ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw lastError || new Error("Déploiement admin non confirmé");
}

if (require.main === module) {
  waitForAdminDeployment(
    process.env.ADMIN_DEPLOY_ORIGIN || "https://parici.onrender.com",
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { checkAdminDeployment, waitForAdminDeployment };
