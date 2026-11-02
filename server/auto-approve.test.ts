// The harness's part in a provider's permission request: pass it through.
// These pin that nothing here judges an action, that Full access answers
// everything, that Approve for me also allows a web search, and that every
// note a card can show has a catalog key.
import { describe, expect, it, vi } from "vitest";

import englishCatalog from "../src/locales/en.json" with { type: "json" };

import {
  HELD_NOTE,
  approvalHeldNote,
  approvalHeldReason,
  approvalModeForOrigin,
  autoVerdict,
  deliverFullAccessApproval,
  delegatedApprovalMode,
  delegationInheritsFullAccess,
} from "./auto-approve.ts";

describe("Full access delivery", () => {
  it.each(["allowed-once", "rejected", "unavailable"] as const)("preserves %s without interrupting or inventing an approval", async outcome => {
    const adapter = { respondToRequest: vi.fn().mockResolvedValue(outcome), interruptTurn: vi.fn() };
    expect(await deliverFullAccessApproval(adapter, "thread", "request", "turn")).toBe(outcome);
    expect(adapter.respondToRequest).toHaveBeenCalledWith("thread", "request", { behavior: "allow" });
    expect(adapter.interruptTurn).not.toHaveBeenCalled();
  });
  it("reports transport failure and interrupts only the failed turn", async () => {
    const adapter = { respondToRequest: vi.fn().mockRejectedValue(new Error("connection lost")), interruptTurn: vi.fn().mockResolvedValue(undefined) };
    expect(await deliverFullAccessApproval(adapter, "thread", "request", "original-turn", () => true)).toBe("failed");
    expect(adapter.interruptTurn).toHaveBeenCalledWith("thread", "original-turn");
    adapter.interruptTurn.mockClear();
    expect(await deliverFullAccessApproval(adapter, "thread", "request")).toBe("failed");
    expect(adapter.interruptTurn).not.toHaveBeenCalled();
    expect(await deliverFullAccessApproval(adapter, "thread", "request", "old-turn", () => false)).toBe("failed");
    expect(adapter.interruptTurn).not.toHaveBeenCalled();
    expect(await deliverFullAccessApproval(undefined, "thread", "request")).toBe("failed");
  });
});

