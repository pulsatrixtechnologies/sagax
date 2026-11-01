// The desktop bridge (server/desktop-bridge.ts): where a turn's tools run on
// an organization server (the routing table), and that a bridge relays only
// for the signed-in person who connected it, only while connected.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DesktopBridges, desktopBridgeCapability, desktopBridgeOperation, resolveBotWorkplace, type DesktopBridgeRegistration } from "./desktop-bridge.ts";
import { localVmDesktopSpec } from "./container-computer.ts";
import { desktopToolOperation, handleDesktopBridgeMcp } from "./desktop-bridge-tools.ts";
import { DEFAULT_BOT_WORKPLACE, parseBotWorkplace, serializeBotWorkplace } from "../shared/bot-workplace.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const secret = "a".repeat(64);
const registration = (name = "Ada's Mac"): DesktopBridgeRegistration => ({
  id: randomUUID(), name, platform: "darwin", attachmentsDir: "/var/folders/x/T/Sagax/attachments",
  capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true },
});

describe("where a turn's tools run (organization server)", () => {
  const base = {
    organization: true, sandboxConfigured: true, desktopTargeted: false, routine: false,
    principal: ADA, personAsked: true, preference: { ...DEFAULT_BOT_WORKPLACE }, desktopConnected: true,
  };
  it("solo server: its own machine, unchanged", () => {
    expect(resolveBotWorkplace({ ...base, organization: false })).toMatchObject({ target: "host", reason: "solo" });
  });
  it("Auto and Cloud: the speaker's server environment, even with their desktop connected", () => {
    expect(resolveBotWorkplace(base)).toEqual({ target: "user-sandbox", principal: ADA, reason: "server-default", fallback: false });
    expect(resolveBotWorkplace({ ...base, desktopConnected: false })).toMatchObject({ target: "user-sandbox", reason: "server-default" });
    expect(resolveBotWorkplace({ ...base, sandboxConfigured: false })).toMatchObject({ target: "none" });
    // The old per-person switch no longer decides.
    expect(resolveBotWorkplace({ ...base, preference: { ...DEFAULT_BOT_WORKPLACE, place: "computer" } })).toMatchObject({ target: "user-sandbox" });
  });
  it("Local VM or This computer: the speaker's own computer, said when it is not connected", () => {
    expect(resolveBotWorkplace({ ...base, desktopTargeted: true })).toEqual({ target: "user-desktop", principal: ADA, reason: "desktop", fallback: false });
    expect(resolveBotWorkplace({ ...base, desktopTargeted: true, desktopConnected: false })).toMatchObject({ target: "user-desktop", reason: "pinned-desktop" });
  });
  it("routines: the owner's sandbox unless the bot works on their computer, it is connected AND they allowed routines on it", () => {
    const routine = { ...base, routine: true, personAsked: false, desktopTargeted: true };
    expect(resolveBotWorkplace(routine)).toMatchObject({ target: "user-sandbox", reason: "routine-not-allowed" });
    const allowed = { ...routine, preference: { ...DEFAULT_BOT_WORKPLACE, routines: true } };
    expect(resolveBotWorkplace(allowed)).toMatchObject({ target: "user-desktop", reason: "desktop" });
    expect(resolveBotWorkplace({ ...allowed, desktopConnected: false })).toMatchObject({ target: "user-sandbox" });
    expect(resolveBotWorkplace({ ...allowed, desktopTargeted: false })).toMatchObject({ target: "user-sandbox" });
  });
  it("rooms: the person whose message triggered the turn; a follow-up nobody asked for never reaches a computer", () => {
    expect(resolveBotWorkplace({ ...base, principal: BOB, desktopTargeted: true })).toMatchObject({ target: "user-desktop", principal: BOB });
    expect(resolveBotWorkplace({ ...base, personAsked: false, desktopTargeted: true })).toMatchObject({ target: "user-sandbox", reason: "no-person" });
  });
  it("nobody known: nothing at all", () => {
    expect(resolveBotWorkplace({ ...base, principal: null })).toMatchObject({ target: "none", principal: null });
  });
  it("the preference reads defensively", () => {
    expect(parseBotWorkplace(undefined)).toEqual({ place: "computer", routines: false, network: "all" });
    expect(parseBotWorkplace("{bad")).toEqual({ place: "computer", routines: false, network: "all" });
    expect(parseBotWorkplace(serializeBotWorkplace({ place: "server", routines: true, network: "lan" }))).toEqual({ place: "server", routines: true, network: "lan" });
  });

  it("accepts staged file offsets through the 1 GB video ceiling", () => {
    expect(desktopBridgeOperation.safeParse({ action: "stage_file", name: "clip.mp4", content: "eA==", offset: 250 * 1024 * 1024 }).success).toBe(true);
    expect(desktopBridgeOperation.safeParse({ action: "stage_file", name: "clip.mp4", content: "eA==", offset: 1024 * 1024 * 1024 + 1 }).success).toBe(false);
  });
});

