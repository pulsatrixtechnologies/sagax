import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildBridgeEnvelope } from "../../shared/grok-bridge.ts";
import { handleBridgePhone } from "./phone.ts";
import { GrokBridgeStore } from "./store.ts";

function storeWith(optIn: { mayCallOwner?: boolean; mayTextOwner?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "grok-bridge-phone-"));
  const store = new GrokBridgeStore(dir);
  store.setLink("pr_owner", {
    webhookUrl: "https://grok.example/hook",
    enabled: true,
    bots: ["cryptic"],
    mayCallOwner: optIn.mayCallOwner === true,
    mayTextOwner: optIn.mayTextOwner === true,
  });
  return store;
}

describe("bridge phone tasks", () => {
  it("third-party call always needs a card when no placeCall is wired", async () => {
    const store = storeWith({ mayCallOwner: true, mayTextOwner: true });
    const envelope = buildBridgeEnvelope({
      fromBot: "cryptic",
      toBot: "atlas",
      task: "phone.call_third_party",
      threadId: "th-1",
      requestedBy: "bot",
      payload: { to: "+15145550199", purpose: "status" },
    });
    envelope.from = { kind: "grok", bot: "cryptic" };
    envelope.to = { kind: "sagax", bot: "atlas" };
    const result = await handleBridgePhone({
      personId: "pr_owner",
      envelope,
      sagaxThreadId: "sagax-th",
      store,
      deps: {},
    });
    expect(result).toMatchObject({ ok: false, needsCard: true });
  });

  it("owner call with opt-in returns accepted without a card when placeCall is absent", async () => {
    const store = storeWith({ mayCallOwner: true });
    const envelope = buildBridgeEnvelope({
      fromBot: "cryptic",
      toBot: "atlas",
      task: "phone.call_owner",
      threadId: "th-2",
      requestedBy: "bot",
      payload: { purpose: "check in" },
    });
    envelope.from = { kind: "grok", bot: "cryptic" };
    envelope.to = { kind: "sagax", bot: "atlas" };
    const result = await handleBridgePhone({
      personId: "pr_owner",
      envelope,
      sagaxThreadId: "sagax-th",
      store,
      deps: { ownerNumber: () => "+15145550100" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result?.task).toBe("phone.call_owner");
  });

  it("owner sms without opt-in needs a card", async () => {
    const store = storeWith({ mayTextOwner: false });
    const envelope = buildBridgeEnvelope({
      fromBot: "cryptic",
      toBot: "atlas",
      task: "phone.sms_owner",
      threadId: "th-3",
      requestedBy: "bot",
      payload: { text: "hello" },
    });
    envelope.from = { kind: "grok", bot: "cryptic" };
    envelope.to = { kind: "sagax", bot: "atlas" };
    const result = await handleBridgePhone({
      personId: "pr_owner",
      envelope,
      sagaxThreadId: "sagax-th",
      store,
      deps: { ownerNumber: () => "+15145550100" },
    });
    expect(result).toMatchObject({ ok: false, needsCard: true });
  });
});
