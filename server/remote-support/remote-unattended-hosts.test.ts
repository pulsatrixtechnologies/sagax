import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUnattendedHosts, HOST_CODE_TOOL, HOST_REVOKE_TOOL, hostInstallCommand, HOSTS_LIST_TOOL, type PerspicaxSeat } from "./remote-unattended-hosts.ts";
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

type Sharing = NonNullable<Parameters<typeof createUnattendedHosts>[0]["sharing"]>;

function make(opts: {
  /** The answer may look at the seat's principal (owner seats of shared hosts, #2957). */
  answers?: Record<string, (args: Record<string, unknown>, principal: string) => Answer>;
  noSeat?: boolean;
  ownerSub?: string | null;
  /** Per-person subs; falls back to ownerSub for the viewer. */
  subs?: Record<string, string>;
  sharing?: Sharing;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-hosts-"));
  dirs.push(dir);
  const calls: Array<{ tool: string; args: Record<string, unknown>; principal: string }> = [];
  const seats: Array<{ principalId: string; seatFor?: unknown }> = [];
  const ended = vi.fn(async () => {});
  const defaults: Record<string, (args: Record<string, unknown>, principal: string) => Answer> = {
    [HOSTS_LIST_TOOL]: () => ok({ hosts: [hostRow()] }),
  };
  const seatOf = (principal: string): PerspicaxSeat => ({
    botId: "bot-1",
    threadId: "thread-1",
    call: async (tool, args) => {
      calls.push({ tool, args, principal });
      const answer = opts.answers?.[tool] ?? defaults[tool];
      return answer ? answer(args, principal) : { status: 200, body: { text: "unknown tool", isError: true } };
    },
    end: ended,
  });
  const audit = vi.fn();
  const closeById = vi.fn(async () => true);
  const hosts = createUnattendedHosts({
    seat: async (principalId, seatFor) => {
      seats.push({ principalId, ...(seatFor ? { seatFor } : {}) });
      return opts.noSeat ? { error: "no link" } : seatOf(principalId);
    },
    local: () => ({ dir, technicianName: "Ada", orgName: "Acme", now: () => NOW, run, sessionId: () => "0123456789ab" }),
    closeById,
    audit,
    ownerSub: (principalId) => opts.subs?.[principalId] ?? (opts.ownerSub === undefined ? TECH_SUB : opts.ownerSub),
    ...(opts.sharing ? { sharing: opts.sharing } : {}),
    statusEveryMs: 0,
    statusTries: 3,
    sleep: async () => {},
    now: () => NOW.getTime(),
  });
  return { hosts, calls, seats, ended, audit, closeById, dir };
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
    expect(calls.map(({ tool, args }) => ({ tool, args }))).toEqual([{ tool: HOSTS_LIST_TOOL, args: {} }]);
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
    expect(out).toEqual({ ok: true, code: "K7QMNP", botId: "bot-1", threadId: "thread-1", session: "0123456789ab" });
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

  // #3505: a session the host never took stayed open at the gateway and
  // counted in its limit of waiting sessions.
  it("closes at the gateway a session the host never took, once, through the seat that opened it", async () => {
    const { hosts, calls, seats, ended, dir } = make({
      answers: {
        remote_support_open: () => ok({ code: "K7QMNP", state: "created", client: "app" }),
        remote_support_status: () => ok({ state: "created", client: "app" }),
        remote_support_close: () => ok({ state: "cancelled" }),
      },
    });
    const seatFor = { botId: "bot-1", threadId: "t-1" };
    const out = await hosts.open(viewer, HOST, { seatFor });
    expect(out).toMatchObject({ ok: true, session: "0123456789ab" });
    // another person never closes it
    expect(await hosts.closeUnconnected({ principalId: "other@example.org" }, "0123456789ab")).toBe(false);
    expect(calls.filter((c) => c.tool === "remote_support_close")).toEqual([]);
    expect(await hosts.closeUnconnected(viewer, "0123456789ab")).toBe(true);
    expect(calls.filter((c) => c.tool === "remote_support_close")).toEqual([{ tool: "remote_support_close", args: { code: "K7QMNP", outcome: "cancelled" }, principal: "tech@example.org" }]);
    expect(seats.at(-1)).toEqual({ principalId: "tech@example.org", seatFor });
    // the closed marker is left, so a late status cannot bring the tunnel back
    expect(existsSync(join(dir, "sessions", "K7QMNP", "closed"))).toBe(true);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(3));
    // once: a second ask posts nothing
    expect(await hosts.closeUnconnected(viewer, "0123456789ab")).toBe(false);
    expect(calls.filter((c) => c.tool === "remote_support_close")).toHaveLength(1);
    // a session this server never opened is not closed
    expect(await hosts.closeUnconnected(viewer, "ffffffffffff")).toBe(false);
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

describe("install code (Computers panel, 2026-11-06)", () => {
  it("asks Perspicax for a host code and returns the install command", async () => {
    const { hosts, calls } = make({ answers: { [HOST_CODE_TOOL]: () => ok({ code: "K7QM-NP42", enroll_url: "https://example.com/e/K7QM", org: "Acme", scope: "view-only", expires_at: "2026-10-26T12:15:00Z" }) } });
    const out = await hosts.installCode(viewer, { scope: "view-only", consentRef: "CW-123" });
    expect(calls.find((c) => c.tool === HOST_CODE_TOOL)?.args).toEqual({ org: "Acme", scope: "view-only", consent_ref: "CW-123" });
    expect(out).toMatchObject({ ok: true, code: "K7QM-NP42", enrollUrl: "https://example.com/e/K7QM", org: "Acme", scope: "view-only", expiresAt: "2026-10-26T12:15:00.000Z" });
    expect(out.ok && out.installCommand).toBe(hostInstallCommand({ org: "Acme", code: "K7QM-NP42", scope: "view-only", recordedBy: "Ada" }));
  });

  it("defaults to full-control and reports a missing code or seat", async () => {
    const empty = make({ answers: { [HOST_CODE_TOOL]: () => ok({}) } });
    expect(await empty.hosts.installCode(viewer, { scope: "bogus" })).toMatchObject({ ok: false, error: "refused" });
    expect(empty.calls.find((c) => c.tool === HOST_CODE_TOOL)?.args).toEqual({ org: "Acme", scope: "full-control" });
    expect(await make({ noSeat: true }).hosts.installCode(viewer)).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("quotes every value of the install command", () => {
    expect(hostInstallCommand({ org: "Exemple inc.", code: "AB-12", scope: "shell-only", recordedBy: "" }))
      .toBe('sagax-remote-access install --unattended --org "Exemple inc." --code "AB-12" --scope shell-only --consent-recorded-by "Sagax"');
  });
});

describe("shared hosts and bot scope (#2957)", () => {
  const MARIE = "marie@example.org";
  const MARIE_SUB = "sub-marie";
  const sharing = (over: Partial<Sharing> = {}): Sharing => ({
    sharedWith: (principalId) => (principalId === viewer.principalId ? [{ hostId: OTHER, owner: MARIE }] : []),
    ownerName: (principalId) => (principalId === MARIE ? "Marie Tremblay" : principalId),
    botAllowed: () => true,
    botName: () => "Nova",
    ...over,
  });
  // Each seat lists its own hosts: the viewer's PC-A, Marie's SRV-B.
  const listByPrincipal = (_args: Record<string, unknown>, principal: string) => ok({
    hosts: principal === MARIE
      ? [hostRow({ host_id: OTHER, hostname: "SRV-B", installed_by: MARIE_SUB })]
      : [hostRow()],
  });

  it("lists a host shared with the viewer from its owner's seat, marked Shared by", async () => {
    const { hosts, seats } = make({ answers: { [HOSTS_LIST_TOOL]: listByPrincipal }, subs: { [MARIE]: MARIE_SUB }, sharing: sharing() });
    const out = await hosts.list(viewer);
    expect(out.available).toBe(true);
    expect(out.hosts.map((row) => [row.hostId, row.hostname, row.sharedBy ?? null])).toEqual([
      [HOST, "PC-A", null],
      [OTHER, "SRV-B", "Marie Tremblay"],
    ]);
    expect(seats.map((seat) => seat.principalId)).toEqual([viewer.principalId, MARIE]);
    // a stranger (no share) sees only their own
    const alone = make({ answers: { [HOSTS_LIST_TOOL]: listByPrincipal }, sharing: sharing({ sharedWith: () => [] }) });
    expect((await alone.hosts.list({ principalId: "bob@example.org" })).hosts.map((row) => row.hostId)).toEqual([HOST]);
  });

  it("opens a shared host through the owner's seat; the viewer stays the actor", async () => {
    const { hosts, calls, seats, audit } = make({
      answers: {
        [HOSTS_LIST_TOOL]: listByPrincipal,
        remote_support_open: () => ok({ code: "K7QMNP", state: "connected", client: "app" }),
        remote_support_status: () => ok({ state: "connected", client: "app" }),
      },
      subs: { [MARIE]: MARIE_SUB },
      sharing: sharing(),
    });
    const out = await hosts.open(viewer, OTHER, { scope: "view-only" });
    expect(out).toMatchObject({ ok: true, code: "K7QMNP" });
    const open = calls.find((c) => c.tool === "remote_support_open")!;
    expect(open.principal).toBe(MARIE);
    expect(open.args).toMatchObject({ host_id: OTHER, scope: "view-only" });
    expect(seats.at(-1)).toEqual({ principalId: MARIE });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "unattended.open", actor: viewer.principalId, hostId: OTHER, ok: true }));
  });

  it("refuses a bot outside the host's bot scope before any Perspicax call", async () => {
    const { hosts, calls, audit } = make({
      answers: { remote_support_open: () => ok({ code: "K7QMNP" }) },
      sharing: sharing({ botAllowed: (_who, hostId, botId) => !(hostId === HOST && botId === "bot-nova") }),
    });
    const refused = await hosts.open(viewer, HOST, { seatFor: { botId: "bot-nova", threadId: "t-1" } });
    expect(refused).toMatchObject({ ok: false, error: "refused" });
    expect((refused as { message: string }).message).toContain("Refused by Sagax: Nova is not allowed on PC-A");
    expect(calls.filter((c) => c.tool === "remote_support_open")).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "unattended.open", hostId: HOST, ok: false, botId: "bot-nova" }));
    // an allowed bot (or the page itself, no bot) goes through
    const allowed = await hosts.open(viewer, HOST, { seatFor: { botId: "bot-atlas", threadId: "t-1" } });
    expect(allowed).toMatchObject({ ok: true, code: "K7QMNP" });
  });
});
