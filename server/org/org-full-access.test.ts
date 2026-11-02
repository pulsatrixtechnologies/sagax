import { describe, expect, it } from "vitest";

import {
  fullAccessConsentedBy,
  orgFullAccessAllowed,
  orgFullAccessGrandfathered,
  newConversationFullAllowed,
  orgFullAccessGrantRefusal,
  orgFullAccessHolds,
  orgNewBotApprovalMode,
  parseOrgFullAccessBody,
  threadFollowsFullGrant,
  trustedChannelFullRefusal,
} from "./org-full-access.ts";

const consent = { principalId: "alice", at: 1 };

describe("organization Full access policy", () => {
  it("has no admin switch: the owner's own confirmation is the gate (2026-10-26)", () => {
    expect(orgFullAccessAllowed(undefined)).toBe(true);
    expect(orgFullAccessAllowed({})).toBe(true);
    expect(orgFullAccessAllowed({ allowFullAccess: false })).toBe(true);
  });

  it("keeps Full allowed for an organization that never saved it and already runs a consented Full bot or thread", () => {
    const fullBot = { approvalMode: "full", fullAccessConsent: consent, tasks: [{ approvalMode: "full" }] };
    const fullThread = { approvalMode: "auto", fullAccessConsent: consent, tasks: [{ approvalMode: "ask" }, { approvalMode: "full" }] };
    expect(orgFullAccessGrandfathered(undefined, [fullBot])).toBe(true);
    expect(orgFullAccessGrandfathered({}, [{ approvalMode: "ask" }, fullThread])).toBe(true);
    // a saved choice, on or off, is never rewritten
    expect(orgFullAccessGrandfathered({ allowFullAccess: false }, [fullBot])).toBe(false);
    expect(orgFullAccessGrandfathered({ allowFullAccess: true }, [fullBot])).toBe(false);
    // no Full in use, or Full stored without its owner's consent (it ran as Ask): off
    expect(orgFullAccessGrandfathered({}, [])).toBe(false);
    expect(orgFullAccessGrandfathered({}, [{ approvalMode: "auto", tasks: [{ approvalMode: "ask" }] }])).toBe(false);
    expect(orgFullAccessGrandfathered({}, [{ approvalMode: "full", tasks: [{ approvalMode: "full" }] }])).toBe(false);
  });
});

describe("the level a new bot starts on in an organization (2026-10-11)", () => {
  it("is Approve for me as on a solo server, Ask only when the organization chose Ask (#1098)", () => {
    expect(orgNewBotApprovalMode("auto")).toBe("auto");
    expect(orgNewBotApprovalMode("ask")).toBe("ask");
    expect(orgNewBotApprovalMode(undefined)).toBe("auto");
    expect(orgNewBotApprovalMode(null)).toBe("auto");
    expect(orgNewBotApprovalMode("full")).toBe("auto");
    expect(orgNewBotApprovalMode("custom")).toBe("auto");
    expect(orgNewBotApprovalMode("edits")).toBe("auto");
  });
});

