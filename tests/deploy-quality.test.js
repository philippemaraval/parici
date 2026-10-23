const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  hostedCommit,
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
      request: async () => ({ ok: false, status: 403 }),
    }),
    /HTTP 403/,
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
