// The computer tab keeps one main action (Open live desktop) and puts the
// rarer ones (two desktops, Sleep, Works on, Delete the VM) in one "...".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { ComputerMoreMenu } from "./ComputerMoreMenu";

const items = [
  { id: "two-desktops", icon: null, label: "Open two desktops", onSelect: () => {} },
  { id: "delete-vm", icon: null, label: "Delete this bot's VM", danger: true, disabled: true, onSelect: () => {} },
];

afterEach(() => setLocale("en"));

describe("computer more menu", () => {
  it("is one closed button until opened, then lists its items", () => {
    const closed = renderToStaticMarkup(createElement(ComputerMoreMenu, { items }));
    expect(closed).toContain('aria-label="More computer actions"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('role="menu"');
    const open = renderToStaticMarkup(createElement(ComputerMoreMenu, { items, defaultOpen: true }));
    expect([...open.matchAll(/data-computer-more-item="([\w-]+)"/g)].map((match) => match[1])).toEqual(["two-desktops", "delete-vm"]);
    expect(open).toMatch(/data-computer-more-item="delete-vm" disabled=""/);
  });

  it("speaks French", () => {
    setLocale("fr");
    expect(renderToStaticMarkup(createElement(ComputerMoreMenu, { items }))).toContain("Autres actions de l&#x27;ordinateur");
  });
});
