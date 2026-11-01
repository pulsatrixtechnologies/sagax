import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  guardRemoteSupportOpen,
  REMOTE_SUPPORT_OPEN_REFUSED,
} from "./remote-support-open-guard.ts";
import type { TailcatRun } from "./remote-support-local.ts";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"cd".repeat(16)}`;
const NODEKEY = `nodekey:${"11".repeat(32)}`;
const MODEL_KEY = `nodekey:${"ee".repeat(32)}`;

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const run: TailcatRun = async (args) => {
  if (args[0] === "genkey") {
    writeFileSync(String(args[3]), "{\"Private\":\"privkey:00\"}\n");
    return { code: 0, stdout: `${NODEKEY}\n`, stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
};

describe("MCP remote_support_open guard", () => {
  it("ignores model-supplied nodekey and session on a coded open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-open-guard-"));
    dirs.push(dir);
    const posted: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const out = await guardRemoteSupportOpen({
      args: { nodekey: MODEL_KEY, session: "ffffffffffff", template: "evil", rights: "standard" },
      botId: "bot-1",
      principalId: "pr_alice",
      ownerSub: "sub-alice",
      remoteHosts: [],
      ownsHost: async () => false,
      local: { dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => "0123456789ab" },
      post: async (tool, args) => {
        posted.push({ tool, args });
        return {
          status: 200,
          body: {
            text: JSON.stringify({
              code: "K7QMNP",
              page_url: "https://support.example.test/assist/K7QMNP",
              line_windows: "irm https://support.example.test/tc/K7QMNP/win | iex",
            }),
            owner: { principalId: "pr_alice", botId: "bot-1" },
          },
        };
      },
    });
    expect(out.isError).toBeFalsy();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.args).toMatchObject({ nodekey: NODEKEY, session: "0123456789ab" });
    expect(posted[0]!.args).not.toHaveProperty("host_id");
    expect(JSON.stringify(posted)).not.toContain(MODEL_KEY);
    expect(JSON.stringify(posted)).not.toContain("ffffffffffff");
  });

  it("refuses a host_id that is not attached to the bot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-open-guard-"));
    dirs.push(dir);
    const post = vi.fn();
    const out = await guardRemoteSupportOpen({
      args: { host_id: OTHER, nodekey: MODEL_KEY, session: "ffffffffffff" },
      botId: "bot-1",
      principalId: "pr_alice",
      ownerSub: "sub-alice",
      remoteHosts: [HOST],
      ownsHost: async () => true,
      local: { dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run },
      post,
    });
    expect(out).toEqual({ text: REMOTE_SUPPORT_OPEN_REFUSED, isError: true });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses an attached host the person does not own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-open-guard-"));
    dirs.push(dir);
    const post = vi.fn();
    const out = await guardRemoteSupportOpen({
      args: { host_id: OTHER, nodekey: MODEL_KEY },
      botId: "bot-1",
      principalId: "pr_alice",
      ownerSub: "sub-alice",
      remoteHosts: [OTHER],
      ownsHost: async () => false,
      local: { dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run },
      post,
    });
    expect(out).toEqual({ text: REMOTE_SUPPORT_OPEN_REFUSED, isError: true });
    expect(post).not.toHaveBeenCalled();
  });

  it("opens an attached owned host with a Sagax-generated key, ignoring model nodekey/session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-open-guard-"));
    dirs.push(dir);
    const posted: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const out = await guardRemoteSupportOpen({
      args: { host_id: HOST, nodekey: MODEL_KEY, session: "ffffffffffff", scope: "view-only" },
      botId: "bot-1",
      principalId: "pr_alice",
      ownerSub: "sub-alice",
      remoteHosts: [HOST],
      ownsHost: async (id) => id === HOST,
      local: { dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => "0123456789ab" },
      post: async (tool, args) => {
        posted.push({ tool, args });
        return {
          status: 200,
          body: {
            text: JSON.stringify({ code: "K7QMNP", state: "created", client: "app" }),
            owner: { principalId: "pr_alice", botId: "bot-1" },
          },
        };
      },
    });
    expect(out.isError).toBeFalsy();
    expect(posted[0]!.args).toMatchObject({
      host_id: HOST,
      nodekey: NODEKEY,
      session: "0123456789ab",
      scope: "view-only",
    });
    expect(JSON.stringify(posted)).not.toContain(MODEL_KEY);
    expect(JSON.stringify(posted)).not.toContain("ffffffffffff");
    expect(existsSync(join(dir, "sessions", "K7QMNP"))).toBe(true);
  });
});
