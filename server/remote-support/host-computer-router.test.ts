// Bot computers (#2726, #2727): a marked host is a Computer choice, a shell
// turn runs there without a session card, the isolated / as-is question is
// asked once and remembered, and the VM is provisioned on a mock host (with
// and without a hypervisor). No real host, no real command.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostComputerRouter, HOST_SESSION_FRESH_MS, HOST_SESSION_IDLE_MS, HOST_SESSION_LIFE_MS, NO_HYPERVISOR } from "./host-computer-router.ts";
import { createHostComputerStore } from "./host-computer-store.ts";
import type { UnattendedHostRow } from "../../shared/remote-unattended-host.ts";

const ALICE = "alice@example.test";
const FS01 = `h_${"a".repeat(32)}`;
const LAPTOP = `h_${"b".repeat(32)}`;
const NOW = Date.parse("2026-11-07T20:00:00Z");

function row(hostId: string, hostname: string, lastSeenAt: string | null = new Date(NOW - 30_000).toISOString()): UnattendedHostRow {
  return { hostId, hostname, org: "Example", scope: "full-control", installedBy: null, enrolledAt: "2026-11-01T00:00:00Z", expiresAt: "2027-11-01T00:00:00Z", lastSeenAt, revokedAt: null, state: "enrolled" } as UnattendedHostRow;
}

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(opts: {
  hypervisor?: boolean;
  access?: "always" | "ask" | "never";
  rows?: UnattendedHostRow[];
  /** Each person's own host list (person isolation); default: `rows` for everyone. */
  rowsOf?: (principalId: string) => UnattendedHostRow[];
  /** "Which bots" per host: absent = All bots. */
  scopes?: Record<string, string[]>;
  /** Which bots each person owns; default: every bot. */
  owns?: (principalId: string, botId: string) => boolean;
  consumeApproval?: (threadId: string, command: string) => boolean;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "host-computer-"));
  dirs.push(dir);
  const store = createHostComputerStore({ dataDir: dir, now: () => NOW });
  const rows = opts.rows ?? [row(FS01, "FS-01"), row(LAPTOP, "Laptop", null)];
  const commands: string[] = [];
  const sessions = new Set<string>();
  const open = vi.fn(async () => { sessions.add("s1"); return { ok: true as const, code: "K7QMNP", botId: "wren", threadId: "t-wren", session: "s1" }; });
  const exec = vi.fn(async ({ command }: { command: string }) => {
    commands.push(command);
    if (command.includes("command -v virsh")) return { host: "FS-01", os: "linux" as const, exitCode: 0, stdout: opts.hypervisor ? "libvirt\n" : "none\n", stderr: "", timedOut: false };
    return { host: "FS-01", os: "linux" as const, exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false };
  });
  const raiseQuestion = vi.fn(() => "req-1");
  const markQuiet = vi.fn();
  const router = createHostComputerRouter({
    store,
    hosts: {
      list: async (viewer) => ({ available: true as const, hosts: opts.rowsOf ? opts.rowsOf(viewer.principalId) : rows }),
      open,
      installCode: async () => ({ ok: true as const, code: "ABCD", enrollUrl: null, org: "Example", scope: "full-control" as const, expiresAt: null, installCommand: "sagax-remote-access install --unattended --code ABCD", installCommands: { macos: "sudo sagax-remote-access install --unattended --code ABCD", linux: "sudo sagax-remote-access install --unattended --code ABCD", windows: "sagax-remote-access.exe install --unattended --code ABCD" } }),
    },
    sessions: {
      target: ({ id }) => (id && sessions.has(id) ? { id, os: "linux" } : null),
      exec,
      screen: async () => null,
      close: async () => undefined,
      markQuiet,
    },
    botThread: (botId) => `t-${botId}`,
    botName: () => "Wren",
    access: () => opts.access ?? "always",
    ...(opts.scopes ? { botScope: (_principalId: string, hostId: string) => opts.scopes?.[hostId] ?? null } : {}),
    ...(opts.owns ? { ownsBot: opts.owns } : {}),
    consumeApproval: opts.consumeApproval ?? (() => false),
    raiseQuestion,
    now: () => NOW,
    // the background follow-up never runs in a test
    sleep: () => new Promise<void>(() => undefined),
  });
  return { router, store, open, exec, commands, raiseQuestion, markQuiet };
}

describe("host computer choices", () => {
  it("lists only the marked hosts, online first", async () => {
    const { router, store } = setup();
    expect(await router.choices(ALICE)).toEqual([]);
    store.update(ALICE, LAPTOP, { botComputer: true });
    store.update(ALICE, FS01, { botComputer: true, tags: ["nas", "unraid"] });
    const hosts = await router.choices(ALICE);
    expect(hosts.map((host) => host.name)).toEqual(["FS-01", "Laptop"]);
    expect(hosts[0]).toMatchObject({ online: true, tags: ["nas", "unraid"] });
    expect(hosts[1]).toMatchObject({ online: false });
  });

  it("refuses a host that is not marked", async () => {
    const { router } = setup();
    expect(await router.select(ALICE, "wren", FS01)).toMatchObject({ ok: false });
  });
});

