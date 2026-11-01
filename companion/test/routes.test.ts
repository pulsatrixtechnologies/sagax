// The allowlist.
//
// The proxy tests prove the app's own calls reach a real harness. These prove
// the other half, which no end-to-end test can: that everything else does
// not. The case worth caring about is the last one — a route nobody here has
// heard of is denied, because that is the property the whole file exists for
// and the one that quietly stopped being true once before.
import { describe, expect, it } from "vitest";

import { denyReason, isBrowserControlAccess, isCloudDesktopAccess, isCompanionNotice } from "../src/routes.ts";

const ask = (method: string, path: string, authenticated = true) =>
  denyReason({ method, path, authenticated });

const allowed = (method: string, path: string) => ask(method, path) === null;

describe("credentials", () => {
  it("lets an unpaired device pair, and do nothing else", () => {
    expect(ask("POST", "/api/pair", false)).toBeNull();
    expect(ask("GET", "/api/bots", false)).toEqual({
      status: 401,
      error: "pair this device from Remote access settings on the host computer",
    });
    expect(ask("POST", "/api/files", false)?.status).toBe(401);
  });

  it("lets anyone curl liveness — it is the unauthenticated smoke test", () => {
    expect(ask("GET", "/api/health", false)).toBeNull();
    // the bypass is one method on one path, not a family
    expect(ask("POST", "/api/health", false)?.status).toBe(401);
    expect(ask("GET", "/api/healthz", false)?.status).toBe(401);
  });
});

describe("what the app may do", () => {
  // Every request the phone apps make. If one of these
  // fails, a screen on the phone is broken.
  const calls: Array<[string, string]> = [
    ["GET", "/api/health"],
    ["GET", "/api/config"],
    ["GET", "/api/events"],
    ["GET", "/api/instances"],
    ["POST", "/api/instances/claude/claude-update"],
    ["POST", "/api/instances/claude.work/claude-update"],
    ["GET", "/api/instances/mistral/api-key"],
    ["POST", "/api/instances/mistral/api-key"],
    ["POST", "/api/instances/cursor/auth/start"],
    ["GET", "/api/instances/cursor/auth/status"],
    ["POST", "/api/instances/cursor/auth/cancel"],
    ["POST", "/api/instances/claude.work/auth/complete"],
    ["GET", "/api/team-map"],
    ["GET", "/api/companion/endpoints"],
    ["GET", "/api/bots"],
    ["POST", "/api/bots"],
    ["POST", "/api/sidebar-sections"],
    ["POST", "/api/bots/bot_123/messages"],
    ["PATCH", "/api/bots/bot_123/cards/msg_2"],
    ["POST", "/api/bots/bot_123/respond"],
    ["POST", "/api/bots/bot_123/interrupt"],
    ["DELETE", "/api/bots/bot_123/queue/queue_1"],
    ["POST", "/api/bots/bot_123/read"],
    ["POST", "/api/bots/bot_123/always-allow"],
    ["POST", "/api/bots/bot_123/messages/msg_2/edit"],
    ["GET", "/api/bots/bot_123/overview"],
    // Read-only: what the bot did, with the outcome (server/activity.ts).
    ["GET", "/api/bots/bot_123/activity"],
    // The section's shared team memory: read it, add an entry, answer or
    // edit one, remove one. Content, not execution policy.
    ["GET", "/api/team-memory"],
    ["POST", "/api/team-memory"],
    ["PATCH", "/api/team-memory/entry_1"],
    ["DELETE", "/api/team-memory/entry_1"],
    ["POST", "/api/bots/bot_123/active-branch"],
    ["POST", "/api/bots/bot_123/compact"],
    ["POST", "/api/bots/bot_123/tasks"],
    ["POST", "/api/bots/bot_123/tasks/th_1"],
    ["PATCH", "/api/bots/bot_123/tasks/th_1"],
    ["DELETE", "/api/bots/bot_123/tasks/th_1"],
    ["PATCH", "/api/bots/bot_123/profile"],
    ["PATCH", "/api/bots/bot_123/model"],
    ["POST", "/api/bots/bot_123/avatar/generate"],
    ["POST", "/api/bots/bot_123/shape-avatar/generate"],
    ["POST", "/api/bots/bot_123/computer/join"],
    ["POST", "/api/bots/bot_123/secret-cards/message_1/provide"],
    ["POST", "/api/bots/bot_123/computer/control"],
    ["POST", "/api/bots/bot_123/computer/screenshot"],
    ["POST", "/api/bots/bot_123/computer/viewer-close"],
    ["POST", "/api/bots/bot_123/local-computer/screenshot"],
    ["POST", "/api/bots/bot_123/local-computer/join"],
    ["POST", "/api/groups/room-1/messages"],
    ["POST", "/api/groups/room-1/leave"],
    ["POST", "/api/groups/room-1/interrupt"],
    ["DELETE", "/api/groups/room-1/queue/queue_1"],
    ["POST", "/api/groups/room-1/read"],
    ["POST", "/api/groups/room-1/tasks"],
    ["POST", "/api/groups/room-1/tasks/th_1"],
    ["PATCH", "/api/groups/room-1/tasks/th_1"],
    ["DELETE", "/api/groups/room-1/tasks/th_1"],
    ["GET", "/api/threads/th_1/messages"],
    ["GET", "/api/threads/th_1/messages/msg_2/image"],
    ["POST", "/api/threads/th_1/messages/msg_2/file"],
    ["POST", "/api/threads/th_1/messages/msg_2/reactions"],
    ["GET", "/api/threads/th_1/read"],
    ["POST", "/api/threads/th_1/read"],
    ["GET", "/api/threads/th_1/export"],
    ["POST", "/api/threads/th_1/respond"],
    ["POST", "/api/me/phone-calls/call_0123456789abcdef/answer"],
    ["POST", "/api/me/credentials/purchases/pay_0123456789abcdef/answer"],
    ["GET", "/api/search"],
    ["POST", "/api/attachments"],
    ["GET", "/api/attachments/avatar-123.webp"],
    ["GET", "/api/attachments/voice-note-1.mp3"],
    ["POST", "/api/files"],
    ["GET", "/api/tts/voices"],
    ["POST", "/api/tts/prepare"],
    ["POST", "/api/tts/speak"],
    // a live call (voice mode)
    ["GET", "/api/bots/bot_123/voice/status"],
    ["GET", "/api/bots/bot_123/voice/voices"],
    ["POST", "/api/bots/bot_123/voice/prepare"],
    ["POST", "/api/bots/bot_123/voice/speak"],
    ["POST", "/api/bots/bot_123/voice/stream"],
    ["POST", "/api/bots/bot_123/voice/transcribe"],
    ["POST", "/api/bots/bot_123/voice/call"],
    ["POST", "/api/live/session"],
    ["POST", "/api/live/call/end"],
    ["GET", "/api/live/call"],
    ["PATCH", "/api/live/settings"],
    ["GET", "/api/routines"],
    ["POST", "/api/routines"],
    ["PATCH", "/api/routines/routine_1"],
    ["DELETE", "/api/routines/routine_1"],
    ["POST", "/api/routines/routine_1/run"],
    ["POST", "/api/routines/watch-check"],
    ["POST", "/api/routine-runs/run_1/cancel"],
    ["POST", "/api/routine-runs/run_1/seen"],
    ["POST", "/api/bots/bot_123/secret-cards/msg_2/resume"],
    ["POST", "/api/bots/bot_123/secret-cards/msg_2/dismiss"],
  ];

  for (const [method, path] of calls) {
    it(`allows ${method} ${path}`, () => expect(ask(method, path)).toBeNull());
  }
});

