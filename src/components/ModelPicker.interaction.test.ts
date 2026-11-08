import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";
import type { ComposerModelMenuControl } from "./ModelPicker";

// Opens the real picker and clicks through it without a DOM: useState is
// held here by call order (the picker's own hooks run first, children after),
// effects never run, and handlers are read off the returned element tree.
// The headless renderer check in docs/verification/bot-continuity.md covers
// the same flows in a browser.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  // localStorage: the favorites (src/lib/model-favorites.ts) a case sets
  const storage: Record<string, string> = {};
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage[key] ?? null, setItem: () => {} });
  return {
    storage,
    values: [] as unknown[],
    index: 0,
    own: 0,
    instances: [] as InstanceInfo[],
    dispatch: (() => {}) as (...args: unknown[]) => void,
    refreshInstances: (() => Promise.resolve()) as () => Promise<void>,
    refreshModels: ((_id: string) => Promise.resolve()) as (instanceId: string) => Promise<void>,
    // An organization server (Perspicax): null on a solo server.
    org: null as unknown,
    myEngines: null as unknown,
    bots: [] as unknown[],
    // state.config: an organization server's allowed model providers ride on it
    config: null as unknown,
    showUnready: false,
    autoStatus: null as import("../../shared/auto-model").AutoModelPreview | null,
    api: (async () => ({})) as (path: string, init?: RequestInit) => Promise<unknown>,
  };
});
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => fixture.org,
  useMyEngines: () => fixture.myEngines,
  reloadMyEngines: () => Promise.resolve(fixture.myEngines),
}));
vi.mock("@/lib/auto-model-preview", () => ({ useAutoModelStatus: () => fixture.autoStatus }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
// The key removal's confirmation portals to <body>; drawn in place here.
vi.mock("./ConfirmDialog", async () => {
  const { createElement } = await import("react");
  return {
    ConfirmDialog: (props: { open: boolean; title: string; body: string; confirmLabel: string }) => props.open
      ? createElement("div", { role: "alertdialog", "data-confirm": "" }, props.title, " ", props.body, " ", props.confirmLabel)
      : null,
  };
});
// Menu animation has its own lifecycle checks; this hook fixture does not
// emulate React's render-time state retries.
vi.mock("./MenuMotion", () => ({ useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: (path: string, init?: RequestInit) => fixture.api(path, init),
  useStore: () => ({
    state: { instances: fixture.instances, bots: fixture.bots, modelVariantSessions: {}, config: fixture.config },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}));

// These cases cover the full picker; Simple mode has its own file.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { ModelPicker } = await import("./ModelPicker");
const { ModelSearchList } = await import("./ModelMenu");
const indicatorModule = await import("./LimitResetContinue");
const { ModelMenuSettings } = await import("./ModelMenuSettings");
type ModelMenuSettingsProps = import("./ModelMenuSettings").ModelMenuSettingsProps;
type MenuRow = import("@/lib/model-menu").ModelMenuRow;
type MenuSection = import("@/lib/model-menu").ModelMenuSection;

afterAll(() => vi.unstubAllGlobals());

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    // #2228: the picker's shell and menu became function components of their
    // own (hook-free); expand them so their output is searched like the rest.
    if (typeof node.type === "function" && ["ModelPickerShell", "ModelPickerMenu"].includes(node.type.name)) {
      return nodes((node.type as (props: unknown) => ReactNode)(node.props));
    }
    // #2181: the menu footer (Effort, Provider) is passed as `after` and drawn
    // outside the scrolling list.
    return [node, ...nodes(node.props.children), ...nodes(node.props.after as ReactNode), ...nodes(node.props.autoPanel as ReactNode), ...nodes(node.props.trigger as ReactNode)];
  });
}

const official = [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5", label: "Sonnet 5" }];
const qwen = { id: "ollama::qwen3", label: "qwen3 (Ollama)", custom: true };
const claudeInstall = {
  command: { darwin: "npm install -g @anthropic-ai/claude-code", linux: "npm install -g @anthropic-ai/claude-code", win32: "npm install -g @anthropic-ai/claude-code" },
  signInCommand: "claude",
};
const claude = (snapshot: InstanceInfo["snapshot"], options: InstanceInfo["models"]["options"] = official): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot,
  models: { default: "claude-opus-5-5", options }, install: claudeInstall,
  authentication: { method: "paste-code", signOut: true },
  capabilities: { withholdsHostTools: true },
});
const signedOut = () => claude({ state: "available", version: "2.1.300", authenticated: false });
const signedIn = () => claude({ state: "available", version: "2.1.300", authenticated: true });
const notFound = () => claude({ state: "unavailable", reason: "`claude` CLI not found" });
const codex: InstanceInfo = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
  snapshot: { state: "available", version: "1.0.0", authenticated: true },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
  capabilities: { withholdsHostTools: true },
};