describe("autoVerdict", () => {
  it("answers a read of the person's own account connector at every level, never a write (2026-10-30)", () => {
    for (const mode of ["ask", "edits", "auto", "custom", "full"] as const) {
      expect(autoVerdict(mode, "other", { toolName: "outlook__search", connectorRead: true }).source).toBe("connector-read");
      // the person's own words, a safety hold and a security key come first
      expect(autoVerdict(mode, "other", { toolName: "outlook__search", connectorRead: true, customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
      expect(autoVerdict(mode, "other", { toolName: "outlook__search", connectorRead: true, safetyHold: true }).approve).toBeNull();
      if (mode !== "full") expect(autoVerdict(mode, "other", { toolName: "outlook__search", connectorRead: true, stepUpRequired: ["mail"] }).approve).toBeNull();
      // an outward call is never a read, whatever the flag says
      expect(autoVerdict(mode, "other", { toolName: "outlook__send_message", connectorRead: true, outbound: true }).source).toBe(mode === "full" ? "full-access" : "email-draft-required");
    }
  });

  it("forces a draft card for unrequested mail sends and lets person-asked mail follow the level", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, "outlook__send_email", { outbound: true }).source).toBe("email-draft-required");
      expect(autoVerdict(mode, "outlook__send_email", { outbound: true, personAskedMail: true, ownerTurn: true }).source).toBe(
        mode === "auto" || mode === "custom" ? "native-approval" : "no-grant",
      );
    }
    expect(autoVerdict("full", "outlook__send_email", { outbound: true, personAskedMail: true, ownerTurn: true }).source).toBe("full-access");
    expect(approvalHeldNote({ source: "email-draft-required", permission: true })).toBe("approval.held.emailDraft");
  });
  it("answers a read-only command on the person's own computer at every level (Owner 2026-10-20)", () => {
    const tool = "mcp__sagax-environment__run_command";
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, tool, { ownReadOnlyCommand: true }).source).toBe("own-read-only");
      // the person's own words, a safety hold and a security key come first
      expect(autoVerdict(mode, tool, { ownReadOnlyCommand: true, customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
      expect(autoVerdict(mode, tool, { ownReadOnlyCommand: true, safetyHold: true }).approve).toBeNull();
      expect(autoVerdict(mode, tool, { ownReadOnlyCommand: true, stepUpRequired: ["shell"] }).approve).toBeNull();
      expect(autoVerdict(mode, tool, { ownReadOnlyCommand: true, requiresExplicitApproval: true }).approve).toBeNull();
    }
  });
  it("never uses a saved command grant to silently send on the person's behalf", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, "mcp__composio__GMAIL_SEND_DRAFT", { commandAllowed: true })).toEqual({ approve: null, source: "outbound-guard" });
    }
    // Native Full still belongs to the provider; Composio's relay enforces its independent gate.
    expect(autoVerdict("full", "GMAIL_SEND_EMAIL").source).toBe("full-access");
  });
  it("applies an explicit exact command grant without changing Full or answering questions/elevations", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, "Bash", { commandAllowed: true }).source).toBe("command-allowlist");
      expect(autoVerdict(mode, "Bash", { commandAllowed: true }).approve).toBeTruthy();
      expect(autoVerdict(mode, "Bash", { commandAllowed: true, requiresExplicitApproval: true }).approve).toBeNull();
      expect(autoVerdict(mode, "AskUserQuestion", { commandAllowed: true }).approve).toBeNull();
    }
    expect(autoVerdict("full", "Bash", { commandAllowed: true, requiresExplicitApproval: true }).source).toBe("full-access");
  });
  it("answers only for Full access, and then answers everything", () => {
    expect(autoVerdict("full", "Bash")).toEqual({ approve: "approved Bash (full access)", source: "full-access" });
    expect(autoVerdict("full", "Bash", { requiresExplicitApproval: true })).toEqual({
      approve: "approved Bash (full access)",
      source: "full-access",
    });
  });

  it("keeps an Ask every time or Deny rule ahead of Full access (#1169)", () => {
    expect(autoVerdict("full", "Read", { customRule: { behavior: "ask", id: "r" } })).toEqual({ approve: null, source: "custom-rule-ask" });
    expect(autoVerdict("full", "Read", { customRule: { behavior: "deny", id: "r" } })).toEqual({ approve: null, source: "custom-rule-deny" });
    expect(autoVerdict("ask", "Read")).toEqual({ approve: null, source: "no-grant" });
  });

  it("leaves an Auto or Custom request with the person as the provider's own reviewer did", () => {
    expect(autoVerdict("auto", "Bash")).toEqual({ approve: null, source: "native-approval" });
    expect(autoVerdict("custom", "Bash")).toEqual({ approve: null, source: "native-approval" });
  });

  it("never judges the action itself: Ask and Edits card everything the provider asks about", () => {
    for (const summary of ["wc -l notes.md", "rm -rf build", "cat ~/.ssh/id_rsa"]) {
      expect(autoVerdict("ask", summary)).toEqual({ approve: null, source: "no-grant" });
      expect(autoVerdict("edits", summary)).toEqual({ approve: null, source: "no-grant" });
    }
  });

  it("holds a sandbox widening for the person in every mode but Full", () => {
    for (const mode of ["ask", "edits", "auto", "custom"] as const) {
      expect(autoVerdict(mode, "shell", { requiresExplicitApproval: true }))
        .toEqual({ approve: null, source: "explicit-approval-block" });
    }
  });

  it("allows a web search under Approve for me, by the tool's bare name", () => {
    for (const tool of ["WebSearch", "web_search", "mcp__claude__WebSearch", "search_web"]) {
      expect(autoVerdict("auto", tool), tool).toEqual({
        approve: `approved ${tool} (web search)`,
        source: "web-search",
      });
    }
  });

  it("still cards a fetch, a bare search, and a command under Approve for me", () => {
    for (const tool of ["WebFetch", "web_fetch", "fetch", "search", "Bash"]) {
      expect(autoVerdict("auto", tool), tool).toEqual({ approve: null, source: "native-approval" });
    }
  });

  it("does not grant a web search in Ask, Edits, or Custom", () => {
    expect(autoVerdict("ask", "WebSearch")).toEqual({ approve: null, source: "no-grant" });
    expect(autoVerdict("edits", "WebSearch")).toEqual({ approve: null, source: "no-grant" });
    expect(autoVerdict("custom", "WebSearch")).toEqual({ approve: null, source: "native-approval" });
  });

  it("holds a safety review for an explicit accept, and auto-approves a read", () => {
    expect(autoVerdict("full", "Bash", { safetyHold: true, sagaxGate: true, ruleAllowed: true })).toEqual({
      approve: null,
      source: "safety-hold",
    });
    expect(autoVerdict("auto", "Bash", { safetyHold: true })).toEqual({ approve: null, source: "safety-hold" });
    expect(autoVerdict("ask", "read_file", { safetyAllow: true })).toEqual({
      approve: "approved read_file (read-only)",
      source: "safety-read",
    });
    expect(approvalHeldNote({ source: "safety-hold", permission: true })).toBe("approval.held.native");
  });

  it("lets Full access, a sandbox block, and a saved command beat the web-search grant", () => {
    expect(autoVerdict("full", "WebSearch")).toEqual({
      approve: "approved WebSearch (full access)",
      source: "full-access",
    });
    expect(autoVerdict("auto", "WebSearch", { requiresExplicitApproval: true })).toEqual({
      approve: null,
      source: "explicit-approval-block",
    });
    expect(autoVerdict("auto", "WebSearch", { commandAllowed: true })).toEqual({
      approve: "approved WebSearch (saved command)",
      source: "command-allowlist",
    });
  });
});

