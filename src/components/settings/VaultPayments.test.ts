// @vitest-environment happy-dom
// Payments (#2080): a bot cap stays folded behind its summary, and Shop Pay
// and Link are sibling rows, not a group inside the methods card.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { CredentialVaultState } from "@/lib/credential-vault";

vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }),
}));

import { PaymentsPanel, botAllowanceSummary } from "./VaultPayments";

const data: CredentialVaultState = {
  items: [],
  onePassword: { available: false, reason: "absent" },
  payments: { bots: { scout: { perPurchaseLimit: "50.00", perMonthLimit: "500.00" } } },
  methods: [],
  purchases: [],
  history: [],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  setLocale("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Payments panel", () => {
  it("folds a bot cap behind the summary and does not nest one-time wallets", async () => {
    expect(botAllowanceSummary(data.payments?.bots?.scout)).toBe("$50.00 per purchase, $500.00 per month");
    expect(botAllowanceSummary(undefined)).toBe("No cap");
    await act(async () => {
      root.render(createElement(PaymentsPanel, {
        data,
        bots: [{ id: "scout", name: "Scout" }, { id: "relay", name: "Relay" }],
        botName: (id: string) => (id === "scout" ? "Scout" : "Relay"),
        addingCard: false,
        renderItem: () => null,
        renderNewCard: () => null,
        onAddCard: () => {},
        onChanged: async () => {},
        onError: () => {},
      }));
    });
    const scout = container.querySelector<HTMLElement>('[data-payments-bot="scout"]')!;
    const relay = container.querySelector<HTMLElement>('[data-payments-bot="relay"]')!;
    expect(scout.querySelector("input")).toBeNull();
    expect(scout.querySelectorAll("button")).toHaveLength(1);
    expect(scout.textContent).toContain("$50.00 per purchase, $500.00 per month");
    expect(relay.textContent).toContain("No cap");
    expect(relay.querySelector("input")).toBeNull();
    const methods = container.querySelector('[data-settings-card="credentials.payments.methods"]')!;
    expect(methods.querySelector('[data-settings-group="credentials.wallets"]')).toBeNull();
    expect(methods.innerHTML).not.toContain('data-settings-group="credentials.wallets"');
    expect(container.querySelectorAll("[data-single-use-wallet]")).toHaveLength(2);
    await act(async () => { scout.querySelector("button")!.click(); });
    expect(scout.querySelectorAll("input")).toHaveLength(3);
    expect(relay.querySelector("input")).toBeNull();
  });
});