function bot(instanceId: string, model: string): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
    color: "green", unread: false, modelSelection: { instanceId, model }, messages: [],
  };
}

type RenderOptions = { contained?: boolean; threadId?: string; label?: string; inComposer?: boolean; windowOnly?: boolean; onWindowClose?: () => void;
  headless?: boolean; menuControl?: { current: ComposerModelMenuControl | null } };

/** Render the picker once; the picker's own state survives, children start fresh. */
function render(forBot: Bot, options?: RenderOptions) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({
      bot: forBot,
      threadId: options && "threadId" in options ? options.threadId : forBot.threadId,
      contained: options?.contained,
      label: options?.label,
      inComposer: options?.inComposer,
      windowOnly: options?.windowOnly,
      onWindowClose: options?.onWindowClose,
      headless: options?.headless,
      menuControl: options?.menuControl,
    });
    fixture.own = fixture.index;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

function open(forBot: Bot, options?: RenderOptions) {
  const trigger = render(forBot, options).nodes.find((node) => node.props["data-tour"] === "model")!;
  (trigger.props.onClick as () => void)();
  return render(forBot, options);
}

/** The window's model list is always open: opening the window is enough. */
const openMenu = open;

/** The model lists drawn (the window's, the composer menu's). */
const lists = (rendered: ReturnType<typeof render>) =>
  rendered.nodes.filter((node) => node.type === ModelSearchList) as unknown as ReactElement<{ sections: MenuSection[]; onPick: (row: MenuRow) => void; variant: string }>[];

/** A row of a model list, by model id (or "auto", "follow"), with a way to
 * pick it; undefined (typed as found, like a lookup the test asserts) when
 * no list draws it. */
function row(rendered: ReturnType<typeof render>, id: string): { props: MenuRow & { onPick: () => void } } {
  for (const list of lists(rendered)) {
    for (const section of list.props.sections) {
      const found = section.rows.find((candidate) => (candidate.kind === "model" ? candidate.modelId : candidate.key) === id);
      if (found) return { props: { ...found, onPick: () => list.props.onPick(found) } };
    }
  }
  return undefined as unknown as { props: MenuRow & { onPick: () => void } };
}

/** The composer menu's settings of the model in use. */
function settings(rendered: ReturnType<typeof render>) {
  return rendered.nodes.find((node) => node.type === ModelMenuSettings) as unknown as ReactElement<ModelMenuSettingsProps> | undefined;
}

function listed(rendered: ReturnType<typeof render>) {
  return lists(rendered).flatMap((list) => list.props.sections).filter((section) => section.rows.some((row) => row.kind === "model")).map((section) => section.key);
}

/** The open menu only; the trigger always names the saved model. */
const menu = (html: string) => {
  const at = html.indexOf("data-model-menu");
  return at < 0 ? "" : html.slice(at);
};

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.own = 0;
  fixture.dispatch = vi.fn();
  fixture.refreshInstances = vi.fn(() => Promise.resolve());
  fixture.refreshModels = vi.fn(() => Promise.resolve());
  fixture.org = null;
  fixture.myEngines = null;
  fixture.bots = [];
  fixture.config = null;
  fixture.showUnready = false;
  fixture.autoStatus = null;
  fixture.api = vi.fn(async () => ({}));
});
afterEach(() => vi.useRealTimers());

