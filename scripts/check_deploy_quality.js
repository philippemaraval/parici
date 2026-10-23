#!/usr/bin/env node
"use strict";
const REQUIRED = ["Code quality", "Performance budgets"];
function hostedCommit(env = process.env) {
  if (env.GITHUB_ACTIONS === "true") return null;
  if (env.CF_PAGES !== "1" && env.RENDER !== "true") return null;
  const commit =
    env.CF_PAGES === "1" ? env.CF_PAGES_COMMIT_SHA : env.RENDER_GIT_COMMIT;
  if (!/^[a-f0-9]{40}$/i.test(commit || ""))
    throw Error("Missing hosted build commit: publication refused.");
  return commit;
}
function qualityState(runs, commit) {
  const selected = REQUIRED.map(
    (name) =>
      runs
        .filter(
          (run) =>
            run.name === name &&
            run.head_sha === commit &&
            run.head_branch === "main" &&
            ["push", "workflow_dispatch"].includes(run.event),
        )
        .sort(
          (a, b) =>
            b.run_number - a.run_number || b.run_attempt - a.run_attempt,
        )[0],
  );
  for (const run of selected) {
    if (run?.status === "completed" && run.conclusion !== "success")
      throw Error(`${run.name} failed for ${commit}: publication refused.`);
  }
  return selected.every(
    (run) => run?.status === "completed" && run.conclusion === "success",
  );
}
async function waitForQuality({
  commit,
  request = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 15 * 60_000,
  token = process.env.GITHUB_TOKEN || "",
}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const response = await request(
      `https://api.github.com/repos/philippemaraval/parici/actions/runs?head_sha=${encodeURIComponent(commit)}&per_page=100`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "parici-deployment-quality",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok)
      throw Error(
        `GitHub quality verification HTTP ${response.status}: publication refused.`,
      );
    const data = await response.json();
    if (!Array.isArray(data.workflow_runs))
      throw Error("Invalid quality response: publication refused.");
    if (qualityState(data.workflow_runs, commit)) {
      console.log(`Quality and performance validated for ${commit}.`);
      return;
    }
    console.log(`Waiting for quality and performance of ${commit}.`);
    await sleep(60_000);
  }
  throw Error("Quality verification timed out: publication refused.");
}
async function checkHostedBuild(env = process.env) {
  const commit = hostedCommit(env);
  if (commit) await waitForQuality({ commit });
}
if (require.main === module)
  checkHostedBuild().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  hostedCommit,
  qualityState,
  waitForQuality,
  checkHostedBuild,
};
