// @vitest-environment happy-dom
// The bot's profile page (#2313), Model & tools > Permissions under the plain
// surface: the approval level is the page's segmented control, the applied
// level line is a subtitle with a plain pill, the rules list sits in its own
// labelled card, the recipients are filled chips over a filled field, and the
// extra teams fold has no rule above it. Nothing is bordered, underlined or a
// primary pill; every label and control is still there.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: (...args: unknown[]) => fixture.api(...args),
    useStore: () => ({ state: { ...actual.initialState, bots: [] }, dispatch: fixture.dispatch }),
  };
});
vi.mock("@/lib/org-approval-policy", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/org-approval-policy")>(),
  useOrgApprovalPolicy: () => ({ alwaysAllow: true }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));

const { SettingsSurfaceProvider } = await import("../SettingsPrimitives");
const { ApprovalModeSelector } = await import("../ApprovalModeSelector");
const { AppliedLevelNote } = await import("./AppliedLevelNote");
const { AllowedRecipientsRow } = await import("./AllowedRecipientsRow");
const { OwnerPermissionsCard } = await import("./OwnerPermissionsCard");
const { ManagedTeamsSettings } = await import("./ManagedTeamsSettings");

const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function renderPlain(child: ReactNode) {
  await act(async () => { root.render(createElement(SettingsSurfaceProvider, { surface: "plain", children: child })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  // HelpTip popovers keep their own outline (a floating surface, not a card).
  for (const popover of host.querySelectorAll(".popover-surface")) popover.remove();
  return host;
}
function expectReferenceLook(node: HTMLElement) {
  for (const element of node.querySelectorAll("*")) {
    const classes = element.getAttribute("class") ?? "";
    expect(classes, element.outerHTML.slice(0, 160)).not.toMatch(BORDER);
    expect(classes).not.toContain("underline");
    expect(classes).not.toContain("ui-button-primary");
  }
}

const bot = (over: Partial<Bot> = {}) => ({ id: "bot-1", name: "Scout", messages: [], ...over } as unknown as Bot);

describe("Permissions on the profile page (plain surface)", () => {
  it("draws the simple approval level as the page's segmented control", async () => {
    const node = await renderPlain(createElement(ApprovalModeSelector, { providerName: "Codex", driverKind: "codex", approvalMode: "ask", onSelect: vi.fn(), wide: true }));
    const group = node.querySelector('[role="group"]');
    expect(group?.getAttribute("class")).toContain("bg-control");
    expect(node.querySelector('[data-approval-choice="ask"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(node.querySelector('[data-approval-choice-hint="ask"]')).not.toBeNull();
    expectReferenceLook(node);
  });

  it("says the applied level as a subtitle with a plain pill", async () => {
    const node = await renderPlain(createElement(AppliedLevelNote, { setting: "full", applied: { mode: "ask", reason: "thread" }, onUseSetting: vi.fn() }));
    expect(node.querySelector('[data-approval-applied="ask"]')).not.toBeNull();
    expect(node.textContent).toContain("Use Full access here");
    expectReferenceLook(node);
  });

  it("lists the rules in their own labelled card, with edit and remove", async () => {
    fixture.api.mockResolvedValue({ rules: [
      { id: "r1", botId: "bot-1", tool: "mail_send", scope: {}, behavior: "deny", description: "Never send mail to clients" },
      { id: "r2", botId: null, tool: "files_read", scope: {}, behavior: "allow", description: "Read shared files" },
    ] });
    const node = await renderPlain(createElement(OwnerPermissionsCard, { bot: { id: "bot-1", name: "Scout" }, leading: createElement("div", null, "Approval level") }));
    expect(node.querySelector('[data-settings-group="approvals"]')?.textContent).toContain("Approvals");
    expect(node.querySelector('[data-settings-group="ownerRules"]')?.textContent).toContain("Rules");
    expect(node.querySelector('[data-owner-rules="2"]')).not.toBeNull();
    expect(node.textContent).toContain("Never send mail to clients");
    expect(node.textContent).toContain("Read shared files");
    expect(node.querySelectorAll('[aria-label="Edit rule"], [aria-label="Remove rule"]').length).toBeGreaterThan(0);
    expectReferenceLook(node);
  });

  it("shows the recipients as filled chips over a filled field", async () => {
    const node = await renderPlain(createElement(AllowedRecipientsRow, { bot: bot({ allowedRecipients: ["ada@example.test"] }) }));
    expect(node.textContent).toContain("ada@example.test");
    expect(node.querySelector("input")?.getAttribute("class")).toContain("bg-inset");
    expectReferenceLook(node);
  });

  it("folds the extra teams with no rule above", async () => {
    const node = await renderPlain(createElement(ManagedTeamsSettings, { name: "Scout", ownTeam: "Ops", teams: ["Ops", "Sales"], allowed: [], onSave: vi.fn() }));
    expect(node.textContent).toContain("Additional teams");
    expectReferenceLook(node);
  });
});
