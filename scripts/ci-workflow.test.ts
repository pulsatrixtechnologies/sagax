import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const requiredRuntimeJobs = ["vitest", "behavior-evals", "packaged-server", "windows-cua", "electron-smokes", "voice-acceptance"];

function runGate(needs: Record<string, unknown>) {
  // Execute the actual gate, not a duplicate of its success/failure logic.
  const command = workflow.jobs.gate.steps[0].run as string;
  const script = command.match(/node --input-type=module -e '([\s\S]+)'/);
  expect(script).not.toBeNull();
  const check = spawnSync(process.execPath, ["--input-type=module", "-e", script![1]], {
    env: { ...process.env, NEEDS: JSON.stringify(needs) },
    encoding: "utf8",
    timeout: 5_000,
  });
  expect(check.error).toBeUndefined();
  return check;
}

function gateNeeds(runtime: string) {
  return {
    static: { result: "success", outputs: { runtime } },
    ...Object.fromEntries(requiredRuntimeJobs.map((job) => [job, { result: runtime === "true" ? "success" : "skipped" }])),
  };
}

describe("CI concurrency", () => {
  it("runs once, on the release candidate: dispatch only, never on a PR, push or merge queue (JC 2026-10-14)", () => {
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on).not.toHaveProperty("push");
    expect(workflow.on).not.toHaveProperty("pull_request");
    expect(workflow.on).not.toHaveProperty("merge_group");
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it("keeps main to one running and one waiting run, apart from PR and merge-queue groups", () => {
    // One group for every main push: GitHub keeps the running run and only
    // the newest waiting one, so a burst of merges cannot pile up full runs.
    expect(workflow.concurrency.group).toBe(
      "ci-${{ github.event_name == 'merge_group' && github.event.merge_group.head_ref || github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.ref }}",
    );
  });

  it("stops a closed PR's run by joining ci.yml's PR group", () => {
    const stop = parse(readFileSync(new URL("../.github/workflows/ci-stop-closed.yml", import.meta.url), "utf8"));
    expect(stop.on).toEqual({ pull_request: { types: ["closed"] } });
    expect(stop.concurrency).toEqual({ group: "ci-pr-${{ github.event.pull_request.number }}", "cancel-in-progress": true });
    // For pull_request events ci.yml's group expression reduces to pr-<number>.
    expect(workflow.concurrency.group).toContain("github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number)");
  });

  it("never lets a merged PR's stop run join main's group", () => {
    // A merged PR's closed event reports the base branch as github.ref, so any
    // ref-named group here cancelled main's CI on every merge (Oct 3 2026).
    const stop = parse(readFileSync(new URL("../.github/workflows/ci-stop-closed.yml", import.meta.url), "utf8"));
    expect(stop.concurrency.group).not.toContain("github.ref");
    expect(stop.concurrency.group).toContain("github.event.pull_request.number");
    expect(stop.permissions).toEqual({});
  });

  it("allows cancelled summary jobs to stop without skipping failure reporting", () => {
    expect(workflow.jobs.gate.if).toBe("${{ !cancelled() }}");
    expect(workflow.jobs.gate.needs).toEqual(["static", ...requiredRuntimeJobs]);
  });

  it("schedules one read-only final gate over the selected platform matrix", () => {
    expect(workflow.jobs.gate.name).toBe("CI");
    expect(workflow.jobs.gate.strategy).toBeUndefined();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.vitest.strategy.matrix).toEqual({
      os: "${{ fromJSON(needs.static.outputs.vitest_os) }}", shard: [1, 2, 3, 4],
    });
    expect(workflow.jobs.vitest["timeout-minutes"]).toBe("${{ matrix.os == 'ubuntu-latest' && 30 || 45 }}");
  });

  it("keeps each PR to one macOS job unless native code changed", () => {
    const macosJobs = Object.entries(workflow.jobs as Record<string, { "runs-on": string; strategy?: { matrix?: { os?: unknown } } }>)
      .filter(([, job]) => job["runs-on"] === "macos-latest" || JSON.stringify(job.strategy?.matrix?.os ?? "").includes("macos"))
      .map(([name]) => name);
    // Sagax keeps its native apps: the iOS build runs only when ios/ changed.
    expect(macosJobs.sort()).toEqual(["electron-smokes", "ios"]);
    const smokes = workflow.jobs["electron-smokes"].steps.map((step: { run?: string }) => step.run);
    expect(smokes).toContain("pnpm test:packaged-server");
  });

  it("checks delegated approval modes on the receipt's work thread, not the selected sibling", () => {
    const smoke = readFileSync(new URL("./smoke-approval-modes.cjs", import.meta.url), "utf8");
    const delegated = smoke.slice(smoke.indexOf("const peerTarget ="), smoke.indexOf("const customCalls ="));
    expect(delegated).toContain("const peerWorkThreadId = peerResponse.body.receipts[0].threadId;");
    expect(delegated).toContain("assert.notEqual(peerWorkThreadId, peerThread.threadId);");
    expect(delegated).toContain("task.threadId === peerWorkThreadId)?.busy === false");
    expect(delegated).toContain("/tasks/${peerWorkThreadId}`");
    expect(delegated).toContain("assert.equal(askPeerResponse.body.receipts[0].threadId, peerWorkThreadId);");
    expect(delegated).toContain("/api/threads/${peerWorkThreadId}/messages");
    expect(delegated).toContain("/api/threads/${peerWorkThreadId}/respond");
    expect(delegated).toContain("const customThreadId = customResponse.body.receipts[0].threadId;");
    expect(delegated).toContain("/api/threads/${customThreadId}/messages");
    expect(delegated).toContain("/api/threads/${customThreadId}/respond");
    expect(delegated).not.toContain("pendingCard((await api(\"/api/bots\"))");
    expect(delegated).not.toContain("/tasks/${peerThread.threadId}`");
  });

  it("makes a release wait for its commit's CI gate before any draft", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    expect(release.jobs.assemble.needs).toContain("ci");
    expect(release.jobs.assemble.needs).toContain("voice-acceptance");
    expect(release.jobs["voice-acceptance"].needs).toBe("prepare");
    expect(release.jobs["voice-acceptance"].uses).toBe("./.github/workflows/voice-release-acceptance.yml");
    expect(release.jobs["voice-acceptance"].with.ref).toBe("${{ needs.prepare.outputs.sha }}");
    expect(release.jobs["voice-acceptance"].secrets).toBe("inherit");
    expect(release.jobs["voice-acceptance"].if).toBe("needs.prepare.outputs.should_release == 'true'");
    const voice = parse(readFileSync(new URL("../.github/workflows/voice-release-acceptance.yml", import.meta.url), "utf8"));
    expect(voice.on).toHaveProperty("workflow_call");
    expect(voice.on).toHaveProperty("workflow_dispatch");
    // No schedule: CI runs once, on the release candidate.
    expect(voice.on).not.toHaveProperty("schedule");
    const accept = voice.jobs.accept;
    expect(accept.steps.some((step: { run?: string }) => step.run === "pnpm voice:acceptance:real -- --enforce --out \"$RUNNER_TEMP/voice-acceptance\"")).toBe(true);
    expect(accept.steps.some((step: { env?: Record<string, string> }) =>
      step.env?.SAGAX_XAI_VOICE_KEY === "${{ secrets.SAGAX_XAI_VOICE_KEY }}"
      && step.env?.XAI_API_KEY === "${{ secrets.SAGAX_XAI_VOICE_KEY }}",
    )).toBe(true);
    expect(accept.steps.some((step: { if?: string; uses?: string }) => step.if === "always()" && step.uses?.startsWith("actions/upload-artifact@"))).toBe(true);
    expect(JSON.stringify(accept)).toContain("espeak-ng");
    expect(JSON.stringify(voice)).not.toContain("ship_without_ci");
    expect(release.jobs.ci.needs).toBe("prepare");
    expect(release.jobs.ci.permissions).toEqual({ actions: "write", contents: "write" });
    const wait = release.jobs.ci.steps.find((step: { run?: string }) => step.run === "node scripts/release-ci.mjs");
    expect(wait.if).toBe("${{ !inputs.ship_without_ci }}");
    expect(wait.env).toMatchObject({ SHA: "${{ needs.prepare.outputs.sha }}", VERSION: "${{ needs.prepare.outputs.version }}" });
    // The script reads ci.yml's gate by its job name.
    expect(readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8")).toContain(`job.name === "${workflow.jobs.gate.name}"`);
    // The release lane is a branch, so its runs get their own concurrency group.
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("checks out every module the release gate imports", () => {
    const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
    const checkout = release.jobs.ci.steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/checkout@"));
    const sparse = (checkout.with["sparse-checkout"] as string).split("\n").map((line) => line.trim()).filter(Boolean);
    const imports = [...readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8").matchAll(/^import .* from "\.\/([^"]+)";$/gm)]
      .map((match) => `scripts/${match[1]}`);
    expect(imports).toContain("scripts/ci-scope.mjs");
    expect(sparse.sort()).toEqual(["scripts/release-ci.mjs", ...imports].sort());
  });

  it("lets push scoping read the previous commit's CI, and nothing more", () => {
    // ci-scope.mjs runs a push's docs- or version-only diff without the runtime
    // jobs only when the commit before it has its own green run.
    expect(workflow.jobs.static.permissions).toEqual({ contents: "read", actions: "read" });
    const scope = workflow.jobs.static.steps.find((step: { id?: string }) => step.id === "scope");
    expect(scope.env).toEqual({ GH_TOKEN: "${{ github.token }}" });
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { permissions?: unknown }][]) {
      if (name !== "static") expect(job.permissions, name).toBeUndefined();
    }
  });

  it("reports every known flaky test that needed a retry in the vitest job summary", () => {
    const steps = workflow.jobs.vitest.steps as { name?: string; run?: string; if?: string; env?: Record<string, string> }[];
    const tests = steps.findIndex((step) => step.name === "Run tests");
    const report = steps.findIndex((step) => step.run === "node scripts/testing/ci-retry-summary.mjs");
    expect(report).toBe(tests + 1);
    expect(steps[report]!.if).toBe("${{ !cancelled() }}");
    // The runner context exists only at step level, never in a job's env.
    expect(workflow.jobs.vitest.env).toBeUndefined();
    for (const step of [steps[tests]!, steps[report]!]) {
      expect(step.env).toEqual({ SAGAX_VITEST_RETRY_LOG: "${{ runner.temp }}/vitest-retries.jsonl" });
    }
    expect(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")).toContain('runner: "./scripts/testing/ci-retry-runner.ts"');
  });

  it.each(requiredRuntimeJobs)("fails closed for every required %s outcome", (job) => {
    for (const result of ["success", "failure", "cancelled", "skipped"]) {
      const check = runGate({ ...gateNeeds("true"), [job]: { result } });
      expect(check.status, check.stderr).toBe(result === "success" ? 0 : 1);
    }
  });

  it("accepts only deliberately unselected jobs on docs-only PRs", () => {
    expect(runGate(gateNeeds("false")).status).toBe(0);
    for (const result of ["success", "failure", "cancelled"]) {
      expect(runGate({ ...gateNeeds("false"), vitest: { result } }).status).toBe(1);
    }
  });

  it("accepts skipped Windows/macOS jobs only when platforms are deselected", () => {
    const pr = (extra: object) => {
      const base = gateNeeds("true");
      return { ...base, static: { ...base.static, outputs: { ...base.static.outputs, platforms: "false" } }, ...extra };
    };
    expect(runGate(pr({ "windows-cua": { result: "skipped" }, "electron-smokes": { result: "skipped" } })).status).toBe(0);
    expect(runGate(pr({ "windows-cua": { result: "skipped" }, "electron-smokes": { result: "skipped" }, vitest: { result: "skipped" } })).status).toBe(1);
  });

  it("rejects failed preflight and missing or malformed selection", () => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds("false"), static: { result, outputs: { runtime: "false" } } }).status).toBe(1);
    }
    for (const runtime of ["", "yes", "TRUE"]) expect(runGate(gateNeeds(runtime)).status).toBe(1);
    expect(runGate({ ...gateNeeds("false"), static: { result: "success", outputs: {} } }).status).toBe(1);
  });

  it("always starts the workflow and validates selection and docs before fanout", () => {
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.jobs.static.if).toBeUndefined();
    expect(workflow.jobs.static.steps[0].with["fetch-depth"]).toBe(0);
    expect(workflow.jobs.static.steps.find((step: { id?: string }) => step.id === "scope").run).toBe("node scripts/ci-scope.mjs");
    expect(workflow.jobs.static.outputs).toEqual({
      runtime: "${{ steps.scope.outputs.runtime }}", mobile: "${{ steps.scope.outputs.mobile }}",
      vitest_os: "${{ steps.scope.outputs.vitest_os }}", platforms: "${{ steps.scope.outputs.platforms }}",
    });
    expect(workflow.jobs.static.steps.some((step: { run?: string }) =>
      step.run === "pnpm exec vitest run scripts/ci-scope.test.ts scripts/ci-workflow.test.ts scripts/testing/verification-docs.test.ts",
    )).toBe(true);
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { needs?: string | string[]; if?: string }][]) {
      if (["static", "gate"].includes(name)) continue;
      expect(job.needs).toBe("static");
      const selector = `needs.static.outputs.${["ios", "android"].includes(name) ? "mobile" : "runtime"} == 'true'`;
      // Windows, macOS and iOS jobs run on main pushes and merge groups only.
      expect(job.if).toBe(["windows-cua", "electron-smokes", "ios"].includes(name)
        ? `${selector} && needs.static.outputs.platforms == 'true'` : selector);
      if (name === "ios") {
        const ios = job as { "runs-on"?: string; steps?: { run?: string }[] };
        expect(ios["runs-on"]).toBe("macos-latest");
        expect(ios.steps?.some((step) => step.run?.includes("swift test --package-path ios"))).toBe(true);
      }
    }
  });

  it("keeps the redundant Windows workflow available only for manual debugging", () => {
    const smoke = parse(readFileSync(new URL("../.github/workflows/shared-terminal-smoke.yml", import.meta.url), "utf8"));
    expect(smoke.on).toEqual({ workflow_dispatch: null });
    const commands = smoke.jobs.windows.steps.map((step: { run?: string }) => step.run);
    expect(commands).toContain("node --test electron/shared-computer-access.node-test.mjs");
    expect(commands).toContain("pnpm exec vitest run server/shared-computers.e2e.test.ts");
  });
});
