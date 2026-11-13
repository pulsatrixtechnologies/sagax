import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const requiredRuntimeJobs = ["vitest", "vitest-macos", "known-failures", "behavior-evals", "packaged-server", "windows-cua", "electron-smokes", "voice-acceptance"];

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
  it("runs every test after each merge to main and nightly, never on a PR or the merge queue (Owner 2026-11-09, #3482)", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "schedule", "workflow_dispatch"]);
    // A push to main only: no tag, so a release tag starts nothing here.
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.schedule).toEqual([{ cron: "17 7 * * *" }]);
    expect(workflow.on.workflow_dispatch.inputs.fill_known_failures).toMatchObject({ type: "boolean", default: false, required: false });
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
      os: "${{ fromJSON(needs.static.outputs.vitest_os) }}", shard: Array.from({ length: 20 }, (_, i) => i + 1),
      exclude: [{ os: "macos-latest" }],
    });
    expect(workflow.jobs.vitest["timeout-minutes"]).toBe("${{ matrix.os == 'ubuntu-latest' && 30 || 45 }}");
  });

  it("writes the same shard count in the matrix, the --shard flag, the job name and the expected result count (#3521)", () => {
    // A count changed in one place only would run some files twice or never,
    // or turn every run red for missing results.
    const count = workflow.jobs.vitest.strategy.matrix.shard.length;
    expect(workflow.jobs.vitest.strategy.matrix.shard).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(workflow.jobs.vitest.name).toBe(`vitest (\${{ matrix.os }}, shard \${{ matrix.shard }}/${count})`);
    const run = workflow.jobs.vitest.steps.find((step: { name?: string }) => step.name === "Run tests").run as string;
    expect(run).toContain(`--shard=\${{ matrix.shard }}/${count} `);
    const verdict = workflow.jobs["known-failures"].steps.find((step: { name?: string }) => step.name === "Every failure is a known failure").run as string;
    expect(verdict).toContain(`JSON.parse(process.env.VITEST_OS).length * ${count})`);
  });

  it("runs the macOS shards a few at a time, with the same shards and steps as the other platforms (#3672)", () => {
    // Twenty macOS shards asked for at once against five hosted macOS
    // runners: GitHub dropped six of them unstarted after an hour.
    const mac = workflow.jobs["vitest-macos"];
    expect(mac.strategy).toEqual({ "fail-fast": false, "max-parallel": 3, matrix: { os: ["macos-latest"], shard: workflow.jobs.vitest.strategy.matrix.shard } });
    expect(mac.steps).toEqual(workflow.jobs.vitest.steps);
    expect(mac.name).toBe(workflow.jobs.vitest.name);
    expect(mac["runs-on"]).toBe("${{ matrix.os }}");
    expect(mac["timeout-minutes"]).toBe(45);
    expect(mac.needs).toBe("static");
    expect(mac.if).toBe("${{ !cancelled() && needs.static.outputs.runtime == 'true' && contains(needs.static.outputs.vitest_os, 'macos-latest') }}");
    // The other macOS jobs of a run on every platform keep a runner each
    // within the five. The Swift package job runs on a push only (#3678),
    // where no other macOS job runs.
    const others = Object.entries(workflow.jobs as Record<string, { "runs-on"?: string }>)
      .filter(([name, job]) => job["runs-on"] === "macos-latest" && name !== "swift-package");
    expect(mac.strategy["max-parallel"] + others.length).toBeLessThanOrEqual(5);
    expect(workflow.jobs["swift-package"].if).toContain("needs.static.outputs.swift == 'true'");
  });

  it("retries the package smoke's tool install and bounds it (#3672)", () => {
    const install = workflow.jobs["package-linux"].steps.find((step: { name?: string }) => step.name === "Install package validation and native smoke tools");
    expect(install["timeout-minutes"]).toBeLessThan(workflow.jobs["package-linux"]["timeout-minutes"]);
    expect(install.run).toContain("Acquire::Retries=3");
    expect(install.run).toContain("for attempt in 1 2 3; do");
    expect(install.run).toMatch(/timeout \d+ sudo apt-get "\$\{apt\[@\]\}" update/);
    expect(install.run).toMatch(/timeout \d+ sudo apt-get "\$\{apt\[@\]\}" install -y/);
  });

  it("keeps each PR to one macOS job unless native code changed", () => {
    const macosJobs = Object.entries(workflow.jobs as Record<string, { "runs-on": string; strategy?: { matrix?: { os?: unknown } } }>)
      .filter(([, job]) => job["runs-on"] === "macos-latest" || JSON.stringify(job.strategy?.matrix?.os ?? "").includes("macos"))
      .map(([name]) => name);
    // Sagax keeps its native apps: the iOS build runs only when ios/ changed.
    expect(macosJobs.sort()).toEqual(["electron-smokes", "ios", "swift-package", "vitest-macos"]);
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
    // known-failures reads the previous main run's sightings and opens the
    // regression issues; nothing else gets more than the workflow's read.
    expect(workflow.jobs["known-failures"].permissions).toEqual({ contents: "read", actions: "read", issues: "write" });
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { permissions?: unknown }][]) {
      if (name !== "static" && name !== "known-failures") expect(job.permissions, name).toBeUndefined();
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
    const skipped = { "windows-cua": { result: "skipped" }, "electron-smokes": { result: "skipped" }, "vitest-macos": { result: "skipped" } };
    expect(runGate(pr(skipped)).status).toBe(0);
    expect(runGate(pr({ ...skipped, vitest: { result: "skipped" } })).status).toBe(1);
  });

  it("rejects failed preflight and missing or malformed selection", () => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(runGate({ ...gateNeeds("false"), static: { result, outputs: { runtime: "false" } } }).status).toBe(1);
    }
    for (const runtime of ["", "yes", "TRUE"]) expect(runGate(gateNeeds(runtime)).status).toBe(1);
    expect(runGate({ ...gateNeeds("false"), static: { result: "success", outputs: {} } }).status).toBe(1);
  });

  it("runs the vitest shards after a red static check and keeps the CI gate red (#3493)", () => {
    // One red quick check must not hide every test result: the shards run
    // whenever the selection step set its outputs, and only a cancel stops them.
    expect(workflow.jobs.vitest.needs).toBe("static");
    expect(workflow.jobs.vitest.if).toBe("${{ !cancelled() && needs.static.outputs.runtime == 'true' }}");
    expect(workflow.jobs["known-failures"].if).toBe("${{ !cancelled() && needs.static.outputs.runtime == 'true' }}");
    const staticRed = { ...gateNeeds("true"), static: { result: "failure", outputs: { runtime: "true" } } };
    expect(runGate(staticRed).status).toBe(1);
  });

  it("always starts the workflow and validates selection and docs before fanout", () => {
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.jobs.static.if).toBeUndefined();
    expect(workflow.jobs.static.steps[0].with["fetch-depth"]).toBe(0);
    expect(workflow.jobs.static.steps.find((step: { id?: string }) => step.id === "scope").run).toBe("node scripts/ci-scope.mjs");
    expect(workflow.jobs.static.outputs).toEqual({
      runtime: "${{ steps.scope.outputs.runtime }}", mobile: "${{ steps.scope.outputs.mobile }}",
      vitest_os: "${{ steps.scope.outputs.vitest_os }}", platforms: "${{ steps.scope.outputs.platforms }}",
      swift: "${{ steps.scope.outputs.swift }}",
    });
    expect(workflow.jobs.static.steps.some((step: { run?: string }) =>
      step.run === "pnpm exec vitest run scripts/ci-scope.test.ts scripts/ci-workflow.test.ts scripts/testing/verification-docs.test.ts",
    )).toBe(true);
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { needs?: string | string[]; if?: string }][]) {
      if (["static", "gate", "known-failures", "vitest", "vitest-macos", "swift-package"].includes(name)) continue;
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

  it("runs the Swift package tests alone after a merge that touches them, blocking nothing (#3678)", () => {
    type Step = { name?: string; run?: string; uses?: string; if?: string; with?: Record<string, unknown> };
    const swift = workflow.jobs["swift-package"] as { needs: string; if: string; name: string; "runs-on": string; steps: Step[]; permissions?: unknown };
    expect(swift.needs).toBe("static");
    expect(swift.if).toBe("${{ !cancelled() && needs.static.outputs.swift == 'true' }}");
    expect(swift["runs-on"]).toBe("macos-latest");
    // The release gate and the issue reader find it by this name.
    expect(readFileSync(new URL("./release-ci.mjs", import.meta.url), "utf8")).toContain(`export const SWIFT_AFTER_MERGE = "${swift.name}";`);
    // Only the package tests: the same steps as the nightly's ios job, no simulator, no screenshot.
    const ios = workflow.jobs.ios.steps as Step[];
    const test = ios.find((step) => step.name === "Swift package tests")!;
    const log = ios.find((step) => step.with?.name === "ios-swift-test")!;
    expect(swift.steps.slice(1)).toEqual([test, log]);
    expect(test.run).toContain("swift test --package-path ios 2>&1 | tee \"$RUNNER_TEMP/swift-test.txt\"");
    expect(JSON.stringify(swift.steps)).not.toMatch(/xcodebuild|simctl|xcodegen/);
    // The gate waits for it only through known-failures (the issue reader),
    // and its result never changes the gate: no other job needs it.
    expect(workflow.jobs.gate.needs).not.toContain("swift-package");
    for (const [name, job] of Object.entries(workflow.jobs) as [string, { needs?: string | string[] }][]) {
      if (name !== "known-failures") expect([job.needs ?? []].flat(), name).not.toContain("swift-package");
    }
  });

  it("keeps the redundant Windows workflow available only for manual debugging", () => {
    const smoke = parse(readFileSync(new URL("../.github/workflows/shared-terminal-smoke.yml", import.meta.url), "utf8"));
    expect(smoke.on).toEqual({ workflow_dispatch: null });
    const commands = smoke.jobs.windows.steps.map((step: { run?: string }) => step.run);
    expect(commands).toContain("node --test electron/shared-computer-access.node-test.mjs");
    expect(commands).toContain("pnpm exec vitest run server/computer/shared-computers.e2e.test.ts");
  });
});