describe("isolated or as-is question", () => {
  it("is asked once in the bot's chat when an Ask host is chosen, and remembered", async () => {
    const { router, store, raiseQuestion } = setup({ access: "ask" });
    store.update(ALICE, FS01, { botComputer: true });
    expect(await router.select(ALICE, "wren", FS01)).toEqual({ ok: true, asked: true });
    expect(raiseQuestion).toHaveBeenCalledTimes(1);
    expect((raiseQuestion.mock.calls[0] as unknown as [string])[0]).toBe("t-wren");
    const options = (raiseQuestion.mock.calls[0] as unknown as [string, { options: { id: string; label: string }[] }])[1].options;
    expect(options.map((option) => option.id)).toEqual(["isolated", "as_is"]);
    // a second pick while the question waits does not ask again
    await router.select(ALICE, "wren", FS01);
    expect(raiseQuestion).toHaveBeenCalledTimes(1);
    expect(router.answer("req-1", "as_is")).toMatchObject({ hostId: FS01, botId: "wren", mode: "as_is" });
    expect(store.mode(ALICE, FS01, "wren")).toBe("as_is");
    // remembered: picking it again asks nothing
    await router.select(ALICE, "wren", null);
    expect(await router.select(ALICE, "wren", FS01)).toEqual({ ok: true, asked: false });
    expect(raiseQuestion).toHaveBeenCalledTimes(1);
  });

  it("on an Ask host, an exec before the answer asks instead of running", async () => {
    const { router, store, exec } = setup({ access: "ask" });
    store.update(ALICE, FS01, { botComputer: true });
    store.setBotHost(ALICE, "wren", FS01);
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "uname -a" });
    expect(out.text).toMatch(/isolated VM/);
    expect(exec).not.toHaveBeenCalled();
  });

  // #3319: Always allow already says "work on it": no card, as-is recorded
  it("on an Always allow host, an exec runs as-is with no card and records as_is", async () => {
    const { router, store, exec, raiseQuestion } = setup({ access: "always", rows: [row(FS01, "FS-01")] });
    store.update(ALICE, FS01, { botComputer: true });
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "uname -a" });
    expect("isError" in out && out.isError).toBeFalsy();
    expect(JSON.parse(out.text)).toMatchObject({ where: "FS-01", exitCode: 0 });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(raiseQuestion).not.toHaveBeenCalled();
    expect(store.mode(ALICE, FS01, "wren")).toBe("as_is");
    // another bot of the person: no card either
    await router.call({ principalId: ALICE, botId: "finch", threadId: "t-finch", action: "exec", command: "ls" });
    expect(raiseQuestion).not.toHaveBeenCalled();
    expect(store.mode(ALICE, FS01, "finch")).toBe("as_is");
  });

  it("on an Always allow host, picking it in the menu or by the bot asks nothing", async () => {
    const { router, store, raiseQuestion } = setup({ access: "always" });
    store.update(ALICE, FS01, { botComputer: true });
    expect(await router.select(ALICE, "wren", FS01)).toEqual({ ok: true, asked: false });
    expect(await router.selectByBot(ALICE, "finch", "FS-01")).toMatchObject({ ok: true, asked: false });
    expect(raiseQuestion).not.toHaveBeenCalled();
    expect(store.mode(ALICE, FS01, "wren")).toBe("as_is");
    expect(store.mode(ALICE, FS01, "finch")).toBe("as_is");
    await router.views(ALICE);
    expect(router.turnNote(ALICE, "wren", "hello", false)).not.toMatch(/ask_mode/);
  });

  it("on an Always allow host, an earlier isolated answer is kept", async () => {
    const { router, store, exec, raiseQuestion } = setup({ access: "always", rows: [row(FS01, "FS-01")] });
    store.update(ALICE, FS01, { botComputer: true });
    store.setMode(ALICE, FS01, "wren", "isolated");
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" });
    expect(out.text).toMatch(/isolated environment/);
    expect(exec).not.toHaveBeenCalled();
    expect(raiseQuestion).not.toHaveBeenCalled();
    expect(store.mode(ALICE, FS01, "wren")).toBe("isolated");
    expect(await router.select(ALICE, "wren", FS01)).toEqual({ ok: true, asked: false });
    expect(store.mode(ALICE, FS01, "wren")).toBe("isolated");
  });

  it("on a Never host, the exec is still refused", async () => {
    const { router, store, exec } = setup({ access: "never", rows: [row(FS01, "FS-01")] });
    store.update(ALICE, FS01, { botComputer: true });
    store.setMode(ALICE, FS01, "wren", "as_is");
    expect((await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" })).text).toMatch(/Never/);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("as-is routing", () => {
  it("runs a shell turn on the host through a quiet session (no session card) and reuses it", async () => {
    const { router, store, open, exec, markQuiet } = setup();
    store.update(ALICE, FS01, { botComputer: true });
    store.setBotHost(ALICE, "wren", FS01);
    store.setMode(ALICE, FS01, "wren", "as_is");
    const first = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "df -h" });
    expect("isError" in first && first.isError).toBeFalsy();
    expect(JSON.parse(first.text)).toMatchObject({ where: "FS-01", exitCode: 0, stdout: "ok\n" });
    expect(markQuiet).toHaveBeenCalledWith("s1");
    await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls /mnt/user" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("respects Never and Ask on the host", async () => {
    const never = setup({ access: "never" });
    never.store.update(ALICE, FS01, { botComputer: true });
    never.store.setBotHost(ALICE, "wren", FS01);
    never.store.setMode(ALICE, FS01, "wren", "as_is");
    await never.router.choices(ALICE);
    expect(await never.router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" })).toMatchObject({ isError: true });
    expect(never.exec).not.toHaveBeenCalled();

    const ask = setup({ access: "ask" });
    ask.store.update(ALICE, FS01, { botComputer: true });
    ask.store.setBotHost(ALICE, "wren", FS01);
    ask.store.setMode(ALICE, FS01, "wren", "as_is");
    await ask.router.choices(ALICE);
    expect(ask.router.needsCard(ALICE, "wren", "rm -rf /tmp/x")).toBe(true);
    expect(ask.router.needsCard(ALICE, "wren", "ls /mnt")).toBe(false);
    expect(await ask.router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "rm -rf /tmp/x" })).toMatchObject({ isError: true });
  });

  it("a shell-only host has no screenshot", async () => {
    const { router, store } = setup();
    store.update(ALICE, FS01, { botComputer: true, shellOnly: true });
    store.setBotHost(ALICE, "wren", FS01);
    store.setMode(ALICE, FS01, "wren", "as_is");
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "screenshot" });
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toMatch(/shell only/);
  });
});

