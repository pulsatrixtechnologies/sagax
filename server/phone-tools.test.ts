import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cardScanRequester, createPhoneToolBroker, PHONE_ACCESS_CHANGED, PHONE_ONLINE_MS, phoneToolTurn, type PhoneToolAuditRow } from "./phone-tools.ts";

describe("phone tool broker", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function setup(options: { pushable?: boolean } = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-tools-"));
    dirs.push(dataDir);
    let clock = 1_000_000;
    const notified: string[] = [];
    const pushed: string[] = [];
    const audit: PhoneToolAuditRow[] = [];
    const broker = createPhoneToolBroker({
      dataDir,
      now: () => clock,
      notify: (person) => notified.push(person),
      push: (person, request) => pushed.push(`${person}:${request.tool}`),
      pushable: () => options.pushable === true,
      audit: (row) => audit.push(row),
    });
    return { broker, dataDir, notified, pushed, audit, tick: (ms: number) => { clock += ms; } };
  }

  const ask = { person: "ann", botId: "bot1", botName: "Wren", threadId: "t1" };

  it("offers only what a phone of that person registered, while it is around", () => {
    const { broker, tick } = setup();
    expect(broker.availableTools("ann")).toEqual([]);
    broker.registerDevice("ann", "phone-a", { deviceName: "iPhone", tools: ["location", "contacts"], transport: "protected" });
    expect(broker.availableTools("ann")).toEqual(["contacts", "location"]);
    expect(broker.availableTools("bob")).toEqual([]);
    tick(PHONE_ONLINE_MS + 1);
    expect(broker.availableTools("ann")).toEqual([]);
  });

  it("keeps a phone that can be woken by a push for a day", () => {
    const { broker, tick } = setup({ pushable: true });
    broker.registerDevice("ann", "phone-a", { deviceName: "iPhone", tools: ["status"], transport: "protected" });
    tick(PHONE_ONLINE_MS + 1);
    expect(broker.availableTools("ann")).toEqual(["status"]);
    tick(24 * 60 * 60_000);
    expect(broker.availableTools("ann")).toEqual([]);
  });

  it("refuses a tool no phone of the person offers", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    expect(() => broker.request({ ...ask, tool: "location", args: {} })).toThrow(/phone/);
  });

  it("tells the person's phones, and only theirs, and hands the answer to the waiting turn once", async () => {
    const { broker, notified, pushed, audit } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "location", args: {} });
    expect(notified).toEqual(["ann"]);
    expect(pushed).toEqual(["ann:location"]);
    expect(broker.pendingFor("ann").map((row) => row.id)).toEqual([request.id]);
    expect(broker.pendingFor("bob")).toEqual([]);
    expect(request.allowAlways).toBe(true);
    expect(request.preApproved).toBe(false);

    const waiting = broker.wait(request.id, { botId: "bot1", threadId: "t1" }, 5_000);
    // another person's phone cannot answer
    expect(broker.answer("bob", "phone-b", request.id, { decision: "once", result: { latitude: 1, longitude: 2 } })).toMatchObject({ ok: false, status: 404 });
    // nor an unregistered device of the same person
    expect(broker.answer("ann", "laptop", request.id, { decision: "once", result: { latitude: 1, longitude: 2 } })).toMatchObject({ ok: false, status: 403 });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: { latitude: 45.50169, longitude: -73.56726 } })).toEqual({ ok: true });
    await expect(waiting).resolves.toEqual({ status: "done", tool: "location", result: { latitude: 45.502, longitude: -73.567, precise: false } });
    // answered once: a second answer finds nothing
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: {} })).toMatchObject({ ok: false });
    expect(broker.pendingFor("ann")).toEqual([]);
    // the audit names the decision, never the data
    expect(audit.map((row) => row.outcome)).toEqual(["requested", "once"]);
    expect(JSON.stringify(audit)).not.toContain("45.5");
  });

  it("never lets another bot or conversation read an answer", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "status", args: {} });
    await expect(broker.wait(request.id, { botId: "bot2", threadId: "t1" }, 10)).resolves.toEqual({ status: "unknown" });
  });

  it("says pending when the phone has not answered within the wait, then expires", async () => {
    const { broker, tick } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "status", args: {} });
    await expect(broker.wait(request.id, ask, 5)).resolves.toEqual({ status: "pending", requestId: request.id });
    tick(5 * 60_000 + 1);
    await expect(broker.wait(request.id, ask, 5)).resolves.toEqual({ status: "expired" });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: {} })).toMatchObject({ ok: false, status: 410 });
  });

  it("a refusal reaches the turn as a refusal", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["contacts"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "contacts", args: { query: "Marie" } });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "deny" })).toEqual({ ok: true });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "denied" });
  });

  it("an approved request whose iOS call failed says why", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["contacts"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "contacts", args: { query: "Marie" } });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", error: "Contacts access is off in Settings." })).toEqual({ ok: true });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "failed", error: "Contacts access is off in Settings." });
  });

  it("Toujours permettre covers that bot, that tool and that access only, and survives a restart", () => {
    const { broker, dataDir } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["reminders", "shortcut"], transport: "protected" });
    const first = broker.request({ ...ask, tool: "reminders", args: { action: "list" } });
    expect(broker.answer("ann", "phone-a", first.id, { decision: "always", result: { reminders: [] } })).toEqual({ ok: true });
    expect(broker.request({ ...ask, tool: "reminders", args: { action: "list" } }).preApproved).toBe(true);
    expect(broker.request({ ...ask, tool: "reminders", args: { action: "create", title: "Pain" } }).preApproved).toBe(false);
    expect(broker.request({ ...ask, botId: "bot2", tool: "reminders", args: { action: "list" } }).preApproved).toBe(false);
    expect(broker.grants("ann")).toEqual([{ botId: "bot1", key: "reminders:read" }]);
    expect(JSON.parse(readFileSync(join(dataDir, "phone-tools", "grants.json"), "utf8")).people.ann).toEqual({ bot1: ["reminders:read"] });

    const again = createPhoneToolBroker({ dataDir, notify: () => {} });
    expect(again.grants("ann")).toEqual([{ botId: "bot1", key: "reminders:read" }]);
    expect(again.revokeGrant("ann", "bot1", "reminders:read")).toBe(true);
    expect(again.grants("ann")).toEqual([]);
  });

  it("lets the person always allow the clipboard, a reminder, an event and the precise position for one bot only", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["clipboard", "reminders", "calendar", "location"], transport: "protected" });
    const cases: Array<{ tool: "clipboard" | "reminders" | "calendar" | "location"; args: Record<string, unknown>; result: Record<string, unknown>; key: string }> = [
      { tool: "clipboard", args: {}, result: { empty: true }, key: "clipboard:read" },
      { tool: "reminders", args: { action: "create", title: "Pain" }, result: { created: { title: "Pain" } }, key: "reminders:write:create" },
      { tool: "calendar", args: { action: "create", title: "Dentiste", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z" }, result: { created: { title: "Dentiste", start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z" } }, key: "calendar:write:create" },
      { tool: "location", args: { precise: true }, result: { latitude: 45.5, longitude: -73.5 }, key: "location:read:precise" },
    ];
    const probe = (tool: string, args: Record<string, unknown>, botId = "bot1") => {
      const request = broker.request({ ...ask, botId, tool: tool as "status", args });
      broker.cancel("ann", request.id);
      return request.preApproved;
    };
    for (const { tool, args, result } of cases) {
      const first = broker.request({ ...ask, tool, args });
      expect(first.allowAlways, tool).toBe(true);
      expect(broker.answer("ann", "phone-a", first.id, { decision: "always", result }), tool).toEqual({ ok: true });
      expect(probe(tool, args), tool).toBe(true);
      // Another bot of the same person does not inherit it.
      expect(probe(tool, args, "bot2"), tool).toBe(false);
    }
    // A write grant never covers a read, and precise never covers approximate.
    expect(probe("reminders", { action: "list" })).toBe(false);
    expect(probe("location", {})).toBe(false);
    expect(broker.grants("ann").map((grant) => grant.key).sort()).toEqual(cases.map((entry) => entry.key).sort());
  });

  it("refuses Toujours permettre where the card does not offer it", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["shortcut"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "shortcut", args: { name: "Pay" } });
    expect(request.allowAlways).toBe(false);
    expect(broker.answer("ann", "phone-a", request.id, { decision: "always", result: { started: true } })).toMatchObject({ ok: false, status: 400 });
    expect(broker.grants("ann")).toEqual([]);
  });

  it("an answer the phone made up is refused, and the turn hears the phone failed", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "location", args: {} });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: { latitude: "here" } })).toMatchObject({ ok: false, status: 400 });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "failed", error: "The phone's answer could not be read." });
  });

  it("caps how many requests one person can have waiting", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    for (let i = 0; i < 5; i += 1) broker.request({ ...ask, tool: "status", args: {} });
    expect(() => broker.request({ ...ask, tool: "status", args: {} })).toThrow(/waiting/);
  });
});

