import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTerminalDestinationPick, terminalRequestBehavior } from "../shared/terminal-request.ts";
import { parseTerminalControl } from "../shared/terminal-resources.ts";
import { TerminalResourceRegistry, terminalResourceAllowed } from "./terminal-resources/registry.ts";
import { createTestTerminalAdapter, testTerminalAdapter } from "./terminal-resources/adapters/test.ts";
import { createPersonalTerminalAdapter } from "./terminal-resources/adapters/personal.ts";
import { createTerminalAuditLog } from "./terminal-audit.ts";
import { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTerminalRequestService, defaultTerminalDestination, type TerminalWorkPlace } from "./terminal-requests.ts";
import type { TerminalAccess, TerminalOpenContext } from "./terminal-resources/types.ts";
import type { Store, Message } from "./store.ts";

const OWNER = "pr_owner";
const MEMBER = "pr_member";
const ADMIN = "pr_admin";

describe("terminalRequestBehavior", () => {
  it("allows the Québec label only", () => {
    expect(terminalRequestBehavior("Ouvrir un terminal")).toBe("allow");
    expect(terminalRequestBehavior("Refuser")).toBe("deny");
  });
});

describe("terminal wire helpers", () => {
  it("reads a resize control frame and nothing else", () => {
    expect(parseTerminalControl(JSON.stringify({ type: "resize", cols: 120, rows: 40 }))).toEqual({ type: "resize", cols: 120, rows: 40 });
    expect(parseTerminalControl("ls -la\r")).toBeNull();
    expect(parseTerminalControl(JSON.stringify({ type: "resize", cols: 0, rows: 40 }))).toBeNull();
    expect(parseTerminalControl(JSON.stringify({ type: "exec", cols: 80, rows: 24 }))).toBeNull();
  });

  it("reads a destination pick from a body", () => {
    expect(parseTerminalDestinationPick({ provider: "sandbox", resourceId: "mine" })).toEqual({ provider: "sandbox", resourceId: "mine" });
    expect(parseTerminalDestinationPick({ provider: "../x", resourceId: "mine" })).toBeNull();
    expect(parseTerminalDestinationPick("sandbox:mine")).toBeNull();
  });
});

