// My devices (2026-11-07): every Sagax desktop signed in to the account is
// one of the person's devices, with a per-device access level for bots
// (always, ask, never) that holds across reconnects and server restarts.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopBridges, type DesktopBridgeOperation, type DesktopBridgeRegistration } from "./desktop-bridge.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const secret = "c".repeat(64);
const registration = (name: string, platform: DesktopBridgeRegistration["platform"] = "darwin"): DesktopBridgeRegistration => ({
  id: randomUUID(), name, platform, attachmentsDir: "/var/folders/x/T/Sagax/attachments",
  capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true },
});
const shell: DesktopBridgeOperation = { action: "run_command", command: "echo hi" } as DesktopBridgeOperation;
const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function setup(file?: string) {
  let at = 1_000_000;
  const bridges = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : session.startsWith("bob") ? BOB : null), () => at, undefined, undefined, file);
  const mac = registration("Work MacBook");
  const mini = registration("Mac mini");
  bridges.register(mac, "ada-1", secret);
  at += 10;
  bridges.register(mini, "ada-2", secret);
  bridges.register(registration("Bob PC", "win32"), "bob-1", secret);
  return { bridges, mac, mini, later: (ms: number) => { at += ms; } };
}

describe("the person's devices", () => {
  it("lists every desktop of the person, this one first, never another person's", () => {
    const { bridges } = setup();
    const devices = bridges.devices(ADA, "ada-1");
    expect(devices.map((device) => [device.name, device.current, device.online, device.access, device.kind])).toEqual([
      ["Work MacBook", true, true, "always", "computer"],
      ["Mac mini", false, true, "always", "computer"],
    ]);
    expect(bridges.devices(BOB, "bob-1").map((device) => device.name)).toEqual(["Bob PC"]);
    expect(bridges.status(ADA).every((entry) => entry.access === "always")).toBe(true);
  });

  it("refuses an unknown access level and another person's device", () => {
    const { bridges } = setup();
    expect(() => bridges.setAccess(ADA, "mac mini", "sometimes" as never)).toThrow(/access/);
    expect(() => bridges.setAccess(BOB, "mac mini", "never")).toThrow(/not in your list/);
  });

  it("Never allow: the device leaves the bots' choice and a request naming it is refused", async () => {
    const { bridges, mac, mini } = setup();
    expect(bridges.current(ADA)?.id).toBe(mini.id);
    bridges.setAccess(ADA, "Mac mini", "never");
    expect(bridges.current(ADA)?.id).toBe(mac.id);
    expect(bridges.status(ADA).find((entry) => entry.id === mini.id)?.access).toBe("never");
    await expect(bridges.request(ADA, shell, () => true, undefined, mini.id)).rejects.toMatchObject({ code: "access_never", status: 403 });
    bridges.setAccess(ADA, "Work MacBook", "never");
    expect(bridges.connected(ADA)).toBe(false);
  });

  it("Ask every time: a bot's request waits on the approval, a denial runs nothing", async () => {
    const { bridges, mini } = setup();
    bridges.setAccess(ADA, mini.id, "ask");
    const asked: Array<{ name: string; botId: string }> = [];
    let answer = false;
    bridges.setAskHook(async ({ device, context }) => { asked.push({ name: device.name, botId: context.botId }); return answer; });
    await expect(bridges.request(ADA, shell, () => true, undefined, undefined, { botId: "b1", threadId: "t1" })).rejects.toMatchObject({ code: "access_denied" });
    expect(asked).toEqual([{ name: "Mac mini", botId: "b1" }]);
    answer = true;
    const pending = bridges.request(ADA, shell, () => true, undefined, undefined, { botId: "b1", threadId: "t1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const job = await bridges.poll(mini.id, "ada-2", secret, 0);
    expect(job?.operation).toEqual(shell);
    bridges.complete(mini.id, "ada-2", secret, job!.id, { ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("M-20261119-034: two Macs in Always allow, the old one connected last and silent for hours: a bot reads and runs on the Mac online, no card, never for another person", async () => {
    let at = 1_000_000;
    const bridges = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : session.startsWith("bob") ? BOB : null), () => at);
    const mac = registration("Jean-Example-Macbook-Pro.local");
    const old = registration("JeanExampleMBP.localdomain");
    bridges.register(mac, "ada-now", secret);
    at += 10;
    bridges.register(old, "ada-old", secret);
    bridges.setAccess(ADA, mac.id, "always");
    bridges.setAccess(ADA, old.id, "always");
    at += 3 * 60 * 60_000;
    bridges.register(mac, "ada-now", secret); // its app keeps polling
    expect(bridges.devices(ADA).map((device) => [device.name, device.online, device.access])).toEqual([
      ["Jean-Example-Macbook-Pro.local", true, "always"], ["JeanExampleMBP.localdomain", false, "always"],
    ]);
    expect(bridges.current(ADA)?.id).toBe(mac.id);
    bridges.setAskHook(async () => { throw new Error("Always allow raised a card"); });
    const context = { botId: "b1", threadId: "t1" };
    const read: DesktopBridgeOperation = { action: "read_file", path: "~/notes.md", max_bytes: 1000, encoding: "utf8" };
    for (const operation of [read, shell]) {
      const pending = bridges.request(ADA, operation, () => true, undefined, undefined, context);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const job = await bridges.poll(mac.id, "ada-now", secret, 0);
      expect(job?.operation).toEqual(operation);
      bridges.complete(mac.id, "ada-now", secret, job!.id, { content: [{ type: "text", text: "ok" }] });
      await expect(pending).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    }
    await expect(bridges.request(BOB, shell, () => true, undefined, undefined, context)).rejects.toMatchObject({ code: "not_connected" });
    await expect(bridges.request(BOB, shell, () => true, undefined, mac.id, context)).rejects.toMatchObject({ code: "not_connected" });
    expect(await bridges.poll(mac.id, "ada-now", secret, 0)).toBeNull();
  });

  it("honors a device revocation while a bot approval is pending", async () => {
    const { bridges, mini } = setup();
    bridges.setAccess(ADA, mini.id, "ask");
    bridges.setAskHook(async () => {
      bridges.setAccess(ADA, mini.id, "never");
      return true;
    });
    await expect(bridges.request(ADA, shell, () => true, undefined, mini.id, { botId: "b1", threadId: "t1" }))
      .rejects.toMatchObject({ code: "access_never" });
    expect(await bridges.poll(mini.id, "ada-2", secret, 0)).toBeNull();
  });

  it("keeps the access and the last presence across a reconnect and a server restart", () => {
    const folder = mkdtempSync(join(tmpdir(), "sagax-devices-")); folders.push(folder);
    const file = join(folder, "devices.json");
    const first = setup(file);
    first.bridges.setAccess(ADA, "Mac mini", "ask");
    // the app restarts: a new registration id, same computer
    const again = registration("Mac mini");
    first.bridges.register(again, "ada-2", secret);
    expect(first.bridges.devices(ADA, "ada-2").find((device) => device.name === "Mac mini")?.access).toBe("ask");
    const restarted = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : null), () => 9_000_000, undefined, undefined, file);
    const remembered = restarted.devices(ADA, "ada-9");
    expect(remembered.map((device) => [device.name, device.online, device.access])).toEqual([
      ["Mac mini", false, "ask"],
      ["Work MacBook", false, "always"],
    ]);
    expect(remembered[0]!.lastSeenAt).toBeGreaterThan(0);
    expect(remembered[0]!.desktopId).toBeNull();
  });

  it("forgets a removed device", () => {
    const { bridges, mini, later } = setup();
    bridges.setAccess(ADA, "Mac mini", "never");
    later(60_000);
    bridges.register(registration("Work MacBook"), "ada-1", secret);
    bridges.remove(ADA, mini.id);
    expect(bridges.devices(ADA, "ada-1").map((device) => device.name)).toEqual(["Work MacBook"]);
  });
});

describe("a remembered computer", () => {
  it("can be removed while its app is closed and the server restarted", () => {
    const folder = mkdtempSync(join(tmpdir(), "sagax-devices-")); folders.push(folder);
    const file = join(folder, "devices.json");
    setup(file);
    const restarted = new DesktopBridges((session) => (session.startsWith("ada") ? ADA : null), () => 9_000_000, undefined, undefined, file);
    restarted.remove(ADA, "mac mini");
    expect(restarted.devices(ADA).map((device) => device.name)).toEqual(["Work MacBook"]);
  });
});