describe("known failures after each merge (#3482)", () => {
  type Step = { name?: string; run?: string; if?: string; uses?: string; shell?: string; env?: Record<string, string>; with?: Record<string, unknown> };
  const vitestSteps = workflow.jobs.vitest.steps as Step[];
  const job = workflow.jobs["known-failures"] as { needs: string[]; if: string; steps: Step[]; "runs-on": string };
  const onMain = "${{ !cancelled() && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule') }}";

  it("lets each vitest job finish on a test failure and hand its results to the verdict", () => {
    const tests = vitestSteps.find((step) => step.name === "Run tests")!;
    expect(tests.shell).toBe("bash");
    expect(tests.run).toContain("set +e");
    expect(tests.run).toContain('--reporter=json --outputFile.json="$RUNNER_TEMP/vitest-report.json"');
    expect(tests.run).toContain('echo "$?" > "$RUNNER_TEMP/vitest-exit"');
    const extract = vitestSteps.find((step) => step.run?.includes("known-failures.mjs extract"))!;
    expect(extract.if).toBe("${{ !cancelled() }}");
    const upload = vitestSteps.find((step) => step.with?.name === "vitest-results-${{ matrix.os }}-${{ matrix.shard }}")!;
    expect(upload.uses).toMatch(/^actions\/upload-artifact@[a-f\d]{40}$/);
    expect(vitestSteps.indexOf(upload)).toBe(vitestSteps.indexOf(extract) + 1);
  });

  it("gives the verdict once, after every vitest job, and the CI gate requires it", () => {
    expect(job.needs).toEqual(["static", "vitest", "vitest-macos", "swift-package", "ios"]);
    expect(job.if).toBe("${{ !cancelled() && needs.static.outputs.runtime == 'true' }}");
    expect(job["runs-on"]).toBe("ubuntu-latest");
    const verdict = job.steps.find((step) => step.name === "Every failure is a known failure")!;
    expect(verdict.run).toContain("known-failures.mjs report");
    expect(verdict.run).toContain('--expect "$expected"');
    // A job with no runner is told apart from a crash (#3672).
    expect(verdict.run).toContain('--jobs "$RUNNER_TEMP/vitest-jobs.jsonl"');
    const jobs = job.steps.find((step) => step.name === "Read this run's test jobs")!;
    expect(jobs.if).toBe("${{ !cancelled() }}");
    expect(jobs.env).toEqual({ GH_TOKEN: "${{ github.token }}" });
    expect(job.steps.indexOf(jobs)).toBe(job.steps.indexOf(verdict) - 1);
    // A failed shrink check must not hide this run's own failures.
    expect(verdict.if).toBe("${{ !cancelled() }}");
    const download = job.steps.find((step) => step.with?.pattern === "vitest-results-*")!;
    expect(download.if).toBe("${{ !cancelled() }}");
    // The list shrinks runner by runner, from the rows each runner sent (#3569).
    expect(verdict.run).not.toContain("--platforms");
    expect(verdict.env?.VITEST_OS).toBe("${{ needs.static.outputs.vitest_os }}");
    expect(verdict.env?.SEED).toBe("${{ inputs.fill_known_failures == true }}");
    expect(workflow.jobs.gate.needs).toContain("known-failures");
    const shrink = job.steps.find((step) => step.run?.includes("check-shrink"))!;
    expect(shrink.if).toBe("github.event_name == 'push'");
    expect(shrink.env).toEqual({ BEFORE: "${{ github.event.before }}" });
  });

  it("opens regression issues and keeps sightings only for main's pushes and nightly runs", () => {
    const issues = job.steps.find((step) => step.run?.includes("known-failures.mjs open-issues"))!;
    expect(issues.if).toBe(onMain);
    expect(issues.env?.GH_TOKEN).toBe("${{ github.token }}");
    // Only a run on every platform forgets a sighting whose test passed.
    expect(issues.env?.VITEST_OS).toBe("${{ needs.static.outputs.vitest_os }}");
    expect(issues.run).toContain('--platforms "$VITEST_OS"');
    for (const name of ["Read the previous main run's sightings", "Keep this run's sightings for the next run"]) {
      expect(job.steps.find((step) => step.name === name)?.if).toBe(onMain);
    }
    // Red Swift package tests open their issue from the same command (#3678):
    // it reads the jobs' step names and the Swift log of this run.
    expect(issues.run).toContain('--jobs "$RUNNER_TEMP/vitest-jobs.jsonl" --swift-log "$RUNNER_TEMP/swift-test/swift-test.txt"');
    const jobs = job.steps.find((step) => step.name === "Read this run's test jobs")!;
    expect(jobs.run).toContain("steps: [.steps[]? | {name, status, conclusion}]");
    const swiftLog = job.steps.find((step) => step.with?.pattern === "ios-swift-test")!;
    expect(swiftLog.if).toBe(onMain);
    expect(swiftLog.with?.path).toBe("${{ runner.temp }}/swift-test");
    expect(job.steps.indexOf(swiftLog)).toBeLessThan(job.steps.indexOf(issues));
    // The job uses the run's own token and no repository secret.
    expect(JSON.stringify(job)).not.toMatch(/secrets\./);
  });
});