describe("allowed recipients (parité 1C)", () => {
  it("sends with no card when every recipient is listed, at any level", () => {
    for (const mode of ["ask", "edits", "auto"] as const) {
      expect(autoVerdict(mode, "mcp__composio__GMAIL_SEND_EMAIL", { recipientsAllowed: true })).toEqual({
        approve: "approved mcp__composio__GMAIL_SEND_EMAIL (allowed recipients)",
        source: "allowed-recipient",
      });
    }
  });

  it("keeps the card for a gate's sandbox widening, a security key, a safety hold or the person's ask rule", () => {
    const tool = "mcp__composio__GMAIL_SEND_EMAIL";
    expect(autoVerdict("auto", tool, { recipientsAllowed: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("auto", tool, { recipientsAllowed: true, stepUpRequired: ["external-send"] }).approve).toBeNull();
    expect(autoVerdict("auto", tool, { recipientsAllowed: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("auto", tool, { recipientsAllowed: true, customRule: { behavior: "ask", id: "r1" } }).approve).toBeNull();
    expect(autoVerdict("auto", tool, { recipientsAllowed: false })).toEqual({ approve: null, source: "email-draft-required" });
  });
});

describe("Reach me: the person's own Teams chat (2026-10-26)", () => {
  const tool = "mcp__microsoft_teams__send_chat_message";
  it("the one self-send of a Reach me run goes with no card, at Ask too", () => {
    expect(autoVerdict("ask", tool, { reachMeSelf: true })).toEqual({ approve: `approved ${tool} (Reach me: your own Teams chat)`, source: "reach-me" });
  });
  it("relaxes nothing else: a security key, an explicit approval, a safety hold, the person's rules", () => {
    expect(autoVerdict("ask", tool, { reachMeSelf: true, stepUpRequired: ["external-send"] }).approve).toBeNull();
    expect(autoVerdict("ask", tool, { reachMeSelf: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("ask", tool, { reachMeSelf: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("ask", tool, { reachMeSelf: true, customRule: { behavior: "deny", id: "r1" } }).approve).toBeNull();
    expect(autoVerdict("ask", tool, { reachMeSelf: false })).toEqual({ approve: null, source: "outbound-guard" });
  });
});

describe("approvalModeForOrigin", () => {
  it("runs peer-started Custom turns as Auto and leaves every other mode alone", () => {
    expect(approvalModeForOrigin("custom", { peerInitiated: true })).toBe("auto");
    expect(approvalModeForOrigin("custom", { peerInitiated: false })).toBe("custom");
    for (const mode of ["ask", "edits", "auto", "full"] as const) {
      expect(approvalModeForOrigin(mode, { peerInitiated: true })).toBe(mode);
    }
  });
});

describe("held notes", () => {
  it("explains a provider's own request and a sandbox change, and nothing else", () => {
    expect(approvalHeldNote({ source: "native-approval", permission: true })).toBe("approval.held.native");
    expect(approvalHeldNote({ source: "explicit-approval-block", permission: true })).toBe("approval.held.sandbox");
    expect(approvalHeldNote({ source: "web-search", permission: true })).toBeUndefined();
    expect(approvalHeldNote({ source: "no-grant", permission: true })).toBeUndefined();
    expect(approvalHeldNote({ source: undefined, permission: true })).toBeUndefined();
    // questions are never held for a mode reason
    expect(approvalHeldNote({ source: "native-approval", permission: false })).toBeUndefined();
    expect(approvalHeldReason({ source: "native-approval", permission: true }))
      .toBe("The provider requires your approval for this action.");
  });

  // Both ways: every note the server can send has a catalog entry, so the
  // client translates by key, and the catalog holds no note the server no
  // longer sends. A note left behind describes behaviour that has gone.
  it("the catalog's held notes are exactly the ones the server sends", () => {
    const catalog = Object.fromEntries(Object.entries(englishCatalog).filter(([key]) => key.startsWith("approval.held.")));
    expect(catalog).toEqual(HELD_NOTE);
  });
});

describe("tools that ask a person", () => {
  // A question normally arrives typed as a question and never reaches a
  // verdict. This is the backstop for the path where one arrives typed as a
  // permission: no mode may answer it, because approving does not answer
  // anything — the CLI runs the tool with no answers and the model is told
  // "The user did not answer the questions."
  const modes = ["ask", "edits", "auto", "custom", "full"] as const;

  it("never answers AskUserQuestion for the person, even under Full access", () => {
    for (const mode of modes) {
      expect(autoVerdict(mode, "AskUserQuestion"), mode).toEqual({ approve: null, source: "no-grant" });
    }
  });

  it("never answers ask_user, bare or MCP-prefixed", () => {
    for (const mode of modes) {
      expect(autoVerdict(mode, "ask_user").approve, mode).toBeNull();
      expect(autoVerdict(mode, "mcp__ogb__ask_user").approve, mode).toBeNull();
    }
  });

  it("still answers an ordinary tool under Full access", () => {
    expect(autoVerdict("full", "Read").approve).toBeTruthy();
  });
});

describe("delegatedApprovalMode", () => {
  const base = { senderIsChief: true, senderMode: "full" as const, sameBot: false, recipientMode: "ask" as const, recipientDriverKind: "claudeAgent" };
  it("passes a Full-access Chief's access to the teammate it delegates to", () => {
    expect(delegatedApprovalMode(base)).toBe("full");
    for (const recipientDriverKind of ["codex", "claudeAgent", "antigravityAgent", "cursorAgent", "grokAgent", "opencodeGo"]) {
      expect(delegatedApprovalMode({ ...base, recipientDriverKind })).toBe("full");
    }
  });
  it("passes an Approve-for-me or Auto-accept-edits Chief's level on too", () => {
    expect(delegatedApprovalMode({ ...base, senderMode: "auto" })).toBe("auto");
    expect(delegatedApprovalMode({ ...base, senderMode: "edits" })).toBe("edits");
    // A Chief's own Custom config reads as Approve for me for a teammate.
    expect(delegatedApprovalMode({ ...base, senderMode: "custom", recipientDriverKind: "codex" })).toBe("auto");
  });
  it("passes nothing on from an ordinary bot, a Chief on Ask, or a bot to itself", () => {
    expect(delegatedApprovalMode({ ...base, senderIsChief: false })).toBeNull();
    expect(delegatedApprovalMode({ ...base, senderMode: "ask" })).toBeNull();
    expect(delegatedApprovalMode({ ...base, sameBot: true })).toBeNull();
  });
  it("never lowers a teammate, and leaves one on Custom with its own config", () => {
    expect(delegatedApprovalMode({ ...base, senderMode: "auto", recipientMode: "full" })).toBeNull();
    expect(delegatedApprovalMode({ ...base, senderMode: "auto", recipientMode: "auto" })).toBeNull();
    expect(delegatedApprovalMode({ ...base, senderMode: "full", recipientMode: "auto" })).toBe("full");
    expect(delegatedApprovalMode({ ...base, senderMode: "edits", recipientMode: "auto" })).toBeNull();
    expect(delegatedApprovalMode({ ...base, recipientMode: "custom", recipientDriverKind: "codex" })).toBeNull();
  });
  it("steps down to the next level the teammate's engine has", () => {
    // No Full mode (hermes): the Chief's Full becomes Approve for me.
    expect(delegatedApprovalMode({ ...base, recipientDriverKind: "hermes" })).toBe("auto");
    expect(delegatedApprovalMode({ ...base, recipientDriverKind: undefined })).toBe("auto");
    // Codex has no Auto-accept edits (its Ask already writes the workspace).
    expect(delegatedApprovalMode({ ...base, senderMode: "edits", recipientDriverKind: "codex" })).toBeNull();
    expect(delegatedApprovalMode({ ...base, senderMode: "auto", recipientDriverKind: "codex" })).toBe("auto");
  });
  it("never passes Full access to a bot a member owns on an organization server", () => {
    // Owner rule until per-owner containers: an admin's Full Chief handing work
    // to a member's bot, in a Direct or a room, leaves that bot on Ask.
    expect(delegatedApprovalMode({ ...base, recipientMemberOwned: true })).toBe("auto");
    expect(delegatedApprovalMode({ ...base, recipientMemberOwned: true, recipientMode: "auto" })).toBeNull();
    expect(delegationInheritsFullAccess({ senderIsChief: true, senderHasFullAccess: true, sameBot: false, recipientDriverKind: "claudeAgent", recipientMemberOwned: true })).toBe(false);
    expect(delegationInheritsFullAccess({ senderIsChief: true, senderHasFullAccess: true, sameBot: false, recipientDriverKind: "claudeAgent", recipientMemberOwned: false })).toBe(true);
  });
  it("Full answers a Sagax approval-gate card; other levels keep the native decision", () => {
    expect(autoVerdict("full", "other", { sagaxGate: true }).source).toBe("full-access");
    for (const mode of ["auto", "custom", "edits", "ask"] as const) {
      expect(autoVerdict(mode, "other", { sagaxGate: true }).approve).toBeNull();
    }
  });
  it("keeps explicit organization asks, denies, holds and security keys ahead of Full at the gate", () => {
    for (const behavior of ["ask", "deny"] as const) {
      expect(autoVerdict("full", "other", { sagaxGate: true, customRule: { behavior, id: "orule_required" } }).source).toBe(`custom-rule-${behavior}`);
    }
    expect(autoVerdict("full", "other", { sagaxGate: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("full", "other", { sagaxGate: true, stepUpRequired: ["destructive"] }).approve).toBeNull();
  });
  it("answers a gate card only from the person's own saved Allow rule", () => {
    for (const mode of ["full", "auto", "custom", "edits", "ask"] as const) {
      expect(autoVerdict(mode, "other", { sagaxGate: true, ruleAllowed: true }).source).toBe("allow-rule");
      expect(Boolean(autoVerdict(mode, "other", { sagaxGate: true, ruleAllowed: false }).approve)).toBe(mode === "full");
    }
  });
});

describe("an engine connector's outward call (review of #943)", () => {
  it("the driver's outward reading holds the card like a send, at Auto and Ask", () => {
    for (const mode of ["auto", "ask"] as const) {
      expect(autoVerdict(mode, "other", { outbound: true, toolName: "outlook__whatever" })).toEqual({ approve: null, source: "outbound-guard" });
    }
  });
  it("a safety review's read-only verdict never answers an outward call", () => {
    expect(autoVerdict("auto", "other", { outbound: true, safetyAllow: true }).approve).toBeNull();
    expect(autoVerdict("auto", "mcp__claude_ai_Microsoft_365__outlook_create_event", { safetyAllow: true }).approve).toBeNull();
  });
  it("Full access is unchanged (no new exception)", () => {
    expect(autoVerdict("full", "other", { outbound: true }).source).toBe("full-access");
  });
});