describe("phoneToolTurn", () => {
  const base = { ownsThread: true, inRoom: false, depth: 0, speakerOrigin: "person" as const, speakerPrincipal: "Ann", ownTurn: true, tainted: false };
  it("is the owner's own 1:1 turn", () => {
    expect(phoneToolTurn(base)).toEqual({ person: "ann" });
    expect(phoneToolTurn({ ...base, speakerOrigin: "operator" })).toEqual({ person: "ann" });
  });
  it("refuses a room, a hop, a routine and another member", () => {
    expect(phoneToolTurn({ ...base, inRoom: true })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, depth: 1 })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerOrigin: "owner-routine" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerOrigin: "peer" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerPrincipal: "" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, ownsThread: false })).toHaveProperty("error");
  });
  // 2026-10-28: a conversation uses the credentials of who speaks
  it("uses the phone of the person speaking on a bot shared with them, never the owner's", () => {
    expect(phoneToolTurn({ ...base, speakerPrincipal: "Bob" })).toEqual({ person: "bob" });
  });
  it("refuses a turn another bot's words joined, or one that is not the owner's own (review of #960)", () => {
    // an aside from another bot (a webhook-fed routine, say) folded into the owner's live turn
    expect(phoneToolTurn({ ...base, tainted: true })).toHaveProperty("error");
    // ownEnvironmentOrigin: an internal turn, a routine lineage, an automation, an unattended run
    expect(phoneToolTurn({ ...base, ownTurn: false })).toHaveProperty("error");
  });
});

