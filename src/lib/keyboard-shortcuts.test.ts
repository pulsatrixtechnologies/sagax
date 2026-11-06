import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterShortcutGroups,
  SHORTCUT_GROUPS,
  shortcutGroupsFor,
  shouldOpenKeyboardShortcuts,
  shortcutKeysForPlatform,
} from "./keyboard-shortcuts";

describe("keyboard-shortcuts", () => {
  it("defines unique IDs and non-empty key lists for all shortcuts", () => {
    const ids = new Set<string>();

    for (const group of SHORTCUT_GROUPS) {
      expect(group.category.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);

      for (const item of group.items) {
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);

        expect(item.description.length).toBeGreaterThan(0);
        expect(item.macKeys.length).toBeGreaterThan(0);
        expect(item.winKeys.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolves correct keys for Mac and Windows", () => {
    const sampleItem = {
      id: "test",
      description: "Test shortcut",
      macKeys: ["⌘", "K"],
      winKeys: ["Ctrl", "K"],
    };

    expect(shortcutKeysForPlatform(sampleItem, true)).toEqual(["⌘", "K"]);
    expect(shortcutKeysForPlatform(sampleItem, false)).toEqual(["Ctrl", "K"]);
  });

  it("filters shortcut groups by search query", () => {
    const all = filterShortcutGroups(SHORTCUT_GROUPS, "");
    expect(all.length).toBe(SHORTCUT_GROUPS.length);

    const nav = filterShortcutGroups(SHORTCUT_GROUPS, "palette");
    expect(nav.length).toBe(1);
    expect(nav[0]?.items[0]?.id).toBe("command-palette");

    const byKey = filterShortcutGroups(SHORTCUT_GROUPS, "Esc", true);
    expect(byKey.some((g) => g.items.some((i) => i.id === "close-panel"))).toBe(true);

    const empty = filterShortcutGroups(SHORTCUT_GROUPS, "nonexistent-query-12345");
    expect(empty.length).toBe(0);
  });

  it("lists the Live call chords", () => {
    const items = SHORTCUT_GROUPS.flatMap((group) => group.items);
    expect(items.find((item) => item.id === "live-call-mute")).toMatchObject({ macKeys: ["⌘", "⇧", "M"], winKeys: ["Ctrl", "Shift", "M"] });
    expect(items.find((item) => item.id === "live-call-hang-up")).toMatchObject({ macKeys: ["⌘", "⇧", "H"], winKeys: ["Ctrl", "Shift", "H"] });
  });

  it("draws the send and new-line rows from the send key choice", () => {
    const row = (groups: readonly typeof SHORTCUT_GROUPS[number][], id: string) => groups.flatMap((group) => group.items).find((item) => item.id === id)!;
    expect(shortcutGroupsFor("enter")).toBe(SHORTCUT_GROUPS);
    expect(row(SHORTCUT_GROUPS, "send-message")).toMatchObject({ macKeys: ["Return"], winKeys: ["Enter"] });
    expect(row(SHORTCUT_GROUPS, "new-line")).toMatchObject({ macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] });
    const shift = shortcutGroupsFor("shift-enter");
    expect(row(shift, "send-message")).toMatchObject({ macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] });
    expect(row(shift, "new-line")).toMatchObject({ macKeys: ["Return"], winKeys: ["Enter"] });
    const mod = shortcutGroupsFor("mod-enter");
    expect(row(mod, "send-message")).toMatchObject({ macKeys: ["⌘", "Return"], winKeys: ["Ctrl", "Enter"] });
    expect(row(mod, "new-line")).toMatchObject({ macKeys: ["Return"], winKeys: ["Enter"] });
    for (const groups of [shift, mod]) {
      expect(row(groups, "save-bulletin")).toBe(row(SHORTCUT_GROUPS, "save-bulletin"));
      expect(row(groups, "send-message").description).toBe("Send message");
      expect(groups.map((group) => group.items.map((item) => item.id))).toEqual(SHORTCUT_GROUPS.map((group) => group.items.map((item) => item.id)));
    }
  });

  it("lists previous/next in handler order and excludes pointer gestures", () => {
    const items = SHORTCUT_GROUPS.flatMap((group) => group.items);
    const switchBot = items.find((item) => item.id === "switch-bot")!;
    expect(switchBot.macKeys.at(-1)).toBe("[ / ]");
    expect(switchBot.winKeys.at(-1)).toBe("[ / ]");
    expect(items.some((item) => [...item.macKeys, ...item.winKeys].includes("Double-click"))).toBe(false);
  });
});

