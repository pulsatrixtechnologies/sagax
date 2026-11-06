// @vitest-environment happy-dom
// #2080 (L0): the shared patterns of the Settings redesign. One action per
// org-managed row, no filter chip without an item, at most one action in an
// empty state, and a selection bar Escape closes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Inbox } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ExternalLinkPill, FilterChips, OrgBand, OrgManagedRow, SelectionBar, SettingsEmpty, StatusText } from "@/components/SettingsPrimitives";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const draw = (node: React.ReactNode) => act(() => root.render(node));

describe("Settings patterns", () => {
  it("OrgManagedRow: the value in grey and one way out, to Perspicax, never an accent link", () => {
    draw(createElement(OrgManagedRow, { label: "Approvals", value: "Ask first", href: "https://perspicax.example/approvals", rowId: "approvals" }));
    const actions = host.querySelectorAll("a, button");
    expect(actions).toHaveLength(1);
    const link = actions[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://perspicax.example/approvals");
    expect(link.target).toBe("_blank");
    expect(link.textContent).toBe("Managed in Perspicax");
    expect(link.className).not.toContain("text-accent");
    expect(host.textContent).toContain("Ask first");
    expect(host.querySelector("input, select, [role=switch]")).toBeNull();
  });

  it("OrgBand: the name, the role and one Perspicax link", () => {
    draw(createElement(OrgBand, { name: "Acme", role: "Member", sentence: "Acme sets your providers.", href: "https://perspicax.example" }));
    expect(host.querySelector("[data-org-band]")?.textContent).toContain("Acme");
    expect(host.textContent).toContain("Member · Acme sets your providers.");
    expect(host.querySelectorAll("a, button")).toHaveLength(1);
  });

  it("ExternalLinkPill and StatusText", () => {
    draw(createElement("div", null,
      createElement(ExternalLinkPill, { href: "https://example.com", children: "Open" }),
      createElement(StatusText, { tone: "success", children: "Connected" })));
    expect(host.querySelector("[data-external-link-pill]")?.getAttribute("rel")).toContain("noopener");
    expect(host.querySelector('[data-status-text="success"]')?.className).toBe("text-success");
  });

  it("FilterChips: a chip with no item is not drawn, one chip left draws nothing", () => {
    const onChange = vi.fn();
    draw(createElement(FilterChips<string>, { label: "Filter", value: "all", onChange, chips: [
      { id: "all", label: "All", count: 3 }, { id: "on", label: "On", count: 3 }, { id: "off", label: "Off", count: 0 },
    ] }));
    const chips = [...host.querySelectorAll<HTMLButtonElement>("[data-filter-chip]")];
    expect(chips.map((chip) => chip.dataset.filterChip)).toEqual(["all", "on"]);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    act(() => chips[1].click());
    expect(onChange).toHaveBeenCalledWith("on");
    draw(createElement(FilterChips<string>, { label: "Filter", value: "all", onChange, chips: [
      { id: "all", label: "All", count: 3 }, { id: "off", label: "Off", count: 0 },
    ] }));
    expect(host.querySelector("[data-filter-chips]")).toBeNull();
  });

  it("SettingsEmpty: one sentence and at most one action", () => {
    const onClick = vi.fn();
    draw(createElement(SettingsEmpty, { icon: Inbox, action: { label: "Add", onClick }, children: "Nothing here yet." }));
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.textContent).toContain("Nothing here yet.");
    draw(createElement(SettingsEmpty, { icon: Inbox, children: "Nothing here yet." }));
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("SelectionBar: count, Clear, at most two actions with the last primary, Done; Escape closes", () => {
    const onDone = vi.fn();
    const onClear = vi.fn();
    const actions = [{ label: "Pause", onClick: vi.fn() }, { label: "Delete", onClick: vi.fn() }, { label: "Extra", onClick: vi.fn() }];
    draw(createElement(SelectionBar, { count: 2, onClear, onDone, actions }));
    expect(host.textContent).toContain("2 selected");
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Clear", "Done", "Pause", "Delete"]);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onDone).toHaveBeenCalled();
    draw(createElement(SelectionBar, { count: 0, onClear, onDone, actions }));
    expect(host.querySelector("[data-selection-bar]")).toBeNull();
  });
});
