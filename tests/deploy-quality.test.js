const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  hostedCommit,
  publicQualityRuns,
  qualityState,
  waitForQuality,
} = require("../scripts/check_deploy_quality");
const sha = "a".repeat(40);
const run = (name, extra = {}) => ({
  name,
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  run_number: 1,
  run_attempt: 1,
  ...extra,
});
test("hosted Render and Cloudflare builds require the exact commit; local and CI validation can build", () => {
  assert.equal(hostedCommit({ RENDER: "true", RENDER_GIT_COMMIT: sha }), sha);
  assert.equal(hostedCommit({ CF_PAGES: "1", CF_PAGES_COMMIT_SHA: sha }), sha);
  assert.equal(hostedCommit({ GITHUB_ACTIONS: "true", RENDER: "true" }), null);
  assert.equal(hostedCommit({}), null);
  assert.throws(() => hostedCommit({ CF_PAGES: "1" }), /refused/);
});
test("only successful quality and performance runs from this main commit permit publication", () => {
  const good = [run("Code quality"), run("Performance budgets")];
  assert.equal(qualityState(good, sha), true);
  for (const extra of [
    { head_sha: "b".repeat(40) },
    { head_branch: "branch" },
    { event: "pull_request" },
    { status: "in_progress" },
  ])
    assert.equal(
      qualityState([run("Code quality", extra), good[1]], sha),
      false,
    );
  assert.equal(qualityState([], sha), false);
  assert.throws(
    () =>
      qualityState(
        [run("Code quality", { conclusion: "failure" }), good[1]],
        sha,
      ),
    /refused/,
  );
  assert.throws(
    () =>
      qualityState(
        [
          ...good,
          run("Code quality", { conclusion: "failure", run_number: 2 }),
        ],
        sha,
      ),
    /refused/,
  );
  assert.equal(
    qualityState(
      [...good, run("Code quality", { conclusion: "failure", run_attempt: 0 })],
      sha,
    ),
    true,
  );
});
test("pending checks are awaited, but API errors and deadline fail closed", async () => {
  let requests = 0,
    time = 0;
  const result = await waitForQuality({
    commit: sha,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    request: async () => ({
      ok: true,
      json: async () => ({
        workflow_runs:
          ++requests === 1
            ? []
            : [run("Code quality"), run("Performance budgets")],
      }),
    }),
  });
  assert.equal(result, undefined);
  assert.equal(requests, 2);
  await assert.rejects(
    waitForQuality({
      commit: sha,
      request: async () => ({ ok: false, status: 401 }),
    }),
    /HTTP 401/,
  );
  await assert.rejects(
    waitForQuality({
      commit: sha,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 1,
      request: async () => ({
        ok: true,
        json: async () => ({ workflow_runs: [] }),
      }),
    }),
    /timed out/,
  );
});

// Fields returned by GitHub's public Actions page, not text from run titles.
const publicRun = (name, extra = {}) => ({
  workflowName: name,
  workflowFilePath:
    name === "Code quality"
      ? ".github/workflows/quality.yml"
      : ".github/workflows/performance-budget.yml",
  id: "123",
  runUrl: "https://github.com/philippemaraval/parici/actions/runs/123",
  runNumber: 2,
  branch: { name: "refs/heads/main" },
  description: {
    linkUrl: `/philippemaraval/parici/commit/${sha}`,
    action: "pushed",
  },
  state: {
    status: "WORKFLOW_RUN_STATUS_COMPLETED",
    conclusion: "WORKFLOW_RUN_CONCLUSION_SUCCESS",
  },
  ...extra,
});
const publicPage = (runs) =>
  `<html><script type="application/json" data-target="react-partial.embeddedData">{}</script><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: { allWorkflowRunsRoute: { workflowRuns: runs } } })}</script></html>`;
const publicGood = () => [
  publicRun("Code quality"),
  publicRun("Performance budgets"),
];