function hub() {
  const people = new Map([["ada-session", ADA], ["bob-session", BOB]]);
  const bridges = new DesktopBridges((session) => people.get(session) ?? null);
  return { bridges, people };
}

describe("the organization's desktops for the admin console", () => {
  it("lists each desktop with its person, name, platform and presence, and nothing secret", () => {
    const { bridges, people } = hub();
    const desktop = { ...registration(), version: "0.4.20" };
    bridges.register(desktop, "ada-session", secret);
    bridges.register(registration("Bob's PC"), "bob-session", "b".repeat(64));
    const listed = bridges.inventory();
    expect(listed.find((entry) => entry.person === ADA)).toEqual({ person: ADA, id: desktop.id, name: "Ada's Mac", platform: "darwin", online: true, lastSeenAt: expect.any(Number), localVm: true, version: "0.4.20" });
    // the secrets themselves, not a pattern: a random desktop id can hold "aaaa"
    const json = JSON.stringify(listed);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("b".repeat(64));
    expect(json).not.toMatch(/session|attachments/);
    // a session that ended takes its desktop away
    people.delete("bob-session");
    expect(bridges.inventory().map((entry) => entry.person)).toEqual([ADA]);
  });
});

describe("the bridge relays only for its own signed-in person", () => {
  it("binds the desktop to the session's person, never to the body", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    expect(bridges.connected(ADA)).toBe(true);
    expect(bridges.connected(BOB)).toBe(false);
    expect(bridges.current(ADA.toUpperCase())?.id).toBe(desktop.id);
  });

  it("a bot turn for Bob never reaches Ada's desktop", async () => {
    const { bridges } = hub();
    bridges.register(registration(), "ada-session", secret);
    await expect(bridges.request(BOB, { action: "run_command", command: "id" }, () => true)).rejects.toMatchObject({ code: "not_connected" });
    await expect(bridges.request(null, { action: "run_command", command: "id" }, () => true)).rejects.toMatchObject({ code: "no_person" });
  });

  it("another session cannot poll, answer or tunnel for a desktop it did not register, even with its secret", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    await expect(bridges.poll(desktop.id, "bob-session", secret, 10)).rejects.toMatchObject({ status: 403 });
    expect(bridges.owns(desktop.id, "bob-session", secret)).toBe(false);
    expect(bridges.owns(desktop.id, "ada-session", "b".repeat(64))).toBe(false);
    expect(bridges.owns(desktop.id, "ada-session", secret)).toBe(true);
  });

  it("a session that is now someone else's (or ended) relays for nobody and the bridge closes", async () => {
    const { bridges, people } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    const pending = bridges.request(ADA, { action: "run_command", command: "sleep 1" }, () => true);
    people.set("ada-session", BOB);
    await expect(bridges.poll(desktop.id, "ada-session", secret, 10)).rejects.toMatchObject({ status: 403 });
    await expect(pending).rejects.toThrow(/not connected/);
    expect(bridges.connected(ADA)).toBe(false);
    expect(bridges.connected(BOB)).toBe(false);
  });

  it("round trip: queued for the person's desktop, polled, answered; refused after the turn ended", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    let live = true;
    const answer = bridges.request(ADA, { action: "read_file", path: "~/notes.md" }, () => live);
    const job = await bridges.poll(desktop.id, "ada-session", secret, 10);
    expect(job?.operation).toEqual({ action: "read_file", path: "~/notes.md" });
    bridges.complete(desktop.id, "ada-session", secret, job!.id, { content: [{ type: "text", text: "hello" }] });
    await expect(answer).resolves.toEqual({ content: [{ type: "text", text: "hello" }] });
    live = false;
    await expect(bridges.request(ADA, { action: "list_files" }, () => live)).rejects.toThrow(/turn ended/);
  });

  it("a person with two computers reaches the one they picked, never another person's", async () => {
    const { bridges, people } = hub();
    people.set("ada-pc-session", ADA);
    const mac = registration("Ada's Mac");
    const pc = registration("ADA-PC");
    const bobs = registration("Bob's PC");
    bridges.register(mac, "ada-session", secret);
    bridges.register(pc, "ada-pc-session", secret);
    bridges.register(bobs, "bob-session", secret);
    const answer = bridges.request(ADA, { action: "vm_status" }, () => true, undefined, mac.id);
    expect(await bridges.poll(pc.id, "ada-pc-session", secret, 10)).toBeNull();
    const job = await bridges.poll(mac.id, "ada-session", secret, 10);
    expect(job?.operation).toEqual({ action: "vm_status" });
    bridges.complete(mac.id, "ada-session", secret, job!.id, { status: "running" });
    await expect(answer).resolves.toEqual({ status: "running" });
    await expect(bridges.request(ADA, { action: "vm_status" }, () => true, undefined, bobs.id)).rejects.toMatchObject({ code: "not_connected", message: expect.stringMatching(/pick another computer/) });
    expect(bridges.status(ADA).map((desktop) => desktop.name).sort()).toEqual(["ADA-PC", "Ada's Mac"]);
  });

  it("an action the desktop does not offer is refused before it is queued", async () => {
    const { bridges } = hub();
    bridges.register(registration(), "ada-session", secret);
    await expect(bridges.request(ADA, { action: "computer_tools" }, () => true)).rejects.toMatchObject({ code: "capability" });
  });

  it("Local VM creation: the desktop's progress reaches the turn, only for a live job of that desktop, bounded", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    const other = registration("Bob's PC");
    bridges.register(other, "bob-session", secret);
    let live = true;
    const steps: string[] = [];
    const answer = bridges.request(ADA, { action: "vm_create", timeout_seconds: 600 }, () => live, (message) => steps.push(message));
    const job = await bridges.poll(desktop.id, "ada-session", secret, 10);
    expect(job?.operation).toEqual({ action: "vm_create", timeout_seconds: 600 });
    expect(bridges.progress(desktop.id, "ada-session", secret, job!.id, "Creating the Local VM\u001b[2J")).toBe(true);
    expect(bridges.progress(desktop.id, "ada-session", secret, job!.id, 42)).toBe(false);
    expect(bridges.progress(desktop.id, "ada-session", secret, "not-a-job", "x")).toBe(false);
    expect(() => bridges.progress(desktop.id, "bob-session", secret, job!.id, "spoofed")).toThrow();
    expect(bridges.progress(other.id, "bob-session", secret, job!.id, "spoofed")).toBe(false);
    for (let index = 0; index < 60; index++) bridges.progress(desktop.id, "ada-session", secret, job!.id, `step ${index}`);
    expect(steps[0]).toBe("Creating the Local VM [2J");
    expect(steps).toHaveLength(50);
    expect(steps.join()).not.toContain("spoofed");
    live = false;
    expect(bridges.progress(desktop.id, "ada-session", secret, job!.id, "after the turn")).toBe(false);
    live = true;
    bridges.complete(desktop.id, "ada-session", secret, job!.id, { content: [{ type: "text", text: "ready" }] });
    await expect(answer).resolves.toEqual({ content: [{ type: "text", text: "ready" }] });
  });

  it("status shows only the person's own desktops, without secrets", () => {
    const { bridges } = hub();
    bridges.register(registration("Ada's Mac"), "ada-session", secret);
    bridges.register(registration("Bob's PC"), "bob-session", secret);
    const mine = bridges.status(ADA);
    expect(mine.map((entry) => entry.name)).toEqual(["Ada's Mac"]);
    expect(JSON.stringify(mine)).not.toContain(secret);
  });
});