describe("isolated provisioning on a mock host", () => {
  it("with a hypervisor: starts a libvirt VM and shows its state", async () => {
    const { router, store, commands } = setup({ hypervisor: true });
    store.update(ALICE, FS01, { botComputer: true, os: "linux" });
    store.setBotHost(ALICE, "wren", FS01);
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "set_mode", mode: "isolated" });
    expect(out.text).toMatch(/KVM\/libvirt/);
    expect(commands.some((command) => command.includes("virsh"))).toBe(true);
    expect(store.mode(ALICE, FS01, "wren")).toBe("isolated");
    expect(store.host(ALICE, FS01)?.vm).toMatchObject({ engine: "libvirt", state: "provisioning" });
    // the VM is not one of the Computer choices
    expect((await router.choices(ALICE)).map((host) => host.name)).toEqual(["FS-01"]);
  });

  it("without a hypervisor: says so in one sentence and offers as-is", async () => {
    const { router, store } = setup({ hypervisor: false });
    store.update(ALICE, FS01, { botComputer: true, os: "linux" });
    store.setBotHost(ALICE, "wren", FS01);
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "vm_provision" });
    expect(out).toEqual({ text: NO_HYPERVISOR, isError: true });
    expect(store.host(ALICE, FS01)?.vm ?? null).toBeNull();
  });
});

describe("Auto hints", () => {
  it("lists the marked hosts with the ones whose tags the request names first", async () => {
    const { router, store } = setup();
    store.update(ALICE, LAPTOP, { botComputer: true, tags: ["gpu"] });
    store.update(ALICE, FS01, { botComputer: true, tags: ["nas"] });
    await router.views(ALICE);
    const note = router.turnNote(ALICE, "wren", "check the nas shares", true);
    expect(note).toMatch(/FS-01/);
    expect(note).toMatch(/prefer it/);
    expect(note).toMatch(/host_computer action exec and host set to its name/);
    expect(router.turnNote(ALICE, "wren", "hello", false)).toMatch(/nobody needs to pick it first/);
  });

  it("names no host the bot may not use", async () => {
    const { router, store } = setup({ scopes: { [FS01]: ["other-bot"], [LAPTOP]: ["other-bot"] } });
    store.update(ALICE, LAPTOP, { botComputer: true });
    store.update(ALICE, FS01, { botComputer: true });
    await router.views(ALICE);
    expect(router.turnNote(ALICE, "wren", "hello", true)).toBeNull();
  });
});

