// Codex permission review (lot A1b): a fresh app-server, the prompt in the
// turn and never in argv, and a tool request fails the call.
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { CodexDriver } from "./codex.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-codex-app-server.ts");

describe("Codex permission review (lot A1b)", () => {
  let instance: ProviderInstance | undefined;
  let scratch: string;
  const keys = ["FAKE_CODEX_MODE", "FAKE_CODEX_DUMP", "FAKE_CODEX_REVIEW_TEXT", "FAKE_CODEX_DUMP_TURNS_ONLY"];

  afterEach(async () => {
    for (const key of keys) delete process.env[key];
    await instance?.dispose();
    instance = undefined;
    if (scratch) await removeTempDir(scratch);
  });

  const create = async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-codex-review-test-"));
    instance = await CodexDriver.create({
      instanceId: "codex-review-test",
      displayName: "Codex review",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    return instance;
  };

  it("returns the model's text and never puts the prompt in argv", async () => {
    const engine = await create();
    process.env.FAKE_CODEX_MODE = "review-text";
    process.env.FAKE_CODEX_REVIEW_TEXT = '{"decision":"none"}';
    process.env.FAKE_CODEX_DUMP = join(scratch, "dump.json");
    process.env.FAKE_CODEX_DUMP_TURNS_ONLY = "1";
    await expect(engine.reviewPermission!("judge this card")).resolves.toBe('{"decision":"none"}');
    const dump = JSON.parse(readFileSync(process.env.FAKE_CODEX_DUMP, "utf8"));
    expect(dump.argv).toEqual(["app-server"]);
    const started = dump.calls.find((call: { method: string }) => call.method === "turn/start");
    expect(JSON.stringify(started.params.input)).toContain("judge this card");
    expect(JSON.stringify(dump.argv)).not.toContain("judge this card");
  });

  it("fails closed when the review asks to run a command", async () => {
    const engine = await create();
    process.env.FAKE_CODEX_MODE = "review-tool";
    await expect(engine.reviewPermission!("judge this card")).rejects.toThrow(/asked for execCommandApproval/);
  });
});