describe("organization Full access grants", () => {

  it("refuses a grant while the policy is off, whoever asks", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: false, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: true, consent })?.code)
      .toBe("org_full_access_disabled");
  });

  it("lets only the bot's owner, signed in, grant it", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: null, ownerPrincipalId: "alice", confirmed: true, consent: null })?.code)
      .toBe("full_access_owner_only");
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "bob", ownerPrincipalId: "alice", confirmed: true, consent: null })?.code)
      .toBe("full_access_owner_only");
  });

  it("asks for the confirmation once per bot", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: false, consent: null })?.code)
      .toBe("full_access_confirm_required");
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: true, consent: null })).toBeNull();
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "Alice", ownerPrincipalId: "alice", confirmed: false, consent })).toBeNull();
    // another person's consent is not the owner's
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: false, consent: { principalId: "bob", at: 1 } })?.code)
      .toBe("full_access_confirm_required");
  });

  it("runs a turn Full only while the policy is on and the current owner consented", () => {
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "alice", consent })).toBe(true);
    expect(orgFullAccessHolds({ policyAllowed: false, ownerPrincipalId: "alice", consent })).toBe(false);
    // ownership moved: the routine's owner never set it on this bot
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "bob", consent })).toBe(false);
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "alice", consent: { principalId: "", at: 1 } })).toBe(false);
    expect(fullAccessConsentedBy("junk", "alice")).toBe(false);
  });

  it("lets a member's bot go Full through the desktop's trusted channel for its owner only (#1098)", () => {
    expect(trustedChannelFullRefusal({ policyAllowed: true, localPrincipalId: "Bob", ownerPrincipalId: "bob", mayFullAccess: true })).toBeNull();
    // someone else's bot, no person, or without bots.fullAccess
    expect(trustedChannelFullRefusal({ policyAllowed: true, localPrincipalId: "uma", ownerPrincipalId: "bob", mayFullAccess: true })?.code).toBe("full_access_owner_only");
    expect(trustedChannelFullRefusal({ policyAllowed: true, localPrincipalId: null, ownerPrincipalId: "bob", mayFullAccess: true })?.code).toBe("full_access_owner_only");
    expect(trustedChannelFullRefusal({ policyAllowed: true, localPrincipalId: "bob", ownerPrincipalId: "bob", mayFullAccess: false })?.code).toBe("full_access_owner_only");
  });

  it("accepts the open conversation beside the Full grant and nothing else", () => {
    expect(parseOrgFullAccessBody({ approvalMode: "full", confirmFullAccess: true, threadId: "talk" })).toEqual({ confirm: true, threadId: "talk" });
    expect(parseOrgFullAccessBody({ approvalMode: "full" })).toEqual({ confirm: false });
    expect(parseOrgFullAccessBody({ approvalMode: "full", confirmFullAccess: true, computer: "local" })).toEqual({ error: "send { approvalMode: \"full\", confirmFullAccess } alone" });
    expect(parseOrgFullAccessBody({ approvalMode: "full", threadId: "../talk" })).toEqual({ error: "send { approvalMode: \"full\", confirmFullAccess } alone" });
  });

  it("copies Full onto the open conversation, and leaves a missing or busy one alone", () => {
    expect(threadFollowsFullGrant({ threadId: "talk", knownThread: true, threadBusy: false })).toBe("talk");
    expect(threadFollowsFullGrant({ threadId: "talk", knownThread: false, threadBusy: false })).toBeNull();
    expect(threadFollowsFullGrant({ threadId: "talk", knownThread: true, threadBusy: true })).toBeNull();
    expect(threadFollowsFullGrant({ knownThread: true, threadBusy: false })).toBeNull();
  });
});

describe("a new conversation on Full access (#1098)", () => {
  const base = { callerPrincipalId: "alice", ownerPrincipalId: "alice", soloOwner: false, localPrincipalId: "local", consent };
  it("opens for the organization owner who already confirmed Full for this bot", () => {
    expect(newConversationFullAllowed({ ...base, identity: "perspicax" })).toBe(true);
    expect(newConversationFullAllowed({ ...base, identity: "perspicax", consent: undefined })).toBe(false);
    expect(newConversationFullAllowed({ ...base, identity: "perspicax", callerPrincipalId: "bob" })).toBe(false);
    expect(newConversationFullAllowed({ ...base, identity: "perspicax", callerPrincipalId: null })).toBe(false);
  });
  it("opens on a solo server from any of the operator's apps once the desktop confirmed it", () => {
    const solo = { ...base, identity: "solo" as const, consent: { principalId: "local", at: 1 } };
    expect(newConversationFullAllowed({ ...solo, soloOwner: true })).toBe(true);
    expect(newConversationFullAllowed({ ...solo, soloOwner: false })).toBe(false);
    expect(newConversationFullAllowed({ ...solo, soloOwner: true, consent: undefined })).toBe(false);
  });
});
