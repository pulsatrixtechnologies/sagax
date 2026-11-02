import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BROWSER_SIGN_IN,
  clearSessionCookie,
  capabilitiesForAuth,
  fromBrowser,
  loopbackBrowserRefused,
  clientBotPatchViolation,
  clientSessionIsComputerOwner,
  companionBotFieldViolation,
  memberBotFieldViolation,
  clientGroupPatchViolation,
  clientInstanceView,
  healthDetail,
  ipcPeer,
  isAllowedOrigin,
  isLoopbackHost,
  isProxied,
  isSameOrigin,
  provesSameOrigin,
  parseCookies,
  requestOrigin,
  requestSource,
  requiredScope,
  routePermission,
  routePermissions,
  PERMISSION_ROUTES,
  readWorkerRelayToken,
  resolveLoopbackTrust,
  resolveRequestAuth,
  sanitizeSource,
  serializeSessionCookie,
  sessionCookieName,
  sessionPrincipal,
  serviceAllowed,
  workerRelayAllowed,
} from "./request-auth.ts";
import { SESSION_TTL_MS, SessionRegistry } from "./sessions.ts";
import type { SessionRecord } from "./sessions.ts";

function request(headers: Record<string, string>, method = "GET"): IncomingMessage {
  // SAFETY: the resolver reads only headers and method; a bare object is the whole contract here
  return { headers, method } as unknown as IncomingMessage;
}