describe("what it may not", () => {
  it("keeps a call's voice routes to their own methods, and the listen socket on the desktop", () => {
    expect(ask("GET", "/api/bots/bot_123/voice/listen")?.status).toBe(404);
    expect(ask("POST", "/api/bots/bot_123/voice/status")?.status).toBe(404);
    expect(ask("GET", "/api/bots/bot_123/voice/stream")?.status).toBe(404);
    expect(ask("POST", "/api/bots/bot_123/voice/other")?.status).toBe(404);
    expect(ask("GET", "/api/bots/bot_123/voice/call")?.status).toBe(404);
    expect(ask("POST", "/api/bots/bot_123/voice/stream", false)?.status).toBe(401);
  });

  it("refuses host configuration, and says where it happens", () => {
    for (const [method, path] of [
      ["PUT", "/api/config"],
      ["PATCH", "/api/config"],
      ["GET", "/api/devices"],
      ["GET", "/api/companion"],
      ["POST", "/api/local-computer/start"],
      ["POST", "/api/webhooks"],
      ["POST", "/api/webhooks/wh_1/rotate"],
      ["DELETE", "/api/connectors/gmail"],
      ["POST", "/api/teams/import"],
    ] as Array<[string, string]>) {
      const denial = ask(method, path);
      expect(denial?.status, `${method} ${path}`).toBe(403);
      expect(denial?.error, `${method} ${path}`).toMatch(/on (?:your|the host) computer/);
    }
    expect(ask("GET", "/api/devices")).toEqual({
      status: 403,
      error: "Remote access settings are managed on the host computer",
    });
    expect(ask("GET", "/api/companion")).toEqual({
      status: 403,
      error: "Remote access settings are managed on the host computer",
    });
  });

  it("keeps endpoint refresh authenticated and exact-method only", () => {
    expect(ask("GET", "/api/companion/endpoints", false)?.status).toBe(401);
    expect(ask("GET", "/api/companion/endpoints")).toBeNull();
    expect(ask("POST", "/api/companion/endpoints")?.status).toBe(403);
    expect(ask("GET", "/api/companion/endpoints/extra")?.status).toBe(403);
  });

  it("describes only refused routine operations as computer-only", () => {
    for (const [method, path] of [
      ["GET", "/api/routines/routine_1"],
      ["PUT", "/api/routines/routine_1"],
      ["POST", "/api/routines/routine_1/cancel"],
      ["GET", "/api/routines/watch-check"],
    ] as Array<[string, string]>) {
      const denial = ask(method, path);
      expect(denial, `${method} ${path}`).toEqual({
        status: 403,
        error: "this routine operation is only available on your computer",
      });
    }
    expect(ask("GET", "/api/routines")).toBeNull();
    expect(ask("POST", "/api/routines/routine_1/run")).toBeNull();
  });

  // The companion tells the harness itself when it unpaired a phone, so the
  // call that phone holds ends. That notice is the companion's, never a
  // phone's: no paired device may send it, even about itself.
  it("keeps the unpaired-phone notice for the companion alone", () => {
    expect(ask("POST", "/api/live/device-revoked")?.status).toBe(404);
    expect(ask("POST", "/api/live/device-revoked", false)?.status).toBe(401);
    expect(isCompanionNotice("POST", "/api/live/device-revoked")).toBe(true);
    expect(isCompanionNotice("GET", "/api/live/device-revoked")).toBe(false);
    expect(isCompanionNotice("POST", "/api/live/device-revoked/x")).toBe(false);
    expect(isCompanionNotice("POST", "/api/live/call/end")).toBe(false);
  });

  it("denies the peer-agent endpoints exist at all", () => {
    expect(ask("GET", "/api/internal/peers")?.status).toBe(404);
    expect(ask("POST", "/api/internal/ask-bot")?.status).toBe(404);
  });

  it("does not serve the desktop UI", () => {
    expect(ask("GET", "/")?.status).toBe(404);
    expect(ask("GET", "/index.html")?.status).toBe(404);
  });

  it("opens and previews only an explicitly granted cloud viewer", () => {
    expect(allowed("POST", "/api/bots/bot_123/computer/join")).toBe(true);
    expect(allowed("POST", "/api/bots/bot_123/computer/control")).toBe(true);
    expect(allowed("POST", "/api/bots/bot_123/computer/screenshot")).toBe(true);
    expect(allowed("POST", "/api/bots/bot_123/computer/viewer-close")).toBe(true);
    // the computer's status is a read (iOS parity S1); nothing under it but the viewer verbs
    expect(allowed("GET", "/api/bots/bot_123/computer")).toBe(true);
    expect(isCloudDesktopAccess("GET", "/api/bots/bot_123/computer")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/computer")).toBe(false);
    expect(allowed("GET", "/api/bots/bot_123/computer/control")).toBe(false);
    expect(allowed("GET", "/api/bots/bot_123/computer/viewer-close")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/computer/provision")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/computer/sleep")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/computer/exec")).toBe(false);
  });

  it("previews a Local VM without reaching its lifecycle", () => {
    expect(allowed("POST", "/api/bots/bot_123/local-computer/screenshot")).toBe(true);
    expect(isCloudDesktopAccess("POST", "/api/bots/bot_123/local-computer/screenshot")).toBe(true);
    expect(allowed("GET", "/api/bots/bot_123/local-computer/screenshot")).toBe(false);
    expect(allowed("GET", "/api/bots/bot_123/local-computer")).toBe(false);
    for (const action of ["run", "stop", "remove"]) {
      expect(allowed("POST", `/api/bots/bot_123/local-computer/${action}`)).toBe(false);
    }
    expect(allowed("POST", "/api/local-computer/screenshot")).toBe(false);
  });

  it("joins a Local VM's live desktop only behind computer access", () => {
    expect(allowed("POST", "/api/bots/bot_123/local-computer/join")).toBe(true);
    expect(isCloudDesktopAccess("POST", "/api/bots/bot_123/local-computer/join")).toBe(true);
    expect(allowed("GET", "/api/bots/bot_123/local-computer/join")).toBe(false);
    expect(allowed("POST", "/api/local-computer/join")).toBe(false);
  });

  it("allows only the exact encrypted credential submission verb", () => {
    expect(allowed("POST", "/api/bots/bot_123/secret-cards/message_1/provide")).toBe(true);
    expect(allowed("GET", "/api/bots/bot_123/secret-cards/message_1/provide")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/secret-cards/message_1/provided")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/secret-cards/message_1/provide/extra")).toBe(false);
  });

  // The method is part of the allowance, not decoration: reading the fleet
  // and deleting a bot are the same path.
  it("allows a path only for the methods it was allowed for", () => {
    expect(allowed("GET", "/api/bots")).toBe(true);
    // Deleting a bot crosses for the phone's profile (the harness checks the owner).
    expect(allowed("DELETE", "/api/bots/bot_123")).toBe(true);
    expect(allowed("PUT", "/api/bots/bot_123/soul")).toBe(false);
    expect(allowed("POST", "/api/threads/th_1/messages")).toBe(false);
    expect(allowed("GET", "/api/threads/th_1/messages/msg_2/file")).toBe(false);
    expect(allowed("POST", "/api/threads/th_1/messages/msg_2/file/extra")).toBe(false);
    expect(allowed("GET", "/api/groups/room-1")).toBe(false);
    // iOS parity: the bot PATCH crosses (the harness holds a companion
    // request to the member fields), but nothing below or beside it.
    expect(allowed("PATCH", "/api/bots/bot_123")).toBe(true);
    expect(allowed("PUT", "/api/bots/bot_123")).toBe(false);
    expect(allowed("GET", "/api/bots/bot_123/model")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/model")).toBe(false);
    expect(allowed("PATCH", "/api/bots/bot_123/model/extra")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/overview")).toBe(false);
    expect(allowed("GET", "/api/bots/bot_123/overview/extra")).toBe(false);
    expect(allowed("PATCH", "/api/bots/bot_123/profile/execution-policy")).toBe(false);
    expect(allowed("GET", "/api/sidebar-sections")).toBe(false);
    expect(allowed("PATCH", "/api/sidebar-sections")).toBe(false);
    expect(allowed("POST", "/api/sidebar-sections/extra")).toBe(false);
    expect(allowed("PUT", "/api/config")).toBe(false);
    expect(allowed("GET", "/api/attachments/../config.json")).toBe(false);
    expect(allowed("GET", "/api/files")).toBe(false);
    expect(allowed("POST", "/api/files/anything")).toBe(false);
    expect(allowed("GET", "/api/routine-runs/run_1/cancel")).toBe(false);
    expect(allowed("POST", "/api/routine-runs/run_1/retry")).toBe(false);
    expect(allowed("DELETE", "/api/connectors/slack")).toBe(false);
    expect(allowed("GET", "/api/connectors/connected/all")).toBe(false);
    // Connected apps are set up on this computer. The whole family stays
    // here, including a per-account removal and a path that climbs out.
    expect(allowed("DELETE", "/api/connectors/slack/accounts/ca_123")).toBe(false);
    expect(allowed("DELETE", "/api/connectors/slack/accounts/../gmail")).toBe(false);
    expect(allowed("POST", "/api/bots/bot_123/secret-cards/msg_2/provided")).toBe(false);
    // A room's PATCH crosses for pinning and renaming; the harness holds a
    // companion request to the member fields (clientGroupPatchViolation).
    expect(allowed("PATCH", "/api/groups/room-1")).toBe(true);
    expect(allowed("PUT", "/api/groups/room-1")).toBe(false);
  });

  // Patterns are anchored, so a path that merely starts right is still a
  // path nobody allowed.
  it("lets a phone update Claude Code and change nothing else about engines", () => {
    for (const [method, path] of [
      ["GET", "/api/instances/claude/claude-update"],
      ["POST", "/api/instances/../claude-update"],
      ["POST", "/api/instances/.../claude-update"],
      ["POST", "/api/instances/%2e%2e/claude-update"],
      ["PATCH", "/api/instances/claude"],
      ["POST", "/api/instances/../api-key"],
      ["POST", "/api/instances/.../api-key"],
      ["GET", "/api/instances/%2e%2e/api-key"],
      ["GET", "/api/instances/../auth/status"],
      ["POST", "/api/instances/%2e%2e/auth/start"],
    ] as Array<[string, string]>) {
      expect(allowed(method, path), `${method} ${path}`).toBe(false);
    }
    expect(allowed("POST", "/api/instances/cursor/auth/start")).toBe(true);
    expect(allowed("GET", "/api/instances/cursor/auth/status")).toBe(true);
    expect(allowed("POST", "/api/instances/cursor/auth/cancel")).toBe(true);
    expect(allowed("POST", "/api/instances/cursor/auth/complete")).toBe(true);
  });

  // A phone may start, end and follow a Live call and change its voice and
  // timing, never the OpenAI key it runs on, and nothing else under /api/live.
  it("allows only the four Live call routes, never the key", () => {
    expect(ask("POST", "/api/live/summary")?.status).toBe(404);
    expect(ask("PUT", "/api/config")?.status).toBe(403);
    expect(allowed("PUT", "/api/live/settings")).toBe(false);
    expect(allowed("GET", "/api/live/settings")).toBe(false);
    expect(allowed("GET", "/api/live/session")).toBe(false);
    expect(allowed("POST", "/api/live/call")).toBe(false);
    expect(allowed("POST", "/api/live/call/end/extra")).toBe(false);
  });

  it("is not fooled by a prefix", () => {
    expect(allowed("GET", "/api/bots/bot_123/computer/status")).toBe(false);
    expect(allowed("GET", "/api/botsandthensome")).toBe(false);
    expect(allowed("GET", "/api/events/all")).toBe(false);
    expect(allowed("GET", "/api/threads/th_1/messages/msg_2/image/../../../config")).toBe(false);
    expect(allowed("GET", "/api/bots%2f..%2fwebhooks")).toBe(false);
  });

  // The one that matters. Upstream adds routes on its own schedule, and the
  // sidecar must not carry them to a phone because nobody wrote a rule
  // against a thing that did not exist yet.
  it("denies a route it has never heard of", () => {
    for (const path of [
      "/api/whatever-ships-next",
      "/api/bots/bot_123/some-new-verb",
      "/api/secrets",
    ]) {
      expect(allowed("GET", path), path).toBe(false);
      expect(allowed("POST", path), path).toBe(false);
      expect(allowed("DELETE", path), path).toBe(false);
    }
  });
});

describe("iOS parity routes", () => {
  it("crosses the phone's new reads and owner actions, method by method", () => {
    for (const [method, path] of [
      ["GET", "/api/auth/session"], ["GET", "/api/people/pr_0b1c-2d/avatar"],
      ["GET", "/api/bots/bot_1/links"], ["GET", "/api/bots/bot_1/files"],
      ["GET", "/api/threads/th_1/files"], ["GET", `/api/threads/th_1/files/${"a".repeat(24)}`],
      ["POST", "/api/bots/bot_1/export"],
      ["GET", "/api/settings/bot"], ["PUT", "/api/settings/bot"],
      ["GET", "/api/auto-review/rules"], ["DELETE", "/api/auto-review/rules/command.bot_1.0b1c"],
      ["GET", "/api/computer/status"], ["POST", "/api/computer/update"], ["POST", "/api/computer/reset"],
      ["GET", "/api/computer/maintenance"], ["PUT", "/api/computer/maintenance"],
      ["GET", "/api/plugins/search"], ["GET", "/api/plugins/installed"], ["POST", "/api/plugins/install"],
      ["POST", "/api/mcp/servers/notion/oauth/start"], ["GET", "/api/mcp/servers/notion/oauth/status"],
      ["DELETE", "/api/me"],
      ["GET", "/api/usage"], ["GET", "/api/bots/bot_1/soul"], ["DELETE", "/api/bots/bot_1"], ["GET", "/api/mcp/servers"],
      ["GET", "/api/bots/bot_1/command-allowlist"], ["DELETE", "/api/bots/bot_1/command-allowlist/0b1c-2d"],
      ["GET", "/api/me/preferences"], ["PUT", "/api/me/preferences"],
      ["GET", "/api/me/appearance"], ["PUT", "/api/me/appearance"],
      ["GET", "/api/me/server-environment"], ["GET", "/api/me/server-environment/stats"],
      ["POST", "/api/me/server-environment/reset"], ["POST", "/api/me/server-environment/update"],
      ["POST", "/api/me/server-environment/power"],
      ["GET", "/api/desktop-viewer/sandbox/me"], ["GET", "/api/desktop-viewer/sandbox/me/websockify"],
      ["PATCH", "/api/groups/room_1"], ["POST", "/api/bots"],
      ["POST", "/api/bots/bot_1/computer/input"], ["GET", "/api/bots/bot_1/computer/clipboard"], ["PUT", "/api/bots/bot_1/computer/clipboard"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(true);
    for (const [method, path] of [
      ["POST", "/api/auth/session"], ["DELETE", "/api/bots/bot_1/links"], ["GET", "/api/bots/bot_1/export"],
      ["DELETE", "/api/settings/bot"], ["POST", "/api/auto-review/rules"], ["POST", "/api/computer/status"],
      ["POST", "/api/computer/maintenance"], ["GET", "/api/computer/disk-saver"], ["POST", "/api/computer/disk-saver"],
      ["POST", "/api/mcp/servers/notion/oauth/disconnect"], ["POST", "/api/mcp/servers"], ["DELETE", "/api/mcp/servers/notion"], ["GET", "/api/me"],
      ["POST", "/api/usage"], ["GET", "/api/usage.csv"], ["PATCH", "/api/bots/bot_1/soul"], ["POST", "/api/bots/bot_1/command-allowlist"],
      ["DELETE", "/api/me/preferences"], ["DELETE", "/api/me/appearance"], ["POST", "/api/me/appearance"], ["DELETE", "/api/groups/room_1"], ["POST", "/api/me/server-environment/delete"],
      ["GET", "/api/bots/bot_1/computer/input"], ["POST", "/api/bots/bot_1/computer/clipboard"],
      ["GET", `/api/threads/th_1/files/${"a".repeat(24)}/extra`],
      ["PUT", "/api/people/pr_1/avatar"], ["DELETE", "/api/people/pr_1/avatar"], ["GET", "/api/people/pr_1"],
      ["GET", "/api/people/pr_1/avatar/extra"], ["GET", "/api/people/../config/avatar"], ["GET", `/api/people/${"a".repeat(81)}/avatar`],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });

  it("puts remote input under the per-phone desktop capability", () => {
    expect(isCloudDesktopAccess("POST", "/api/bots/bot_1/computer/input")).toBe(true);
    expect(isCloudDesktopAccess("GET", "/api/bots/bot_1/computer/clipboard")).toBe(true);
    expect(isCloudDesktopAccess("PUT", "/api/bots/bot_1/computer/clipboard")).toBe(true);
    expect(isCloudDesktopAccess("GET", "/api/desktop-viewer/sandbox/me")).toBe(true);
    expect(isCloudDesktopAccess("GET", "/api/desktop-viewer/sandbox/me/websockify")).toBe(true);
    expect(isCloudDesktopAccess("POST", "/api/me/server-environment/power")).toBe(true);
    expect(isCloudDesktopAccess("GET", "/api/bots/bot_1/links")).toBe(false);
  });

  it("lets the MCP sign-in return without a device token, and nothing else", () => {
    expect(denyReason({ method: "GET", path: "/api/mcp-oauth/callback", authenticated: false })).toBeNull();
    expect(denyReason({ method: "POST", path: "/api/mcp-oauth/callback", authenticated: false })?.status).toBe(401);
    expect(denyReason({ method: "GET", path: "/api/plugins/installed", authenticated: false })?.status).toBe(401);
  });

  it("lets a native player fetch proxied media without the device token; the harness checks the signed path", () => {
    expect(denyReason({ method: "GET", path: "/api/media/proxy/eyJ1IjoiaCJ9.c2ln", authenticated: false })).toBeNull();
    expect(denyReason({ method: "POST", path: "/api/media/proxy/eyJ1IjoiaCJ9.c2ln", authenticated: false })?.status).toBe(401);
    expect(denyReason({ method: "GET", path: "/api/media/proxy/", authenticated: false })?.status).toBe(401);
    expect(denyReason({ method: "GET", path: "/api/media/proxy/a/b", authenticated: false })?.status).toBe(401);
  });
});

// The Electron app in remote-client mode (window.ogb.remoteClient.active)
// talks to this same sidecar, and the iPad must match it. Every request that
// renderer makes from a surface it shows in that mode crosses; what it hides
// in that mode, and what belongs to the host, does not. The surface-by-surface
// table is in docs/superpowers/specs/2026-10-02-ipad-desktop-parity-design.md.
describe("desktop remote-client parity", () => {
  it("crosses every request the remote-client renderer makes", () => {
    for (const [method, path] of [
      // boot, sidebar, search
      ["GET", "/api/brand"], ["GET", "/api/config"], ["GET", "/api/events"], ["GET", "/api/instances"],
      ["GET", "/api/bots"], ["GET", "/api/routines"], ["GET", "/api/auth/session"], ["GET", "/api/search"],
      ["GET", "/api/me/preferences"], ["PUT", "/api/me/preferences"],
      ["POST", "/api/sidebar-sections"], ["PATCH", "/api/bots/bot_1"], ["PATCH", "/api/bots/bot_1/profile"],
      ["POST", "/api/bots"], ["POST", "/api/groups"],
      // threads and folders in the sidebar (Appearance > Show threads)
      ["POST", "/api/bots/bot_1/tasks"], ["POST", "/api/bots/bot_1/tasks/th_2"], ["PATCH", "/api/bots/bot_1/tasks/th_2"],
      ["DELETE", "/api/bots/bot_1/tasks/th_2"], ["POST", "/api/bots/bot_1/tasks/th_2/title"],
      ["POST", "/api/bots/bot_1/projects"], ["PATCH", "/api/bots/bot_1/projects/pr_1"],
      ["DELETE", "/api/bots/bot_1/projects/pr_1"], ["PATCH", "/api/bots/bot_1/projects/order"],
      // 1:1 chat and composer
      ["GET", "/api/threads/th_1/messages"], ["POST", "/api/bots/bot_1/messages"], ["POST", "/api/bots/bot_1/messages/m_1/edit"],
      ["POST", "/api/bots/bot_1/active-branch"], ["POST", "/api/bots/bot_1/compact"], ["POST", "/api/bots/bot_1/interrupt"],
      ["POST", "/api/bots/bot_1/read"], ["DELETE", "/api/bots/bot_1/queue/q_1"], ["POST", "/api/bots/bot_1/queue/q_1/steer"],
      ["POST", "/api/bots/bot_1/respond"], ["POST", "/api/threads/th_1/respond"], ["PATCH", "/api/bots/bot_1/cards/m_1"],
      ["POST", "/api/bots/bot_1/always-allow"], ["POST", "/api/threads/th_1/messages/m_1/reactions"],
      ["GET", "/api/threads/th_1/export"], ["POST", "/api/threads/th_1/messages/m_1/file"],
      ["POST", "/api/attachments"], ["GET", "/api/attachments/a1b2.png"], ["POST", "/api/files"],
      ["POST", "/api/bots/bot_1/secret-cards/m_1/dismiss"], ["POST", "/api/instances/claude/claude-update"],
      ["GET", "/api/instances/mistral/api-key"], ["POST", "/api/instances/mistral/api-key"],
      ["POST", "/api/instances/cursor/auth/start"], ["GET", "/api/instances/cursor/auth/status"],
      ["POST", "/api/instances/cursor/auth/cancel"], ["POST", "/api/instances/cursor/auth/complete"],
      // rooms
      ["POST", "/api/groups/room_1/messages"], ["POST", "/api/groups/room_1/leave"], ["POST", "/api/groups/room_1/interrupt"], ["POST", "/api/groups/room_1/read"],
      ["DELETE", "/api/groups/room_1/queue/q_1"], ["POST", "/api/groups/room_1/queue/q_1/steer"],
      ["POST", "/api/groups/room_1/tasks"], ["PATCH", "/api/groups/room_1/tasks/th_2"], ["PATCH", "/api/groups/room_1"],
      // Remote agent settings panel, Computer panel
      ["GET", "/api/tts/voices"], ["POST", "/api/tts/speak"], ["GET", "/api/threads/th_1/files"],
      ["POST", "/api/bots/bot_1/computer/control"], ["POST", "/api/bots/bot_1/computer/join"],
      ["POST", "/api/bots/bot_1/computer/screenshot"], ["POST", "/api/bots/bot_1/computer/viewer-close"],
      // Automations (routines only), Team map, Plugins
      ["POST", "/api/routines"], ["PATCH", "/api/routines/r_1"], ["DELETE", "/api/routines/r_1"], ["POST", "/api/routines/r_1/run"],
      ["POST", "/api/routine-runs/run_1/cancel"], ["POST", "/api/routine-runs/run_1/seen"], ["POST", "/api/routine-runs/seen-all"],
      ["GET", "/api/team-map"],
      ["GET", "/api/mcp/servers"], ["POST", "/api/mcp/servers/notion/oauth/start"], ["GET", "/api/mcp/servers/notion/oauth/status"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(true);
  });

  it("keeps out what the remote-client renderer hides and what belongs to the host", () => {
    for (const [method, path] of [
      // hidden in remote-client mode: room setup and delete, the full bot panel, Inspector,
      // team-map editing, Templates, New Bot presets and defaults, the approval-mode menu
      // (the advanced panel's skills, memory, history and presets cross for
      // the owner since decision D1: see "iOS feature parity" below)
      ["PATCH", "/api/groups/room_1/setup"], ["DELETE", "/api/groups/room_1"],
      ["GET", "/api/threads/th_1/events"], ["GET", "/api/section-context"], ["PUT", "/api/section-context"],
      ["DELETE", "/api/sidebar-sections"], ["GET", "/api/sidebar-sections"], ["PUT", "/api/sidebar-sections"],
      ["GET", "/api/team-computers"], ["GET", "/api/teams/scout"], ["POST", "/api/teams/import"],
      ["GET", "/api/bot-defaults"], ["DELETE", "/api/bot-presets/preset_1"], ["GET", "/api/connectors/tools"],
      ["GET", "/api/connectors"], ["GET", "/api/connectors/catalog"], ["GET", "/api/connectors/connected"],
      ["POST", "/api/connectors/gmail/authorize"], ["DELETE", "/api/connectors/gmail/accounts/ca_1"],
      ["GET", "/api/bots/bot_1/connector-cards/m_1/status"], ["POST", "/api/bots/bot_1/connector-cards/m_1/authorize"],
      ["GET", "/api/calendar-calls"], ["GET", "/api/webhooks"],
      // host-only: keys, engines setup, Local VM, backups, pairing, MCP server writes, people
      ["PUT", "/api/config"], ["PATCH", "/api/config"], ["POST", "/api/keys/test"], ["PATCH", "/api/instances/claude"],
      ["POST", "/api/instances/claude/refresh-models"], ["GET", "/api/local-computer"], ["GET", "/api/workspace-backup/status"],
      ["POST", "/api/auth/pairing"], ["GET", "/api/auth/sessions"], ["POST", "/api/mcp/servers"], ["DELETE", "/api/mcp/servers/notion"],
      ["GET", "/api/mail/settings"], ["GET", "/api/admin-activity"], ["GET", "/api/fleet"],
      // nothing beside the new routes
      ["GET", "/api/bots/bot_1/queue/q_1/steer"], ["POST", "/api/bots/bot_1/queue/q_1/steer/extra"],
      ["GET", "/api/bots/bot_1/projects"], ["PUT", "/api/bots/bot_1/projects/pr_1"], ["POST", "/api/bots/bot_1/projects/pr_1/extra"],
      ["GET", "/api/bots/bot_1/tasks/th_2/title"], ["POST", "/api/brand"], ["GET", "/api/routine-runs/seen-all"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });
});

// docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md, packages S1
// and the decisions D1 (advanced bot panel for the computer's owner) and D3
// (room memory). Each route crosses for exactly the methods listed; what the
// advanced panel still keeps on the computer does not.
describe("iOS feature parity (S1, D1, D3)", () => {
  it("crosses the remote client's missing routes and the advanced panel, method by method", () => {
    for (const [method, path] of [
      // S1
      ["GET", "/api/bots/bot_1/harness-commands"], ["POST", "/api/bots/bot_1/parallel/th_2/stop"],
      ["GET", "/api/bots/bot_1/activity"], ["GET", "/api/bots/bot_1/activity/item"],
      ["POST", "/api/bots/bot_1/primary"], ["GET", "/api/me/harness-connectors"], ["GET", "/api/bots/bot_1/computer"],
      // D3
      ["GET", "/api/groups/room_1/memory"], ["PUT", "/api/groups/room_1/memory"],
      // the voice engine picker
      ["PUT", "/api/tts/provider"],
      // D1
      ["GET", "/api/bots/bot_1/system-prompt"], ["GET", "/api/bots/bot_1/history"], ["POST", "/api/bots/bot_1/history/rollback"],
      ["GET", "/api/bots/bot_1/skills"], ["POST", "/api/bots/bot_1/skills"],
      ["GET", "/api/bots/bot_1/skills/web-research"], ["PATCH", "/api/bots/bot_1/skills/web-research"],
      ["DELETE", "/api/bots/bot_1/skills/web-research"],
      ["GET", "/api/bots/bot_1/memory"], ["GET", "/api/bots/bot_1/memory/file"], ["PUT", "/api/bots/bot_1/memory/file"],
      ["DELETE", "/api/bots/bot_1/memory/file"], ["GET", "/api/bots/bot_1/memory/journal"],
      ["POST", "/api/bots/bot_1/memory/journal/ch_1/revert"], ["GET", "/api/bots/bot_1/memory/upkeep"],
      ["POST", "/api/bots/bot_1/memory/tidy"],
      ["GET", "/api/bot-presets"],
      ["GET", "/api/me/achievements"], ["POST", "/api/me/achievements/events"], ["PUT", "/api/me/achievements/settings"],
      ["GET", "/api/achievements/public"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(true);
  });

  it("keeps the rest of the advanced panel and everything beside the new routes on the computer", () => {
    for (const [method, path] of [
      // opening the memory folder acts on the host's screen; the legacy whole-file write has no hash
      ["POST", "/api/bots/bot_1/memory/open"], ["PUT", "/api/bots/bot_1/memory"], ["POST", "/api/bots/bot_1/memory/reviewed"],
      ["GET", "/api/bots/bot_1/memory/topics/notes.md"], ["DELETE", "/api/bots/bot_1/memory"],
      // skills: a template, an organization library entry, a path that is not a skill name
      ["POST", "/api/bots/bot_1/skill-template"], ["GET", "/api/org-library/skills"],
      ["GET", "/api/bots/bot_1/skills/Web_Research"], ["GET", "/api/bots/bot_1/skills/a/b"], ["PUT", "/api/bots/bot_1/skills/web-research"],
      // history: only the soul rollback; presets: never removed from here
      ["DELETE", "/api/bots/bot_1/history"], ["POST", "/api/bots/bot_1/history/rollback/extra"],
      ["DELETE", "/api/bot-presets/preset_1"], ["POST", "/api/bot-presets"],
      ["GET", "/api/bots/bot_1/system-prompt/extra"], ["PUT", "/api/bots/bot_1/system-prompt"],
      // approval mode, folder, computer and access stay refused
      ["POST", "/api/bots/bot_1/computer/provision"], ["POST", "/api/bots/bot_1/computer/sleep"],
      ["GET", "/api/bots/bot_1/checkpoints"], ["GET", "/api/connectors/tools"], ["GET", "/api/webhooks"],
      // nothing beside S1, D3 and the voice engine
      ["GET", "/api/bots/bot_1/primary"], ["DELETE", "/api/bots/bot_1/primary"],
      ["GET", "/api/bots/bot_1/parallel/th_2/stop"], ["POST", "/api/bots/bot_1/parallel/th_2"],
      ["POST", "/api/bots/bot_1/activity"], ["GET", "/api/bots/bot_1/activity/item/extra"],
      ["POST", "/api/bots/bot_1/harness-commands"], ["PUT", "/api/harness-connectors/settings"], ["POST", "/api/me/harness-connectors"],
      ["DELETE", "/api/groups/room_1/memory"], ["PATCH", "/api/groups/room_1/memory"],
      ["GET", "/api/tts/provider"], ["POST", "/api/tts/provider"], ["PUT", "/api/config"],
      ["GET", "/api/me/achievements/settings"], ["DELETE", "/api/me/achievements"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });
});

describe("library artifacts", () => {
  it("lists, opens and pins a bot's artifacts, and nothing else under artifacts/", () => {
    for (const [method, path] of [
      ["GET", "/api/bots/bot_1/artifacts"], ["GET", "/api/bots/bot_1/artifacts/art_AbC-d_12345x"],
      ["PATCH", "/api/bots/bot_1/artifacts/art_AbC-d_12345x"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(true);
    for (const [method, path] of [
      ["DELETE", "/api/bots/bot_1/artifacts/art_AbC-d_12345x"], ["POST", "/api/bots/bot_1/artifacts/art_AbC-d_12345x/refresh"],
      ["POST", "/api/bots/bot_1/artifacts"], ["PUT", "/api/bots/bot_1/artifacts/art_AbC-d_12345x"],
      ["GET", "/api/bots/bot_1/artifacts/other"], ["GET", "/api/artifacts"], ["POST", "/api/artifacts/watch"],
      ["POST", "/api/internal/artifacts"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });
});

describe("browser control", () => {
  it("allows the live stream and the action channel, and nothing else under browser/", () => {
    expect(allowed("GET", "/api/bots/b1/browser/live")).toBe(true);
    expect(allowed("POST", "/api/bots/b1/browser/action")).toBe(true);
    // The two verbs are not interchangeable: the stream is a GET and the
    // action channel is a POST, and neither route answers the other's method.
    expect(allowed("POST", "/api/bots/b1/browser/live")).toBe(false);
    expect(allowed("GET", "/api/bots/b1/browser/action")).toBe(false);
    // Anything else the harness may grow under this prefix stays closed.
    expect(allowed("POST", "/api/bots/b1/browser/restart")).toBe(false);
    expect(allowed("GET", "/api/bots/b1/browser")).toBe(false);
  });

  it("classifies exactly the two routes as needing the browser capability", () => {
    expect(isBrowserControlAccess("GET", "/api/bots/b1/browser/live")).toBe(true);
    expect(isBrowserControlAccess("POST", "/api/bots/b1/browser/action")).toBe(true);
    expect(isBrowserControlAccess("GET", "/api/bots/b1/messages")).toBe(false);
    // Driving a bot's signed-in browser is not the same permission as a
    // throwaway cloud desktop, so the classifiers must not overlap.
    expect(isBrowserControlAccess("POST", "/api/bots/b1/computer/join")).toBe(false);
    expect(isCloudDesktopAccess("GET", "/api/bots/b1/browser/live")).toBe(false);
  });

  it("anchors the bot id so a traversal cannot reach another route", () => {
    expect(allowed("GET", "/api/bots/b1/browser/live/../../config")).toBe(false);
    expect(allowed("GET", "/api/bots/b1/browser/live?x=1")).toBe(false);
    expect(isBrowserControlAccess("GET", "/api/bots/b1/browser/live/extra")).toBe(false);
  });
});

describe("Reach me on the phone (#1187)", () => {
  it("crosses the person's own reach-me routes, method by method", () => {
    for (const [method, path] of [
      ["GET", "/api/bots/bot_1/reach-me"], ["PUT", "/api/bots/bot_1/reach-me"],
      ["POST", "/api/bots/bot_1/reach-me/telegram"], ["DELETE", "/api/bots/bot_1/reach-me/telegram"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(true);
  });

  it("keeps every other method and path beside them refused", () => {
    for (const [method, path] of [
      ["POST", "/api/bots/bot_1/reach-me"], ["DELETE", "/api/bots/bot_1/reach-me"], ["PATCH", "/api/bots/bot_1/reach-me"],
      ["GET", "/api/bots/bot_1/reach-me/telegram"], ["PUT", "/api/bots/bot_1/reach-me/telegram"],
      ["GET", "/api/bots/bot_1/reach-me/extra"], ["GET", "/api/bots/bot_1/reach-me/telegram/token"],
      ["GET", "/api/bots/../reach-me"],
    ] as const) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });
});
