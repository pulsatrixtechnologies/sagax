import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import {
  Card,
  SettingRow,
  cardCount,
  loadCardOpen,
  requestSettingsCard,
  resetSettingsCards,
  saveCardOpen,
} from "./SettingsPrimitives";

// No DOM here: the store and the modal only ask whether a bridge exists.
beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
  (globalThis as { document?: unknown }).document ??= { documentElement: { dataset: {} } };
});

vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
}));

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

function collapsible(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(Card, {
    collapsible: true,
    cardId: "test.card",
    defaultOpen: false,
    title: "About me",
    subtitle: "Shared with every bot.",
    summary: "3 lines",
    ...props,
  }, createElement("textarea", { "aria-label": "About me text" })));
}

/** A fresh device: storage stubbed, in-memory choices dropped. */
function device(storage = memoryStorage()) {
  vi.stubGlobal("localStorage", storage);
  resetSettingsCards();
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSettingsCards();
  setLocale("en");
});

describe("collapsible settings card", () => {
  it("starts collapsed with a one-line summary and an accessible disclosure button", () => {
    device();
    const html = collapsible();
    expect(html).toMatch(/<h3[^>]*><button type="button" aria-expanded="false" aria-controls="([^"]+)"/);
    const controls = /aria-controls="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${controls}" hidden=""`);
    expect(html).toContain("data-card-summary");
    expect(html).toContain(">3 lines<");
    expect(html).toContain("focus-visible:ring-2");
    // the body stays mounted so a draft or save in progress survives folding
    expect(html).toContain('aria-label="About me text"');
    expect(html).toContain('data-open="false"');
  });

  it("opens by default when asked to, and then hides the summary in favor of the subtitle", () => {
    device();
    const html = collapsible({ defaultOpen: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("data-card-summary");
    expect(html).not.toContain('hidden=""');
    expect(html).toContain("Shared with every bot.");
  });

  it("remembers each card's choice on this device", () => {
    const storage = memoryStorage();
    expect(loadCardOpen("test.card", false, storage)).toBe(false);
    saveCardOpen("test.card", true, storage);
    saveCardOpen("other.card", false, storage);
    expect(loadCardOpen("test.card", false, storage)).toBe(true);
    expect(loadCardOpen("other.card", true, storage)).toBe(false);
    expect(JSON.parse(storage.values.get("openmausbot.settingsCards.v1")!)).toEqual({ "test.card": true, "other.card": false });

    device(storage);
    expect(collapsible()).toContain('aria-expanded="true"');
    expect(collapsible({ cardId: "other.card", defaultOpen: true })).toContain('aria-expanded="false"');
  });

  it("falls back to the default when storage is missing, corrupt or throws", () => {
    expect(loadCardOpen("test.card", true, null)).toBe(true);
    expect(loadCardOpen("test.card", false, memoryStorage({ "openmausbot.settingsCards.v1": "{not json" }))).toBe(false);
    expect(loadCardOpen("test.card", false, memoryStorage({ "openmausbot.settingsCards.v1": '{"test.card":"yes"}' }))).toBe(false);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadCardOpen("test.card", true, throwing)).toBe(true);
    expect(() => saveCardOpen("test.card", true, throwing)).not.toThrow();
  });

  it("opens a collapsed card that a deep link targets, even against a remembered choice", () => {
    const storage = device(memoryStorage({ "openmausbot.settingsCards.v1": '{"test.card":false}' }));
    expect(collapsible()).toContain('aria-expanded="false"');
    // before the card mounts, as when a link opens Settings first
    requestSettingsCard("test.card");
    expect(collapsible()).toContain('aria-expanded="true"');
    expect(collapsible({ cardId: "unrelated.card" })).toContain('aria-expanded="false"');
    // and it stays open next time
    expect(JSON.parse(storage.values.get("openmausbot.settingsCards.v1")!)["test.card"]).toBe(true);
  });

  it("follows a changing default until the person chooses", () => {
    device();
    expect(collapsible({ cardId: "setup.card", defaultOpen: true })).toContain('aria-expanded="true"');
    expect(collapsible({ cardId: "setup.card", defaultOpen: false })).toContain('aria-expanded="false"');
  });

  it("folds a card without a cardId too, without writing to storage", () => {
    const storage = device();
    const html = collapsible({ cardId: undefined, defaultOpen: false });
    expect(html).toContain('aria-expanded="false"');
    expect(storage.values.size).toBe(0);
  });

  it("keeps a plain card static, without a disclosure button", () => {
    const html = renderToStaticMarkup(createElement(Card, { title: "Profile", summary: "ignored" }, "body"));
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain("ignored");
    expect(html).toContain("rounded-[14px] border-[0.5px] border-border px-3.5 py-3");
  });

  it("moves a row's long explanation behind a keyboard-reachable help disclosure", () => {
    const html = renderToStaticMarkup(createElement(SettingRow, {
      title: "Language",
      subtitle: "Short line.",
      help: "The long explanation.",
      children: createElement("select", { "aria-label": "App language" }),
    }));
    expect(html).toContain("Short line.");
    expect(html).toMatch(/<summary aria-label="More about Language"/);
    expect(html).toContain("The long explanation.");
  });
});

describe("collapsed card summaries", () => {
  it("summarizes About me, keys, cleanup and VM setup in one line each", async () => {
    const { cardsMatching } = await import("./SettingsModal");
    const { aboutMeFirstLine } = await import("./AboutMeSettings");
    const { threadCleanupSummary } = await import("./ThreadCleanupSettings");
    const { setupStep } = await import("./LocalComputerSection");

    expect(aboutMeFirstLine(undefined)).toBe("Not set");
    expect(aboutMeFirstLine("  \n")).toBe("Not set");
    expect(aboutMeFirstLine("I run an MSP")).toBe("I run an MSP");
    expect(aboutMeFirstLine("\n## Who I am\nTwo\nThree")).toBe("Who I am");

    expect(threadCleanupSummary(null, null)).toBe("Off");
    expect(threadCleanupSummary(30, 52_428_800)).toBe("Delete after 30 days · Trim at 50 MiB");

    expect(setupStep({ runtime: undefined, daemonUp: false, image: false } as never)).toBe(1);
    expect(setupStep({ runtime: "podman", daemonUp: true, image: false } as never)).toBe(3);

    expect(cardsMatching("ab")).toEqual([]);
    expect(cardsMatching("jev")).toEqual(["engines.decisionModel"]);
    expect(cardsMatching("about")).toEqual(["general.aboutMe"]);
    expect(cardsMatching("openrouter")).toEqual(["engines.moreProviders"]);
    expect(cardsMatching("live call")).toEqual(["voice.advanced"]);
    expect(cardsMatching("avatar")).toEqual(["connections.image"]);
  });

  it("French summaries come from the pack", async () => {
    const { aboutMeFirstLine } = await import("./AboutMeSettings");
    setLocale("fr");
    expect(aboutMeFirstLine("a\nb")).toBe("a");
    expect(aboutMeFirstLine("")).toBe("Non défini");
  });
});

describe("card counts", () => {
  it("uses the language's plural rule", () => {
    expect(cardCount("people", 1)).toBe("1 person");
    expect(cardCount("people", 3)).toBe("3 people");
    expect(cardCount("devices", 0)).toBe("0 devices");
    setLocale("fr");
    expect(cardCount("people", 0)).toBe("0 personne");
    expect(cardCount("people", 2)).toBe("2 personnes");
  });
});

describe("skin picker", () => {
  it("draws Grok Bot's tiles: picture, name and check, the tagline as a tooltip", async () => {
    const { SkinPicker } = await import("./SkinPicker");
    const html = renderToStaticMarkup(createElement(SkinPicker));
    expect(html).toContain("grid-cols-[repeat(auto-fill,minmax(132px,1fr))]");
    expect(html).toContain(`title="Perspicax&#x27;s own look: navy chrome, Geist and a soft glow from the top."`);
    expect(html).toContain(`aria-description="Perspicax&#x27;s own look: navy chrome, Geist and a soft glow from the top."`);
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("Settings → General, compact", () => {
  it("renders the advanced cards collapsed on General > Advanced and About me as a row to its own page", async () => {
    device();
    const { SettingsModal, GeneralAdvancedSettings } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(StoreProvider, null, createElement(SettingsModal)));
    // 2026-10-14: the technical cards are one row away, on their own page
    expect(html).toContain('data-settings-card="general.advanced" data-settings-subpage-row');
    for (const id of ["general.threadCleanup", "general.roomTurns", "general.mcpCalls"]) {
      expect(html).not.toContain(`data-settings-card="${id}"`);
    }
    const advanced = renderToStaticMarkup(createElement(StoreProvider, null, createElement(GeneralAdvancedSettings)));
    // 0.5.6: Grok-style rows under grey headings, nothing folded
    expect(advanced).toContain('data-settings-group="threadCleanup"');
    expect(advanced).toContain('data-settings-card="general.threadCleanup"');
    // 2026-10-15: each bot's own now, in its editor (bot-settings/)
    for (const id of ["general.threads", "general.recovery", "general.toolAccess"]) {
      expect(advanced).not.toContain(`data-settings-card="${id}"`);
    }
    expect(advanced).not.toContain(">3 per bot<");
    // 2026-10-15: group turns and MCP calls are cards of Organization
    for (const id of ["organization.roomTurns", "organization.mcpCalls"]) expect(advanced).not.toContain(`data-settings-card="${id}"`);
    expect(html).toContain(">Not set<");
    // About me is edited on its sub-page; General shows its first line and Edit
    expect(html).toContain('data-settings-card="general.aboutMe" data-settings-subpage-row');
    expect(html).not.toContain('id="profile-about-me"');
    // every other card on the page is the collapsible kind; the account card
    // (2026-10-15) is always open, never collapsed
    expect(html).not.toContain('data-settings-card="general.profile"');
    expect(html.match(/data-settings-card="[^"]*"(?! data-open| data-settings-subpage-row)/g)).toEqual(['data-settings-card="general.account"']);
  });
});