describe("loopback rules (moved from the server entry, behaviour unchanged)", () => {
  it("accepts localhost, 127.x and ::1 with or without a port", () => {
    for (const host of ["localhost", "localhost:8799", "127.0.0.1", "127.9.9.9:80", "[::1]", "[::1]:8799", "LOCALHOST"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["", "example.com", "127.0.0.1:x", "[::1]x", "100.64.0.1:8799", "localhost.evil.com", "[fe80::1]"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
  it("allows absent origins and loopback origins only", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8799")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("ftp://localhost")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
  });
});

describe("origin and cookies", () => {
  it("derives the request origin from Host and the proxy's scheme", () => {
    expect(requestOrigin(request({ host: "bots.example.com" }))).toBe("http://bots.example.com");
    expect(requestOrigin(request({ host: "Bots.Example.com", "x-forwarded-proto": "https" }))).toBe("https://bots.example.com");
    expect(requestOrigin(request({ host: "a:8799", "x-forwarded-proto": "https, http" }))).toBe("https://a:8799");
    expect(requestOrigin(request({}))).toBeNull();
  });
  it("treats absent or matching Origin as same-origin, anything else as foreign", () => {
    expect(isSameOrigin(request({ host: "a.example" }))).toBe(true);
    expect(isSameOrigin(request({ host: "a.example", origin: "http://a.example" }))).toBe(true);
    expect(isSameOrigin(request({ host: "a.example", "x-forwarded-proto": "https", origin: "https://a.example" }))).toBe(true);
    expect(isSameOrigin(request({ host: "a.example", origin: "https://evil.example" }))).toBe(false);
  });
  it("parses cookies and names the session cookie per port and environment", () => {
    expect(parseCookies("a=1; omb_session_8799_abc=tok; b = 2")).toEqual(new Map([["a", "1"], ["omb_session_8799_abc", "tok"], ["b", "2"]]));
    expect(parseCookies(undefined).size).toBe(0);
    expect(sessionCookieName(8799, "3f2a-uuid-like-id")).toBe("omb_session_8799_3f2auuidlike");
    expect(serializeSessionCookie("c", "t", { secure: true, maxAgeSeconds: 60 })).toBe("c=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
    expect(serializeSessionCookie("c", "t", { secure: false, maxAgeSeconds: 60 })).not.toContain("Secure");
    expect(clearSessionCookie("c")).toContain("Max-Age=0");
  });
});

describe("request source for the lockout", () => {
  const withPeer = (peer: string, headers: Record<string, string>) =>
    // SAFETY: only headers and the socket peer are read
    ({ headers, method: "POST", socket: { remoteAddress: peer } }) as unknown as IncomingMessage;
  it("takes the LAST forwarded hop, only from a proxy on this machine, and sanitises it", () => {
    // the last hop is the one our own proxy wrote; earlier hops are client-supplied
    expect(requestSource(withPeer("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestSource(withPeer("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestSource(withPeer("127.0.0.1", {}))).toBe("127.0.0.1");
    expect(requestSource(withPeer("100.64.0.7", { "x-forwarded-for": "1.1.1.1" }))).toBe("100.64.0.7");
    expect(requestSource(withPeer("127.0.0.1", { "x-forwarded-for": "evil\n\u0007 <script>" + "x".repeat(200) }))).toMatch(/^[\w.:%[\]-]{1,64}$/);
    expect(sanitizeSource("")).toBe("unknown");
  });
});

describe("scopes", () => {
  it("lets people manage their own provider keys and servers without an admin", () => {
    expect(requiredScope("GET", "/api/me/providers")).toBe("client");
    for (const method of ["PUT", "DELETE"]) {
      for (const path of ["keys/elevenlabs", "keys/compat%3Alab", "servers/lab"]) {
        expect(requiredScope(method, `/api/me/providers/${path}`)).toBe("client");
      }
    }
    for (const method of ["GET", "POST"]) {
      expect(routePermission(method, "/api/instances/mistral/api-key", { orgDirectory: true })).toBeNull();
    }
  });
  it("lets a person read their own Claude connectors; only an admin turns them off", () => {
    expect(requiredScope("GET", "/api/me/harness-connectors")).toBe("client");
    // A member sees the images a bot's Markdown renders, not only downloads.
    expect(requiredScope("GET", "/api/threads/t-1/messages/m-1/file")).toBe("client");
    expect(requiredScope("POST", "/api/threads/t-1/messages/m-1/file")).toBe("client");
    expect(requiredScope("DELETE", "/api/threads/t-1/messages/m-1/file")).toBe("admin");
    expect(requiredScope("PUT", "/api/me/harness-connectors")).toBe("admin");
    expect(requiredScope("PUT", "/api/harness-connectors/settings")).toBe("admin");
  });
  it("keeps full backups, credentials and replacement behind admin scope", () => {
    for (const path of ["status", "export", "upload", "preview", "restore", "client-state", "download/123"]) {
      for (const method of ["GET", "POST", "DELETE"]) expect(requiredScope(method, `/api/workspace-backup/${path}`)).toBe("admin");
    }
  });
  it("is default deny: chat, approvals, rooms, attachments, routines and own session are client; everything else admin", () => {
    for (const [method, path] of [
      ["POST", "/api/bots/x/messages"], ["POST", "/api/bots/x/respond"], ["POST", "/api/threads/t/respond"],
      ["POST", "/api/threads/t/undo"], ["POST", "/api/bots/x/compact"], ["POST", "/api/bots/x/tasks/t/title"],
      ["PATCH", "/api/bots/x/cards/m"], ["POST", "/api/groups/g/messages"], ["PATCH", "/api/groups/g"],
      // #1786: leaving a group is the member's own membership, not an admin act
      ["POST", "/api/groups/g/leave"],
      ["PATCH", "/api/bots/x"], ["PATCH", "/api/bots/x/profile"], ["POST", "/api/attachments"],
      ["GET", "/api/attachments/a.png"], ["POST", "/api/routines"], ["POST", "/api/routines/r/run"],
      ["POST", "/api/routines/watch-check"], // #1202 Check now: the handler applies the routine save's rights
      ["POST", "/api/routines/folders"], // routine folders: the handler applies the routine edit rights
      // Limit-reset: Continue card, near-limit banner, calendar markers (person's own bots)
      ["GET", "/api/limit-resets"], ["POST", "/api/limit-resets/continue"], ["POST", "/api/limit-resets/after-reset"],
      ["POST", "/api/routine-runs/seen-all"], ["DELETE", "/api/routine-runs"],
      // #1482: scheduled calls, the handler narrows them to the member's bots
      ["GET", "/api/calendar-calls"], ["POST", "/api/calendar-calls"], ["PATCH", "/api/calendar-calls/c"],
      ["DELETE", "/api/calendar-calls/c"], ["POST", "/api/calendar-calls/c/room"],
      // desktop remote-client parity: steer (bot and room) and the engines catalogue (redacted)
      ["POST", "/api/bots/x/queue/q/steer"], ["POST", "/api/groups/g/queue/q/steer"],
      ["GET", "/api/bots"], ["GET", "/api/groups"], ["GET", "/api/threads/t/messages"], ["GET", "/api/search"], ["GET", "/api/events"],
      ["GET", "/api/config"], ["GET", "/api/webhooks"], ["POST", "/api/tts/speak"],
      ["GET", "/api/auth/session"], ["POST", "/api/auth/stream-ticket"], ["POST", "/api/auth/logout"],
      ["GET", "/api/bots/x/slack-management"], // a link to Admin, read-only
      ["GET", "/api/bots/x/inbound-mail"], // the bot's own email address (Perspicax relay), read-only
      ["PUT", "/api/bots/x/inbound-mail"], // its owner changes it (the handler checks the owner)
      ["GET", "/api/bots/x/browser/live"], // watch the bot's browser (the handler checks the viewer)
      ["POST", "/api/bots/x/browser/action"], // take over that session (same check)
      ["POST", "/api/bots/x/direct-grants"],
      ["POST", "/api/bots"], ["DELETE", "/api/bots/x"], // a member's own bots: the handler checks role and owner
      ["POST", "/api/teams/import"], // 2026-10-26: a team file for oneself; the handler checks the right to create bots
      ["GET", "/api/desktop-viewer/vps/b1"], ["GET", "/api/desktop-viewer/vps/b1/websockify"], // 2026-10-26: the owner's own bot VPS; the target decides
      ["POST", "/api/bots/x/primary"], ["DELETE", "/api/bots/x/primary"], // the owner's own Primary Bot, both ways
      ["POST", "/api/org/invites/tok/accept"],
      ["GET", "/api/org"],
      ["POST", "/api/workers"],
      ["GET", "/api/workers"],
      ["POST", "/api/workers/laptop/pull"],
      ["POST", "/api/workers/laptop/drop"],
      ["POST", "/api/workers/queue/m1/cancel"],
      ["GET", "/api/workers/laptop/turns/m1"],
      ["POST", "/api/workers/laptop/turns/m1"],
      ["GET", "/api/threads/t/files"], ["GET", `/api/threads/t/files/${"a1".repeat(12)}`],
      ["POST", `/api/threads/t/files/${"a1".repeat(12)}/pin`],
      // 2026-10-22: a webhook runs on the bot's own computer, so its
      // owner creates and manages it without the server-settings right; the
      // handler (webhookDelegateRefusal, webhookExecTargetAdminOnly) keeps the
      // limits (an admin's bot, a Microsoft trigger, a server run target).
      ["POST", "/api/webhooks"], ["POST", "/api/webhooks/w/rotate"],
      ["POST", "/api/webhooks/w/test"], ["POST", "/api/webhooks/w/reveal"],
      ["PATCH", "/api/webhooks/w"], ["DELETE", "/api/webhooks/w"],
      // 2026-10-26 (#1201): the folders of a bot's threads, the live view and
      // capture of its cloud computer, and the MCP list for its MCP choice
      // reach their handler, which lets only the bot's owner (or an admin)
      // through; the MCP list gives a non-manager names and states only
      ["POST", "/api/bots/x/projects"], ["PATCH", "/api/bots/x/projects/order"], ["PATCH", "/api/bots/x/projects/p"],
      ["DELETE", "/api/bots/x/projects/p"],
      ["POST", "/api/bots/x/computer/join"], ["POST", "/api/bots/x/computer/screenshot"],
      ["GET", "/api/mcp/servers"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [
      ["POST", "/api/cli-test"], ["GET", "/api/cli-candidates"], ["PATCH", "/api/instances/claude"],
      ["GET", "/api/instances/claude"], ["POST", "/api/instances/claude/refresh-models"], ["GET", "/api/instances/extra/x"],
      ["GET", "/api/bots/x/queue/q/steer"], ["POST", "/api/bots/x/queue/q/steer/extra"],
      // the desktop remote client hides these, or their handler has no per-viewer check:
      // team filing, room setup (it sets the room's folder) and usage
      ["POST", "/api/sidebar-sections"], ["GET", "/api/usage"],
      // starting, stopping and running a bot's cloud computer stay admin (its live view is the owner's, below)
      ["POST", "/api/bots/x/computer/exec"], ["POST", "/api/bots/x/computer/start"], ["POST", "/api/bots/x/computer/stop"],
      ["POST", "/api/local-computer/run"],
      ["POST", "/api/bots/x/browser/live"], ["GET", "/api/bots/x/browser/action"],
      ["POST", "/api/bots/x/browser/restart"], ["POST", "/api/browser-engine/install"],
      ["POST", "/api/bots/x/local-computer/join"], ["POST", "/api/bots/x/local-computer/screenshot"],
      ["GET", "/api/computers/boxes"], ["POST", "/api/computers/boxes/bx_23456789/delete"],
      ["POST", "/api/bots/x/skills"], ["PATCH", "/api/bots/x/skills/s"],
      ["PATCH", "/api/bots/x/model"], ["GET", "/api/teams/scout"], ["POST", "/api/org-library/add"],
      ["PUT", "/api/section-context"], ["GET", "/api/threads/t/events"],
      // shared team memory: direct reads and writes stay admin; a member only
      // answers the team-memory card of their own team (the respond routes)
      ["GET", "/api/team-memory"], ["POST", "/api/team-memory"],
      ["PATCH", "/api/team-memory/entry_1"], ["DELETE", "/api/team-memory/entry_1"],
      ["POST", "/api/mcp/servers"], ["PATCH", "/api/mcp/servers/x"], ["DELETE", "/api/mcp/servers/x"], ["POST", "/api/connectors/slack/authorize"],
      ["POST", "/api/bots/x/slack-management"], ["GET", "/api/bots/x/slack-management/extra"],
      ["PUT", "/api/config"], ["POST", "/api/auth/pairing"], ["GET", "/api/auth/sessions"], ["DELETE", "/api/auth/sessions/abc"],
      // Live calls spend the owner's OpenAI key and reach any bot: admins only
      ["POST", "/api/live/session"], ["POST", "/api/live/call/end"], ["GET", "/api/live/call"], ["PATCH", "/api/live/settings"],
      ["POST", "/api/live/device-revoked"],
      ["POST", "/api/auth/pair"], // handled before the gate; the gate itself never grants it
      ["POST", "/api/org"], ["POST", "/api/org/invites"], ["GET", "/api/org/invites"],
      ["GET", "/api/mail/settings"], ["PUT", "/api/mail/settings"], ["POST", "/api/mail/test"], // mail transport: admin only
      ["GET", "/api/something-new"], // anything unlisted is admin until listed
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });

  // iOS feature parity S2 (docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md):
  // each route reaches its handler, which checks the owner.
  it("lets a client session reach the owner routes of the iOS parity, and nothing beside them", () => {
    for (const [method, path] of [
      ["GET", "/api/bots/x/command-allowlist"], ["DELETE", "/api/bots/x/command-allowlist/rule-1"],
      ["POST", "/api/plugins/install"],
      ["GET", "/api/bots/x/overview"],
      // the bot workspace: the Soul's gate (owner or admin) in the handler
      ["GET", "/api/bots/x/workspace"], ["GET", "/api/bots/x/workspace/download"],
      ["GET", "/api/bots/x/workspace/file"], ["PUT", "/api/bots/x/workspace/file"], ["DELETE", "/api/bots/x/workspace/file"],
      ["POST", "/api/bots/x/workspace/docs/rename"],
      // 2026-10-26: the bot's memory and change history, owner checked in the handlers
      ["GET", "/api/bots/x/memory"], ["PUT", "/api/bots/x/memory"],
      ["GET", "/api/bots/x/memory/file"], ["PUT", "/api/bots/x/memory/file"], ["DELETE", "/api/bots/x/memory/file"],
      ["GET", "/api/bots/x/memory/journal"], ["POST", "/api/bots/x/memory/journal/e1/revert"],
      ["GET", "/api/bots/x/memory/upkeep"], ["POST", "/api/bots/x/memory/tidy"],
      ["GET", "/api/bots/x/history"], ["POST", "/api/bots/x/history/rollback"], ["POST", "/api/bots/x/history/restore"],
      // 2026-10-26 (#1201): the prompt preview of a bot the session owns
      // (owner checked in the handler) and the presets New bot offers, read only
      ["GET", "/api/bots/x/system-prompt"], ["GET", "/api/bot-presets"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [
      ["POST", "/api/bots/x/command-allowlist"], ["DELETE", "/api/bots/x/command-allowlist"],
      ["PUT", "/api/bots/x/command-allowlist/rule-1"], ["GET", "/api/bots/x/connector-cards/m/authorize"],
      ["POST", "/api/bots/x/connector-cards/m/authorize/extra"], ["GET", "/api/plugins/install"],
      ["POST", "/api/plugins/uninstall"], ["POST", "/api/bots/x/overview"],
      // the voice engine and the advanced panel stay admin for a session (the sidecar is the owner)
      ["PUT", "/api/tts/provider"], ["POST", "/api/bots/x/system-prompt"],
      ["GET", "/api/bots/x/skills"], ["POST", "/api/bot-presets"], ["DELETE", "/api/bot-presets/p"], ["GET", "/api/bots/x/computer"],
      ["DELETE", "/api/bots/x/history"], ["POST", "/api/bots/x/memory/open"],
      // the workspace routes take only these shapes
      ["POST", "/api/bots/x/workspace"], ["PUT", "/api/bots/x/workspace/download"],
      ["GET", "/api/bots/x/workspace/docs/rename"], ["POST", "/api/bots/x/workspace/file"], ["GET", "/api/bots/x/workspace/other"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });

  // 2026-10-28: a member opens their own bot's task list and background brief.
  // The handlers check the bot and the person; neither is an admin route.
  it("lets a member reach the task list and the background brief of their own bot", () => {
    for (const [method, path] of [
      ["GET", "/api/bots/x/task-list"], ["POST", "/api/bots/x/task-list"],
      ["POST", "/api/bots/x/task-list/task_a1/reopen"],
      ["GET", "/api/bots/x/background-brief"], ["PUT", "/api/bots/x/background-brief"],
      ["POST", "/api/bots/x/background-brief/pass"],
      ["POST", "/api/bots/x/background-brief/brief_1/reject"], ["POST", "/api/bots/x/background-brief/brief_1/keep"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [
      ["DELETE", "/api/bots/x/background-brief"], ["GET", "/api/bots/x/background-brief/pass"],
      ["POST", "/api/bots/x/background-brief/brief_1/other"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });

  it("knows this computer's own person: the owner, an admin, or a session bound to the operator on a personal server", () => {
    const personal = { organization: false, cloudHome: false, localPrincipalId: "pr_owner", operatorEmail: "Owner@Example.test" };
    const session = (fields: Partial<SessionRecord>, scopes: Array<"admin" | "client"> = ["client"]) =>
      ({ kind: "session", via: "bearer", scopes, session: { id: "s", label: "phone", scopes, createdAt: 0, expiresAt: 1, lastUsedAt: 0, ...fields } }) as never;
    expect(clientSessionIsComputerOwner({ kind: "loopback", scopes: ["admin", "client"] }, personal)).toBe(true);
    expect(clientSessionIsComputerOwner({ kind: "loopback", scopes: ["client"], trust: "service" }, personal)).toBe(false);
    expect(clientSessionIsComputerOwner(session({}, ["admin", "client"]), personal)).toBe(true);
    expect(clientSessionIsComputerOwner(session({ principalId: "pr_owner" }), personal)).toBe(true);
    expect(clientSessionIsComputerOwner(session({ email: "owner@example.test" }), personal)).toBe(true);
    // a chat-only pairing with nobody behind it, someone else, or any client session where the owner is not the operator
    expect(clientSessionIsComputerOwner(session({}), personal)).toBe(false);
    expect(clientSessionIsComputerOwner(session({ principalId: "pr_guest", email: "owner@example.test" }), personal)).toBe(false);
    expect(clientSessionIsComputerOwner(session({ email: "guest@example.test" }), personal)).toBe(false);
    expect(clientSessionIsComputerOwner(session({ email: "owner@example.test" }), { ...personal, operatorEmail: undefined })).toBe(false);
    expect(clientSessionIsComputerOwner(session({ principalId: "pr_owner" }), { ...personal, organization: true })).toBe(false);
    expect(clientSessionIsComputerOwner(session({ principalId: "pr_owner" }), { ...personal, cloudHome: true })).toBe(false);
  });

  it("reads the signed-in principal id (sessionPrincipal, #1388 leaf)", () => {
    expect(sessionPrincipal({ kind: "loopback", scopes: ["admin"] })).toBeNull();
    expect(sessionPrincipal({
      kind: "session", via: "bearer", scopes: ["client"],
      session: { id: "s", label: "phone", scopes: ["client"], createdAt: 0, expiresAt: 1, lastSeenAt: 0, tokenHash: "a".repeat(64), principalId: "  Pr_Ada  " },
    })).toBe("pr_ada");
    expect(sessionPrincipal({
      kind: "session", via: "bearer", scopes: ["client"],
      session: { id: "s", label: "phone", scopes: ["client"], createdAt: 0, expiresAt: 1, lastSeenAt: 0, tokenHash: "a".repeat(64) },
    })).toBeNull();
  });

  it("lets the owner's paired phone switch a bot's memory, and nothing a member may not set besides", () => {
    expect(companionBotFieldViolation({ memoryEnabled: false, memoryUpkeep: true, name: "Scout", soul: "x", modelSelection: {} })).toBeNull();
    // the voice notes switch of the bot panel (row BA11)
    expect(companionBotFieldViolation({ voiceNotes: false })).toBeNull();
    for (const field of ["approvalMode", "cwd", "computer", "mcpServers", "autoApprove", "browserProfile", "visibility", "hidden", "host"]) {
      expect(companionBotFieldViolation({ memoryEnabled: true, [field]: "x" }), field).toBe(field);
    }
    expect(companionBotFieldViolation([])).toBe("body");
    // a member session still may not
    expect(memberBotFieldViolation({ memoryEnabled: false })).toBe("memoryEnabled");
    expect(memberBotFieldViolation({ voiceNotes: false })).toBe("voiceNotes");
  });

  it("opens the engines catalogue to client sessions behind a feature only", () => {
    expect(requiredScope("GET", "/api/instances", { serverCatalogue: true })).toBe("client");
    expect(requiredScope("GET", "/api/instances")).toBe("admin");
    // an organization server opens it too, with a member's copy (memberInstanceView)
    expect(requiredScope("GET", "/api/instances", { orgDirectory: true })).toBe("client");
    expect(requiredScope("PATCH", "/api/instances/claude", { serverCatalogue: true })).toBe("admin");
    expect(requiredScope("GET", "/api/instances/claude", { serverCatalogue: true })).toBe("admin");
  });

  it("gives a client session the engines catalogue without how the host is set up", () => {
    const view = clientInstanceView({
      instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
      models: { default: "opus", options: [{ id: "opus", label: "Opus" }] },
      capabilities: { queueing: true }, access: "subscription", icon: "claude",
      snapshot: {
        state: "available", authenticated: true, billing: "subscription", version: "2.1.0",
        account: { email: "owner@example.test", organization: "Owner Inc" },
        update: { title: "Update", message: "m", command: "claude update" },
      },
      cli: "/opt/bin/claude", cliDefault: "claude", cliCandidates: ["/usr/local/bin/claude"],
      install: { signInCommand: "claude login" }, authentication: { method: "browser" },
      claudeAccount: { configDir: "/Users/owner/.claude", signInCommand: "x" }, freeUpSpace: true,
      somethingNew: "unlisted",
    });
    expect(view).toEqual({
      readOnly: true, instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude",
      models: { default: "opus", options: [{ id: "opus", label: "Opus" }] },
      capabilities: { queueing: true }, access: "subscription", icon: "claude",
      snapshot: { state: "available", authenticated: true, billing: "subscription" },
    });
    expect(JSON.stringify(view)).not.toMatch(/owner@|\/opt\/bin|\/Users\/owner|claude login|claude update/);
  });

  it("gives a paired phone's live call every voice mode route it uses, and nothing more", () => {
    // ios/Sources/CompanionCore/VoiceCall/ClientVoiceMode.swift: status, voices,
    // a sentence streamed as PCM, a whole turn transcribed, and the call turn's send
    for (const [method, path] of [
      ["GET", "/api/bots/x/voice/status"], ["GET", "/api/bots/x/voice/voices"],
      ["POST", "/api/bots/x/voice/stream"], ["POST", "/api/bots/x/voice/transcribe"],
      ["POST", "/api/bots/x/voice/speak"], ["POST", "/api/bots/x/voice/prepare"], ["POST", "/api/bots/x/voice/call"],
      ["POST", "/api/bots/x/messages"], ["POST", "/api/bots/x/interrupt"], ["POST", "/api/groups/g/interrupt"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("client");
    for (const [method, path] of [
      ["POST", "/api/bots/x/voice/status"], ["GET", "/api/bots/x/voice/stream"], ["POST", "/api/bots/x/voice/other"],
    ] as const) expect(requiredScope(method, path), `${method} ${path}`).toBe("admin");
  });

  it("limits a client's bot and room edits to display fields, naming the field it refused", () => {
    expect(clientBotPatchViolation({ unread: true })).toBeNull();
    expect(clientBotPatchViolation({ pinned: true, color: "green" })).toBeNull();
    expect(clientBotPatchViolation({ color: "black", mascotSkin: "lightning" })).toBeNull();
    expect(clientBotPatchViolation({ unread: true, autoApprove: true })).toBe("autoApprove");
    expect(clientBotPatchViolation({ cwd: "/" })).toBe("cwd");
    expect(clientBotPatchViolation([])).toBe("body");
    expect(memberBotFieldViolation({ name: "Scout", soul: "Be brief.", color: "green", modelSelection: { instanceId: "codex" } })).toBeNull();
    for (const field of ["cwd", "computer", "approvalMode", "mcpServers", "browserProfile", "peers", "chiefOfStaff", "section", "visibility"]) {
      expect(memberBotFieldViolation({ name: "Scout", [field]: null }), field).toBe(field);
    }
    expect(clientGroupPatchViolation({ name: "Ops", unread: false, turnTimeoutMinutes: 30 })).toBeNull();
    expect(clientGroupPatchViolation({ cwd: "/tmp" })).toBe("cwd");
    expect(clientGroupPatchViolation({ memberIds: ["bot"], humanIds: ["ada@example.test"] })).toBeNull();
  });

  it("reports installation capabilities from the admin scope, and pairing for an organization member", () => {
    expect(capabilitiesForAuth({ scopes: ["admin", "client"] }, { orgPairing: false })).toEqual({
      editConfig: true, manageKeys: true, manageComputers: true, viewUsage: true, manageBackups: true, pairDevices: true,
    });
    expect(capabilitiesForAuth({ scopes: ["client"] }, { orgPairing: true })).toEqual({
      editConfig: false, manageKeys: false, manageComputers: false, viewUsage: false, manageBackups: false, pairDevices: true,
    });
    expect(capabilitiesForAuth({ scopes: ["client"] }, { orgPairing: false }).pairDevices).toBe(false);
  });
});

describe("resolveRequestAuth", () => {
  let dir: string;
  let sessions: SessionRegistry;
  const cookieName = "omb_session_8799_env";
  const resolve = (headers: Record<string, string>, path = "/api/bots", method = "GET") =>
    resolveRequestAuth(request(headers, method), { sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x") });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-auth-"));
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts authenticated relay mutations without exposing the desktop owner capability", () => {
    const headers = {
      host: "127.0.0.1:8799",
      "x-openmausbot-companion": "1",
      "x-openmausbot-companion-device": "phone-1",
      "x-openmausbot-companion-auth": "relay-secret",
    };
    const check = (method: string, path: string, overrides: Record<string, string> = {}, relay = "relay-secret") =>
      resolveRequestAuth(request({ ...headers, ...overrides }, method), {
        sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://localhost"),
        loopbackMutationToken: "desktop-secret", companionMutationToken: relay,
      });
    for (const [method, path] of [
      ["POST", "/api/bots"], ["POST", "/api/bots/b/messages"],
      ["POST", "/api/bots/b/read"], ["POST", "/api/bots/b/respond"],
      ["POST", "/api/bots/b/secret-cards/card/provide"],
      ["GET", "/api/events"], ["PATCH", "/api/bots/b/profile"],
      // iOS parity S1, D1, D3 and the voice engine reach the harness as the owner
      ["GET", "/api/bots/b/skills"], ["PUT", "/api/bots/b/memory/file"], ["POST", "/api/bots/b/history/rollback"],
      ["GET", "/api/bots/b/system-prompt"], ["POST", "/api/bots/b/primary"], ["PUT", "/api/groups/g/memory"],
      ["PUT", "/api/tts/provider"], ["GET", "/api/bot-presets"],
      // Browser control: the harness re-runs the sidecar's own allowlist, so
      // these resolve here for the same reason the phone may ask for them.
      // The per-device capability is the proxy's job, not this one's.
      ["GET", "/api/bots/b/browser/live"], ["POST", "/api/bots/b/browser/action"],
    ]) expect(check(method, path).auth?.kind, path).toBe("loopback");
    // And the allowlist still closes everything else under that prefix.
    for (const [method, path] of [
      ["POST", "/api/bots/b/browser/live"], ["GET", "/api/bots/b/browser/action"],
      ["POST", "/api/bots/b/browser/restart"],
    ]) expect(check(method, path).auth?.kind, path).not.toBe("loopback");
    const forged: Record<string, string>[] = [
      { "x-openmausbot-companion-auth": "" },
      { "x-openmausbot-companion-auth": "desktop-secret" },
      { "x-openmausbot-companion-device": "" },
      { "x-openmausbot-companion": "0" },
      { origin: "https://evil.example" },
      { "x-forwarded-for": "203.0.113.1" },
      { host: "remote.example" },
    ];
    for (const overrides of forged) expect(check("POST", "/api/bots/b/read", overrides).auth).toBeNull();
    expect(check("POST", "/api/bots/b/read", {}, "").auth).toBeNull();
    for (const [method, path] of [
      ["PUT", "/api/config"], ["POST", "/api/auth/pairing"],
      ["POST", "/api/internal/anything"], ["GET", "/api/auth/sessions"],
      ["POST", "/api/not-yet-supported"], ["POST", "/api/bots/b/memory/open"], ["DELETE", "/api/bot-presets/p"],
    ]) expect(check(method, path).auth, path).toBeNull();
    // The companion's own notice that it unpaired a phone: not on the phone
    // allowlist, but the relay's private token opens it; a forged one does not.
    expect(check("POST", "/api/live/device-revoked").auth?.kind).toBe("loopback");
    for (const overrides of forged) expect(check("POST", "/api/live/device-revoked", overrides).auth).toBeNull();
    expect(check("GET", "/api/live/device-revoked").auth).toBeNull();
  });

  function pairedToken(scopes: Array<"admin" | "client"> = ["admin", "client"]): string {
    const { code } = sessions.openPairing({ scopes });
    const result = sessions.exchange({ code, label: "test", source: "1.2.3.4" });
    if (!result.ok) throw new Error(result.error);
    return result.token;
  }

  it("keeps the loopback owner path exactly as before", () => {
    expect(resolve({ host: "127.0.0.1:8799" }).auth).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
    expect(resolve({ host: "127.0.0.1:8799", origin: "http://localhost:8799" }).auth?.kind).toBe("loopback");
    const foreignHost = resolve({ host: "100.64.0.9:8799" });
    expect(foreignHost.auth).toBeNull();
    expect(foreignHost.status).toBe(403);
    expect(foreignHost.error).toMatch(/loopback host required.*pair this device/);
    const foreignOrigin = resolve({ host: "127.0.0.1:8799", origin: "https://evil.example" });
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.error).toBe("forbidden: cross-origin request");
  });

  it("opens an admin-scope route to a person holding its permission, and names the permission otherwise (2026-10-09)", () => {
    const member = sessions.issue({ label: "browser", scopes: ["client"] });
    const held = new Set<string>();
    const gate = (method: string, path: string, features: Record<string, boolean> = { orgDirectory: true }) =>
      resolveRequestAuth(request({ host: "bots.example.com", authorization: `Bearer ${member.token}` }, method), {
        sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"), features,
        permits: (session, permission) => session.id === member.session.id && held.has(permission),
      });
    expect(gate("GET", "/api/usage")).toMatchObject({ auth: null, status: 403, error: "forbidden", permission: "usage.view" });
    held.add("usage.view");
    expect(gate("GET", "/api/usage").auth?.kind).toBe("session");
    expect(gate("GET", "/api/usage.csv").auth?.kind).toBe("session");
    // a solo server (no orgDirectory) never opens it
    expect(gate("GET", "/api/usage", {})).toMatchObject({ auth: null, error: "forbidden: this session lacks the admin scope" });
    // a route no permission opens keeps the scope refusal (2026-10-19: tool
    // grants change admin rights)
    expect(gate("GET", "/api/tool-grants")).toMatchObject({ auth: null, error: "forbidden: this session lacks the admin scope" });
    expect(gate("GET", "/api/tool-grants").permission).toBeUndefined();
    held.add("engines.manage");
    expect(gate("PATCH", "/api/instances/codex").auth?.kind).toBe("session");
    expect(gate("POST", "/api/instances/codex/install").auth?.kind).toBe("session");
    // never the CLI test, which runs a program: that is host.shell
    expect(gate("POST", "/api/cli-test")).toMatchObject({ auth: null, permission: "host.shell" });
  });

  it("opens Me plugin and skill routes to a member with no organization permission", () => {
    const org = { orgDirectory: true };
    for (const [method, path] of [
      ["GET", "/api/me/plugins"], ["POST", "/api/me/plugins/install"],
      ["PUT", "/api/me/plugins/docs%40market/config"],
      ["PATCH", "/api/me/plugins/docs%40market"], ["DELETE", "/api/me/plugins/docs%40market"],
      ["POST", "/api/me/plugins/marketplaces"],
      ["PUT", "/api/me/plugins/marketplaces/market/credential"],
      ["GET", "/api/me/skills-library"], ["POST", "/api/me/skills-library"],
      ["PUT", "/api/me/skills-library/writing"], ["PATCH", "/api/me/skills-library/writing"],
      ["DELETE", "/api/me/skills-library/writing"],
    ]) {
      expect(requiredScope(method!, path!, org), `${method} ${path}`).toBe("client");
      expect(routePermission(method!, path!, org)).toBeNull();
    }
  });

  it("maps admin-scope routes to permissions only with the organization directory", () => {
    const org = { orgDirectory: true };
    expect(routePermission("GET", "/api/usage", org)).toBe("usage.view");
    expect(routePermission("GET", "/api/admin-activity.csv", org)).toBe("people.activityLog");
    expect(routePermission("POST", "/api/marketplaces", org)).toBe("apps.marketplaces");
    expect(routePermission("POST", "/api/marketplaces/acme/plugins/tool", org)).toBe("apps.marketplaces");
    expect(routePermission("POST", "/api/marketplaces/acme/plugins/tool/update", org)).toBe("apps.marketplaces");
    expect(routePermission("PUT", "/api/skills-library/my-skill", org)).toBe("skills.library");
    expect(routePermission("POST", "/api/instances/claude-accounts", org)).toBe("engines.manage");
    expect(routePermission("POST", "/api/instances/claude/leftover-files/remove", org)).toBeNull();
    // 2026-10-19: the four admin keys an admin gives in Perspicax
    expect(routePermission("PUT", "/api/mcp/servers/x", org)).toBe("host.shell");
    // 2026-10-22: the config write opens to EITHER server.settings OR the
    // separate server.experimental key (no implication). A refusal names the
    // primary (server.settings); routePermissions lists both.
    expect(routePermission("PATCH", "/api/config", org)).toBe("server.settings");
    expect(routePermission("PUT", "/api/config", org)).toBe("server.settings");
    expect([...routePermissions("PATCH", "/api/config", org)!]).toEqual(["server.settings", "server.experimental"]);
    expect(routePermission("PATCH", "/api/org/settings", org)).toBe("server.settings");
    // 2026-10-22: webhooks are no longer gated behind server.settings;
    // a normal owner creates and manages one on the bot's own computer.
    expect(routePermission("POST", "/api/webhooks", org)).toBeNull();
    expect(routePermission("PATCH", "/api/webhooks/w", org)).toBeNull();
    expect(routePermission("POST", "/api/webhooks/w/rotate", org)).toBeNull();
    expect(routePermission("GET", "/api/workspace-backup/status", org)).toBe("backup.workspace");
    expect(routePermission("POST", "/api/workspace-backup/export", org)).toBe("backup.workspace");
    expect(routePermission("DELETE", "/api/auth/sessions/abc", org)).toBe("people.manage");
    // never what changes admin rights
    expect(routePermission("POST", "/api/workspace-backup/restore", org)).toBeNull();
    expect(routePermission("POST", "/api/workspace-backup/upload", org)).toBeNull();
    expect(routePermission("POST", "/api/workspace-backup/preview", org)).toBeNull();
    expect(routePermission("GET", "/api/tool-grants", org)).toBeNull();
    expect(routePermission("POST", "/api/org/interim-people/attach", org)).toBeNull();
    expect(routePermission("GET", "/api/usage", {})).toBeNull();
    // every route a permission opens is admin scope to begin with
    for (const [method, path] of [["GET", "/api/usage"], ["GET", "/api/admin-activity"], ["GET", "/api/marketplaces"], ["GET", "/api/skills-library"], ["PATCH", "/api/instances/codex"]] as const) {
      expect(requiredScope(method, path, org)).toBe("admin");
      expect(PERMISSION_ROUTES.some((rule) => rule.path.test(path) && rule.methods.includes(method)), path).toBe(true);
    }
  });

  it("issues sgx_sess_ bearers and still accepts an omb_sess_ one issued before Sagax", () => {
    const issued = sessions.issue({ label: "browser", scopes: ["admin", "client"] });
    expect(issued.token).toMatch(/^sgx_sess_/);
    expect(resolve({ host: "bots.example.com", authorization: `Bearer ${issued.token}` }).auth?.kind).toBe("session");
    // an older token: same record, as written by a server that issued omb_sess_
    const legacy = `omb_sess_${"L".repeat(43)}`;
    const file = join(dir, "sessions.json");
    const stored = JSON.parse(readFileSync(file, "utf8"));
    const records = Array.isArray(stored) ? stored : stored.sessions;
    records[0].tokenHash = createHash("sha256").update(legacy).digest("hex");
    writeFileSync(file, JSON.stringify(stored));
    sessions = new SessionRegistry({ file });
    expect(resolve({ host: "bots.example.com", authorization: `Bearer ${legacy}` }).auth?.kind).toBe("session");
    expect(resolve({ host: "bots.example.com", authorization: `Bearer ${issued.token}` })).toMatchObject({ auth: null, status: 401 });
  });

  it("rejects revoked email cookies, bearers and tickets without falling back to loopback ownership", () => {
    let allowed: Array<"admin" | "client"> = ["admin", "client"];
    sessions = new SessionRegistry({ file: join(dir, "sessions.json"), emailScopes: () => allowed });
    const paired = pairedToken();
    const email = sessions.issue({ label: "browser", email: "person@example.test", scopes: ["admin", "client"] });
    const { ticket } = sessions.issueStreamTicket(email.session.id);
    expect(resolve({ host: "localhost", cookie: `${cookieName}=${email.token}` }).auth?.kind).toBe("session");
    allowed = ["client"];
    for (const host of ["bots.example.com", "localhost"]) {
      expect(resolve({ host, cookie: `${cookieName}=${email.token}` })).toMatchObject({ auth: null, status: 401 });
      expect(resolve({ host, authorization: `Bearer ${email.token}` })).toMatchObject({ auth: null, status: 401 });
      expect(resolve({ host }, `/api/events?ticket=${ticket}`)).toMatchObject({ auth: null, status: 401 });
    }
    expect(resolve({ host: "localhost", authorization: `Bearer ${paired}` }).auth?.kind).toBe("session");
    expect(resolve({ host: "localhost" }).auth?.kind).toBe("loopback");
  });

  it("renews a session only for a request that passed the origin and scope checks", () => {
    let clock = 1_700_000_000_000;
    sessions = new SessionRegistry({ file: join(dir, "sessions.json"), now: () => clock });
    const { code } = sessions.openPairing({ scopes: ["client"] });
    const result = sessions.exchange({ code, label: "phone", source: "10.0.0.2" });
    if (!result.ok) throw new Error(result.error);
    const { token, session } = result;
    clock += SESSION_TTL_MS / 2 + 1; // renewal is due from here on
    const csrf = resolve({ host: "bots.example.com", cookie: `${cookieName}=${token}`, origin: "https://evil.example" }, "/api/bots", "POST");
    expect(csrf.error).toBe("forbidden: cross-origin request");
    expect(sessions.list()[0]?.expiresAt).toBe(session.expiresAt); // a rejected request is not use
    const overScope = resolve({ authorization: `Bearer ${token}` }, "/api/config", "PUT");
    expect(overScope.status).toBe(403);
    expect(sessions.list()[0]?.expiresAt).toBe(session.expiresAt);
    const { ticket } = sessions.issueStreamTicket(session.id);
    const stream = resolve({ host: "bots.example.com" }, `/api/events?ticket=${ticket}`);
    expect(stream.auth?.kind === "session" && stream.auth.via).toBe("ticket");
    expect(sessions.list()[0]?.expiresAt).toBe(session.expiresAt); // a stream alone is not use
    const ok = resolve({ host: "bots.example.com", cookie: `${cookieName}=${token}`, origin: "http://bots.example.com" });
    expect(ok.auth?.kind).toBe("session");
    expect(sessions.list()[0]?.expiresAt).toBe(clock + SESSION_TTL_MS);
    clock += SESSION_TTL_MS + 1;
    const expired = resolve({ host: "bots.example.com", cookie: `${cookieName}=${token}`, origin: "http://bots.example.com" });
    expect(expired.status).toBe(401);
    expect(sessions.list()).toEqual([]); // expired: gone, not renewed
  });

  it("requires the packaged desktop capability for public loopback mutations", () => {
    const options = (path: string) => ({
      sessions,
      cookieName,
      streamPath: "/api/events",
      url: new URL(path, "http://x"),
      loopbackMutationToken: "owner-token-123",
    });
    const denied = resolveRequestAuth(
      request({ host: "127.0.0.1:8799" }, "PATCH"),
      options("/api/bots/bot-1"),
    );
    expect(denied.auth).toBeNull();
    expect(denied.status).toBe(403);
    expect(denied.error).toMatch(/desktop app or a paired device/);

    const desktop = resolveRequestAuth(
      request({
        host: "127.0.0.1:8799",
        "x-openmausbot-desktop-owner": "owner-token-123",
      }, "POST"),
      options("/api/routines"),
    );
    expect(desktop.auth?.kind).toBe("loopback");

    expect(resolveRequestAuth(
      request({ host: "127.0.0.1:8799" }, "GET"),
      options("/api/bots"),
    ).auth?.kind).toBe("loopback");
    const connectorRefresh = resolveRequestAuth(
      request({ host: "127.0.0.1:8799" }, "GET"),
      options("/api/bots/bot-1/connector-cards/card-1/status?threadId=thread-1"),
    );
    expect(connectorRefresh.auth).toBeNull();
    expect(connectorRefresh.status).toBe(403);
    // The remote viewer route hands out a desktop password and its RFB
    // socket; native owners use the direct viewer instead.
    for (const path of ["/api/desktop-viewer/vps/bot-1", "/api/desktop-viewer/local/shared/websockify",
      "/api/local-computer", "/api/bots/bot-1/local-computer",
      "/api/webhooks/hook-1/address", "/api/webhooks/hook-1/reveal"]) {
      expect(resolveRequestAuth(request({ host: "127.0.0.1:8799" }, "GET"), options(path)).status, path).toBe(403);
      expect(resolveRequestAuth(request({ host: "127.0.0.1:8799", "x-openmausbot-desktop-owner": "owner-token-123" }, "GET"), options(path)).auth?.kind, path)
        .toBe("loopback");
    }
    for (const path of ["/api/webhooks", "/api/local-computer/instances", "/api/bots/bot-1/local-computer/screenshot"]) {
      expect(resolveRequestAuth(request({ host: "127.0.0.1:8799" }, "GET"), options(path)).auth?.kind, path).toBe("loopback");
    }
    expect(resolveRequestAuth(
      request({ host: "127.0.0.1:8799" }, "POST"),
      options("/api/internal/ask-bot"),
    ).auth?.kind).toBe("loopback");
  });

  it("never grants loopback trust to a request that came through a proxy, whatever Host it carries", () => {
    expect(isProxied(request({ host: "localhost", "x-forwarded-for": "203.0.113.9" }))).toBe(true);
    expect(isProxied(request({ host: "localhost", "x-forwarded-proto": "https" }))).toBe(true);
    expect(isProxied(request({ host: "localhost" }))).toBe(false);
    const viaProxy = resolve({ host: "localhost", "x-forwarded-for": "203.0.113.9" });
    expect(viaProxy.auth).toBeNull();
    expect(viaProxy.status).toBe(403);
    expect(viaProxy.error).toMatch(/came through a proxy.*pair this device/);
    const rewritten = resolve({ host: "127.0.0.1:8799", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9" });
    expect(rewritten.auth).toBeNull();
    // a paired session through the same proxy is fine
    const token = pairedToken();
    expect(resolve({ host: "localhost", "x-forwarded-for": "203.0.113.9", authorization: `Bearer ${token}` }).auth?.kind).toBe("session");
  });

  it("admits a bearer session from any host and reports how it authenticated", () => {
    const token = pairedToken();
    const r = resolve({ host: "100.64.0.9:8799", authorization: `Bearer ${token}` });
    expect(r.auth?.kind).toBe("session");
    expect(r.auth?.kind === "session" && r.auth.via).toBe("bearer");
  });

  it("admits the cookie only same-origin, so a foreign page cannot ride it", () => {
    const token = pairedToken();
    const ok = resolve({ host: "bots.example.com", cookie: `${cookieName}=${token}`, origin: "http://bots.example.com" });
    expect(ok.auth?.kind).toBe("session");
    const csrf = resolve({ host: "bots.example.com", cookie: `${cookieName}=${token}`, origin: "https://evil.example" }, "/api/bots", "POST");
    expect(csrf.auth).toBeNull();
    expect(csrf.status).toBe(403);
    expect(csrf.error).toBe("forbidden: cross-origin request");
  });

  it("lets a browser sign-in's session make changes only when the browser says the request is its own page's", () => {
    const { credential } = sessions.openPairing({ browser: true, owner: "ada@example.test" });
    const signedIn = sessions.exchange({ code: credential, label: "Chrome on Mac", source: "1.2.3.4", browser: true });
    if (!signedIn.ok) throw new Error(signedIn.error);
    const cookie = `${cookieName}=${signedIn.token}`;
    const cloud = { host: "omb-u-0123456789ab.fly.dev", "x-forwarded-proto": "https", cookie };
    // Reading needs nothing more.
    expect(resolve(cloud).auth?.kind).toBe("session");
    // A change: the browser's Origin, or its Sec-Fetch-Site, must say same-origin.
    expect(resolve({ ...cloud, origin: "https://omb-u-0123456789ab.fly.dev" }, "/api/bots", "POST").auth?.kind).toBe("session");
    expect(resolve({ ...cloud, "sec-fetch-site": "same-origin" }, "/api/bots", "DELETE").auth?.kind).toBe("session");
    for (const [headers, method] of [[{}, "POST"], [{}, "PUT"], [{}, "PATCH"], [{}, "DELETE"], [{ "sec-fetch-site": "none" }, "POST"], [{ "sec-fetch-site": "cross-site" }, "POST"],
      [{ "sec-fetch-site": "same-site" }, "POST"], [{ origin: "https://evil.example", "sec-fetch-site": "same-origin" }, "POST"]] as const) {
      const refused = resolve({ ...cloud, ...headers }, "/api/bots", method);
      expect(refused.auth, `${method} ${JSON.stringify(headers)}`).toBeNull();
      expect(refused.status).toBe(403);
    }
    expect(resolve(cloud, "/api/bots", "POST").error).toBe("forbidden: this browser's session makes changes only from its own page");
    const connectorRefresh = "/api/bots/bot-1/connector-cards/card-1/status";
    const secretRead = "/api/local-computer";
    const notItsPage: Record<string, string>[] = [{}, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }, { origin: "https://evil.example" }];
    for (const headers of notItsPage) {
      expect(resolve({ ...cloud, ...headers }, connectorRefresh, "GET").auth, JSON.stringify(headers)).toBeNull();
      expect(resolve({ ...cloud, ...headers }, secretRead, "GET").auth, JSON.stringify(headers)).toBeNull();
      expect(resolve({ ...cloud, ...headers }, "/api/desktop-viewer/vps/bot-1", "GET").auth, JSON.stringify(headers)).toBeNull();
    }
    expect(resolve({ ...cloud, "sec-fetch-site": "same-origin" }, connectorRefresh, "GET").auth?.kind).toBe("session");
    expect(resolve({ ...cloud, "sec-fetch-site": "same-origin" }, secretRead, "GET").auth?.kind).toBe("session");
    expect(resolve({ ...cloud, "sec-fetch-site": "same-site" }, "/api/bots", "GET").auth?.kind).toBe("session");
    // Any other session's cookie keeps the old rule: a missing Origin passes.
    const paired = pairedToken();
    expect(resolve({ host: "omb-u-0123456789ab.fly.dev", "x-forwarded-proto": "https", cookie: `${cookieName}=${paired}` }, "/api/bots", "POST").auth?.kind).toBe("session");
    expect(provesSameOrigin(request({ host: "a.example", origin: "http://a.example" }))).toBe(true);
    expect(provesSameOrigin(request({ host: "a.example" }))).toBe(false);
    // A foreign Origin is never outvoted by Sec-Fetch-Site.
    expect(provesSameOrigin(request({ host: "a.example", origin: "https://evil.example", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("accepts a stream ticket on the event stream only, once", () => {
    const token = pairedToken();
    const session = sessions.authenticate(token);
    if (!session) throw new Error("no session");
    const { ticket } = sessions.issueStreamTicket(session.id);
    expect(resolve({ host: "bots.example.com" }, `/api/events?ticket=${ticket}`).auth?.kind).toBe("session");
    expect(resolve({ host: "bots.example.com" }, `/api/events?ticket=${ticket}`).status).toBe(401);
    const { ticket: other } = sessions.issueStreamTicket(session.id);
    expect(resolve({ host: "bots.example.com" }, `/api/bots?ticket=${other}`).auth).toBeNull();
  });

  it("enforces scope: a client-only session cannot manage pairing or write config", () => {
    const token = pairedToken(["client"]);
    const denied = resolve({ host: "bots.example.com", authorization: `Bearer ${token}` }, "/api/auth/pairing", "POST");
    expect(denied.status).toBe(403);
    expect(denied.error).toContain("lacks the admin scope");
    const mcpDenied = resolve(
      { host: "bots.example.com", authorization: `Bearer ${token}` },
      "/api/mcp/servers/github/test",
      "POST",
    );
    expect(mcpDenied.status).toBe(403);
    expect(mcpDenied.error).toContain("lacks the admin scope");
    expect(resolve({ host: "bots.example.com", authorization: `Bearer ${token}` }, "/api/bots").auth?.kind).toBe("session");
    // #1786: POST leave reaches the handler; any other method stays admin.
    const leave = resolve({ host: "bots.example.com", authorization: `Bearer ${token}` }, "/api/groups/g-1/leave", "POST");
    expect(leave.auth?.kind).toBe("session");
    expect(leave.error).not.toContain("lacks the admin scope");
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const refused = resolve({ host: "bots.example.com", authorization: `Bearer ${token}` }, "/api/groups/g-1/leave", method);
      expect(refused.status, method).toBe(403);
      expect(refused.error, method).toContain("lacks the admin scope");
    }
  });

  it.each([
    ["GET", "/api/settings/custom-domain"],
    ["POST", "/api/settings/custom-domain"],
    ["DELETE", "/api/settings/custom-domain"],
    ["GET", "/api/instances/codex/auth/status?flowId=private-device-flow"],
    ["POST", "/api/instances/codex/auth/start"],
    ["POST", "/api/instances/codex/auth/cancel"],
    ["POST", "/api/instances/codex/auth/sign-out"],
    ["POST", "/api/instances/claude-work/auth/sign-out"],
    ["GET", "/api/usage?from=2026-09-01&to=2026-09-30"],
    ["GET", "/api/usage.csv?from=2026-09-01&to=2026-09-30"],
    ["POST", "/api/keys/test"],
    ["GET", "/api/fleet"],
    ["POST", "/api/fleet/workspaces"],
    ["DELETE", "/api/fleet/workspaces/acme"],
    ["POST", "/api/fleet/upgrade"],
    ["POST", "/api/instances/antigravity/auth/complete"],
    ["GET", "/api/instances/cursor/api-key"],
    ["POST", "/api/instances/cursor/api-key"],
  ])("requires admin for server Settings: %s %s", (method, path) => {
    expect(requiredScope(method, path.split("?")[0]!)).toBe("admin");
    const client = pairedToken(["client"]);
    const admin = pairedToken(["admin"]);
    const headers = { host: "bots.example.com", "x-forwarded-proto": "https", origin: "https://bots.example.com" };
    // Both app bearer sessions and same-origin browser cookies must enforce
    // the boundary: a client cannot read login codes or change pairing URLs.
    const clientCredentials: Record<string, string>[] = [{ authorization: `Bearer ${client}` }, { cookie: `${cookieName}=${client}` }];
    for (const credential of clientCredentials) {
      const denied = resolve({ ...headers, ...credential }, path, method);
      expect(denied.auth).toBeNull();
      expect(denied.status).toBe(403);
      expect(denied.error).toContain("lacks the admin scope");
    }
    expect(resolve({ ...headers, authorization: `Bearer ${admin}` }, path, method).auth?.kind).toBe("session");
    expect(resolve(headers, path, method).auth).toBeNull();
  });

  it("explains a dead credential instead of silently falling back, even on loopback", () => {
    const token = pairedToken();
    const session = sessions.authenticate(token);
    if (!session) throw new Error("no session");
    sessions.revoke(session.id);
    const remote = resolve({ host: "bots.example.com", authorization: `Bearer ${token}` });
    expect(remote.status).toBe(401);
    expect(remote.error).toMatch(/expired or was revoked; pair this device again/);
    // A rejected credential must never become a more powerful identity.
    expect(resolve({ host: "127.0.0.1:8799", cookie: `${cookieName}=${token}` })).toMatchObject({ auth: null, status: 401 });
  });
});

describe("an IPC listener (openmausbot serve --tunnel) is remote by construction", () => {
  // SAFETY: only headers, method and the socket peer are read; a unix-socket peer has no address
  const overSocket = (headers: Record<string, string>) => ({ headers, method: "GET", socket: {} }) as unknown as IncomingMessage;

  it("counts as proxied whatever the headers say; a bare mock without a socket does not", () => {
    expect(ipcPeer(overSocket({ host: "127.0.0.1:8799" }))).toBe(true);
    expect(isProxied(overSocket({ host: "localhost" }))).toBe(true);
    expect(ipcPeer(request({ host: "127.0.0.1:8799" }))).toBe(false);
    expect(isProxied(request({ host: "127.0.0.1:8799" }))).toBe(false);
  });

  it("attributes pairing attempts to the address the tunnel forwarded", () => {
    expect(requestSource(overSocket({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(requestSource(overSocket({}))).toBe("unknown");
  });

  it("never grants loopback trust over the socket, even with a loopback Host and no forwarded headers; a session works", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-auth-ipc-"));
    try {
      const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
      const gate = { sessions, cookieName: "omb_session_test", streamPath: "/api/events", url: new URL("/api/bots", "http://x") };
      const denied = resolveRequestAuth(overSocket({ host: "127.0.0.1:8799" }), gate);
      expect(denied.auth).toBeNull();
      expect(denied.status).toBe(403);
      expect(denied.error).toMatch(/through a proxy/);
      const { code } = sessions.openPairing({ scopes: ["admin", "client"] });
      const paired = sessions.exchange({ code, label: "phone", source: "203.0.113.9" });
      if (!paired.ok) throw new Error(paired.error);
      const admitted = resolveRequestAuth(overSocket({ host: "c-1.openmausbot.com", authorization: `Bearer ${paired.token}` }), gate);
      expect(admitted.auth?.kind).toBe("session");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loopback trust: owner on one person's machine, service on a shared workspace", () => {
  let dir: string;
  let sessions: SessionRegistry;
  const cookieName = "omb_session_8799_env";
  const local = { host: "127.0.0.1:8799" };
  const check = (method: string, path: string, options: { trust?: "owner" | "service"; headers?: Record<string, string>; desktopToken?: string } = {}) =>
    resolveRequestAuth(request({ ...local, ...options.headers }, method), {
      sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"),
      ...(options.trust ? { loopbackTrust: options.trust } : {}),
      ...(options.desktopToken !== undefined ? { loopbackMutationToken: options.desktopToken } : {}),
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-auth-trust-"));
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Liveness, identity, and the turn-scoped capability routes. The old
  // Slack-worker data plane is in DENIED_SERVICE_CALLS: a bot's shell is
  // the same session-less loopback caller.
  const SERVICE_CALLS: Array<[string, string]> = [
    ["GET", "/api/health"],
    ["GET", "/api/auth/session"],
    ["GET", "/api/edition"],
    ["GET", "/api/brand"],
    ["POST", "/api/internal/ask-bot"],
    ["GET", "/api/internal/agents"],
    ["POST", "/api/internal/hook"],
    ["POST", "/api/testing/internal-capability"],
  ];
  const DENIED_SERVICE_CALLS: Array<[string, string]> = [
    ["GET", "/api/bots?messages=0"],
    ["GET", "/api/threads/thread-1/messages?limit=0"],
    ["GET", "/api/threads/thread-1/messages?limit=200&before=m-1"],
    ["GET", "/api/attachments/0b3c9f2e-1a2b-4c5d-8e9f-0a1b2c3d4e5f.png"],
    ["POST", "/api/bots/bot-1/tasks"],
    ["POST", "/api/bots/bot-1/messages/guarded"],
    ["GET", "/api/bots/bot-1/requests/job_0123456789abcdef?threadId=thread-1"],
    ["POST", "/api/bots/bot-1/requests/job_0123456789abcdef/interrupt"],
    ["DELETE", "/api/bots/bot-1/queue/queue-1"],
    ["POST", "/api/threads/thread-1/respond"],
  ];
  // Admin changes a bot's shell must not make as the owner.
  const ADMIN_CALLS: Array<[string, string]> = [
    ["PUT", "/api/config"], ["PATCH", "/api/config"], ["GET", "/api/config"],
    ["POST", "/api/webhooks"], ["GET", "/api/webhooks"],
    ["GET", "/api/auth/sessions"], ["DELETE", "/api/auth/sessions/sess-admin"], ["POST", "/api/auth/pairing"],
    ["POST", "/api/bots"], ["PATCH", "/api/bots/bot-1"], ["DELETE", "/api/bots/bot-1"],
    ["POST", "/api/instances"], ["GET", "/api/instances"], ["POST", "/api/mcp-servers"],
    ["POST", "/api/keys/test"], ["GET", "/api/usage"], ["GET", "/api/decisions"], ["GET", "/api/decisions.csv"],
    ["POST", "/api/fleet/workspaces"], ["POST", "/api/settings/custom-domain"], ["POST", "/api/workspace-backup/export"],
    // ordinary sends and answers go through a person's session, not loopback
    ["POST", "/api/bots/bot-1/messages"], ["POST", "/api/bots/bot-1/respond"], ["POST", "/api/bots/bot-1/always-allow"],
    ["POST", "/api/threads/thread-1/undo"], ["POST", "/api/groups/room-1/messages"], ["POST", "/api/routines"], ["GET", "/api/events"],
  ];

  it("keeps the owner exactly as before when no trust is given or trust is owner", () => {
    for (const trust of [undefined, "owner"] as const) {
      for (const [method, path] of [...SERVICE_CALLS, ...DENIED_SERVICE_CALLS, ...ADMIN_CALLS]) {
        expect(check(method, path, { trust }).auth, `${method} ${path}`).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
      }
    }
  });

  it("keeps the browser network debugger for the person: never a bot shell, a worker or a client", () => {
    const path = "/api/bots/bot-1/browser/network";
    // a bot's shell on a shared server, with or without the worker relay token
    expect(check("POST", path, { trust: "service" }).auth).toBeNull();
    const token = "r".repeat(43);
    expect(resolveRequestAuth(request({ ...local, "x-sagax-worker-relay": token }, "POST"), {
      sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"), loopbackTrust: "service", workerRelayToken: token,
    }).auth).toBeNull();
    // a local process on the desktop without the app's own capability
    expect(check("POST", path, { desktopToken: "owner-token" }).auth).toBeNull();
    expect(check("POST", path, { desktopToken: "owner-token", headers: { "x-openmausbot-desktop-owner": "owner-token" } }).auth?.kind).toBe("loopback");
    // a client session (not an admin) may not use it either
    expect(requiredScope("POST", path)).toBe("admin");
    expect(serviceAllowed("POST", path)).toBe(false);
    expect(workerRelayAllowed("POST", path)).toBe(false);
  });

  it("lets a service reach only its routes, as a client without admin", () => {
    for (const [method, path] of SERVICE_CALLS) {
      expect(check(method, path, { trust: "service" }).auth, `${method} ${path}`).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    }
    for (const [method, path] of [...DENIED_SERVICE_CALLS, ...ADMIN_CALLS]) {
      const denied = check(method, path, { trust: "service" });
      expect(denied.auth, `${method} ${path}`).toBeNull();
      expect(denied.status).toBe(403);
      expect(denied.error).toMatch(/shared server.*sign in/);
    }
  });

  it("opens the worker data plane only to the relay token, never to a bot shell", () => {
    const token = "r".repeat(43);
    const header = "x-sagax-worker-relay";
    const asWorker = (method: string, path: string, presented: string | false = token) =>
      resolveRequestAuth(request({ ...local, ...(presented === false ? {} : { [header]: presented }) }, method), {
        sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"),
        loopbackTrust: "service", workerRelayToken: token,
      });
    for (const [method, path] of DENIED_SERVICE_CALLS) {
      expect(asWorker(method, path).auth, `${method} ${path}`).toEqual({
        kind: "loopback", scopes: ["client"], trust: "service", relay: "worker",
      });
      expect(asWorker(method, path, false).auth, `shell ${method} ${path}`).toBeNull();
      expect(asWorker(method, path, "s".repeat(43)).auth, `wrong ${method} ${path}`).toBeNull();
    }
    for (const [method, path] of ADMIN_CALLS) {
      expect(asWorker(method, path).auth, `admin ${method} ${path}`).toBeNull();
    }
    expect(asWorker("GET", "/api/health").auth).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    expect(asWorker("GET", "/api/bots?messages=0", "").auth).toBeNull();
  });

  it("reads a one-line relay token and ignores a short or multiline value without echoing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = "r".repeat(43);
    expect(readWorkerRelayToken({ SAGAX_WORKER_RELAY_TOKEN: good })).toBe(good);
    expect(readWorkerRelayToken({})).toBeUndefined();
    expect(readWorkerRelayToken({ SAGAX_WORKER_RELAY_TOKEN: "" })).toBeUndefined();
    expect(readWorkerRelayToken({ SAGAX_WORKER_RELAY_TOKEN: "short" })).toBeUndefined();
    expect(readWorkerRelayToken({ SAGAX_WORKER_RELAY_TOKEN: `${good}\nextra` })).toBeUndefined();
    expect(warn.mock.calls.flat().join(" ")).not.toContain(good.slice(0, 8));
    warn.mockRestore();
  });

  it("still admits a real session with its own scopes on a service-trust server", () => {
    const admin = sessions.issue({ label: "Laptop", scopes: ["admin", "client"] });
    const member = sessions.issue({ label: "Phone", scopes: ["client"] });
    expect(check("PUT", "/api/config", { trust: "service", headers: { authorization: `Bearer ${admin.token}` } }).auth?.kind).toBe("session");
    expect(check("POST", "/api/bots/bot-1/messages", { trust: "service", headers: { authorization: `Bearer ${member.token}` } }).auth?.kind).toBe("session");
    expect(check("PUT", "/api/config", { trust: "service", headers: { authorization: `Bearer ${member.token}` } }).status).toBe(403);
  });

  it("ignores service trust while the desktop capability is in force", () => {
    expect(check("PUT", "/api/config", { trust: "service", desktopToken: "owner-token", headers: { "x-openmausbot-desktop-owner": "owner-token" } }).auth)
      .toEqual({ kind: "loopback", scopes: ["admin", "client"] });
  });

  it("defaults to service on a hosted workspace, owner elsewhere, and lets the operator choose", () => {
    const pick = (env: NodeJS.ProcessEnv, flags: { desktopManaged?: boolean; hostedWorkspace?: boolean } = {}) =>
      resolveLoopbackTrust({ env, desktopManaged: false, hostedWorkspace: false, ...flags });
    expect(pick({})).toEqual({ trust: "owner", reason: "self-hosted default", localBrowsers: false });
    expect(pick({}, { hostedWorkspace: true })).toEqual({ trust: "service", reason: "hosted workspace", localBrowsers: false });
    expect(pick({ SAGAX_LOOPBACK_TRUST: "service" })).toEqual({ trust: "service", reason: "SAGAX_LOOPBACK_TRUST", localBrowsers: false });
    expect(pick({ SAGAX_LOOPBACK_TRUST: " Service " }).trust).toBe("service");
    const forced = pick({ SAGAX_LOOPBACK_TRUST: "owner" }, { hostedWorkspace: true });
    expect(forced.trust).toBe("owner");
    expect(forced.warning).toMatch(/shared workspace/);
    const typo = pick({ SAGAX_LOOPBACK_TRUST: "own3r\n" });
    expect(typo.trust).toBe("service");
    expect(typo.warning).toMatch(/not owner or service/);
    expect(typo.warning).not.toContain("\n");
    expect(pick({ SAGAX_LOOPBACK_TRUST: "" }).trust).toBe("owner");
    const desktop = pick({ SAGAX_LOOPBACK_TRUST: "service" }, { desktopManaged: true, hostedWorkspace: true });
    expect(desktop.trust).toBe("owner");
    expect(desktop.warning).toMatch(/ignored in the desktop app/);
  });

  it("is always service on an OMB Cloud home, where a local request is only ever a process on the machine", () => {
    const pick = (env: NodeJS.ProcessEnv) => resolveLoopbackTrust({ env, desktopManaged: false, hostedWorkspace: false, cloudHome: true });
    expect(pick({})).toEqual({ trust: "service", reason: "OMB Cloud home", localBrowsers: false });
    expect(pick({ SAGAX_LOOPBACK_TRUST: "service" })).toEqual({ trust: "service", reason: "OMB Cloud home", localBrowsers: false });
    const forced = pick({ SAGAX_LOOPBACK_TRUST: "owner" });
    expect(forced.trust).toBe("service");
    expect(forced.warning).toMatch(/ignored on an OMB Cloud home/);
  });

  it("lets only the CLI that started the server, holding its secret, mint a pairing code under service trust", () => {
    const secret = "c".repeat(43);
    const as = (method: string, path: string, header?: string, token: string | null = secret) =>
      resolveRequestAuth(request({ ...local, ...(header ? { "x-openmausbot-cli-owner": header } : {}) }, method), {
        sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"), loopbackTrust: "service", cliOwnerToken: token ?? undefined,
      });
    expect(as("POST", "/api/auth/pairing", secret).auth).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
    expect(as("GET", "/api/auth/pairing", secret).auth?.kind).toBe("loopback");
    // nothing else opens with it, and nothing opens without it
    for (const [method, path] of [["PUT", "/api/config"], ["GET", "/api/auth/sessions"], ["DELETE", "/api/auth/pairing"], ["POST", "/api/bots"]] as const) {
      expect(as(method, path, secret).auth, `${method} ${path}`).toBeNull();
    }
    expect(as("POST", "/api/auth/pairing").auth).toBeNull();
    expect(as("POST", "/api/auth/pairing", "d".repeat(43)).auth).toBeNull();
    expect(as("POST", "/api/auth/pairing", "", null).auth).toBeNull();
    expect(as("POST", "/api/auth/pairing", secret, null).auth).toBeNull();
    // the serving CLI waits on the pid it started: its secret opens the full health answer
    const health = as("GET", "/api/health", secret).auth;
    expect(health).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
    expect(healthDetail(health, { organization: true })).toBe("full");
    expect(as("POST", "/api/health", secret).auth).toBeNull();
    const plain = as("GET", "/api/health").auth;
    expect(plain).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    expect(healthDetail(plain, { organization: true })).toBe("app");
  });
});

describe("what GET /api/health tells a caller (spec section 4 bis)", () => {
  const session = (scopes: Array<"admin" | "client">) => ({ kind: "session" as const, via: "cookie" as const, scopes,
    // SAFETY: healthDetail reads only the kind and trust; the record is inert here
    session: { id: "s", scopes } as unknown as SessionRecord });
  it("lists the engines to anyone signed in and to the owner's loopback", () => {
    for (const organization of [true, false]) {
      expect(healthDetail(session(["admin", "client"]), { organization })).toBe("full");
      expect(healthDetail(session(["client"]), { organization })).toBe("full");
      expect(healthDetail({ kind: "loopback", scopes: ["admin", "client"] }, { organization })).toBe("full");
    }
  });
  it("tells a session-less bot shell on an organization server the app name only", () => {
    expect(healthDetail({ kind: "loopback", scopes: ["client"], trust: "service" }, { organization: true })).toBe("app");
    expect(healthDetail(null, { organization: true })).toBe("app");
    expect(healthDetail(null, { organization: false })).toBe("app");
  });
  it("keeps the guarded send contract for the Slack worker on a hosted workspace, without pid or engines", () => {
    expect(healthDetail({ kind: "loopback", scopes: ["client"], trust: "service" }, { organization: false })).toBe("capabilities");
  });
});

describe("organization pairing (SAGAX_IDENTITY=perspicax, slice 2)", () => {
  it("lets a member open a pairing code only on an organization server", () => {
    expect(requiredScope("POST", "/api/auth/pairing")).toBe("admin");
    expect(requiredScope("POST", "/api/auth/pairing", { orgPairing: false })).toBe("admin");
    expect(requiredScope("POST", "/api/auth/pairing", { orgPairing: true })).toBe("client");
    // listing the open codes stays admin
    expect(requiredScope("GET", "/api/auth/pairing", { orgPairing: true })).toBe("admin");
    expect(requiredScope("POST", "/api/auth/pairings", { orgPairing: true })).toBe("admin");
  });
});

describe("organization sharing routes (SAGAX_IDENTITY=perspicax, slice 3)", () => {
  it("opens the directory to members only on an organization server", () => {
    expect(requiredScope("GET", "/api/org/directory")).toBe("admin");
    expect(requiredScope("GET", "/api/org/directory", { orgDirectory: true })).toBe("client");
    // a person's avatar: an organization's people, or a personal computer's owner
    expect(requiredScope("GET", "/api/people/pr_1/avatar")).toBe("client");
    expect(requiredScope("GET", "/api/people/pr_1/avatar", { orgDirectory: true })).toBe("client");
    expect(requiredScope("PUT", "/api/people/pr_1/avatar")).toBe("admin");
    expect(requiredScope("POST", "/api/org/directory", { orgDirectory: true })).toBe("admin");
  });

  it("keeps the mail settings admin-only whatever the features", () => {
    for (const [method, path] of [["GET", "/api/mail/settings"], ["PUT", "/api/mail/settings"], ["POST", "/api/mail/test"]] as const) {
      expect(requiredScope(method, path, { orgDirectory: true, orgPairing: true, sharedComputers: true })).toBe("admin");
    }
  });

  it("keeps the organization settings and the admin approvals admin-only", () => {
    expect(requiredScope("PATCH", "/api/org/settings", { orgDirectory: true, orgPairing: true })).toBe("admin");
    expect(requiredScope("GET", "/api/org/approvals", { orgDirectory: true, orgPairing: true })).toBe("admin");
  });

  it("opens the caller's routine delegation to members on an organization server only, read-only (slice 6, 2026-10-08)", () => {
    expect(requiredScope("GET", "/api/org/routine-delegation", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/org/routine-delegation")).toBe("admin");
    // no consent to start and nothing to revoke from Sagax any more
    for (const method of ["POST", "DELETE"]) expect(requiredScope(method, "/api/org/routine-delegation", { orgDirectory: true })).toBe("admin");
    expect(requiredScope("PATCH", "/api/org/routine-delegation", { orgDirectory: true })).toBe("admin");
    expect(requiredScope("GET", "/api/org/routine-delegation/x", { orgDirectory: true })).toBe("admin");
  });

  it("lets the owner remove a grant by principal id at client scope", () => {
    expect(requiredScope("DELETE", "/api/bots/aurora/direct-grants/pr_00000000-0000-4000-8000-000000000001")).toBe("client");
    expect(requiredScope("DELETE", "/api/bots/aurora/direct-grants/someone")).toBe("admin");
    expect(requiredScope("POST", "/api/bots/aurora/direct-grants")).toBe("client");
  });
});

describe("a browser on this machine is not the owner", () => {
  let dir: string;
  let sessions: SessionRegistry;
  const cookieName = "omb_session_8799_env";
  // What Chrome sends: Sec-Fetch-* on every request to a loopback address, Origin on every WebSocket handshake.
  const page = { host: "127.0.0.1:8799", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" };
  const navigation = { host: "127.0.0.1:8799", "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" };
  const socket = { host: "127.0.0.1:8799", origin: "http://localhost:3000", upgrade: "websocket", connection: "Upgrade" };
  const ownUi = { host: "127.0.0.1:8799", origin: "http://127.0.0.1:8799", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
  const check = (headers: Record<string, string>, path = "/api/bots", method = "GET", options: { desktopToken?: string; trust?: "owner" | "service"; localBrowsers?: boolean } = {}) =>
    resolveRequestAuth(request(headers, method), {
      sessions, cookieName, streamPath: "/api/events", url: new URL(path, "http://x"),
      ...(options.desktopToken !== undefined ? { loopbackMutationToken: options.desktopToken, companionMutationToken: "relay-secret" } : {}),
      ...(options.trust ? { loopbackTrust: options.trust } : {}),
      ...(options.localBrowsers ? { trustLocalBrowser: true } : {}),
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-auth-browser-"));
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("tells a browser request from a command-line one", () => {
    for (const headers of [page, navigation, socket, ownUi, { host: "localhost", "sec-fetch-dest": "image" }]) expect(fromBrowser(request(headers)), JSON.stringify(headers)).toBe(true);
    const programs: Record<string, string>[] = [
      { host: "127.0.0.1:8799" }, { host: "127.0.0.1:8799", origin: "http://127.0.0.1:8799" }, { host: "127.0.0.1:8799", upgrade: "websocket" },
      { host: "127.0.0.1:8799", "x-openmausbot-cli": "1" },
      // Node's fetch.
      { host: "127.0.0.1:8799", "sec-fetch-mode": "cors", "accept-language": "*", "user-agent": "node" },
    ];
    for (const headers of programs) {
      expect(fromBrowser(request(headers)), JSON.stringify(headers)).toBe(false);
    }
  });

  it("refuses a self-hosted server's browser on loopback, reads included, and says how to sign in", () => {
    for (const headers of [page, navigation, socket, ownUi]) {
      for (const [method, path] of [["GET", "/api/bots"], ["GET", "/api/config"], ["GET", "/api/auth/session"], ["POST", "/api/auth/pairing"], ["GET", "/api/desktop-viewer/local/shared/websockify"]]) {
        const refused = check(headers, path, method);
        expect(refused.auth, `${method} ${path}`).toBeNull();
        expect(refused.status).toBe(401);
        expect(refused.error).toBe(BROWSER_SIGN_IN);
      }
    }
    expect(check({ host: "127.0.0.1:8799" }).auth).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
  });

  it("refuses it under service trust too, where it would otherwise get the service routes", () => {
    expect(check(page, "/api/health", "GET", { trust: "service" }).auth).toBeNull();
    expect(check({ host: "127.0.0.1:8799" }, "/api/health", "GET", { trust: "service" }).auth?.kind).toBe("loopback");
  });

  it("lets the desktop app's own window in with its owner header, on http and WebSocket alike", () => {
    const desktop = { desktopToken: "owner-token-123" };
    const owner = { "x-openmausbot-desktop-owner": "owner-token-123" };
    expect(check({ ...ownUi, ...owner }, "/api/bots", "GET", desktop).auth?.kind).toBe("loopback");
    expect(check({ ...ownUi, ...owner }, "/api/bots/bot-1", "PATCH", desktop).auth?.kind).toBe("loopback");
    expect(check({ ...socket, origin: "http://127.0.0.1:8799", ...owner }, "/api/desktop-viewer/local/shared/websockify", "GET", desktop).auth?.kind).toBe("loopback");
    for (const headers of [ownUi, page, socket, { ...ownUi, "x-openmausbot-desktop-owner": "owner-token-999" }]) {
      expect(check(headers, "/api/bots", "GET", desktop).status, JSON.stringify(headers)).toBe(401);
    }
    // Before the desktop app has sent its capability, nothing a browser sends matches.
    expect(check({ ...ownUi, "x-openmausbot-desktop-owner": "" }, "/api/bots", "GET", { desktopToken: "" }).auth).toBeNull();
    // The app's main process and the companion send no Sec-Fetch-*.
    expect(check({ host: "127.0.0.1:8799" }, "/api/bots", "GET", desktop).auth?.kind).toBe("loopback");
    const relay = { host: "127.0.0.1:8799", "x-openmausbot-companion": "1", "x-openmausbot-companion-device": "phone-1", "x-openmausbot-companion-auth": "relay-secret" };
    expect(check(relay, "/api/bots/b/messages", "POST", desktop).auth?.kind).toBe("loopback");
  });

  it("refuses a browser the owner view of a published page, unless it is the desktop window or a dev server", () => {
    expect(loopbackBrowserRefused(request(ownUi), {})).toBe(true);
    expect(loopbackBrowserRefused(request(page), { loopbackMutationToken: "owner-token-123" })).toBe(true);
    expect(loopbackBrowserRefused(request({ ...ownUi, "x-openmausbot-desktop-owner": "owner-token-123" }), { loopbackMutationToken: "owner-token-123" })).toBe(false);
    expect(loopbackBrowserRefused(request({ ...ownUi, "x-openmausbot-desktop-owner": "" }), { loopbackMutationToken: "" })).toBe(true);
    expect(loopbackBrowserRefused(request(page), { trustLocalBrowser: true })).toBe(false);
    expect(loopbackBrowserRefused(request({ host: "127.0.0.1:8799" }), {})).toBe(false);
  });

  it("still admits a browser that signed in", () => {
    const { code } = sessions.openPairing({ scopes: ["admin", "client"] });
    const paired = sessions.exchange({ code, label: "This browser", source: "127.0.0.1" });
    if (!paired.ok) throw new Error(paired.error);
    const signedIn = check({ ...ownUi, cookie: `${cookieName}=${paired.token}` });
    expect(signedIn.auth?.kind).toBe("session");
  });

  it("trusts local browsers only on a development server that asked for it", () => {
    expect(check(page, "/api/bots", "GET", { localBrowsers: true }).auth).toEqual({ kind: "loopback", scopes: ["admin", "client"] });
    // The desktop owner header is still required for desktop mutations.
    expect(check(page, "/api/bots/bot-1", "PATCH", { localBrowsers: true, desktopToken: "owner-token-123" }).status).toBe(403);
    const pick = (env: NodeJS.ProcessEnv, flags: { fromSource?: boolean; desktopManaged?: boolean; hostedWorkspace?: boolean } = {}) =>
      resolveLoopbackTrust({ env, desktopManaged: false, hostedWorkspace: false, ...flags });
    const dev = { SAGAX_DEV_TRUST_LOCAL_BROWSER: "1" };
    expect(pick(dev, { fromSource: true })).toMatchObject({ trust: "owner", localBrowsers: true, warning: expect.stringMatching(/development only/) });
    expect(pick(dev, { fromSource: false })).toMatchObject({ localBrowsers: false, warning: expect.stringMatching(/ignored/) });
    expect(pick(dev, { fromSource: true, desktopManaged: true })).toMatchObject({ localBrowsers: false, warning: expect.stringMatching(/ignored/) });
    expect(pick(dev, { fromSource: true, hostedWorkspace: true })).toMatchObject({ trust: "service", localBrowsers: false });
    expect(pick({ ...dev, SAGAX_LOOPBACK_TRUST: "service" }, { fromSource: true }).localBrowsers).toBe(false);
    expect(pick({ SAGAX_DEV_TRUST_LOCAL_BROWSER: "true" }, { fromSource: true })).toEqual({ trust: "owner", reason: "self-hosted default", localBrowsers: false });
    expect(resolveLoopbackTrust({ env: dev, desktopManaged: false, hostedWorkspace: false, cloudHome: true, fromSource: true }).localBrowsers).toBe(false);
  });
});