describe("the picker opens as a menu (lot 7)", () => {

  it("opens the model menu from the chip, with no modal window", () => {
    fixture.instances = [signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = open(onClaude);
    expect(opened.html).toContain("data-model-menu");
    expect(opened.html).not.toContain("data-model-picker-content");
    expect(opened.html).not.toContain("data-model-picker-backdrop");
    expect(lists(opened)[0]!.props.variant).toBe("popover");
  });
});

describe("the Grok list", () => {
  // The server builds it from the engine's own answer (server/drivers/acp/grok.ts
  // probeGrokModels), and opening the picker in solo re-reads it.
  const grok: InstanceInfo = {
    instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
    snapshot: { state: "available", version: "1.0.50", authenticated: true },
    models: { default: "grok-4.7", options: [
      { id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast" },
      { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true },
    ] },
    capabilities: { withholdsHostTools: true },
  };

  it("shows what the engine offers, nothing it does not, and a local row Grok can run", () => {
    fixture.instances = [grok];
    const opened = openMenu(bot("grok", "grok-4.7"));
    const html = menu(opened.html);
    // Fast twin folds into Grok 4.7 with the Fast switch (menu settings).
    expect(html).toContain(">Grok 4.7<");
    expect(html).toContain("data-model-settings-fast");
    expect(row(opened, "grok-4.7-build-fast")).toBeUndefined();
    expect(html).not.toContain("Grok 4.5");
    expect(html).not.toContain("Grok 4.6");
    expect(html).toContain("DwarfStar: Qwen3.8 Flash Next");
    expect(html).not.toContain("data-model-unavailable");
  });
});

describe("ModelPicker Auto (docs/plans/2026-10-08-auto-model.md)", () => {
  const onAuto = () => ({ ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true as const } });

  it("pins a model again when one is chosen", () => {
    fixture.instances = [signedIn()];
    const opened = openMenu(onAuto());
    row(opened, "claude-opus-5-5")!.props.onPick();
    const call = (fixture.dispatch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { selection: Record<string, unknown> };
    expect(call.selection).toEqual({ instanceId: "claude", model: "claude-opus-5-5" });
  });

  it("shows plain Auto before any pick is known", () => {
    fixture.instances = [signedIn()];
    const html = render(onAuto()).html;
    expect(html).toContain(">Auto<");
    expect(html).not.toContain(">Sonnet 5<");
  });

  it("#2902/#0867: the limit indicator follows the engine Auto resolved to, not the saved one", () => {
    const { EngineLimitIndicator } = indicatorModule;
    const limitEngine = (rendered: ReturnType<typeof render>) =>
      (rendered.nodes.find((node) => node.type === EngineLimitIndicator)?.props.engine as string | undefined);
    fixture.instances = [signedIn(), codex];
    // Auto picked a Codex model for this thread: the dot reads Codex's limits.
    fixture.autoStatus = {
      auto: true, chain: [], excluded: [], backups: [],
      pick: { instanceId: "codex", model: "gpt-5.6", engineLabel: "Codex", modelLabel: "GPT-5.6", role: "orchestration", tier: "standard", reason: "default" } as never,
    };
    expect(limitEngine(render(onAuto()))).toBe("codex");
    // Before any pick is known it reads the saved engine.
    fixture.autoStatus = null;
    expect(limitEngine(render(onAuto()))).toBe("claude");
    // Pinned (Auto off): the saved engine, whatever Auto would pick.
    fixture.autoStatus = { auto: false, pick: null, chain: [], excluded: [], backups: [] };
    expect(limitEngine(render(bot("claude", "claude-opus-5-5")))).toBe("claude");
  });

});

describe("one mode (2026-10-09)", () => {
  it("makes a model chosen in a thread the thread's and the bot's in one request", () => {
    fixture.instances = [signedIn()];
    const opened = openMenu(bot("claude", "claude-opus-5-5"));
    row(opened, "claude-sonnet-5")!.props.onPick();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5" },
    });
  });

  it("returns every thread to the bot's model silently", () => {
    fixture.instances = [signedIn()];
    const profile = { ...bot("claude", "claude-opus-5-5"), tasks: [{ threadId: "thread-atlas", title: "t", createdAt: 1, followsBotModel: false, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }] };
    fixture.bots = [profile];
    const opened = open({ ...profile, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    const follow = row(opened, "follow")!;
    expect(follow.props).toMatchObject({ label: "Use Atlas's model", detail: "Opus 5.5", current: false });
    // The thread's own model is the checked row.
    expect(row(opened, "claude-sonnet-5")!.props.current).toBe(true);
    follow.props.onPick();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "claude", model: "claude-opus-5-5" },
    });
  });

  it("checks only the bot's model row while the thread follows it", () => {
    fixture.instances = [signedIn()];
    const profile = { ...bot("claude", "claude-opus-5-5"), tasks: [{ threadId: "thread-atlas", title: "t", createdAt: 1, followsBotModel: true }] };
    fixture.bots = [profile];
    const opened = open(profile);
    expect(row(opened, "follow")!.props.current).toBe(true);
    expect(row(opened, "claude-opus-5-5")!.props.current).toBe(false);
  });
});