test("public GitHub results retain exact commit, workflow, branch and event checks", () => {
  assert.equal(
    qualityState(publicQualityRuns(publicPage(publicGood())), sha),
    true,
  );
  for (const extra of [
    {
      description: {
        linkUrl: `/philippemaraval/parici/commit/${"b".repeat(40)}`,
        action: "pushed",
      },
    },
    { description: { linkUrl: `/other/repo/commit/${sha}`, action: "pushed" } },
    {
      description: {
        linkUrl: `/philippemaraval/parici/commit/${sha}`,
        action: "pull_request",
      },
    },
    { branch: { name: "refs/heads/other" } },
    { workflowFilePath: ".github/workflows/untrusted.yml" },
    { runUrl: "https://example.com/actions/runs/123" },
    { runNumber: null },
    { state: { status: "WORKFLOW_RUN_STATUS_IN_PROGRESS" } },
    { state: {} },
  ]) {
    const runs = publicQualityRuns(
      publicPage([publicRun("Code quality", extra), publicGood()[1]]),
    );
    assert.equal(qualityState(runs, sha), false);
  }
  for (const conclusion of [
    "FAILURE",
    "CANCELLED",
    "SKIPPED",
    "TIMED_OUT",
    "NEUTRAL",
    undefined,
  ]) {
    const runs = publicQualityRuns(
      publicPage([
        ...publicGood(),
        publicRun("Code quality", {
          runNumber: 3,
          state: {
            status: "WORKFLOW_RUN_STATUS_COMPLETED",
            conclusion: conclusion && `WORKFLOW_RUN_CONCLUSION_${conclusion}`,
          },
        }),
      ]),
    );
    assert.throws(() => qualityState(runs, sha), /publication refused/);
  }
  for (const html of [
    "<html>Login required</html>",
    publicPage(null),
    '<script data-target="react-app.embeddedData">invalid</script>',
  ])
    assert.throws(() => publicQualityRuns(html), /Invalid public GitHub/);
});

test("API 403 and 429 switch to public results without leaking credentials or retrying the limited API", async () => {
  for (const status of [403, 429]) {
    let apiCalls = 0,
      publicCalls = 0,
      time = 0;
    await waitForQuality({
      commit: sha,
      token: "private-api-token",
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      request: async (url, options) => {
        if (url.startsWith("https://api.github.com/")) {
          apiCalls++;
          assert.equal(
            options.headers.authorization,
            "Bearer private-api-token",
          );
          return { ok: false, status };
        }
        assert.equal(new URL(url).origin, "https://github.com");
        assert.equal(options.headers.authorization, undefined);
        publicCalls++;
        return {
          ok: true,
          text: async () => publicPage(publicCalls === 1 ? [] : publicGood()),
        };
      },
    });
    assert.equal(apiCalls, 1);
    assert.equal(publicCalls, 2);
    assert.equal(time, 60000);
  }
});

test("public fallback never authorizes failed, unrelated, inaccessible or invalid checks", async () => {
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, text: async () => "<html>Unavailable</html>" },
    {
      ok: true,
      text: async () =>
        publicPage(
          publicGood().map((run) => ({
            ...run,
            description: {
              ...run.description,
              linkUrl: `/philippemaraval/parici/commit/${"b".repeat(40)}`,
            },
          })),
        ),
    },
    {
      ok: true,
      text: async () =>
        publicPage([
          publicGood()[1],
          publicRun("Code quality", {
            state: {
              status: "WORKFLOW_RUN_STATUS_COMPLETED",
              conclusion: "WORKFLOW_RUN_CONCLUSION_FAILURE",
            },
          }),
        ]),
    },
  ]) {
    let time = 0;
    await assert.rejects(
      waitForQuality({
        commit: sha,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        timeoutMs: 1,
        request: async (url) =>
          url.startsWith("https://api.github.com/")
            ? { ok: false, status: 403 }
            : response,
      }),
      /refused/,
    );
  }
});
