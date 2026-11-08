import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  assessEngineBinaries,
  assessHealthz,
  assessImageLabels,
  assessLock,
  assessProductionManifest,
  assessStartupLog,
  invokedAsCli,
  main,
  productionEngineBins,
  productionEngineIds,
} from "./engine-image-gate.mjs";

const gateScript = join(import.meta.dirname, "engine-image-gate.mjs");
const workflow = readFileSync(join(import.meta.dirname, "..", ".github/workflows/gox-image-gate.yml"), "utf8");

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8"));
const required = productionEngineIds(lock);
const bins = productionEngineBins(lock);
const sha = "20004735d6f4ad9d924ee04175d245feaa8398e5";

function manifest(engineSet, ids = required) {
  return {
    engineSet,
    installed: ids.map((id) => ({ id, bin: id === "cursor" ? "cursor-agent" : id })),
  };
}

function startupLog(ids = required, { failed = [], engineSet = "all", extra = "" } = {}) {
  const lines = ids.map((id) => (failed.includes(id)
    ? `[engines] ${id}: FAILED, missing (pinned 1)`
    : `[engines] ${id}: 1 (pinned 1, /usr/local/bin/${id})`));
  lines.push(extra);
  lines.push(`[engines] self-check: ${ids.length - failed.length}/${ids.length} preinstalled engine(s) start (image set ${engineSet})`);
  return lines.filter(Boolean).join("\n");
}

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), "engine-image-gate-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGate(args, extra = {}) {
  return spawnSync(process.execPath, [gateScript, ...args], { encoding: "utf8", ...extra });
}

// The same answers as the fake docker binary below, for main(argv, run) in
// process: Windows cannot spawn an extensionless shebang script.
function fakeDockerRun({ body, versions, missing = [] }) {
  return (command, args) => {
    if (command !== "docker") return { status: 2, stdout: "", stderr: "unexpected command\n" };
    const flag = args.indexOf("--entrypoint");
    const entry = flag >= 0 ? args[flag + 1] : "";
    const rest = flag >= 0 ? args.slice(flag + 2) : args;
    if (entry === "cat" && rest.includes("/app/engines/manifest.json")) {
      return { status: 0, stdout: JSON.stringify(body), stderr: "" };
    }
    if (rest.includes("--version")) {
      if (missing.includes(entry)) return { status: 127, stdout: "", stderr: "" };
      return { status: 0, stdout: versions[entry] ?? "", stderr: "" };
    }
    return { status: 2, stdout: "", stderr: "unexpected docker argv\n" };
  };
}