// A host marked as a bot computer and shared with All bots (or with the bot by
// name) is the bot's to use: no Computer menu pick first.
describe("hosts shared with the bot, no pick", () => {
  const BOB = "bob@example.test";
  const BOB_HOST = `h_${"c".repeat(32)}`;
  const isolated = () => setup({
    rowsOf: (principalId) => principalId === ALICE ? [row(FS01, "FS-01"), row(LAPTOP, "Laptop")] : [row(BOB_HOST, "Bob-Box")],
    owns: (principalId, botId) => (principalId === ALICE ? botId === "wren" : botId === "finch"),
  });

  it("runs exec on the owner's only All bots host without a pick", async () => {
    const { router, store, exec } = setup({ rows: [row(FS01, "FS-01")] });
    store.update(ALICE, FS01, { botComputer: true });
    store.setMode(ALICE, FS01, "wren", "as_is");
    expect(store.botHost(ALICE, "wren")).toBeNull();
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "uname -a" });
    expect("isError" in out && out.isError).toBeFalsy();
    expect(JSON.parse(out.text)).toMatchObject({ where: "FS-01", exitCode: 0 });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("with several hosts, takes one by name and the refusal lists the names", async () => {
    const { router, store, exec } = setup();
    store.update(ALICE, FS01, { botComputer: true });
    store.update(ALICE, LAPTOP, { botComputer: true });
    store.setMode(ALICE, FS01, "wren", "as_is");
    const refused = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/FS-01/);
    expect(refused.text).toMatch(/Laptop/);
    expect(refused.text).not.toMatch(/not a host/);
    const named = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls", host: "fs-01" });
    expect(JSON.parse(named.text)).toMatchObject({ where: "FS-01" });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("select_computer's list holds the host and the bot switches to it itself", async () => {
    const { router, store, raiseQuestion } = setup({ access: "ask" });
    store.update(ALICE, FS01, { botComputer: true });
    const { hosts } = await router.botHosts(ALICE, "wren");
    expect(hosts.map((host) => host.name)).toEqual(["FS-01"]);
    const picked = await router.selectByBot(ALICE, "wren", "FS-01");
    expect(picked).toMatchObject({ ok: true, host: { hostId: FS01 }, asked: true });
    expect(store.botHost(ALICE, "wren")).toBe(FS01);
    expect(raiseQuestion).toHaveBeenCalledTimes(1);
  });

  it("the host's access rule still decides: Ask gates a change, Never refuses", async () => {
    const ask = setup({ access: "ask", rows: [row(FS01, "FS-01")] });
    ask.store.update(ALICE, FS01, { botComputer: true });
    ask.store.setMode(ALICE, FS01, "wren", "as_is");
    await ask.router.views(ALICE);
    expect(ask.router.needsCard(ALICE, "wren", "rm -rf /tmp/x")).toBe(true);
    expect(ask.router.needsCard(ALICE, "wren", "ls /mnt")).toBe(false);
    expect(await ask.router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "rm -rf /tmp/x" })).toMatchObject({ isError: true });
    expect(ask.exec).not.toHaveBeenCalled();

    const never = setup({ access: "never", rows: [row(FS01, "FS-01")] });
    never.store.update(ALICE, FS01, { botComputer: true });
    never.store.setMode(ALICE, FS01, "wren", "as_is");
    expect((await never.router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" })).text).toMatch(/Never/);
    expect(never.exec).not.toHaveBeenCalled();
  });

  it("another person's host is neither listed nor reachable", async () => {
    const { router, store, exec, open } = isolated();
    store.update(ALICE, FS01, { botComputer: true });
    store.update(BOB, BOB_HOST, { botComputer: true });
    store.setMode(BOB, BOB_HOST, "wren", "as_is");
    // Alice speaking to her bot: only her host
    expect((await router.botHosts(ALICE, "wren")).hosts.map((host) => host.name)).toEqual(["FS-01"]);
    const byName = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls", host: "Bob-Box" });
    expect(byName).toMatchObject({ isError: true });
    expect(byName.text).toMatch(/Use one of: FS-01\.$/);
    expect((await router.selectByBot(ALICE, "wren", "Bob-Box")).ok).toBe(false);
    // Bob speaking to Alice's bot: his All bots host is for his own bots only
    expect((await router.botHosts(BOB, "wren")).hosts).toEqual([]);
    expect(await router.call({ principalId: BOB, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" })).toMatchObject({ isError: true });
    expect(router.turnNote(BOB, "wren", "hello", true)).toBeNull();
    expect(exec).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("a host colleague-shared with the person is not used without a pick", async () => {
    const shared: UnattendedHostRow = { ...row(BOB_HOST, "Bob-Box"), sharedBy: "Bob" };
    const { router, store, exec } = setup({ rows: [shared] });
    store.update(ALICE, BOB_HOST, { botComputer: true });
    store.setMode(ALICE, BOB_HOST, "wren", "as_is");
    expect((await router.botHosts(ALICE, "wren")).hosts).toEqual([]);
    expect(await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" })).toMatchObject({ isError: true });
    expect(exec).not.toHaveBeenCalled();
  });

  it("a host whose Which bots leaves the bot out is refused; one naming it is used", async () => {
    const { router, store, exec } = setup({ rows: [row(FS01, "FS-01"), row(LAPTOP, "Laptop")], scopes: { [FS01]: ["finch"], [LAPTOP]: ["wren"] } });
    store.update(ALICE, FS01, { botComputer: true });
    store.update(ALICE, LAPTOP, { botComputer: true });
    store.setMode(ALICE, FS01, "wren", "as_is");
    store.setMode(ALICE, LAPTOP, "wren", "as_is");
    expect((await router.botHosts(ALICE, "wren")).hosts.map((host) => host.name)).toEqual(["Laptop"]);
    const refused = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls", host: "FS-01" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/Laptop/);
    expect((await router.selectByBot(ALICE, "wren", "FS-01")).ok).toBe(false);
    const used = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" });
    expect(JSON.parse(used.text)).toMatchObject({ where: "Laptop" });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("a host not marked as a bot computer stays out", async () => {
    const { router, exec } = setup({ rows: [row(FS01, "FS-01")] });
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "ls" });
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toMatch(/Use as a bot computer/);
    expect(exec).not.toHaveBeenCalled();
  });
});

// #3393: one unattended session per person and host, shared by every bot of
// that person; an ended session is replaced; a command that did not run is
// an error with its reason.
describe("the person's session on a host (#3393)", () => {
  const BOB_PERSON = "bob@example.test";

  function shared(opts: {
    endAt?: string;
    failReused?: "ended" | "expired" | "live" | "no-tunnel";
    /** The host ends each session this long after it opened (#3492: its
     * first grant renewal is refused at 30 min): ssh answers 255 from then
     * on, while the local row stays connected with its own end time. */
    hostLifeMs?: number;
    /** The tunnel probe after a 255 (#3492); absent = no probe. */
    reachable?: (id: string) => boolean | null;
  } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "host-computer-"));
    dirs.push(dir);
    const store = createHostComputerStore({ dataDir: dir, now: () => NOW });
    // session id -> the bot whose row it is, its end time, still connected
    const rows = new Map<string, { botId: string; principalId: string; endAt: string; connected: boolean; openedAt: number }>();
    let opened = 0;
    let clock = NOW;
    const open = vi.fn(async (viewer: { principalId: string }, _hostId: string, options: { seatFor?: { botId: string } }) => {
      opened += 1;
      const session = `s${opened}`;
      rows.set(session, { botId: options.seatFor?.botId ?? "primary", principalId: viewer.principalId, endAt: opts.endAt ?? new Date(NOW + 30 * 60_000).toISOString(), connected: true, openedAt: clock });
      return { ok: true as const, code: `K7QMN${opened}`, botId: options.seatFor?.botId ?? "primary", threadId: "t", session };
    });
    const target = ({ principalId, botId, id }: { principalId: string; botId: string; id?: string }) => {
      const found = id ? rows.get(id) : undefined;
      return found && found.connected && found.botId === botId && found.principalId === principalId ? { id: id!, os: "linux", endAt: found.endAt } : null;
    };
    const exec = vi.fn(async (input: { principalId: string; botId: string; id?: string; command: string; actor?: string }) => {
      if (!target({ principalId: input.principalId, botId: input.botId, id: input.id })) return { error: "No remote session is connected in this conversation." };
      const at = rows.get(input.id!)!;
      if (opts.hostLifeMs !== undefined && clock - at.openedAt >= opts.hostLifeMs) return { error: "The remote computer did not answer (the tunnel is down or the session ended)." };
      if (opts.failReused && input.id === "s1" && exec.mock.calls.length > 1) {
        if (opts.failReused === "no-tunnel") return { error: "This server does not have the tunnel of that session." };
        // ssh exit 255 with no output: the session ended at the server, or
        // the command itself (or a dropped tunnel mid-run) gave 255
        if (opts.failReused === "ended") rows.get("s1")!.connected = false;
        if (opts.failReused === "expired") rows.get("s1")!.endAt = new Date(NOW - 1_000).toISOString();
        return { error: "The remote computer did not answer (the tunnel is down or the session ended)." };
      }
      return { host: "FS-01", os: "linux" as const, exitCode: 0, stdout: `${input.botId}\n`, stderr: "", timedOut: false };
    });
    const close = vi.fn(async (_principalId: string, _botId: string, id: string) => { const found = rows.get(id); if (found) found.connected = false; });
    const router = createHostComputerRouter({
      store,
      hosts: {
        // the host keeps beating: seen 30 s before the clock, wherever it is
        list: async () => ({ available: true as const, hosts: [row(FS01, "FS-01", new Date(clock - 30_000).toISOString())] }),
        open,
        installCode: async () => ({ ok: false as const, error: "unavailable" as const, message: "no" }),
      },
      sessions: {
        target, exec, screen: async () => null, close, markQuiet: vi.fn(),
        ...(opts.reachable ? { reachable: async ({ id }: { id: string }) => opts.reachable!(id) } : {}),
      },
      botThread: (botId) => `t-${botId}`,
      botName: () => "Bot",
      access: () => "always",
      consumeApproval: () => false,
      raiseQuestion: () => "req-1",
      now: () => clock,
      sleep: () => Promise.resolve(),
    });
    for (const person of [ALICE, BOB_PERSON]) store.update(person, FS01, { botComputer: true });
    const run = (principalId: string, botId: string, command = "whoami", timeoutMs?: number) => router.call({ principalId, botId, threadId: `t-${botId}`, action: "exec", command, host: "FS-01", ...(timeoutMs ? { timeoutMs } : {}) });
    return { router, open, exec, close, rows, run, tick: (ms: number) => { clock += ms; } };
  }

  // #3492: Sagax records the end time it asked for (2 hours), but the host
  // ends the session 30 minutes after it took it (its first grant renewal is
  // refused): the local row still says connected, 1 h 30 to go. Every
  // command then answered 255 on the dead session, which was never replaced.
  describe("the session's 30 minute life on the host (#3492)", () => {
    const TWO_HOURS = new Date(NOW + 2 * 60 * 60_000).toISOString();

    it("a session the host ended at 30 minutes is replaced before the next command, which runs once on the new one", async () => {
      const { open, exec, close, rows, run, tick } = shared({ endAt: TWO_HOURS, hostLifeMs: HOST_SESSION_LIFE_MS });
      expect(JSON.parse((await run(ALICE, "sagax-test")).text)).toMatchObject({ exitCode: 0 });
      tick(HOST_SESSION_LIFE_MS);
      // the local row is the production one: connected, its end 1 h 30 away
      expect(rows.get("s1")).toMatchObject({ connected: true, endAt: TWO_HOURS });
      const out = await run(ALICE, "ember");
      expect(out).not.toHaveProperty("isError");
      expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.map(([input]) => [input.id, input.actor])).toEqual([["s1", "sagax-test"], ["s2", "ember"]]);
    });

    it("use never pushes the end past 30 minutes from the open: a session used every 5 minutes is still replaced at 30 minutes", async () => {
      const { open, exec, run, tick } = shared({ endAt: TWO_HOURS, hostLifeMs: HOST_SESSION_LIFE_MS });
      await run(ALICE, "sagax-test");
      for (let minute = 5; minute < 30; minute += 5) {
        tick(5 * 60_000);
        expect(JSON.parse((await run(ALICE, "ember")).text)).toMatchObject({ exitCode: 0 });
      }
      expect(open).toHaveBeenCalledTimes(1);
      tick(5 * 60_000);
      const out = await run(ALICE, "architect");
      expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.at(-1)![0]).toMatchObject({ id: "s2", actor: "architect" });
      // a work of more than 30 minutes goes on: the new session has its own 30
      tick(29 * 60_000);
      expect(JSON.parse((await run(ALICE, "ember")).text)).toMatchObject({ exitCode: 0 });
      expect(open).toHaveBeenCalledTimes(2);
    });

    it("the end is never later than the gateway's own end time", async () => {
      const { open, run, tick } = shared({ endAt: new Date(NOW + 10 * 60_000).toISOString() });
      await run(ALICE, "sagax-test");
      tick(10 * 60_000);
      await run(ALICE, "ember");
      expect(open).toHaveBeenCalledTimes(2);
    });

    it("a 255 once the 30 minutes passed during the command is not run again, closes the session, and the next call opens a new one", async () => {
      const { open, exec, close, run, tick } = shared({ endAt: TWO_HOURS, hostLifeMs: HOST_SESSION_LIFE_MS });
      await run(ALICE, "sagax-test");
      tick(HOST_SESSION_LIFE_MS - 60_000);
      // sent at 29:00 with 60 s left (a 30 s command fits), the host ends the session during it
      exec.mockImplementationOnce(async () => {
        tick(60_000);
        return { error: "The remote computer did not answer (the tunnel is down or the session ended)." };
      });
      const out = await run(ALICE, "ember");
      expect(out).toMatchObject({ isError: true });
      expect(out.text).toMatch(/^The connection to FS-01 dropped during the command, so it may have run: /);
      expect(exec.mock.calls.map(([input]) => [input.id, input.actor])).toEqual([["s1", "sagax-test"], ["s1", "ember"]]);
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      expect(open).toHaveBeenCalledTimes(1);
      const next = await run(ALICE, "architect");
      expect(JSON.parse(next.text)).toMatchObject({ exitCode: 0 });
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.at(-1)![0]).toMatchObject({ id: "s2", actor: "architect" });
    });

    it("a 255 whose tunnel no longer answers closes the session (the command is not run again); one that answers keeps it", async () => {
      const dead = shared({ endAt: TWO_HOURS, failReused: "live", reachable: () => false });
      await dead.run(ALICE, "sagax-test");
      const out = await dead.run(ALICE, "ember");
      expect(out.text).toMatch(/^The connection to FS-01 dropped during the command, so it may have run: /);
      expect(dead.exec).toHaveBeenCalledTimes(2);
      expect(dead.close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      await dead.run(ALICE, "architect");
      expect(dead.open).toHaveBeenCalledTimes(2);

      const alive = shared({ endAt: TWO_HOURS, failReused: "live", reachable: () => true });
      await alive.run(ALICE, "sagax-test");
      await alive.run(ALICE, "ember");
      expect(alive.close).not.toHaveBeenCalled();
      await alive.run(ALICE, "architect");
      expect(alive.open).toHaveBeenCalledTimes(1);
    });

    it("a session whose tunnel is gone is replaced before the command is sent, which runs once on the new one", async () => {
      const asked: string[] = [];
      const { open, exec, close, run, tick } = shared({ endAt: TWO_HOURS, reachable: (id) => { asked.push(id); return id !== "s1"; } });
      await run(ALICE, "sagax-test");
      tick(2 * 60_000);
      const out = await run(ALICE, "ember", "make build");
      expect(out).not.toHaveProperty("isError");
      expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
      expect(asked).toEqual(["s1"]);
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.filter(([input]) => input.command === "make build").map(([input]) => input.id)).toEqual(["s2"]);
    });

    it("the tunnel is asked only after a minute without an answer, and a probe that could not ask keeps the session", async () => {
      let asked = 0;
      let answer: boolean | null = true;
      const { open, exec, run, tick } = shared({ endAt: TWO_HOURS, reachable: () => { asked += 1; return answer; } });
      await run(ALICE, "sagax-test");
      tick(HOST_SESSION_FRESH_MS - 1);
      await run(ALICE, "ember");
      expect(asked).toBe(0);
      tick(HOST_SESSION_FRESH_MS);
      await run(ALICE, "ember");
      expect(asked).toBe(1);
      // the answer counts: the next command within the minute is not preceded by a ping
      await run(ALICE, "architect");
      expect(asked).toBe(1);
      tick(HOST_SESSION_FRESH_MS);
      answer = null;
      expect(JSON.parse((await run(ALICE, "ember")).text)).toMatchObject({ exitCode: 0 });
      expect(asked).toBe(2);
      expect(open).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls.every(([input]) => input.id === "s1")).toBe(true);
    });

    it("a session running another bot's command is neither asked nor replaced for a long command", async () => {
      let asked = 0;
      const { open, exec, close, run, tick } = shared({ endAt: TWO_HOURS, reachable: () => { asked += 1; return asked === 1; } });
      await run(ALICE, "sagax-test");
      // 60 s left: the first command fits and its tunnel answers
      tick(HOST_SESSION_LIFE_MS - 60_000);
      let release: () => void = () => undefined;
      exec.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ exitCode: 0, stdout: "", stderr: "", timedOut: false }); }));
      const running = run(ALICE, "ember", "make test");
      await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(2));
      const queued = run(ALICE, "architect", "make build", 120_000);
      await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(3));
      release();
      await Promise.all([running, queued]);
      expect(close).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
      expect(asked).toBe(1);
    });

    it("a command longer than the time left opens a new session first and runs once there; a short one stays", async () => {
      const { open, exec, close, run, tick } = shared({ endAt: TWO_HOURS, hostLifeMs: HOST_SESSION_LIFE_MS });
      await run(ALICE, "sagax-test");
      tick(HOST_SESSION_LIFE_MS - 60_000);
      // 60 s left: a 30 s command fits
      expect(JSON.parse((await run(ALICE, "ember", "uptime", 30_000)).text)).toMatchObject({ exitCode: 0 });
      expect(exec.mock.calls.at(-1)![0]).toMatchObject({ id: "s1" });
      tick(30_000);
      // 30 s left: a 120 s build does not fit, a new session takes it
      const out = await run(ALICE, "ember", "make build", 120_000);
      expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.filter(([input]) => input.command === "make build").map(([input]) => input.id)).toEqual(["s2"]);
    });

    it("the idle sweep closes a session past its 30 minutes", async () => {
      const { router, close, run, tick } = shared({ endAt: TWO_HOURS });
      await run(ALICE, "sagax-test");
      tick(HOST_SESSION_LIFE_MS - 60_000);
      await run(ALICE, "ember");
      tick(60_000);
      expect(await router.sweep()).toBe(1);
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
    });
  });

  it("every bot of the same person reaches the host through the one open session", async () => {
    const { open, exec, run } = shared();
    for (const bot of ["sagax-test", "ember", "architect"]) {
      const out = await run(ALICE, bot);
      expect(out).not.toHaveProperty("isError");
      expect(JSON.parse(out.text)).toMatchObject({ where: "FS-01", exitCode: 0 });
    }
    expect(open).toHaveBeenCalledTimes(1);
    // the session row is the opener's: every exec goes through it
    expect(exec.mock.calls.map(([input]) => [input.id, input.botId])).toEqual([["s1", "sagax-test"], ["s1", "sagax-test"], ["s1", "sagax-test"]]);
    // the audit names the bot that asked for each command, not the opener
    expect(exec.mock.calls.map(([input]) => input.actor)).toEqual(["sagax-test", "ember", "architect"]);
  });

  it("never shares a session with another person", async () => {
    const { open, exec, run } = shared();
    await run(ALICE, "sagax-test");
    await run(BOB_PERSON, "ember");
    expect(open).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls.map(([input]) => [input.principalId, input.id])).toEqual([[ALICE, "s1"], [BOB_PERSON, "s2"]]);
  });

  it("a session past its end time is closed and the next exec opens a new one", async () => {
    const { open, exec, close, run } = shared({ endAt: new Date(NOW - 1_000).toISOString() });
    await run(ALICE, "sagax-test");
    const out = await run(ALICE, "perspicax-core");
    expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
    expect(exec.mock.calls.at(-1)![0]).toMatchObject({ id: "s2", botId: "perspicax-core" });
  });

  // The session was live when the command was sent: dead after a 255 means
  // it died during the command, which may have run. Never run it again; close
  // the dead session so the next call opens a new one.
  for (const variant of ["ended", "expired"] as const) {
    it(`a 255 on a session that ${variant === "ended" ? "closed" : "passed its end time"} during the command runs it once in all, closes the session, and the next call opens a new one`, async () => {
      const { open, exec, close, run } = shared({ failReused: variant });
      await run(ALICE, "sagax-test");
      const out = await run(ALICE, "ember");
      expect(out).toMatchObject({ isError: true });
      expect(out.text).toMatch(/^The connection to FS-01 dropped during the command, so it may have run: /);
      expect(exec.mock.calls.map(([input]) => [input.id, input.command, input.actor])).toEqual([["s1", "whoami", "sagax-test"], ["s1", "whoami", "ember"]]);
      expect(open).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
      const next = await run(ALICE, "architect");
      expect(JSON.parse(next.text)).toMatchObject({ exitCode: 0 });
      expect(open).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls.at(-1)![0]).toMatchObject({ id: "s2", actor: "architect" });
    });
  }

  it("a reused session with no tunnel here is replaced: the command was never sent", async () => {
    const { open, exec, close, run } = shared({ failReused: "no-tunnel" });
    await run(ALICE, "sagax-test");
    const out = await run(ALICE, "ember");
    expect(JSON.parse(out.text)).toMatchObject({ exitCode: 0 });
    expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
    expect(open).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls.map(([input]) => input.id)).toEqual(["s1", "s1", "s2"]);
  });

  it("a 255 on a session that is still live is neither run again nor a reason to close it", async () => {
    const { open, exec, close, run } = shared({ failReused: "live" });
    await run(ALICE, "sagax-test");
    const out = await run(ALICE, "ember");
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toMatch(/^The connection to FS-01 dropped during the command, so it may have run: The remote computer did not answer/);
    expect(exec.mock.calls.map(([input]) => input.id)).toEqual(["s1", "s1"]);
    expect(close).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    // the session stays the person's: the next call reuses it
    await run(ALICE, "architect");
    expect(open).toHaveBeenCalledTimes(1);
  });

  // #3430: the session closed at 18.5 minutes, not 30. A command running
  // (or waiting its turn on the tunnel) is a use: the idle sweep never closes
  // the session under it, and the idle time counts from its end.
  it("the idle sweep never closes a session with a command still running, and counts idle time from its end (#3430)", async () => {
    const { router, exec, close, run, tick } = shared();
    await run(ALICE, "sagax-test");
    let finish: () => void = () => undefined;
    exec.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return { host: "FS-01", os: "linux" as const, exitCode: 0, stdout: `${input.botId}\n`, stderr: "", timedOut: false };
    });
    const long = run(ALICE, "ember");
    await vi.waitFor(() => expect(exec).toHaveBeenCalledTimes(2));
    tick(HOST_SESSION_IDLE_MS + 60_000);
    expect(await router.sweep()).toBe(0);
    expect(close).not.toHaveBeenCalled();
    finish();
    expect(JSON.parse((await long).text)).toMatchObject({ exitCode: 0 });
    tick(HOST_SESSION_IDLE_MS - 60_000);
    expect(await router.sweep()).toBe(0);
    tick(2 * 60_000);
    expect(await router.sweep()).toBe(1);
    expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
  });

  it("a command that did not run is an error naming the host and the reason", async () => {
    const { exec, run } = shared();
    await run(ALICE, "sagax-test");
    exec.mockImplementation(async () => ({ error: "This server does not have the tunnel of that session." }));
    const out = await run(ALICE, "ember");
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toMatch(/^The command did not run on FS-01: This server does not have the tunnel/);
    expect(out.text).not.toMatch(/exit code/);
  });
});