describe("the model list in the window", () => {

  it("names the effort a pick keeps beside each model of the same engine", () => {
    fixture.instances = [{ ...signedIn(), capabilities: { withholdsHostTools: true, effortLevels: ["low", "high"] } }, codex];
    const forBot = { ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", effort: "high" as const } };
    const opened = open(forBot);
    expect(row(opened, "claude-opus-5-5")!.props.detail).toBe("High");
    expect(row(opened, "claude-sonnet-5")!.props.detail).toBe("High");
  });
});

describe("the composer's model menu (2026-10-12)", () => {
  const composer = { inComposer: true };

  // Owner, 2026-10-18: no chip; the + menu's Model row opens the same menu
  it("headless: draws no chip, carries the label, opens from the + menu's row and calls back on a pick", () => {
    fixture.instances = [codex, signedIn()];
    const forBot = bot("claude", "claude-opus-5-5");
    const menuControl: { current: ComposerModelMenuControl | null } = { current: null };
    const options = { inComposer: true, headless: true, menuControl };
    const shown = render(forBot, options);
    expect(shown.nodes.some((node) => node.props["data-tour"] === "model")).toBe(false);
    expect(shown.html).toMatch(/<span hidden="" data-composer-model="[^"]+"><\/span>/);
    expect(shown.html).not.toContain("data-model-menu");
    const done = vi.fn();
    menuControl.current!.toggle(null, done);
    const opened = render(forBot, options);
    expect(opened.html).toContain("data-model-menu");
    expect(lists(opened)[0]!.props.variant).toBe("popover");
    row(opened, "auto").props.onPick();
    expect(done).toHaveBeenCalledTimes(1);
    expect(render(forBot, options).html).not.toContain("data-model-menu");
  });

  it("opens a menu, not the window, with the search, Auto, the bot's engine first and Providers", () => {
    fixture.instances = [codex, signedIn()];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot, composer);
    expect(opened.html).toContain("data-model-menu");
    expect(opened.html).not.toContain("data-model-picker-content");
    const list = lists(opened)[0]!;
    expect(list.props.variant).toBe("popover");
    expect(list.props.sections.map((section) => section.label ?? section.key)).toEqual(["top", "Claude", "OpenAI"]);
    // Auto first (a thread that follows its bot adds the bot's model below it).
    expect(list.props.sections[0]!.rows.map((candidate) => candidate.key)).toEqual(["auto"]);
    expect(opened.html).toContain('placeholder="Search models"');
    expect(opened.html).toContain("data-model-edit");
    expect(opened.html).toContain(">Providers<");
  });

  // Owner, 2026-10-14: too many models shown. The root lists the providers,
  // each opening its models in a submenu, and the stars.

  // Owner, 2026-10-14: hide the models that do not work (src/lib/model-health.ts).
  describe("only the models that work", () => {
    const gemini = (authenticated: boolean): InstanceInfo => ({
      instanceId: "gemini", driverKind: "geminiAgent", displayName: "Gemini", access: "api",
      snapshot: { state: "available", authenticated },
      models: { default: "gemini-pro", options: [{ id: "gemini-pro", label: "Gemini Pro" }, { id: "dwarfstar::qwen", label: "DwarfStar: Qwen", custom: true, local: true }] },
    });
    const sectionKeys = (opened: ReturnType<typeof render>) => lists(opened)[0]!.props.sections.map((section) => section.key);
    const rowIds = (opened: ReturnType<typeof render>, key: string) =>
      lists(opened)[0]!.props.sections.find((section) => section.key === key)?.rows.map((candidate) => candidate.modelId);

    it("hides a model its engine cannot run, which the window still shows greyed", () => {
      fixture.instances = [signedIn(), gemini(true)];
      const opened = open(bot("claude", "claude-opus-5-5"), composer);
      expect(rowIds(opened, "gemini")).toEqual(["gemini-pro"]);
    });

    it("drops a provider with no model that works", () => {
      fixture.instances = [signedIn(), gemini(false)];
      const opened = open(bot("claude", "claude-opus-5-5"), composer);
      expect(sectionKeys(opened)).toEqual(["top", "claude"]);
      expect(opened.html).not.toContain('data-model-provider="gemini"');
    });

    it("keeps the model in use, checked, saying it does not respond", () => {
      fixture.instances = [signedOut(), codex];
      const opened = open(bot("claude", "claude-opus-5-5"), composer);
      const claudeRows = lists(opened)[0]!.props.sections.find((section) => section.key === "claude")!.rows;
      expect(claudeRows.map((candidate) => candidate.modelId)).toEqual(["claude-opus-5-5"]);
      expect(claudeRows[0]).toMatchObject({ current: true, warning: "Not responding" });
      // the root shows it with its warning
      expect(opened.html).toContain("data-model-row-warning");
      expect(opened.html).toContain("Not responding");
      // a working one has no warning
      fixture.values = [];
      const working = lists(open(bot("codex", "gpt-5.6"), composer))[0]!.props.sections.find((section) => section.key === "codex")!.rows;
      expect(working[0]!.warning).toBeUndefined();
    });

    it("keeps the model in use of an engine that is not installed any more", () => {
      fixture.instances = [notFound(), codex];
      const opened = open(bot("claude", "claude-opus-5-5"), composer);
      expect(rowIds(opened, "claude")).toEqual(["claude-opus-5-5"]);
      expect(sectionKeys(opened)).toEqual(["top", "claude", "codex"]);
    });
  });

  it("applies a pick at once and closes", () => {
    fixture.instances = [codex, signedIn()];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot, composer);
    row(opened, "gpt-5.6")!.props.onPick();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "codex", model: "gpt-5.6" },
    });
    expect(render(forBot, composer).html).not.toContain("data-model-menu");
  });

  it("opens Providers from the menu footer and closes the menu", () => {
    fixture.instances = [signedIn()];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot, composer);
    const edit = opened.nodes.find((node) => node.props["data-model-edit"] !== undefined)!;
    (edit.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "providers" });
    expect(render(forBot, composer).html).not.toContain("data-model-menu");
  });

  // Owner, 2026-10-14: no Model › (the provider submenus list the same models)
  // and no Context line.
  it("carries the model's settings below the list, its effort as Effort ›, without Model › or Context, Advanced only", () => {
    fixture.instances = [{ ...signedIn(), capabilities: { withholdsHostTools: true, effortLevels: ["low", "high", "ultracode"] } }];
    const opened = open(bot("claude", "claude-opus-5-5"), composer);
    expect(opened.html).toContain("data-model-settings-effort");
    expect(opened.html).not.toContain("data-model-settings-model");
    expect(opened.html).not.toContain("data-model-settings-context");
    expect(settings(opened)!.props.effort!.levels).toEqual(["low", "high", "ultracode"]);
  });

  // Owner, 2026-10-13: the Effort list offered levels the model does not take.
  const grokEngine = (): InstanceInfo => ({
    instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
    snapshot: { state: "available", authenticated: true },
    models: { default: "grok-4.7", options: [
      { id: "grok-4.7", label: "Grok 4.7", contextWindow: 256_000, effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
      { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast", contextWindow: 256_000, effortLevels: ["low", "medium", "high", "xhigh"], defaultEffort: "high" },
      { id: "grok-4.5", label: "Grok 4.5", effortLevels: ["low", "medium", "high"], defaultEffort: "high" },
      { id: "dwarfstar::qwen", label: "DwarfStar: Qwen", custom: true, local: true, effortLevels: [] },
    ] },
    capabilities: { withholdsHostTools: true, effortLevels: ["low", "medium", "high", "xhigh"] },
  });
  const withEffort = (forBot: Bot, effort: Bot["modelSelection"]["effort"]): Bot => ({ ...forBot, modelSelection: { ...forBot.modelSelection, effort } });

  it("offers each model only the levels it takes, Default naming the model's own", () => {
    fixture.instances = [grokEngine()];
    expect(settings(open(bot("grok", "grok-4.7"), composer))!.props.effort).toMatchObject({ levels: ["low", "medium", "high", "xhigh"], modelDefault: "high" });
    fixture.values = [];
    expect(settings(open(bot("grok", "grok-4.5"), composer))!.props.effort!.levels).toEqual(["low", "medium", "high"]);
    fixture.values = [];
    // a model with no effort control gets no Effort row at all
    const local = open(bot("grok", "dwarfstar::qwen"), composer);
    expect(settings(local)!.props.effort).toBeUndefined();
    expect(local.html).not.toContain("data-model-settings-effort");
  });

  it("resets the effort to the new model's default when it does not take the old one, and keeps it when it does", () => {
    fixture.instances = [grokEngine()];
    row(open(withEffort(bot("grok", "grok-4.7"), "xhigh"), composer), "grok-4.5")!.props.onPick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { instanceId: "grok", model: "grok-4.5" } }));
    fixture.values = [];
    row(open(withEffort(bot("grok", "grok-4.7"), "medium"), composer), "grok-4.5")!.props.onPick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { instanceId: "grok", model: "grok-4.5", effort: "medium" } }));
  });

  it("reads each row with the effort a pick would run, the stored one or the model's default", () => {
    fixture.instances = [grokEngine()];
    const opened = open(withEffort(bot("grok", "grok-4.7"), "xhigh"), composer);
    expect(row(opened, "grok-4.7")!.props.detail).toBe("X-High");
    expect(row(opened, "grok-4.5")!.props.detail).toBe("High");
    expect(row(opened, "grok-4.5")!.props.title).toContain("Grok 4.5");
  });

  it("folds the fast twin into its model's row and switches it with Fast", () => {
    fixture.instances = [grokEngine()];
    const opened = open(bot("grok", "grok-4.7-build-fast"), composer);
    expect(row(opened, "grok-4.7")).toBeUndefined();
    const folded = row(opened, "grok-4.7-build-fast")!.props;
    expect(folded.label).toBe("Grok 4.7");
    expect(folded.detail).toBe("High Fast");
    expect(folded.current).toBe(true);
    const panel = settings(opened)!.props;
    expect(panel.fast!.on).toBe(true);
    panel.fast!.onToggle();
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { instanceId: "grok", model: "grok-4.7" } }));
    // the menu stays open on a switch
    expect(render(bot("grok", "grok-4.7-build-fast"), composer).html).toContain("data-model-menu");
    fixture.values = [];
    expect(settings(open(bot("grok", "grok-4.5"), composer))!.props.fast).toBeUndefined();
  });

  it("sets the effort from Effort › for this thread and the bot", () => {
    fixture.instances = [grokEngine()];
    const forBot = bot("grok", "grok-4.5");
    settings(open(forBot, composer))!.props.effort!.onPick("low");
    expect(fixture.dispatch).toHaveBeenLastCalledWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "grok", model: "grok-4.5", effort: "low" },
    });
  });

  it("leaves out an engine to install, and on an organization server one nothing pays for yet unless it is the bot's", () => {
    fixture.org = { org: { name: "Example", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    const grok: InstanceInfo = {
      instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
      snapshot: { state: "available", authenticated: true },
      models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }] },
      capabilities: { withholdsHostTools: true },
    };
    const facts = (instanceId: string, myTurns: string) => ({ instanceId, driver: "x", displayName: instanceId, installed: true,
      subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns });
    fixture.myEngines = [facts("claude", "none"), facts("codex", "org-key"), facts("grok", "none")];
    fixture.instances = [signedIn(), codex, grok];
    const opened = open(bot("claude", "claude-opus-5-5"), composer);
    expect(lists(opened)[0]!.props.sections.map((section) => section.key)).toEqual(["top", "claude", "codex"]);
  });
});