describe("protected transport only(2026-10-21)", () => {
  it("a phone on plain local Wi-Fi offers nothing to bots", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-transport-"));
    try {
      const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "local" });
      expect(broker.availableTools("ann")).toEqual([]);
      expect(() => broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "location", args: {} })).toThrow(/HTTPS or Tailscale/);
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
      expect(broker.availableTools("ann")).toEqual(["location"]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("a phone that refuses with a reason", () => {
  it("hands the reason to the turn", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-reason-"));
    try {
      const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
      const request = broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "status", args: {} });
      expect(broker.answer("ann", "phone-a", request.id, { decision: "deny", error: "The phone is on plain local Wi-Fi." })).toEqual({ ok: true });
      await expect(broker.wait(request.id, { botId: "b", threadId: "t" }, 10)).resolves.toEqual({ status: "failed", error: "The phone is on plain local Wi-Fi." });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("housekeeping (review of #960)", () => {
  it("drops an answer nobody came back for, and waits a moment after a refusal before a new card", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-sweep-"));
    let clock = 1_000;
    try {
      const broker = createPhoneToolBroker({ dataDir, now: () => clock, notify: () => {} });
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status", "location"], transport: "protected" });
      const unread = broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "status", args: {} });
      broker.answer("ann", "phone-a", unread.id, { decision: "once", result: { lowPowerMode: false } });
      clock += 5 * 60_000 + 1;
      broker.sweep();
      await expect(broker.wait(unread.id, { botId: "b", threadId: "t" }, 5)).resolves.toEqual({ status: "unknown" });

      const refused = broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "location", args: {} });
      broker.answer("ann", "phone-a", refused.id, { decision: "deny" });
      expect(() => broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "location", args: {} })).toThrow(/refused/);
      // another tool is not held back
      expect(broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "status", args: {} }).tool).toBe("status");
      clock += 60_001;
      expect(broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "location", args: {} }).tool).toBe("location");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("card scan through the broker (row 84)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("is never offered as a bot tool, and the computer can cancel it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-scan-"));
    dirs.push(dataDir);
    const notified: string[] = [];
    const broker = createPhoneToolBroker({ dataDir, notify: (person) => notified.push(person) });
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["card_scan", "status"], transport: "protected" });
    expect(broker.availableTools("ann")).toEqual(["card_scan", "status"]);
    expect(broker.botTools("ann")).toEqual(["status"]);
    const request = broker.request({ person: "ann", botId: "", botName: "", threadId: "card-scan:ann", tool: "card_scan", args: {} });
    expect(request.allowAlways).toBe(false);
    expect(broker.cancel("bob", request.id)).toBe(false);
    expect(broker.cancel("ann", request.id)).toBe(true);
    expect(broker.pendingFor("ann")).toEqual([]);
    await expect(broker.wait(request.id, { botId: "", threadId: "card-scan:ann" }, 10)).resolves.toEqual({ status: "unknown" });
    expect(notified.filter((person) => person === "ann").length).toBe(2);
  });
});