describe("terminal destination rights", () => {
  const member: TerminalAccess = { organization: true, admin: false, ownsBot: true };
  const notOwner: TerminalAccess = { organization: true, admin: false, ownsBot: false };
  const admin: TerminalAccess = { organization: true, admin: true, ownsBot: false };
  const delegated: TerminalAccess = { organization: true, admin: false, ownsBot: false, serverHosts: true };
  const soloStranger: TerminalAccess = { organization: false, admin: false, ownsBot: false, ownsConversation: true };
  const ownConversation: TerminalAccess = { organization: true, admin: false, ownsBot: false, ownsConversation: true };

  it("keeps the server's hosts for admins and a person's own environment for themselves (2026-10-19: from any conversation of theirs)", () => {
    expect(terminalResourceAllowed({ scope: "server" }, member)).toBe(false);
    expect(terminalResourceAllowed({ scope: "server" }, admin)).toBe(true);
    // A row from an older adapter (no scope) is a server host.
    expect(terminalResourceAllowed({}, member)).toBe(false);
    expect(terminalResourceAllowed({ scope: "personal" }, member)).toBe(true);
    // 2026-10-19 (JC): a person's own cloud computer, Local VM and computer
    // are theirs from any conversation of theirs on an organization server,
    // whoever owns the bot; answering someone else's card opens nothing
    expect(terminalResourceAllowed({ scope: "personal" }, ownConversation)).toBe(true);
    expect(terminalResourceAllowed({ scope: "personal" }, notOwner)).toBe(false);
    // a solo server: the operator only
    expect(terminalResourceAllowed({ scope: "personal" }, soloStranger)).toBe(false);
    // the server's hosts: also a person an admin gave host.commands to
    expect(terminalResourceAllowed({ scope: "server" }, delegated)).toBe(true);
    expect(terminalResourceAllowed({}, delegated)).toBe(true);
    expect(terminalResourceAllowed({ scope: "server" }, { ...member, serverHosts: false })).toBe(false);
    expect(terminalResourceAllowed({ scope: "personal" }, admin)).toBe(true);
    expect(terminalResourceAllowed({ scope: "personal" }, undefined)).toBe(false);
  });

  it("lists only what the person may open", async () => {
    const registry = new TerminalResourceRegistry();
    registry.register(createTestTerminalAdapter({ kind: "ssh", id: "nas", label: "NAS", scope: "server" }));
    registry.register(createTestTerminalAdapter({ kind: "sandbox", id: "mine", label: "Cloud", scope: "personal" }));
    const ctx = (access?: TerminalAccess) => ({ auth: {} as never, principalId: MEMBER, botId: "bot-1", ...(access ? { access } : {}) });
    expect((await registry.listAll(ctx(member))).map((row) => row.provider)).toEqual(["sandbox"]);
    expect((await registry.listAll(ctx(admin))).map((row) => row.provider)).toEqual(["ssh", "sandbox"]);
    expect(await registry.listAll(ctx(notOwner))).toEqual([]);
    expect((await registry.listAll(ctx(ownConversation))).map((row) => row.provider)).toEqual(["sandbox"]);
    expect((await registry.listAll(ctx(delegated))).map((row) => row.provider)).toEqual(["ssh"]);
    expect(await registry.listAll(ctx(soloStranger))).toEqual([]);
    expect(await registry.listAll(ctx())).toEqual([]);
    await expect(registry.open({ provider: "ssh", id: "nas" }, { ...ctx(member), sessionId: "s", cols: 80, rows: 24 })).rejects.toThrow(/not allowed/);
  });

  it("resolves a personal destination to the person who opens it, never to an id", async () => {
    const seen: string[] = [];
    const adapter = createPersonalTerminalAdapter("sandbox", {
      async available(ctx) { return { hostLabel: `env of ${ctx.principalId}` }; },
      async open(ctx) { seen.push(ctx.principalId); throw new Error("stop"); },
    });
    const ctx = { auth: {} as never, principalId: MEMBER, access: member };
    expect(await adapter.resolve(OWNER, ctx)).toBeNull();
    expect(await adapter.resolve("mine", ctx)).toMatchObject({ id: "mine", provider: "sandbox", scope: "personal", hostLabel: `env of ${MEMBER}` });
    await expect(adapter.open("mine", { ...ctx, sessionId: "s", cols: 80, rows: 24 })).rejects.toThrow("stop");
    expect(seen).toEqual([MEMBER]);
  });

  it("defaults to where the bot works, then the person's own environments", () => {
    const rows = [
      { id: "nas", provider: "ssh" as const, label: "NAS", hostLabel: "nas", status: "unknown" as const, scope: "server" as const },
      { id: "mine", provider: "desktop" as const, label: "Cet ordinateur", hostLabel: "mac", status: "unknown" as const, scope: "personal" as const },
      { id: "mine", provider: "sandbox" as const, label: "Cloud", hostLabel: "env", status: "unknown" as const, scope: "personal" as const },
    ];
    expect(defaultTerminalDestination(rows, "desktop")?.provider).toBe("desktop");
    expect(defaultTerminalDestination(rows, "local-vm")?.provider).toBe("sandbox");
    expect(defaultTerminalDestination(rows, null)?.provider).toBe("sandbox");
    expect(defaultTerminalDestination(rows.slice(0, 1), "sandbox")?.provider).toBe("ssh");
    expect(defaultTerminalDestination([], "sandbox")).toBeNull();
    const withRemote = [...rows, { id: "0123456789ab", provider: "tailcat" as const, label: "Session à distance", hostLabel: "POSTE-02", status: "online" as const, scope: "personal" as const }];
    expect(defaultTerminalDestination(withRemote, null)?.provider).toBe("sandbox");
    expect(defaultTerminalDestination(withRemote.slice(-1), null)).toBeNull();
  });
});

