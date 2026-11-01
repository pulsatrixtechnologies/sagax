import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUnattendedHosts, HOST_REVOKE_TOOL, HOSTS_LIST_TOOL, type PerspicaxSeat } from "./remote-unattended-hosts.ts";
import type { TailcatRun } from "./remote-support-local.ts";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const HOST = `h_${"ab".repeat(16)}`;
const OTHER = `h_${"ef".repeat(16)}`;
const NODEKEY = `nodekey:${"cd".repeat(32)}`;
const OWNER = { principalId: "tech@example.org", botId: "bot-1" };
const TECH_SUB = "sub-tech";
const OTHER_SUB = "sub-other";

const hostRow = (over: Record<string, unknown> = {}) => ({
  host_id: HOST,
  hostname: "PC-A",
  scope: "view-only",
  created_at: "2026-10-01T00:00:00Z",
  expires_at: "2026-12-30T00:00:00Z",
  installed_by: TECH_SUB,
  ...over,
});

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const run: TailcatRun = async (args) => {
  if (args[0] === "genkey") {
    writeFileSync(String(args[3]), "{\"Private\":\"privkey:00\"}\n");
    return { code: 0, stdout: `${NODEKEY}\n`, stderr: "" };
  }
  return { code: 0, stdout: "", stderr: "" };
};

type Answer = { status: number; body: Record<string, unknown> };