describe("keyboard shortcut opening guard", () => {
  class Target extends EventTarget {
    constructor(readonly selector: string | null = null, readonly isContentEditable = false) { super(); }
    closest(selectors: string) { return this.selector && selectors.split(", ").includes(this.selector) ? this : null; }
  }
  const event = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
    key, target: new Target(), defaultPrevented: false, isComposing: false,
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides,
  }) as KeyboardEvent;

  beforeEach(() => vi.stubGlobal("HTMLElement", Target));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts help keys outside editing controls", () => {
    expect(shouldOpenKeyboardShortcuts(event("?", { shiftKey: true }))).toBe(true);
    expect(shouldOpenKeyboardShortcuts(event("/", { metaKey: true }))).toBe(true);
    expect(shouldOpenKeyboardShortcuts(event("/", { ctrlKey: true }))).toBe(true);
    expect(shouldOpenKeyboardShortcuts(event("/"))).toBe(false);
    expect(shouldOpenKeyboardShortcuts(event("k", { metaKey: true }))).toBe(false);
  });

  it.each(["input", "textarea", "select", "dialog", "[role=dialog]"])("does not open from %s", (selector) => {
    const target = new Target(selector);
    expect(shouldOpenKeyboardShortcuts(event("?", { target }))).toBe(false);
    expect(shouldOpenKeyboardShortcuts(event("/", { target, metaKey: true }))).toBe(false);
    expect(shouldOpenKeyboardShortcuts(event("/", { target, ctrlKey: true }))).toBe(false);
  });

  it("respects editable ancestors, composition, handled events, and extra modifiers", () => {
    for (const overrides of [
      { target: new Target(null, true) }, { isComposing: true },
      { defaultPrevented: true }, { altKey: true },
    ]) {
      expect(shouldOpenKeyboardShortcuts(event("?", overrides))).toBe(false);
      expect(shouldOpenKeyboardShortcuts(event("/", { metaKey: true, ...overrides }))).toBe(false);
    }
    expect(shouldOpenKeyboardShortcuts(event("?", { ctrlKey: true }))).toBe(false);
    expect(shouldOpenKeyboardShortcuts(event("/", { metaKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("the reference design's app-wide chords", () => {
  const press = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
    key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...overrides,
  });

  it("maps ⌘B, ⌘I, ⌘⇧F, ⌘L and ⌘⇧N on macOS, Ctrl on Windows and Linux", async () => {
    const { appShortcutFor } = await import("./keyboard-shortcuts");
    const cases = [
      ["b", false, "toggle-sidebar"],
      ["i", false, "focus-composer"],
      ["F", true, "search-everything"],
      ["l", false, "quote-selection"],
      ["N", true, "new-group"],
    ] as const;
    for (const [key, shiftKey, expected] of cases) {
      expect(appShortcutFor(press(key, { metaKey: true, shiftKey }), true)).toBe(expected);
      expect(appShortcutFor(press(key, { ctrlKey: true, shiftKey }), false)).toBe(expected);
      // the other platform's modifier is not the chord
      expect(appShortcutFor(press(key, { ctrlKey: true, shiftKey }), true)).toBeNull();
      expect(appShortcutFor(press(key, { metaKey: true, shiftKey }), false)).toBeNull();
    }
  });

  it("leaves the existing chords and everything else alone", async () => {
    const { appShortcutFor } = await import("./keyboard-shortcuts");
    // ⌘F finds in the conversation, ⌘N opens the compose picker, ⌘K the palette
    for (const key of ["f", "n", "k", "d", "1", "/"]) expect(appShortcutFor(press(key, { metaKey: true }), true)).toBeNull();
    // the shifted twins of the new unshifted chords are free
    for (const key of ["B", "I", "L"]) expect(appShortcutFor(press(key, { metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(appShortcutFor(press("b"), true)).toBeNull();
    expect(appShortcutFor(press("b", { metaKey: true, altKey: true }), true)).toBeNull();
    expect(appShortcutFor(press("b", { metaKey: true, ctrlKey: true }), true)).toBeNull();
    expect(appShortcutFor(press("b", { metaKey: true, isComposing: true }), true)).toBeNull();
    expect(appShortcutFor(press("b", { metaKey: true, defaultPrevented: true }), true)).toBeNull();
  });

  it("lists every new chord on the cheat sheet, with no two rows on the same keys", () => {
    const items = SHORTCUT_GROUPS.flatMap((group) => group.items);
    const keysOf = (id: string) => items.find((item) => item.id === id)?.macKeys;
    expect(keysOf("toggle-sidebar")).toEqual(["⌘", "B"]);
    expect(keysOf("focus-composer")).toEqual(["⌘", "I"]);
    expect(keysOf("search-everything")).toEqual(["⌘", "⇧", "F"]);
    expect(keysOf("quote-selection")).toEqual(["⌘", "L"]);
    expect(keysOf("new-group")).toEqual(["⌘", "⇧", "N"]);
    for (const platform of ["macKeys", "winKeys"] as const) {
      const chords = items.map((item) => item[platform].join("+"));
      expect(new Set(chords).size).toBe(chords.length);
    }
  });

  it("has a string for every row and group, in the keys the shortcuts window reads", async () => {
    const { en } = await import("@/locales");
    for (const group of SHORTCUT_GROUPS) {
      expect(Object.values(en)).toContain(group.category);
      for (const item of group.items) expect(item.description.startsWith("shortcuts.")).toBe(false);
    }
  });

  it("speaks the interface language", async () => {
    const { setLocale } = await import("./i18n");
    try {
      setLocale("fr");
      const items = SHORTCUT_GROUPS.flatMap((group) => group.items);
      expect(items.find((item) => item.id === "toggle-sidebar")?.description).toBe("Replier ou déplier la barre latérale");
      expect(SHORTCUT_GROUPS[0].category).toBe("Navigation");
      expect(SHORTCUT_GROUPS[1].category).toBe("Conversation et saisie");
      setLocale("en");
      expect(items.find((item) => item.id === "toggle-sidebar")?.description).toBe("Collapse or expand the sidebar");
      expect(SHORTCUT_GROUPS[1].category).toBe("Chat & Composer");
    } finally {
      setLocale("en");
    }
  });

  it("is wired where the action lives: the shell, the selection toolbar, and ⌘F leaves ⌘⇧F to search", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const shell = [
      read("../App.tsx"),
      read("../App.tsx-parts/useShellNavigation.ts"),
      read("../App.tsx-parts/ShellLayout.tsx"),
      read("../App.tsx-parts/useShellEffects.ts"),
    ].join("\n");
    expect(shell).toMatch(/chord === "toggle-sidebar"\) \{\s*e\.preventDefault\(\);\s*toggleSidebarCollapsed\(\);/);
    expect(shell).toMatch(/chord === "focus-composer"\) \{\s*if \(focusComposer\(\)\) e\.preventDefault\(\);/);
    expect(shell).toMatch(/chord === "search-everything"\) \{\s*e\.preventDefault\(\);\s*openCommandPalette\(\);/);
    expect(shell).toMatch(/chord === "new-group"\) \{\s*e\.preventDefault\(\);\s*setComposeGroup\(true\);\s*setComposeOpen\(true\);/);
    expect(shell).toContain('<ComposeToPicker key={composeGroup ? "group" : "browse"} startInGroup={composeGroup}');
    expect(read("../components/ComposeToPicker.tsx")).toContain('useState<ComposeMode>(startInGroup ? "group" : "browse")');
    expect(read("../components/CitationUI.tsx")).toMatch(/appShortcutFor\(event\) === "quote-selection"\) \{[\s\S]*?addRef\.current\(captured\.citation\);/);
    const chatFind = [
      read("../components/ChatView.tsx"),
      read("../components/ChatView.tsx-parts/useChatViewSession.ts"),
    ].join("\n");
    expect(chatFind).toContain('(event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f")');
    expect(read("../components/GroupView.tsx")).toContain('(event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f")');

  });
});

describe("focusComposer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the caret at the end of the composer's text, and says when there is none", async () => {
    const { focusComposer, COMPOSER_INPUT_SELECTOR } = await import("./composer-focus");
    const input = { value: "hello", disabled: false, focus: vi.fn(), setSelectionRange: vi.fn() };
    const querySelector = vi.fn(() => input);
    vi.stubGlobal("document", { querySelector });
    expect(focusComposer()).toBe(true);
    expect(querySelector).toHaveBeenCalledWith(COMPOSER_INPUT_SELECTOR);
    expect(input.focus).toHaveBeenCalled();
    expect(input.setSelectionRange).toHaveBeenCalledWith(5, 5);
    vi.stubGlobal("document", { querySelector: () => null });
    expect(focusComposer()).toBe(false);
  });
});