describe("the model menu from the sidebar (windowOnly)", () => {
  it("opens with no chip and tells its host when it closes", () => {
    fixture.instances = [signedIn()];
    const closed = vi.fn();
    const shown = render(bot("claude", "claude-opus-5-5"), { windowOnly: true, onWindowClose: closed, threadId: undefined });
    expect(shown.html).toContain("data-model-menu");
    expect(shown.html).not.toContain("data-model-picker-content");
    expect(shown.nodes.some((node) => node.props["data-tour"] === "model")).toBe(false);
    // Escape on the search list closes and notifies the host.
    const list = lists(shown)[0]!;
    (list.props as { onEscape?: () => void }).onEscape?.();
    expect(closed).toHaveBeenCalledOnce();
  });

  // Refs #1979: CSS bottom: innerHeight - 96 put the menu above the window.
  it("pins the open-alone menu by its top inside the viewport", () => {
    fixture.instances = [signedIn()];
    const shown = render(bot("claude", "claude-opus-5-5"), { windowOnly: true, threadId: undefined });
    const menu = shown.nodes.find((node) => "data-model-menu" in node.props)!;
    const style = menu.props.style as { top?: number; bottom?: number; left?: number; maxHeight?: number };
    expect(style).toMatchObject({ left: 24, top: 96 });
    expect(style.bottom).toBeUndefined();
    expect(style.maxHeight).toBeGreaterThan(0);
  });
});