describe("session revoke ends phone access (port of upstream 035101e08)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("dropDevice removes the session phone and fails pending waits when it was the only one", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-revoke-"));
    dirs.push(dataDir);
    const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
    const deviceId = "session:sess-1";
    broker.registerDevice("ann", deviceId, { deviceName: "iPhone", tools: ["location"], transport: "protected" });
    const request = broker.request({ person: "ann", botId: "bot1", botName: "Wren", threadId: "t1", tool: "location", args: {} });
    const waiting = broker.wait(request.id, { botId: "bot1", threadId: "t1" }, 5_000);
    expect(broker.dropDevice(deviceId)).toBe(true);
    expect(broker.hasDevice("ann", deviceId)).toBe(false);
    expect(broker.availableTools("ann")).toEqual([]);
    await expect(waiting).resolves.toEqual({ status: "failed", error: PHONE_ACCESS_CHANGED });
    expect(broker.dropDevice(deviceId)).toBe(false);
  });

  it("keeps another phone of the same person when only the session device is dropped", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-revoke-keep-"));
    dirs.push(dataDir);
    const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
    broker.registerDevice("ann", "session:sess-1", { deviceName: "iPhone", tools: ["location"], transport: "protected" });
    broker.registerDevice("ann", "companion:other", { deviceName: "iPad", tools: ["contacts"], transport: "protected" });
    expect(broker.dropDevice("session:sess-1")).toBe(true);
    expect(broker.availableTools("ann")).toEqual(["contacts"]);
  });
});

describe("who may start a card scan (crypto review of #961)", () => {
  const base = { person: "ann", desktopOwnerHeader: true, desktopManaged: true, companionMarked: false };
  it("the desktop app (its owner token), or a person's browser session", () => {
    expect(cardScanRequester({ ...base, auth: "loopback" })).toBe("ann");
    expect(cardScanRequester({ ...base, auth: "cookie" })).toBe("ann");
  });
  it("never a native app's bearer session, a bot's or an ephemeral session, nor loopback without the desktop's token", () => {
    expect(cardScanRequester({ ...base, auth: "bearer" })).toBeNull();
    expect(cardScanRequester({ ...base, auth: "bot" })).toBeNull();
    expect(cardScanRequester({ ...base, auth: "loopback", desktopOwnerHeader: false })).toBeNull();
    // a header a phone could send does not decide anything
    expect(cardScanRequester({ ...base, auth: "loopback", companionMarked: true })).toBe("ann");
    expect(cardScanRequester({ ...base, person: "" , auth: "cookie" })).toBeNull();
  });
  it("on a server outside the desktop app, a loopback caller is not the computer's owner", () => {
    expect(cardScanRequester({ ...base, auth: "loopback", desktopManaged: false, desktopOwnerHeader: false })).toBeNull();
  });
});
