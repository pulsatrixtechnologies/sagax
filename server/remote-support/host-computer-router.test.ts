// Bot computers (#2726, #2727): a marked host is a Computer choice, a shell
// turn runs there without a session card, the isolated / as-is question is
// asked once and remembered, and the VM is provisioned on a mock host (with
// and without a hypervisor). No real host, no real command.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHostComputerRouter, NO_HYPERVISOR } from "./host-computer-router.ts";
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

  function shared(opts: { endAt?: string; failReused?: boolean } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "host-computer-"));
    dirs.push(dir);
    const store = createHostComputerStore({ dataDir: dir, now: () => NOW });
    // session id -> the bot whose row it is, its end time, still connected
    const rows = new Map<string, { botId: string; principalId: string; endAt: string; connected: boolean }>();
    let opened = 0;
    const open = vi.fn(async (viewer: { principalId: string }, _hostId: string, options: { seatFor?: { botId: string } }) => {
      opened += 1;
      const session = `s${opened}`;
      rows.set(session, { botId: options.seatFor?.botId ?? "primary", principalId: viewer.principalId, endAt: opts.endAt ?? new Date(NOW + 30 * 60_000).toISOString(), connected: true });
      return { ok: true as const, code: `K7QMN${opened}`, botId: options.seatFor?.botId ?? "primary", threadId: "t", session };
    });
    const target = ({ principalId, botId, id }: { principalId: string; botId: string; id?: string }) => {
      const found = id ? rows.get(id) : undefined;
      return found && found.connected && found.botId === botId && found.principalId === principalId ? { id: id!, os: "linux", endAt: found.endAt } : null;
    };
    const exec = vi.fn(async (input: { principalId: string; botId: string; id?: string; command: string }) => {
      if (!target({ principalId: input.principalId, botId: input.botId, id: input.id })) return { error: "No remote session is connected in this conversation." };
      if (opts.failReused && input.id === "s1" && exec.mock.calls.length > 1) return { error: "The remote computer did not answer (the tunnel is down or the session ended)." };
      return { host: "FS-01", os: "linux" as const, exitCode: 0, stdout: `${input.botId}\n`, stderr: "", timedOut: false };
    });
    const close = vi.fn(async (_principalId: string, _botId: string, id: string) => { const found = rows.get(id); if (found) found.connected = false; });
    const router = createHostComputerRouter({
      store,
      hosts: {
        list: async () => ({ available: true as const, hosts: [row(FS01, "FS-01")] }),
        open,
        installCode: async () => ({ ok: false as const, error: "unavailable" as const, message: "no" }),
      },
      sessions: { target, exec, screen: async () => null, close, markQuiet: vi.fn() },
      botThread: (botId) => `t-${botId}`,
      botName: () => "Bot",
      access: () => "always",
      consumeApproval: () => false,
      raiseQuestion: () => "req-1",
      now: () => NOW,
      sleep: () => Promise.resolve(),
    });
    for (const person of [ALICE, BOB_PERSON]) store.update(person, FS01, { botComputer: true });
    const run = (principalId: string, botId: string) => router.call({ principalId, botId, threadId: `t-${botId}`, action: "exec", command: "whoami", host: "FS-01" });
    return { router, open, exec, close, rows, run };
  }

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

  it("a reused session whose tunnel no longer answers is replaced and the command runs once there", async () => {
    const { open, exec, close, run } = shared({ failReused: true });
    await run(ALICE, "sagax-test");
    const out = await run(ALICE, "sagax-test");
    expect(out).not.toHaveProperty("isError");
    expect(JSON.parse(out.text)).toMatchObject({ where: "FS-01", exitCode: 0 });
    expect(open).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(ALICE, "sagax-test", "s1");
    expect(exec.mock.calls.map(([input]) => input.id)).toEqual(["s1", "s1", "s2"]);
  });

  it("a command that did not run is an error naming the host and the reason", async () => {
    const { exec, run, rows } = shared();
    await run(ALICE, "sagax-test");
    exec.mockImplementation(async () => ({ error: "The remote computer did not answer (the tunnel is down or the session ended)." }));
    rows.set("s2", { botId: "x", principalId: ALICE, endAt: new Date(NOW + 60_000).toISOString(), connected: true });
    const out = await run(ALICE, "ember");
    expect(out).toMatchObject({ isError: true });
    expect(out.text).toMatch(/^The command did not run on FS-01: The remote computer did not answer/);
    expect(out.text).not.toMatch(/exit code/);
  });
});
