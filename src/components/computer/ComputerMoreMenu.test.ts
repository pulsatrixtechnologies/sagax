// The computer tab keeps one main action (Open live desktop) and puts the
// rarer ones (two desktops, Sleep, Works on, Delete the VM) in one "...".
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { locales } from "@/locales";
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

describe("computer panel layout", () => {
  // ComputerPanel was split into hooks and parts; read the panel and its parts together.
  const partsDir = new URL("../ComputerPanel.tsx-parts/", import.meta.url);
  const source = [
    readFileSync(new URL("../ComputerPanel.tsx", import.meta.url), "utf8"),
    ...readdirSync(partsDir)
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => readFileSync(new URL(name, partsDir), "utf8")),
  ].join("\n");

  it("merges Take control and Open live desktop into one main button", () => {
    expect(source.match(/data-computer-open-desktop/g)).toHaveLength(1);
    // Help banner in DeviceBody still offers Take control when the bot asks
    // for hands; SignInRequestCard also carries it for sign-in help.
    expect(source.match(/t\("computer\.takeControl"\)/g)).toHaveLength(1);
    const card = readFileSync(new URL("../SignInRequestCard.tsx", import.meta.url), "utf8");
    expect(card.match(/t\("computer\.takeControl"\)/g)).toHaveLength(1);
    for (const id of ["two-desktops", "sleep", "works-on", "delete-vm"]) expect(source).toContain(`id: "${id}"`);
  });

  it("has no English left in the header, and the keys exist in French", () => {
    expect(source).not.toContain('aria-label="Back"');
    expect(source).not.toContain(">Computer</span>");
    for (const key of ["computer.back", "computer.close", "computer.more", "computer.confirm.deleteVm", "computer.confirm.replaceVm", "computer.confirm.replaceVps", "computer.phase.vpsIncompatible", "computer.openVmDesktopTitle"]) {
      expect(locales.fr?.[key as keyof NonNullable<typeof locales.fr>], key).toBeTruthy();
    }
  });
});