function make(opts: {
  answers?: Record<string, (args: Record<string, unknown>) => Answer>;
  noSeat?: boolean;
  ownerSub?: string | null;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-hosts-"));
  dirs.push(dir);
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const ended = vi.fn(async () => {});
  const defaults: Record<string, (args: Record<string, unknown>) => Answer> = {
    [HOSTS_LIST_TOOL]: () => ok({ hosts: [hostRow()] }),
  };
  const seat: PerspicaxSeat = {
    botId: "bot-1",
    threadId: "thread-1",
    call: async (tool, args) => {
      calls.push({ tool, args });
      const answer = opts.answers?.[tool] ?? defaults[tool];
      return answer ? answer(args) : { status: 200, body: { text: "unknown tool", isError: true } };
    },
    end: ended,
  };
  const audit = vi.fn();
  const closeById = vi.fn(async () => true);
  const hosts = createUnattendedHosts({
    seat: async () => (opts.noSeat ? { error: "no link" } : seat),
    local: () => ({ dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => "0123456789ab" }),
    closeById,
    audit,
    ownerSub: () => (opts.ownerSub === undefined ? TECH_SUB : opts.ownerSub),
    statusEveryMs: 0,
    statusTries: 3,
    sleep: async () => {},
    now: () => NOW.getTime(),
  });
  return { hosts, calls, ended, audit, closeById, dir };
}

const ok = (value: unknown): Answer => ({ status: 200, body: { text: JSON.stringify(value), isError: false, owner: OWNER } });
const viewer = { principalId: "tech@example.org" };

describe("enrolled hosts at Perspicax", () => {
  it("lists the hosts and ends the link", async () => {
    const { hosts, calls, ended } = make({
      answers: { [HOSTS_LIST_TOOL]: () => ok({ hosts: [hostRow()] }) },
    });
    const out = await hosts.list(viewer);
    expect(out.available).toBe(true);
    expect(out.hosts.map((h) => [h.hostname, h.state, h.scope, h.installedBy])).toEqual([["PC-A", "enrolled", "view-only", TECH_SUB]]);
    expect(calls).toEqual([{ tool: HOSTS_LIST_TOOL, args: {} }]);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("says not available when Perspicax has no list tool yet, or no link", async () => {
    expect((await make({ answers: { [HOSTS_LIST_TOOL]: () => ({ status: 200, body: { text: "unknown", isError: true } }) } }).hosts.list(viewer)).available).toBe(false);
    expect(await make({ noSeat: true }).hosts.list(viewer)).toEqual({ available: false, hosts: [], reason: "no link" });
  });

  it("opens against host_id with a session key of its own, then follows the status until connected", async () => {
    let statuses = 0;
    const { hosts, calls, ended, audit, dir } = make({
      answers: {
        remote_support_open: () => ok({ code: "K7QMNP", state: "created", client: "app" }),
        remote_support_status: () => ok({ state: ++statuses >= 2 ? "connected" : "created", client: "app" }),
      },
    });
    const out = await hosts.open(viewer, HOST, { scope: "view-only" });
    expect(out).toEqual({ ok: true, code: "K7QMNP", botId: "bot-1", threadId: "thread-1" });
    const open = calls.find((c) => c.tool === "remote_support_open")!;
    expect(open.args).toMatchObject({ host_id: HOST, nodekey: NODEKEY, session: "0123456789ab", scope: "view-only", rights: "standard" });
    expect(open.args).not.toHaveProperty("code");
    // the private key stays in the session folder, never in a call
    expect(JSON.stringify(calls)).not.toContain("privkey");
    expect(existsSync(join(dir, "sessions", "K7QMNP"))).toBe(true);
    expect(readdirSync(join(dir, "pending"))).toEqual([]);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(2));
    expect(calls.filter((c) => c.tool === "remote_support_status")).toHaveLength(2);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "unattended.open",
      actor: "tech@example.org",
      hostId: HOST,
      ok: true,
      scope: "view-only",
      rights: "standard",
      botId: "bot-1",
    }));
  });

  it("refuses another person's host even when the list still returns the whole org", async () => {
    const { hosts, calls, audit } = make({
      answers: {
        [HOSTS_LIST_TOOL]: () => ok({
          hosts: [
            hostRow(),
            hostRow({ host_id: OTHER, hostname: "Bob-PC", installed_by: OTHER_SUB }),
          ],
        }),
        remote_support_open: () => ok({ code: "K7QMNP" }),
      },
    });
    expect(await hosts.open(viewer, OTHER)).toMatchObject({ ok: false, error: "not_found" });
    expect(calls.filter((c) => c.tool === "remote_support_open")).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "unattended.open",
      hostId: OTHER,
      ok: false,
      scope: "full-control",
      rights: "standard",
    }));
  });

  it("a refused open (revoked or expired host) leaves no key and ends the link", async () => {
    const { hosts, ended, audit, dir } = make({
      answers: { remote_support_open: () => ({ status: 200, body: { text: "not_found", isError: true } }) },
    });
    expect(await hosts.open(viewer, HOST)).toMatchObject({ ok: false, error: "refused" });
    expect(existsSync(join(dir, "sessions"))).toBe(false);
    expect(ended).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "unattended.open", ok: false, botId: "bot-1" }));
  });

  it("refuses a host id that is not h_ and 32 hex", async () => {
    const { hosts, calls } = make();
    expect(await hosts.open(viewer, "PC-01")).toMatchObject({ ok: false, error: "invalid" });
    expect(await hosts.revoke(viewer, "PC-01")).toMatchObject({ ok: false, error: "invalid" });
    expect(calls.filter((c) => c.tool !== HOSTS_LIST_TOOL)).toEqual([]);
  });

  it("revokes, audits the person who revoked (M4), and ends sessions opened here", async () => {
    const answers: Record<string, (args: Record<string, unknown>) => Answer> = {
      [HOSTS_LIST_TOOL]: () => ok({ hosts: [hostRow()] }),
      remote_support_open: () => ok({ code: "K7QMNP", state: "created" }),
      remote_support_status: () => ok({ state: "connected" }),
      [HOST_REVOKE_TOOL]: () => ok({ revoked: true }),
    };
    const dir = mkdtempSync(join(tmpdir(), "sagax-hosts-"));
    dirs.push(dir);
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const audit = vi.fn();
    const closeById = vi.fn(async () => true);
    const hosts = createUnattendedHosts({
      seat: async () => ({ botId: "bot-1", threadId: "thread-1", call: async (tool, args) => { calls.push({ tool, args }); return answers[tool]!(args); }, end: async () => {} }),
      local: () => ({ dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => "0123456789ab" }),
      closeById,
      audit,
      ownerSub: () => TECH_SUB,
      statusEveryMs: 0,
      statusTries: 1,
      sleep: async () => {},
    });
    expect((await hosts.open(viewer, HOST)).ok).toBe(true);
    expect(await hosts.revoke({ principalId: "boss@example.org" }, HOST, "  poste\nremplacé  ")).toEqual({ ok: true });
    expect(calls.find((c) => c.tool === HOST_REVOKE_TOOL)?.args).toEqual({ host_id: HOST, reason: "poste remplacé" });
    expect(closeById).toHaveBeenCalledWith("0123456789ab");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "remote_host.revoked", actor: "boss@example.org", hostId: HOST, ok: true, reason: "poste remplacé" }));
  });

  it("a refused revoke says so and closes nothing", async () => {
    const { hosts, closeById, calls } = make({ answers: { [HOST_REVOKE_TOOL]: () => ({ status: 200, body: { text: "not permitted", isError: true } }) } });
    expect(await hosts.revoke(viewer, HOST)).toMatchObject({ ok: false, error: "refused" });
    expect(closeById).not.toHaveBeenCalled();
    // No reason given: none sent (Perspicax decides who may revoke).
    expect(calls.find((c) => c.tool === HOST_REVOKE_TOOL)?.args).toEqual({ host_id: HOST });
  });
});