describe("the sagax-desktop tools", () => {
  it("become typed operations, rejecting bad arguments", () => {
    expect(desktopToolOperation("run_command", { command: "ls", timeout_seconds: 9999 })).toMatchObject({ action: "run_command", command: "ls", timeout_seconds: 600 });
    expect(desktopToolOperation("local_vm", { action: "run", command: "uname" })).toMatchObject({ action: "vm_run_command", command: "uname" });
    // the server's own recipe goes with it; the desktop checks it
    expect(desktopToolOperation("local_vm", { action: "create" })).toEqual({ action: "vm_create", arguments: { spec: localVmDesktopSpec() }, timeout_seconds: 600 });
    expect(() => desktopToolOperation("local_vm", { action: "destroy" })).toThrow(/status, start, run, create, tools or use/);
    expect(() => desktopToolOperation("local_vm", { action: "use", tool_name: "click", arguments: { x: 12, y: 34, button: "left", debug_image_out: "/tmp/x" } })).toThrow(/not allowed/);
    expect(desktopToolOperation("local_vm", { action: "use", tool_name: "screenshot" })).toEqual({ action: "vm_computer_call", tool_name: "get_desktop_state", arguments: {}, timeout_seconds: 60 });
    expect(desktopToolOperation("local_vm", { action: "use", tool_name: "click", arguments: { x: 12, y: 34, button: "left" } })).toEqual({ action: "vm_computer_call", tool_name: "click", arguments: { x: 12, y: 34, button: "left" }, timeout_seconds: 60 });
    expect(() => desktopToolOperation("local_vm", { action: "use", tool_name: "bash", arguments: { command: "id" } })).toThrow(/not part of the Local VM screen/);
    expect(desktopToolOperation("fetch_url", { url: "http://intranet.local/x" })).toMatchObject({ action: "fetch_url", url: "http://intranet.local/x" });
    expect(() => desktopToolOperation("fetch_url", { url: "file:///etc/passwd" })).toThrow();
    expect(() => desktopToolOperation("fetch_url", { url: "https://user:pw@x.test/" })).toThrow();
    expect(() => desktopToolOperation("search_files", {})).toThrow();
    expect(() => desktopToolOperation("nope", {})).toThrow();
  });
  it("lists the solo-mode set and turns a refusal into a tool error", async () => {
    const listed = await handleDesktopBridgeMcp("tools/list", {}, async () => null) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["run_command", "read_file", "write_file", "search_files", "fetch_url", "browse", "computer_use", "local_vm"]));
    const refused = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "ls" } }, async () => { throw new Error("Your computer is not connected right now."); });
    expect(refused).toEqual({ content: [{ type: "text", text: "Your computer is not connected right now." }], isError: true });
  });
  // Command variables (server/credential-command-env.ts), read for each command.
  it("adds command variables to run_command after the refusal checks, and an older desktop runs without them", async () => {
    const value = "fake-command-variable-value";
    const sent: Array<Record<string, unknown>> = [];
    const checked: string[] = [];
    const ok = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "ls" } }, async (operation) => {
      sent.push(operation);
      return { content: [{ type: "text", text: "done" }] };
    }, { payloadRefusal: (payload) => { checked.push(payload); return null; }, commandVariables: () => ({ EXAMPLE_API_KEY: value, lower: "dropped" }) });
    expect(ok).toEqual({ content: [{ type: "text", text: "done" }] });
    expect(sent).toEqual([{ action: "run_command", command: "ls", timeout_seconds: 120, env: { EXAMPLE_API_KEY: value } }]);
    expect(checked.join("")).not.toContain(value);
    // turned off or revoked: nothing
    sent.length = 0;
    await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "ls" } }, async (operation) => { sent.push(operation); return { content: [{ type: "text", text: "done" }] }; }, { commandVariables: () => ({}) });
    expect(sent[0]).not.toHaveProperty("env");
    // never on another action
    sent.length = 0;
    await handleDesktopBridgeMcp("tools/call", { name: "read_file", arguments: { path: "~/x" } }, async (operation) => { sent.push(operation); return { content: [{ type: "text", text: "x" }] }; }, { commandVariables: () => ({ EXAMPLE_API_KEY: value }) });
    expect(sent[0]).not.toHaveProperty("env");
    // a desktop app from before command variables refuses the field: once more without
    sent.length = 0;
    const old = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "ls" } }, async (operation) => {
      sent.push(operation);
      return operation.env ? { content: [{ type: "text", text: "Invalid request" }], isError: true } : { content: [{ type: "text", text: "done" }] };
    }, { commandVariables: () => ({ EXAMPLE_API_KEY: value }) }) as { content: Array<{ text: string }> };
    expect(sent.map((operation) => "env" in operation)).toEqual([true, false]);
    expect(old.content.map((item) => item.text)).toEqual(["done", expect.stringMatching(/too old to receive your command variables/)]);
  });
  it("an older desktop app that cannot create a Local VM says to update it", async () => {
    const old = await handleDesktopBridgeMcp("tools/call", { name: "local_vm", arguments: { action: "create" } }, async () => ({ content: [{ type: "text", text: "Invalid request" }], isError: true }));
    expect(old).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/too old to create a Local VM/) }] });
  });
  it("lists the Local VM screen tools without calling the desktop, and an older app says to update", async () => {
    let called = false;
    const listed = await handleDesktopBridgeMcp("tools/call", { name: "local_vm", arguments: { action: "tools" } }, async () => { called = true; return null; }) as { content: { text: string }[] };
    expect(called).toBe(false);
    expect(listed.content[0]?.text).toContain("screenshot");
    expect(listed.content[0]?.text).toContain("click");
    expect(listed.content[0]?.text).not.toContain("debug_image_out");
    expect(listed.content[0]?.text).not.toContain("launch_app");
    const use = desktopToolOperation("local_vm", { action: "use", tool_name: "click", arguments: { x: 1, y: 2 } });
    expect(use.action).toBe("vm_computer_call");
    expect(desktopBridgeCapability("vm_computer_call")).toBe("localVm");
    for (const text of ["Invalid request", "Unsupported operation"]) {
      const old = await handleDesktopBridgeMcp("tools/call", { name: "local_vm", arguments: { action: "use", tool_name: "click", arguments: { x: 1, y: 2 } } }, async () => ({ content: [{ type: "text", text }], isError: true }));
      expect(old).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringMatching(/too old to control the Local VM screen/) }] });
    }
  });
});

