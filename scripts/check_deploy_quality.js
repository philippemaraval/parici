#!/usr/bin/env node
"use strict";
const REQUIRED = ["Code quality", "Performance budgets"];
const REPOSITORY = "philippemaraval/parici";
const WORKFLOW_FILES = {
  "Code quality": ".github/workflows/quality.yml",
  "Performance budgets": ".github/workflows/performance-budget.yml",
};
function publicQualityRuns(html) {
  const embedded = html.match(
    /<script\b[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/,
  );
  let runs;
  try {
    runs = JSON.parse(embedded?.[1]).payload.allWorkflowRunsRoute.workflowRuns;
  } catch {
    throw Error("Invalid public GitHub quality response: publication refused.");
  }
  if (!Array.isArray(runs))
    throw Error("Invalid public GitHub quality response: publication refused.");
  return runs.flatMap((run) => {
    const commit = run.description?.linkUrl?.match(
      /^\/philippemaraval\/parici\/commit\/([a-f0-9]{40})$/,
    )?.[1];
    if (
      !REQUIRED.includes(run.workflowName) ||
      run.workflowFilePath !== WORKFLOW_FILES[run.workflowName] ||
      !commit ||
      run.branch?.name !== "refs/heads/main" ||
      run.description?.action !== "pushed" ||
      !Number.isSafeInteger(run.runNumber) ||
      run.runNumber < 1 ||
      !/^\d+$/.test(run.id) ||
      run.runUrl !== `https://github.com/${REPOSITORY}/actions/runs/${run.id}`
    )
      return [];
    return [
      {
        name: run.workflowName,
        head_sha: commit,
        head_branch: "main",
        event: "push",
        run_number: run.runNumber,
        run_attempt: 1,
        status:
          run.state?.status === "WORKFLOW_RUN_STATUS_COMPLETED"
            ? "completed"
            : "in_progress",
        conclusion:
          run.state?.conclusion === "WORKFLOW_RUN_CONCLUSION_SUCCESS"
            ? "success"
            : "failure",
      },
    ];
  });
}
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
  let usePublicPage = false;
  while (now() < deadline) {
    let runs;
    if (!usePublicPage) {
      const response = await request(
        `https://api.github.com/repos/${REPOSITORY}/actions/runs?head_sha=${encodeURIComponent(commit)}&per_page=100`,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": "parici-deployment-quality",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok && [403, 429].includes(response.status)) {
        usePublicPage = true;
        console.log(
          `GitHub API HTTP ${response.status}; checking public GitHub workflow results instead.`,
        );
      } else if (!response.ok)
        throw Error(
          `GitHub quality verification HTTP ${response.status}: publication refused.`,
        );
      else {
        const data = await response.json();
        if (!Array.isArray(data.workflow_runs))
          throw Error("Invalid quality response: publication refused.");
        runs = data.workflow_runs;
      }
    }
    if (usePublicPage) {
      const response = await request(
        `https://github.com/${REPOSITORY}/actions?query=branch%3Amain`,
        {
          headers: {
            accept: "text/html",
            "cache-control": "no-cache",
            "user-agent": "parici-deployment-quality",
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        throw Error(
          `Public GitHub quality verification HTTP ${response.status}: publication refused. Configure GITHUB_TOKEN with Actions read access in the hosting environment.`,
        );
      runs = publicQualityRuns(await response.text());
    }
    if (qualityState(runs, commit)) {
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
  publicQualityRuns,
  hostedCommit,
  qualityState,
  waitForQuality,
  checkHostedBuild,
};
