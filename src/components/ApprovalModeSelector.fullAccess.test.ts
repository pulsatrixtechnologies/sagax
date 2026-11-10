// Full access in the approval menu: its description, its warning icon, and
// how it shows on an organization server (src/lib/full-access.ts).
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { TriangleAlert } from "lucide-react";
import type { ApprovalMode } from "../../shared/approval-mode";
import type { OrgFullAccess } from "@/lib/full-access";

const fixture = vi.hoisted(() => ({ open: false }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [fixture.open, (next: boolean | ((current: boolean) => boolean)) => {
    fixture.open = typeof next === "function" ? next(fixture.open) : next;
  }],
}));
import { ApprovalModeSelector, approvalModeOptionsFor } from "./ApprovalModeSelector";

type Node = ReactElement<{ children?: ReactNode; role?: string; onClick?: () => void; disabled?: boolean; "aria-haspopup"?: string; "data-approval-mode"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function render(onSelect: (mode: ApprovalMode) => void, orgFullAccess?: OrgFullAccess, trustedModesAvailable = false) {
  let tree: ReactNode;
  function Capture() {
    tree = ApprovalModeSelector({ providerName: "Claude", driverKind: "claudeAgent", approvalMode: "ask", onSelect, trustedModesAvailable, orgFullAccess });
    return tree;
  }
  return { html: renderToStaticMarkup(createElement(Capture)), nodes: nodes(tree) };
}
function openMenu(onSelect: (mode: ApprovalMode) => void, orgFullAccess?: OrgFullAccess, trusted = false) {
  render(onSelect, orgFullAccess, trusted).nodes.find((node) => node.props["aria-haspopup"] === "menu")!.props.onClick!();
  return render(onSelect, orgFullAccess, trusted);
}
beforeEach(() => { fixture.open = false; });

describe("Full access in the approval menu", () => {
  it("says what it does and wears a warning icon of its own", () => {
    const full = approvalModeOptionsFor("claudeAgent").find((option) => option.mode === "full")!;
    expect(full.label).toBe("Full access");
    expect(full.description).toBe("Runs commands and edits files without asking. Your rules still apply: \"Ask every time\" shows a card and \"Deny\" refuses, even here. Use only with bots you trust.");
    expect(full.Icon).toBe(TriangleAlert);
    for (const other of approvalModeOptionsFor("claudeAgent").filter((option) => option.mode !== "full")) expect(other.Icon).not.toBe(TriangleAlert);
  });

  it("lists Full on a solo server outside the packaged app (omb #2701)", () => {
    const html = openMenu(vi.fn()).html;
    expect(html).toContain("Ask for approval");
    expect(html).toContain("Full access");
    expect(approvalModeOptionsFor("claudeAgent", false, undefined).map((option) => option.mode)).toContain("full");
  });

  it("offers Full to the bot's owner on an organization server and returns it when picked", () => {
    const select = vi.fn();
    const open = openMenu(select, "allowed");
    expect(open.html).toContain("Full access");
    expect(open.html).not.toContain("Custom (config.toml)");
    const item = open.nodes.find((node) => node.props["data-approval-mode"] === "full")!;
    expect(item.props.disabled).toBe(false);
    item.props.onClick!();
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
  });

  it("never greys Full out for the bot's owner (#3294: no organization switch)", () => {
    const open = openMenu(vi.fn(), "allowed");
    expect(open.html).not.toContain("data-full-access-org-off");
    expect(open.html).not.toContain("Turned off by your organization.");
  });

  it("hides Full from someone who does not own the bot", () => {
    expect(openMenu(vi.fn(), "hidden").html).not.toContain("Full access");
  });
});