describe("the person's own computer in their Computer tab", () => {
  it("keeps coarse system facts for that person's desktop only", async () => {
    const sessions = new Map([["s-ada", ADA], ["s-bob", BOB]]);
    const bridges = new DesktopBridges((session) => sessions.get(session) ?? null);
    const ada = registration();
    bridges.register(ada, "s-ada", secret);
    const system = { os: "macOS 27.0", arch: "arm64", cpus: 10, cpuPercent: 15, memoryGb: 32, memoryUsedGb: 18.5, diskGb: 994, diskFreeGb: 410 };
    expect(() => bridges.setSystem(ada.id, "s-bob", secret, system)).toThrow();
    expect(() => bridges.setSystem(ada.id, "s-ada", "b".repeat(64), system)).toThrow();
    bridges.setSystem(ada.id, "s-ada", secret, system);
    expect(bridges.status(ADA)[0]!.system).toEqual(system);
    expect(bridges.status(BOB)).toEqual([]);
    const { desktopSystemInfo } = await import("./desktop-bridge.ts");
    expect(desktopSystemInfo.safeParse({ ...system, hostname: "ada-mbp" }).success).toBe(false);
    expect(desktopSystemInfo.safeParse({ ...system, os: "x".repeat(81) }).success).toBe(false);
  });
});