describe("Connected is said once", () => {

  it("has no status badge in the header on a solo server either", () => {
    fixture.instances = [signedIn()];
    expect(menu(open(bot("claude", "claude-opus-5-5")).html)).not.toContain("data-model-status");
  });
});

describe("the organization's allowed model providers", () => {
  const orgFixture = { org: { name: "Example", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
  const mine = (instanceId: string, driver: string, signedIn: boolean) => ({
    instanceId, driver, displayName: instanceId, installed: true,
    subscription: { supported: true, signedIn }, myKey: false, orgKey: true, myTurns: signedIn ? "subscription" : "org-key",
  });
  it("2026-10-17: an empty list allows no provider the organization pays for (Perspicax saves none as [])", () => {
    fixture.instances = [signedIn(), codex];
    fixture.org = orgFixture;
    fixture.myEngines = [mine("claude", "claudeAgent", false), mine("codex", "codex", false)];
    fixture.values = [];
    fixture.config = { allowedEngines: [] };
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(listed(opened)).toEqual([]);
    expect(row(opened, "claude-opus-5-5")).toBeUndefined();
  });

  // 2026-10-18 (owner): "hidden from the Perspicax menu, still visible in a lot
  // of menus": a provider the admin hid is listed nowhere while the
  // organization's key is what runs it. 2026-10-27 (#1098, #1282): the one
  // the person pays for with their own subscription or key stays theirs.

});

// Lot 4 replaces the provider rail, its connection cards and footer with one
// Providers link. Credential persistence/sign-in flows are covered on that page.
describe("the flat model picker", () => {
  const org = { org: { name: "Example", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
  const mine = (instanceId: string, myTurns = "org-key") => ({ instanceId, driver: instanceId, displayName: instanceId, installed: true,
    subscription: { supported: true, signedIn: myTurns === "subscription" }, myKey: myTurns === "key", orgKey: myTurns === "org-key", myTurns });
  const ready = () => { fixture.instances = [signedIn(), codex]; };

  it("shows all ready providers at once, without a rail or nested provider menus", () => {
    ready();
    for (const inComposer of [false, true]) {
      fixture.values = [];
      const opened = open(bot("claude", "claude-opus-5-5"), { inComposer });
      expect(row(opened, "claude-opus-5-5")).toBeDefined();
      expect(row(opened, "gpt-5.6")).toBeDefined();
      for (const list of lists(opened)) {
        expect((list.props as { submenus?: boolean }).submenus).not.toBe(true);
      }
      expect(opened.html).not.toContain("data-model-provider-column");
      expect(opened.html).not.toContain("data-model-all");
    }
  });

  it("opens Providers from its single link and closes the picker", () => {
    ready();
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot);
    const links = opened.nodes.filter((node) => node.props["data-model-edit"] !== undefined);
    expect(links).toHaveLength(1);
    expect(opened.html).not.toContain("data-model-add-api-keys");
    expect(opened.html).not.toContain("data-engine-keys-link");
    (links[0]!.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "providers" });
    expect(render(forBot).html).not.toContain("data-model-menu");
  });

  it.each([signedOut, notFound])("keeps setup reachable through Providers while offering ready models only (%#)", (unready) => {
    fixture.instances = [unready(), codex];
    const opened = open(bot("claude", "claude-opus-5-5"));
    // Menu keeps the model in use with a warning; Providers is how setup stays reachable.
    expect(row(opened, "claude-opus-5-5")?.props).toMatchObject({ current: true, warning: "Not responding" });
    expect(row(opened, "gpt-5.6")).toBeDefined();
    expect(opened.html).toContain("data-model-edit");
    expect(opened.html).not.toContain("data-claude-sign-in");
    expect(opened.html).not.toContain("data-rail-row-action");
  });

  it("keeps scope silent and closes from Escape on the menu", () => {
    ready();
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot);
    expect(opened.html).toContain('role="dialog"');
    expect(opened.html).toContain("data-model-menu");
    expect(opened.html).not.toContain("data-model-scope");
    expect(opened.html).not.toContain("Switch it too");
    (lists(opened)[0]!.props as { onEscape?: () => void }).onEscape?.();
    expect(render(forBot).html).not.toContain("data-model-menu");
  });

  it("changes the bot and all its threads through the same action, from either list", () => {
    ready();
    for (const inComposer of [false, true]) {
      fixture.values = [];
      row(open(bot("claude", "claude-opus-5-5"), { inComposer }), "gpt-5.6").props.onPick();
      expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true, selection: { instanceId: "codex", model: "gpt-5.6" } });
    }
  });

  it("lists ready models without guessing a payer in the menu", () => {
    ready();fixture.org = org;fixture.myEngines = [mine("claude"), mine("codex", "subscription")];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot);
    expect(row(opened, "claude-opus-5-5")).toBeDefined();
    expect(row(opened, "gpt-5.6")).toBeDefined();
    // Payer copy lives in Settings; the menu stays a choice list.
    expect(opened.html).not.toContain("Who pays is confirmed when the turn starts");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("keeps a signed-out engine's working local model and the model in use, without an embedded connection form", () => {
    fixture.instances = [claude({ state: "available", authenticated: false }, [...official, qwen])];
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(row(opened, qwen.id)).toBeDefined();
    expect(row(opened, "claude-opus-5-5")?.props).toMatchObject({ current: true, warning: "Not responding" });
    expect(opened.html).not.toContain("data-claude-sign-in");
  });

  it("keeps a local model through an engine that can run it, with no unavailable alternative", () => {
    const local = { id: "deskab12cd8002::qwen3", label: "Local Qwen", custom: true, local: true };
    fixture.org = org;fixture.myEngines = [mine("claude"), mine("codex")];
    fixture.instances = [{ ...signedIn(), models: { default: official[0]!.id, options: [...official, local] } },
      { ...codex, models: { ...codex.models, options: [...codex.models.options, local] } }];
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(row(opened, local.id).props.instanceId).toBe("codex");
    expect(row(opened, local.id).props.unavailable).toBeFalsy();
    row(opened, local.id).props.onPick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ selection: { instanceId: "codex", model: local.id } }));
  });

  it("allows Claude's desktop model when its server speaks Anthropic and hides an unsupported one", () => {
    fixture.org = org;fixture.myEngines = [mine("claude")];
    const supported = { id: "deskab12cd8002::qwen", label: "Local Qwen", custom: true, local: true, anthropic: true };
    const unsupported = { id: "deskab12cd9337::gguf", label: "Other local", custom: true, local: true };
    fixture.instances = [claude({ state: "available", authenticated: true }, [...official, supported, unsupported])];
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(row(opened, supported.id)).toBeDefined();expect(row(opened, unsupported.id)).toBeUndefined();
    expect(opened.html).not.toContain("data-model-unavailable");
  });

  it("offers a compatible server's own manual models in an organization", () => {
    fixture.org = org;
    const endpoint: InstanceInfo = { ...codex, instanceId: "compat-lab", displayName: "My endpoint", driverKind: "openai-compat", access: "api",
      models: { default: "my-model", options: [{ id: "my-model", label: "My model", custom: true }] } };
    fixture.myEngines = [mine("compat-lab", "key")];fixture.instances = [endpoint];
    expect(row(open(bot("compat-lab", "my-model")), "my-model")).toBeDefined();
  });

  it.each([false, true])("holds the organization's disabled providers out for an admin or member (%s)", (admin) => {
    ready();fixture.org = { ...org, viewerRole: admin ? "admin" : "member" };fixture.myEngines = [mine("claude"), mine("codex", "subscription")];
    fixture.config = { allowedEngines: ["claude"] };
    const forBot = bot("claude", "claude-opus-5-5");
    for (const inComposer of [false, true]) {
      fixture.values = [];
      expect(row(open(forBot, { inComposer }), "gpt-5.6")).toBeUndefined();
    }
    fixture.values = [];fixture.config = { allowedEngines: ["claude"], ownAccountsOutsideList: true };
    expect(row(open(forBot), "gpt-5.6")).toBeDefined();
  });

  it("keeps a disabled model that is still selected, and hides other disabled favorites", () => {
    ready();fixture.config = { myDisabledModels: ["claude/claude-opus-5-5", "claude/claude-sonnet-5"] };
    fixture.storage["sagax.modelFavorites.v1"] = JSON.stringify([["claude", "claude-sonnet-5"]]);
    try {
      const opened = open(bot("claude", "claude-opus-5-5"));
      // Current selection stays visible; a disabled favorite that is not selected does not.
      expect(row(opened, "claude-opus-5-5")?.props.current).toBe(true);
      expect(row(opened, "claude-sonnet-5")).toBeUndefined();
    } finally { delete fixture.storage["sagax.modelFavorites.v1"]; }
  });

  it("offers Auto first and uses the same bot-wide choice action", () => {
    ready();
    const opened = open(bot("claude", "claude-sonnet-5"));
    expect(lists(opened)[0]!.props.sections[0]!.rows[0]!.kind).toBe("auto");
    row(opened, "auto").props.onPick();
    expect(fixture.dispatch).toHaveBeenLastCalledWith({ type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5", auto: true, autoOptimize: "balance" } });
  });

  it("shows Auto's last real pick on the chip; chain status lives in Settings", () => {
    ready();
    const forBot = { ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true as const } };
    fixture.bots = [{ ...forBot, tasks: [{ threadId: forBot.threadId, title: "t", createdAt: 1, autoModel: {
      instanceId: "claude", model: "claude-fable-5-1", engineLabel: "Claude", modelLabel: "Fable 5.1", role: "orchestration", tier: "top", reason: "strongest-own", via: "subscription", at: 1,
    } }] }];
    const opened = open(forBot);
    expect(opened.html).toContain("Auto · Fable 5.1");
    expect(opened.html).not.toContain("data-auto-model-status");
    expect(row(opened, "auto").props.current).toBe(true);
  });

  it("does not guess an owner-paid shared bot payer in the menu", () => {
    ready();
    fixture.org = { org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    fixture.myEngines = [mine("claude")];
    const opened = open({ ...bot("claude", "claude-opus-5-5"), turnPayer: "owner" });
    expect(opened.html).not.toContain("Who pays is confirmed when the turn starts");
    expect(opened.html).not.toContain("paid by the organization");
    expect(opened.html).not.toContain("paid by me");
    expect(row(opened, "claude-opus-5-5")).toBeDefined();
  });

  it("leaves Auto recovery details to Settings (no backup card in the menu)", () => {
    ready();fixture.autoStatus = { auto: false, pick: null, chain: [], excluded: [], backups: [] };
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(opened.html).not.toContain("No automatic backup is configured");
    expect(opened.html).toContain("data-model-menu");
  });
});


describe("the fast model's switches", () => {
  it("filters disabled local models out of the Auto menu list (fast select lives in Settings)", () => {
    const options = [
      { id: "ds::off-by-me", label: "Off by me", custom: true, local: true },
      { id: "ds::off-by-org", label: "Off by org", custom: true, local: true },
      { id: "ds::ready", label: "Ready fast", custom: true, local: true },
    ];
    fixture.instances = [claude({ state: "available", authenticated: true }, [...official, ...options])];
    fixture.config = { myDisabledModels: ["claude/ds::off-by-me"], disabledModels: ["claude/ds::off-by-org"] };
    const forBot = { ...bot("claude", "claude-opus-5-5"), modelSelection: { instanceId: "claude", model: "claude-opus-5-5", auto: true as const } };
    const opened = open(forBot);
    expect(opened.html).not.toContain("data-model-fast");
    expect(row(opened, "ds::ready")).toBeDefined();
    expect(row(opened, "ds::off-by-me")).toBeUndefined();
    expect(row(opened, "ds::off-by-org")).toBeUndefined();
  });
});