describe("public server image (install.sh, docs/install.md)", () => {
  const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
  const job = release.jobs["server-image"];

  it("builds once per published release: no new push or pull-request trigger (Owner 2026-10-14)", () => {
    expect(Object.keys(release.on).sort()).toEqual(["push", "release", "workflow_dispatch"]);
    expect(release.on.release.types).toEqual(["published"]);
    expect(release.on.push.branches).toEqual(["main"]);
    expect(release.on.push.paths).toEqual(["package.json"]);
    expect(release.on).not.toHaveProperty("pull_request");
    expect(release.on).not.toHaveProperty("schedule");
    expect(job.needs).toBe("prepare");
    expect(job.if).toBe("needs.prepare.outputs.server_image == 'true'");
    const decide = release.jobs.prepare.steps.find((step: { id?: string }) => step.id === "image");
    expect(decide.run).toContain("^pulsa-v([0-9]+\\.[0-9]+\\.[0-9]+)$");
    // A release event never rebuilds the installers.
    const pin = release.jobs.prepare.steps.find((step: { id?: string }) => step.id === "pin");
    expect(pin.run).toContain('if [ "$GITHUB_EVENT_NAME" = release ] || [ -n "$SERVER_IMAGE_TAG" ]; then');
  });

  it("never delays the installers: no release job waits for it", () => {
    for (const [name, other] of Object.entries(release.jobs) as [string, { needs?: string | string[] }][]) {
      if (name === "server-image") continue;
      expect([other.needs ?? []].flat()).not.toContain("server-image");
    }
  });

  it("publishes amd64 and arm64 from the tagged commit, scanned and signed, with no deployment config", () => {
    const steps = JSON.stringify(job.steps);
    const build = job.steps.find((step: { id?: string }) => step.id === "build");
    expect(build.with.platforms).toBe("linux/amd64,linux/arm64");
    expect(build.with.context).toBe(".");
    expect(build.with).not.toHaveProperty("file");
    expect(build.with["build-args"]).toContain("ENGINE_SET=all");
    expect(job.steps[0].with.ref).toBe("${{ needs.prepare.outputs.sha }}");
    expect(job.permissions).toEqual({ contents: "read", "id-token": "write", packages: "write" });
    expect(steps).toContain("node scripts/vuln-attestation.mjs vuln.json vuln-amd64.json vuln-arm64.json");
    expect(steps).toContain('cosign sign --yes \\"${STAGING}@${DIGEST}\\"');
    expect(steps).toContain("IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}");
    expect(steps).toContain("type=raw,value=latest,enable=${{ needs.prepare.outputs.image_latest == 'true' }}");
    expect(steps).not.toMatch(/secrets\.(?!GITHUB_TOKEN|TRIVYIGNORE_PRIVATE)/);
  });

  it("attaches one Android APK and does not invent signing material", () => {
    const apk = release.jobs["android-apk"];
    expect(release.jobs.assemble.needs).toContain("android-apk");
    expect(apk.needs).toBe("prepare");
    expect(apk.if).toBe("needs.prepare.outputs.should_release == 'true'");
    const text = JSON.stringify(apk);
    for (const name of ["SAGAX_KEYSTORE_FILE", "SAGAX_KEYSTORE_PASSWORD", "SAGAX_KEY_ALIAS", "SAGAX_KEY_PASSWORD"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("Sagax.apk");
    expect(text).toContain("Sagax-unsigned.apk");
    expect(text).toContain("No password was invented.");
    expect(text).not.toMatch(/storePassword["']?\s*[:=]\s*["'][^"']+["']/);
    const assemble = JSON.stringify(release.jobs.assemble);
    expect(assemble).toContain("Sagax-unsigned.apk");
    expect(assemble).toContain("Sagax.apk");
  });
});
