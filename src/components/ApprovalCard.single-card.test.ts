// @vitest-environment happy-dom
// One card per approval (owner, 2026-10-15): while a tool request waits, the box
// above the composer holds it with its buttons and the thread shows one quiet
// step line; once answered, the thread keeps a one-line receipt (#455) that
// opens on the saved rule and the full request.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { BotEditorStore, type Message } from "@/state/store";
import { ApprovalCard } from "./ApprovalCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dispatch = vi.fn();
const store = { dispatch } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
const TWILIO = "mcp__perspicax_quasar__twilio_api_query";
const input = JSON.stringify({ resource: "Accounts", fields: ["sid", "friendlyName"], limit: 5 });

function twilioAsk(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "m-twilio", role: "bot", kind: "options", at: 1,
    card: {
      title: "Approval needed", subtitle: input, toolInput: input, options: ["Allow", "Deny"],
      requestId: "req-twilio", requestType: "permission", tool: "other", mcpTool: TWILIO,
      ownerRule: { tool: "perspicax_quasar__twilio_api_query", scope: { resource: "accounts" }, description: "View accounts in Twilio (accounts)" },
      ...extra,
    },
  } as Message;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("fr");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLocale("en");
});

function mount(message: Message) {
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(ApprovalCard, { bot: { name: "Rocket" }, message }) })));
}

describe("one approval card per request", () => {
  it("shows a waiting line, not a second card, while the request waits", () => {
    mount(twilioAsk());
    expect(host.querySelectorAll("[data-step-row]")).toHaveLength(1);
    expect(host.textContent).toBe("En attente de votre autorisation");
    expect(host.querySelector("button")).toBeNull();
  });

  it("turns into a one-line receipt that opens on the saved rule and the full request", () => {
    mount(twilioAsk({
      answered: "allow",
      ruleSaved: { id: "rule_1", behavior: "allow", description: "View accounts in Twilio (accounts)" },
    }));
    // 2026-10-28: the call's own step line; "Always allowed" only in the details
    const row = host.querySelector<HTMLButtonElement>('[data-testid="approval-receipt-quiet"] button')!;
    expect(row.textContent).not.toContain("Toujours autorisé");
    expect(host.querySelector("[data-owner-rule-saved]")).toBeNull();
    act(() => row.click());
    expect(host.querySelector('[data-testid="approval-receipt-detail"]')?.textContent).toContain("Toujours autorisé");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-owner-rule-saved="allow"]')?.textContent).toContain("View accounts in Twilio (accounts)");
    expect(host.textContent).toContain("Voir la demande complète");
  });

  it("opens on an earlier Allow rule (an allowKey) with Edit rule", () => {
    mount(twilioAsk({ answered: "allow", ownerRule: undefined, alwaysAllowed: "mcp:perspicax_quasar__twilio_api_query" }));
    const row = host.querySelector<HTMLButtonElement>('[data-testid="approval-receipt-quiet"] button')!;
    expect(row.textContent).not.toContain("Toujours autorisé");
    act(() => row.click());
    expect(host.querySelector("[data-allow-rule]")).not.toBeNull();
  });
});