describe("terminal request service", () => {
  const threadId = "thread-1";
  const botId = "bot-1";
  let messages: Message[];
  let dataDir: string;
  let calls: { opened: TerminalOpenContext[]; resized: { cols: number; rows: number }[] };
  let workPlace: TerminalWorkPlace;
  let taskOwner: string | undefined;

  beforeEach(() => {
    taskOwner = undefined;
    messages = [];
    dataDir = mkdtempSync(join(tmpdir(), "sagax-terminal-"));
    calls = { opened: [], resized: [] };
    workPlace = "sandbox";
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  function setup(extra: Partial<Parameters<typeof createTerminalRequestService>[0]> = {}) {
    const registry = new TerminalResourceRegistry();
    registry.register(testTerminalAdapter);
    registry.register(createTestTerminalAdapter({ kind: "sandbox", id: "mine", label: "Ordinateur infonuagique", scope: "personal", calls }));
    registry.register(createTestTerminalAdapter({ kind: "desktop", id: "mine", label: "Cet ordinateur", scope: "personal", calls }));
    const audit = createTerminalAuditLog(dataDir);
    const sessions = createTerminalSessionManager({ registry, audit, now: () => 1_700_000_000_000 });
    const store = {
      bot: () => ({ id: botId, name: "T", color: "#336699" }),
      taskByThread: () => ({ ownerPrincipalId: taskOwner ?? OWNER }),
      messagesFor: () => messages,
      appendMessage: (_thread: string, partial: Partial<Message>) => {
        const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
        messages.push(message);
        return message;
      },
      patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
        const row = messages.find((m) => m.id === id);
        if (row && patch.card) row.card = { ...row.card!, ...patch.card };
      },
    } as unknown as Store;
    const requests = createTerminalRequestService({
      store,
      registry,
      sessions,
      principalId: () => OWNER,
      audit,
      now: () => 1_700_000_000_000,
      access: (principalId) => principalId === ADMIN
        ? { organization: true, admin: true, ownsBot: false }
        : { organization: true, admin: false, ownsBot: principalId === OWNER },
      workPlace: () => workPlace,
      ...extra,
    });
    const auditRows = () => readFileSync(audit.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    return { requests, sessions, auditRows };
  }

  const card = () => messages.find((m) => m.card?.terminalRequest)!.card!;
  const embed = () => messages.find((m) => m.terminalEmbed)?.terminalEmbed;

  it("lists the person's own destinations only, with where the bot works as the default", async () => {
    const { requests } = setup();
    const owner = await requests.destinations({ botId, threadId });
    expect(owner.principalId).toBe(OWNER);
    expect(owner.resources.map((row) => row.provider)).toEqual(["sandbox", "desktop"]);
    expect(owner.defaultResource?.provider).toBe("sandbox");
    const member = await requests.destinations({ botId, threadId, principalId: MEMBER });
    expect(member.resources).toEqual([]);
    // 2026-10-19: a conversation of the member's own with this bot (shared
    // with them): their own environments open from it
    taskOwner = MEMBER;
    const own = await requests.destinations({ botId, threadId, principalId: MEMBER });
    expect(own.resources.map((row) => row.provider)).toEqual(["sandbox", "desktop"]);
    taskOwner = undefined;
    const admin = await requests.destinations({ botId, threadId, principalId: ADMIN });
    expect(admin.resources.map((row) => row.provider)).toEqual(["test", "sandbox", "desktop"]);
  });

  it("proposes where the bot works when it names no destination, and lists the others on the card", async () => {
    workPlace = "desktop";
    const { requests, auditRows } = setup();
    const submitted = await requests.submit({ botId, threadId, reason: "Déboguer en direct" });
    expect("requestId" in submitted).toBe(true);
    expect(card().terminalRequest).toMatchObject({ provider: "desktop", resourceId: "mine" });
    expect(card().terminalRequest!.destinations!.map((row) => row.provider)).toEqual(["desktop", "sandbox"]);
    expect(auditRows().at(-1)).toMatchObject({ kind: "session.requested", principalId: OWNER, resourceId: "desktop:mine" });
  });

  it("refuses an offer for a destination the person may not open", async () => {
    const { requests } = setup();
    expect(await requests.submit({ botId, threadId, provider: "test", resourceId: "echo", reason: "x" })).toMatchObject({ error: expect.stringMatching(/not one this person may open/) });
    expect(messages).toEqual([]);
  });

  it("opens the destination the person picked on the card and audits the change", async () => {
    const { requests, sessions, auditRows } = setup();
    const submitted = await requests.submit({ botId, threadId, provider: "sandbox", reason: "Installer" });
    if (!("requestId" in submitted)) throw new Error("no card");
    const allowed = await requests.resolve({
      threadId, requestId: submitted.requestId, behavior: "allow", principalId: OWNER,
      pick: { provider: "desktop", resourceId: "mine" }, cols: 132, rows: 43,
    });
    expect(allowed).toMatchObject({ claimed: true, outcome: "allowed-once" });
    expect(embed()).toMatchObject({ provider: "desktop", resourceId: "mine" });
    expect(card()).toMatchObject({ answered: "allow" });
    expect(card().terminalRequest).toMatchObject({ provider: "desktop", sessionId: embed()!.sessionId });
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0]).toMatchObject({ principalId: OWNER, cols: 132, rows: 43, access: { ownsBot: true } });
    expect(sessions.resize(embed()!.sessionId, OWNER, 90, 30)).toBe(true);
    expect(sessions.resize(embed()!.sessionId, MEMBER, 90, 30)).toBe(false);
    expect(calls.resized).toEqual([{ cols: 90, rows: 30 }]);
    expect(sessions.close(embed()!.sessionId, OWNER)).toBe(true);
    const kinds = auditRows().map((row) => row.kind);
    expect(kinds).toEqual(["session.requested", "session.destination", "session.opened", "session.ended"]);
    expect(auditRows()[1]).toMatchObject({ from: "sandbox:mine", to: "desktop:mine" });
    expect(auditRows()[2]).toMatchObject({ principalId: OWNER, resourceId: "desktop:mine", botId, threadId });
    expect(auditRows()[3]).toMatchObject({ resourceId: "desktop:mine", reason: "closed" });
  });

  it("refuses a pick the card did not offer, and keeps the card open", async () => {
    const { requests, auditRows } = setup();
    const submitted = await requests.submit({ botId, threadId, reason: "x" });
    if (!("requestId" in submitted)) throw new Error("no card");
    const refused = await requests.resolve({
      threadId, requestId: submitted.requestId, behavior: "allow", principalId: OWNER,
      pick: { provider: "test", resourceId: "echo" },
    });
    expect(refused).toMatchObject({ claimed: true, status: 403 });
    expect(card().answered).toBeUndefined();
    expect(embed()).toBeUndefined();
    expect(calls.opened).toEqual([]);
    expect(auditRows().at(-1)).toMatchObject({ kind: "session.refused", resourceId: "test:echo", reason: "not_allowed" });
  });

  it("never opens a destination for someone without the right, even from a card offered to its owner", async () => {
    const { requests, auditRows } = setup();
    const submitted = await requests.submit({ botId, threadId, reason: "x" });
    if (!("requestId" in submitted)) throw new Error("no card");
    // A teammate who sees the conversation answers: the bot is not theirs.
    const refused = await requests.resolve({ threadId, requestId: submitted.requestId, behavior: "allow", principalId: MEMBER });
    expect(refused).toMatchObject({ claimed: true, status: 403 });
    expect(calls.opened).toEqual([]);
    expect(auditRows().at(-1)).toMatchObject({ kind: "session.refused", principalId: MEMBER });
  });

  it("2026-10-19: an Always allow kept for this bot and this destination opens it as that person; another destination keeps its card", async () => {
    const kept: Array<{ principalId: string; tool: string; scope: Record<string, string> }> = [];
    const journal: string[] = [];
    const { requests } = setup({
      keptRule: (principalId, _bot, candidate) => {
        kept.push({ principalId, ...candidate });
        return principalId === OWNER && candidate.scope.destination === "desktop:mine" ? { id: "r1" } : null;
      },
      journalRule: ({ rule }) => journal.push(rule),
    });
    const other = await requests.submit({ botId, threadId, provider: "sandbox", reason: "x" });
    if (!("requestId" in other)) throw new Error("no card");
    expect(card().ownerRule).toMatchObject({ tool: "sagax:terminal", scope: { destination: "sandbox:mine" } });
    expect(card().answered).toBeUndefined();
    expect(calls.opened).toEqual([]);
    messages = [];
    const auto = await requests.submit({ botId, threadId, provider: "desktop", reason: "y" });
    expect("requestId" in auto).toBe(true);
    expect(card().answered).toBe("allow");
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0]).toMatchObject({ principalId: OWNER });
    expect(journal).toEqual(["r1"]);
    expect(kept.every((row) => row.principalId === OWNER)).toBe(true);
  });

  it("audits a refusal of the card", async () => {
    const { requests, auditRows } = setup();
    const submitted = await requests.submit({ botId, threadId, reason: "x" });
    if (!("requestId" in submitted)) throw new Error("no card");
    expect(await requests.resolve({ threadId, requestId: submitted.requestId, behavior: "deny", principalId: OWNER })).toMatchObject({ outcome: "rejected" });
    expect(card()).toMatchObject({ answered: "deny" });
    expect(auditRows().at(-1)).toMatchObject({ kind: "session.denied", principalId: OWNER });
  });
});