function writeFakeDocker(dir, { body, versions, missing = [] }) {
  const docker = join(dir, "docker");
  writeFileSync(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
const flag = args.indexOf("--entrypoint");
const entry = flag >= 0 ? args[flag + 1] : "";
const rest = flag >= 0 ? args.slice(flag + 2) : args;
if (entry === "cat" && rest.includes("/app/engines/manifest.json")) {
  process.stdout.write(${JSON.stringify(JSON.stringify(body))});
  process.exit(0);
}
if (rest.includes("--version")) {
  const missing = ${JSON.stringify(missing)};
  if (missing.includes(entry)) process.exit(127);
  const versions = ${JSON.stringify(versions)};
  process.stdout.write(versions[entry] ?? "");
  process.exit(0);
}
process.stderr.write("unexpected docker argv\\n");
process.exit(2);
`);
  chmodSync(docker, 0o755);
  return docker;
}

describe("assessProductionManifest", () => {
  it("accepts the full lock and refuses none, another set, or a missing engine", () => {
    expect(assessProductionManifest(manifest("all"), lock)).toMatchObject({ ok: true, errors: [], missing: [] });
    expect(assessProductionManifest({ engineSet: "none", installed: [] }, lock).errors).toEqual([
      "engineSet is none",
      `missing engines: ${required.join(",")}`,
    ]);
    expect(assessProductionManifest({ installed: [] }, lock).errors[0]).toBe("engineSet is none");
    expect(assessProductionManifest(manifest("open", required.filter((id) => id !== "claude")), lock).errors).toEqual([
      "engineSet must be all",
      "missing engines: claude",
    ]);
    const dropped = assessProductionManifest(manifest("all", required.filter((id) => id !== "grok" && id !== "cursor")), lock);
    expect(dropped.ok).toBe(false);
    expect(dropped.missing).toEqual(["grok", "cursor"]);
    expect(assessProductionManifest(manifest("all", [...required, "claude"]), lock).ok).toBe(true);
    expect(assessProductionManifest({ engineSet: "all", installed: required.map((id) => ({ id })) }, lock).missing).toEqual(required);
  });

  it("fails closed when the lock is empty or has no engines", () => {
    expect(assessLock({})).toEqual({ ok: false, errors: ["lock has no engines"] });
    expect(assessLock({ engines: [] })).toEqual({ ok: false, errors: ["lock has no engines"] });
    expect(assessLock({ engines: [{ name: "none" }] })).toEqual({ ok: false, errors: ["lock has no engines"] });
    expect(assessLock(null).ok).toBe(false);
    const empty = assessProductionManifest(manifest("all"), {});
    expect(empty.ok).toBe(false);
    expect(empty.errors).toContain("lock has no engines");
  });
});

describe("assessImageLabels", () => {
  const labels = {
    "org.opencontainers.image.revision": sha,
    "org.opencontainers.image.created": "2026-10-12T15:25:00Z",
    "io.sagax.engine-set": "all",
  };

  it("requires the commit, a UTC stamp and the engine set", () => {
    expect(assessImageLabels(labels, { sha }).ok).toBe(true);
    expect(assessImageLabels({ ...labels, "org.opencontainers.image.revision": "other" }, { sha }).errors[0]).toMatch(/revision/);
    expect(assessImageLabels({ ...labels, "org.opencontainers.image.created": "" }, { sha }).errors[0]).toMatch(/UTC/);
    expect(assessImageLabels({ ...labels, "io.sagax.engine-set": "none" }, { sha }).errors[0]).toMatch(/none/);
    expect(assessImageLabels(null, {}).ok).toBe(false);
  });
});

describe("assessStartupLog", () => {
  it("accepts a full start and rejects none, a failure, or a missing line", () => {
    expect(assessStartupLog(startupLog(), required).ok).toBe(true);
    const empty = assessStartupLog("[engines] self-check: 0/0 preinstalled engine(s) start (image set none)\n[engines] engine_missing engineSet=none missing=claude", required);
    expect(empty.ok).toBe(false);
    expect(empty.alerts).toHaveLength(1);
    expect(assessStartupLog(startupLog(required, { failed: ["grok"] }), required).errors.join("\n")).toMatch(/grok failed/);
    expect(assessStartupLog(startupLog(required.filter((id) => id !== "codex")), required).errors.join("\n")).toMatch(/codex/);
    expect(assessStartupLog("[engines] self-check: 11/11 preinstalled engine(s) start (image set open)", required).errors).toContain("self-check did not report image set all");
  });
});

describe("assessHealthz", () => {
  it("requires ok and the app name", () => {
    expect(assessHealthz('{"ok":true,"app":"openmausbot","product":"sagax"}').ok).toBe(true);
    expect(assessHealthz({ ok: true, app: "openmausbot" }).ok).toBe(true);
    expect(assessHealthz('{"app":"openmausbot"}').errors).toContain("healthz not ok");
    expect(assessHealthz('{"ok":true}').errors).toContain("healthz missing openmausbot");
    expect(assessHealthz("nope").ok).toBe(false);
  });
});

describe("assessEngineBinaries", () => {
  it("requires each lock binary to be present and print a version", () => {
    const ok = bins.map((engine) => ({
      id: engine.id,
      bin: engine.bin,
      status: 0,
      stdout: `${engine.bin} ${engine.version}\n`,
      stderr: "",
    }));
    expect(assessEngineBinaries(bins, ok).ok).toBe(true);
    expect(assessEngineBinaries([], ok).ok).toBe(false);
    expect(assessEngineBinaries(bins, []).errors[0]).toMatch(/was not probed/);
    expect(assessEngineBinaries(bins, ok.map((probe) => (
      probe.id === "claude" ? { ...probe, status: 127 } : probe
    ))).errors[0]).toMatch(/claude: claude missing or --version failed/);
    expect(assessEngineBinaries(bins, ok.map((probe) => (
      probe.id === "grok" ? { ...probe, stdout: "", stderr: "" } : probe
    ))).errors[0]).toMatch(/grok: grok --version was empty/);
  });
});

describe("engine-image-gate cli", () => {
  it("exits 0 for a full production manifest and 1 for engineSet none", () => {
    const ok = withTemp((dir) => {
      const path = join(dir, "valid.json");
      writeFileSync(path, JSON.stringify(manifest("all")));
      return runGate(["--manifest", path]);
    });
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe("");

    const bad = withTemp((dir) => {
      const path = join(dir, "none.json");
      writeFileSync(path, JSON.stringify({ engineSet: "none", installed: [] }));
      return runGate(["--manifest", path]);
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/engineSet is none/);
    expect(bad.stderr).toMatch(/missing engines:/);
  });

  it("exits non-zero for a missing manifest or malformed JSON", () => {
    const missing = runGate(["--manifest", join(tmpdir(), "engine-image-gate-absent.json")]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/ENOENT|no such file/i);

    const malformed = withTemp((dir) => {
      const path = join(dir, "bad.json");
      writeFileSync(path, "{not json");
      return runGate(["--manifest", path]);
    });
    expect(malformed.status).not.toBe(0);
    expect(malformed.stderr).toMatch(/JSON|Unexpected|not json/i);
  });

  it("exits non-zero when the lock is empty or has no engines", () => {
    const empty = withTemp((dir) => {
      const lockPath = join(dir, "empty-lock.json");
      const manifestPath = join(dir, "valid.json");
      writeFileSync(lockPath, "{}\n");
      writeFileSync(manifestPath, JSON.stringify(manifest("all")));
      return runGate(["--lock", lockPath, "--manifest", manifestPath]);
    });
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toMatch(/lock has no engines/);

    const none = withTemp((dir) => {
      const lockPath = join(dir, "none-lock.json");
      const manifestPath = join(dir, "valid.json");
      writeFileSync(lockPath, JSON.stringify({ engines: [] }));
      writeFileSync(manifestPath, JSON.stringify(manifest("all")));
      return runGate(["--lock", lockPath, "--manifest", manifestPath]);
    });
    expect(none.status).not.toBe(0);
    expect(none.stderr).toMatch(/lock has no engines/);
  });

  it("still gates when invoked through a symlink", () => {
    expect(invokedAsCli(gateScript, pathToFileURL(gateScript).href)).toBe(true);
    withTemp((dir) => {
      const link = join(dir, "gate");
      symlinkSync(gateScript, link);
      expect(invokedAsCli(link, pathToFileURL(gateScript).href)).toBe(true);
      const bare = spawnSync(process.execPath, [link], { encoding: "utf8" });
      expect(bare.status).not.toBe(0);
      const missing = spawnSync(process.execPath, [link, "--manifest", join(dir, "absent.json")], { encoding: "utf8" });
      expect(missing.status).not.toBe(0);
      const path = join(dir, "valid.json");
      writeFileSync(path, JSON.stringify(manifest("all")));
      const ok = spawnSync(process.execPath, [link, "--manifest", path], { encoding: "utf8" });
      expect(ok.status).toBe(0);
    });
  });

  it("probes each lock binary --version in the image and refuses a missing one (in process)", () => {
    const versions = Object.fromEntries(bins.map((engine) => [engine.bin, `${engine.bin} ${engine.version}\n`]));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const argv = ["--image", "example-server:test"];
      expect(main(argv, fakeDockerRun({ body: manifest("all"), versions }))).toBe(0);
      expect(errors).not.toHaveBeenCalled();
      expect(main(argv, fakeDockerRun({ body: manifest("all"), versions, missing: ["claude"] }))).not.toBe(0);
      expect(errors.mock.calls.flat().join("\n")).toMatch(/claude: claude missing or --version failed/);
    } finally {
      errors.mockRestore();
    }
  });

  // The CLI path puts a fake `docker` shebang script first on PATH. Windows
  // cannot spawn an extensionless script (and the runner's real Docker would
  // answer instead), so this end-to-end spawn runs where the gate runs: the
  // ACME image gate workflow is ubuntu-latest. The in-process test above keeps
  // the probe logic covered on every platform.
  it.skipIf(process.platform === "win32")("probes each lock binary --version in the image and refuses a missing one", () => {
    const versions = Object.fromEntries(bins.map((engine) => [engine.bin, `${engine.bin} ${engine.version}\n`]));
    const ok = withTemp((dir) => {
      writeFakeDocker(dir, { body: manifest("all"), versions });
      const path = join(dir, "valid.json");
      writeFileSync(path, JSON.stringify(manifest("all")));
      return runGate(["--manifest", path, "--image", "example-server:test"], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
      });
    });
    expect(ok.status).toBe(0);
    expect(ok.stderr).toBe("");

    const missingBin = withTemp((dir) => {
      writeFakeDocker(dir, { body: manifest("all"), versions, missing: ["claude"] });
      const path = join(dir, "valid.json");
      writeFileSync(path, JSON.stringify(manifest("all")));
      return runGate(["--manifest", path, "--image", "example-server:test"], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
      });
    });
    expect(missingBin.status).not.toBe(0);
    expect(missingBin.stderr).toMatch(/claude: claude missing or --version failed/);
  });
});

describe("manual image gate workflow", () => {
  it("keeps the image gate workflow title and checks the image through IMAGE", () => {
    expect(workflow).toMatch(/^name: [A-Z]+ image gate$/m);
    expect(workflow).toContain("IMAGE: ${{ inputs.image }}");
    expect(workflow).toContain('docker pull "$IMAGE"');
    expect(workflow).toContain('docker run --rm --entrypoint cat "$IMAGE" /app/engines/manifest.json');
    expect(workflow).toContain('scripts/engine-image-gate.mjs --manifest "$RUNNER_TEMP/engines-manifest.json" --image "$IMAGE"');
    const run = workflow.split("run: |")[1] ?? "";
    expect(run).not.toContain("${{ inputs.image }}");
    expect(workflow).not.toContain("gox-deploy.mjs");
  });
});
