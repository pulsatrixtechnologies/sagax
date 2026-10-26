import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { gateReadOnlyTools, GROK_APPROVAL_GATE_FILE, grokApprovalGateEnabled } from "./grok-approval-gate.ts";

const bridge = { command: process.execPath, args: [SPAWNED_PROXIES.perspicax], env: { SAGAX_PERSPICAX_PROFILE: "pr_1" } };
const WRITES = [
  "cw_psa__write", "cw_psa__action", "memory_write", "memory_forget", "memory_promote", "memory_propose",
  "sagax_send", "sagax_approve", "sagax_nudge", "sagax_routine_run", "flow_action", "ask_person", "api_upload",
  "run_command", "write_file", "create_bot", "send_message", "workspace_write",
];

describe("grokApprovalGateEnabled", () => {
  it("is on by default (engine parity) and off only for an explicit opt-out", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-flag-"));
    try {
      const write = (content: string) => writeFileSync(join(dir, GROK_APPROVAL_GATE_FILE), content);
      // no file: every bot, and a turn with no bot
      expect(grokApprovalGateEnabled("b1", dir)).toBe(true);
      expect(grokApprovalGateEnabled(undefined, dir)).toBe(true);
      write(JSON.stringify({ off: ["b1"] }));
      expect(grokApprovalGateEnabled("b1", dir)).toBe(false);
      expect(grokApprovalGateEnabled("b2", dir)).toBe(true);
      expect(grokApprovalGateEnabled(undefined, dir)).toBe(true);
      write(JSON.stringify({ bots: "none" }));
      expect(grokApprovalGateEnabled("b2", dir)).toBe(false);
      expect(grokApprovalGateEnabled(undefined, dir)).toBe(false);
      // the earlier opt-in list no longer narrows: an unlisted bot is gated too
      write(JSON.stringify({ bots: ["b1"] }));
      expect(grokApprovalGateEnabled("b2", dir)).toBe(true);
      // anything unreadable fails toward Sagax's decision, never Grok's classifier
      for (const bad of ["", "nope", "[]", JSON.stringify({ bots: "b1" }), JSON.stringify({ off: "b1" }), JSON.stringify({ off: [1] }), JSON.stringify({})]) {
        write(bad);
        expect(grokApprovalGateEnabled("b1", dir)).toBe(true);
      }
    } finally {
      removeTempDir(dir);
    }
  });
});

describe("gateReadOnlyTools", () => {
  it("lets the reviewed reads through and never a write", () => {
    const agents = gateReadOnlyTools({ name: "agents", builtin: true });
    const perspicax = gateReadOnlyTools({ name: "perspicax_jc", builtin: false, spec: bridge });
    expect(agents).toContain("list_bots");
    expect(perspicax).toEqual(expect.arrayContaining(["api_search", "cw_psa__query", "memory_search", "flow"]));
    for (const tool of WRITES) {
      expect(agents).not.toContain(tool);
      expect(perspicax).not.toContain(tool);
    }
  });

  it("gives every other server nothing, whatever it is named", () => {
    expect(gateReadOnlyTools({ name: "agents", builtin: false, spec: bridge })).toEqual([]);
    expect(gateReadOnlyTools({ name: "perspicax_fake", builtin: false, spec: { command: "node", args: ["/tmp/x.mjs"], env: { SAGAX_PERSPICAX_PROFILE: "p" } } })).toEqual([]);
    for (const name of ["browser", "computer", "sagax-environment", "sagax-computer", "github"]) {
      expect(gateReadOnlyTools({ name, builtin: name !== "sagax-environment" && name !== "sagax-computer" && name !== "github" })).toEqual([]);
    }
  });
});

describe("gateReadOnlyTools: computer_select on a cloud-only bot", () => {
  it("passes computer_select unasked only for a bot in cloud-only-bots.json, on Sagax's own sagax-computer", () => {
    const dir = mkdtempSync(join(tmpdir(), "gate-cloud-only-"));
    try {
      const computer = { name: "sagax-computer", builtin: true };
      // no file: every bot's computer_select asks (it can move the turn)
      expect(gateReadOnlyTools(computer, "cw1", dir)).toEqual([]);
      writeFileSync(join(dir, "cloud-only-bots.json"), JSON.stringify({ bots: ["cw1"] }));
      expect(gateReadOnlyTools(computer, "cw1", dir)).toEqual(["computer_select"]);
      expect(gateReadOnlyTools(computer, "other", dir)).toEqual([]);
      expect(gateReadOnlyTools(computer, undefined, dir)).toEqual([]);
      // a connector that names itself sagax-computer gets nothing
      expect(gateReadOnlyTools({ name: "sagax-computer", builtin: false }, "cw1", dir)).toEqual([]);
      // the cloud-only bot's other servers are unchanged: writes still ask
      expect(gateReadOnlyTools({ name: "sagax-environment", builtin: true }, "cw1", dir)).toEqual([]);
      writeFileSync(join(dir, "cloud-only-bots.json"), "not json");
      expect(gateReadOnlyTools(computer, "cw1", dir)).toEqual([]);
    } finally {
      removeTempDir(dir);
    }
  });
});
