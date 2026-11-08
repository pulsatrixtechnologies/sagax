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

function setup(opts: { hypervisor?: boolean; access?: "always" | "ask" | "never"; rows?: UnattendedHostRow[] } = {}) {
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
      list: async () => ({ available: true as const, hosts: rows }),
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
    consumeApproval: () => false,
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
  it("is asked once in the bot's chat when the host is chosen, and remembered", async () => {
    const { router, store, raiseQuestion } = setup();
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

  it("an exec before the answer asks instead of running", async () => {
    const { router, store, exec } = setup();
    store.update(ALICE, FS01, { botComputer: true });
    store.setBotHost(ALICE, "wren", FS01);
    const out = await router.call({ principalId: ALICE, botId: "wren", threadId: "t-wren", action: "exec", command: "uname -a" });
    expect(out.text).toMatch(/isolated VM/);
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
    expect(router.turnNote(ALICE, "wren", "hello", false)).toBeNull();
  });
});
