import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], bots: [] as Bot[], dispatch: vi.fn() as (...args: unknown[]) => void };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("./MenuMotion", () => ({ useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }) }));
// #3116: the chat bar menu opens on its first step (the harnesses); a test
// that reads the models of one harness opens the menu on that step.
const steps = vi.hoisted(() => ({ path: {} as { harness?: string; provider?: string } }));
vi.mock("./ModelMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ModelMenu")>();
  return {
    ...actual,
    ModelSearchList: (props: Parameters<typeof actual.ModelSearchList>[0]) =>
      actual.ModelSearchList({ ...props, steps: props.steps ? { ...props.steps, initialPath: steps.path } : undefined }),
  };
});
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, modelVariantSessions: {}, bots: fixture.bots },
    dispatch: fixture.dispatch,
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

const { ModelPicker } = await import("./ModelPicker");
afterAll(() => vi.unstubAllGlobals());

const claude = (authenticated: boolean): InstanceInfo => ({
  instanceId: "claude",
  driverKind: "claudeAgent",
  displayName: "Claude",
  access: "subscription",
  snapshot: { state: "available", version: "2.1.300", authenticated },
  models: {
    default: "claude-opus",
    options: [
      { id: "claude-opus", label: "Opus" },
      { id: "claude-sonnet", label: "Sonnet" },
      { id: "claude-haiku", label: "Haiku" },
      { id: "claude-extra-1", label: "Extra one" },
      { id: "claude-extra-2", label: "Extra two" },
      { id: "claude-extra-3", label: "Extra three" },
      { id: "ollama::qwen", label: "qwen", custom: true },
    ],
  },
  install: {
    command: { darwin: "npm i", linux: "npm i", win32: "npm i" },
    signInCommand: "claude",
  },
  authentication: { method: "paste-code", signOut: true },
  capabilities: { effortLevels: ["low", "high"], withholdsHostTools: true },
});

function bot(): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "",
    notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "claude", model: "claude-opus", effort: "high" },
    messages: [],
  };
}

const html = () => renderToStaticMarkup(createElement(ModelPicker, { bot: bot() }));

beforeEach(() => { steps.path = {}; });

describe("model picker in Simple mode", () => {
  it("opens on the harnesses, with Auto and the bot's model on top (#3116)", () => {
    fixture.instances = [claude(true)];
    const markup = html();
    expect(markup).toContain('data-model-search-list="popover"');
    expect(markup).toContain('placeholder="Search models"');
    expect(markup).toContain('data-model-step="harness"');
    expect(markup).toContain('data-model-row-key="auto"');
    expect(markup).toContain("Opus");
    expect(markup).toContain('data-model-harness="claudeAgent"');
    expect(markup).toContain(">Claude Code<");
    // the custom ollama model makes a Local harness of its own
    expect(markup).toContain('data-model-harness="local"');
    expect(markup).toContain(">1 model<");
    // a harness's models wait for its step
    expect(markup).not.toContain("Extra three");
  });

  it("keeps the model list and hides effort, catalog chrome and settings links", () => {
    fixture.instances = [claude(true)];
    steps.path = { harness: "claudeAgent" };
    const markup = html();
    expect(markup).toContain('data-model-step="model"');
    expect(markup).toContain("data-model-step-back");
    expect(markup).toContain("Opus");
    // #2963: the chat bar menu is flat: every model shows, no Show more.
    expect(markup).not.toContain("data-model-show-more");
    expect(markup).toContain("Extra three");
    expect(markup).not.toContain("Suggested");
    expect(markup).not.toContain("data-model-effort");
    expect(markup).not.toContain("data-model-add-api-keys");
    expect(markup).not.toContain("data-model-engines-link");
    expect(markup).not.toContain("data-model-local-entry");
    expect(markup).not.toContain("Show all");
  });

  it("labels the composer chip with the effort, as in Advanced", () => {
    fixture.instances = [claude(true)];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: bot(), inComposer: true }));
    // #3116: the chip reads the steps: the harness, then the model and its effort
    expect(markup).toMatch(/<span class="truncate">Claude Code · Opus High<\/span>/);
  });

  it("lists local models under Local in Simple too", () => {
    const instance = claude(true);
    instance.models.options.push({ id: "dwarfstar::qwen3.8-flash-next-chat", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true, anthropic: true });
    fixture.instances = [instance];
    expect(html()).toContain('data-model-harness="local"');
    steps.path = { harness: "local" };
    const markup = html();
    expect(markup).toContain('data-model-section="local:this-computer"');
    expect(markup).toContain("DwarfStar: Qwen3.8 Flash Next");
    expect(markup).not.toContain("data-model-local-entry");
  });

  it("shows a local model by its name alone, with the server only when a name is duplicated (2026-10-26)", () => {
    const instance = claude(true);
    // Keep the Local group at 4 models so the preview (#2181) still shows the
    // duplicate-name and shared-by cases without needing Show more.
    instance.models.options = instance.models.options.filter((option) => option.id !== "ollama::qwen");
    instance.models.options.push(
      { id: "desk8000abc::Ornith-1.5-122B-oQ4e-mtp", label: "Ornith-1.5-122B-oQ4e-mtp", custom: true, local: true, anthropic: true },
      { id: "desk8000abc::Twin-Model", label: "Twin-Model", server: "oMLX", custom: true, local: true, anthropic: true },
      { id: "desk8000cd::Shared-Model-With-A-Long-Name", label: "Shared-Model-With-A-Long-Name", sharedBy: "Camille Tremblay", custom: true, local: true, anthropic: true },
      { id: "desk8002abc::Twin-Model", label: "Twin-Model", server: ":8002", custom: true, local: true, anthropic: true },
    );
    fixture.instances = [instance];
    steps.path = { harness: "local" };
    const markup = html();
    expect(markup).toContain("Ornith-1.5-122B-oQ4e-mtp");
    expect(markup).not.toContain(":8000:");
    expect(markup).toContain("oMLX");
    expect(markup).toContain(":8002");
    // who shares it: a second line under the whole name, not appended to it
    expect(markup).toMatch(/Shared-Model-With-A-Long-Name<\/span>.*data-model-row-sub[^>]*>Shared by Camille Tremblay</s);
    expect(markup).not.toContain("Shared-Model-With-A-Long-Name (Shared by");
    // the full technical id stays in the tooltip
    expect(markup).toContain("desk8000abc::Ornith-1.5-122B-oQ4e-mtp");
  });

  it("links to the models window, which connects a provider (#2963)", () => {
    fixture.instances = [claude(false)];
    const markup = html();
    expect(markup).toContain("data-model-manage");
    expect(markup).toContain("Manage models");
    expect(markup).not.toContain("data-claude-sign-in");
    expect(markup).not.toContain("data-model-add-api-keys");
    expect(markup).not.toContain("data-model-engines-link");
  });
});

describe("a thread's picker and its bot's model", () => {
  const opus = { instanceId: "claude", model: "claude-opus" };
  const haiku = { instanceId: "claude", model: "claude-haiku" };
  /** The bot as the store holds it (its model is Opus), and the thread's view of it. */
  function scout(threadModel: typeof opus | null): Bot {
    const profile: Bot = { ...bot(), modelSelection: opus, tasks: [
      { threadId: "thread-atlas", title: "This one", createdAt: 1, modelSelection: threadModel ?? opus, followsBotModel: threadModel === null },
    ] };
    fixture.bots = [profile];
    return { ...profile, modelSelection: threadModel ?? opus };
  }
  const threadPicker = (forBot: Bot) => renderToStaticMarkup(createElement(ModelPicker, { bot: forBot, threadId: "thread-atlas" }));

  /** The "<bot>'s model" row of the menu's list, as markup. */
  const followRow = (markup: string) => {
    const menu = markup.slice(markup.indexOf("data-model-menu"));
    return /<div[^>]*data-follow-bot-model="true"[^>]*>/.exec(menu)?.[0] ?? "";
  };

  it("offers the bot's model to a thread on its own", () => {
    fixture.instances = [claude(true)];
    const markup = threadPicker(scout(haiku));
    expect(markup).toContain("Use Atlas&#x27;s model");
    expect(markup).toMatch(/Use Atlas&#x27;s model<\/span><span data-model-row-detail="true" class="[^"]*">Opus<\/span>/);
    expect(followRow(markup)).not.toContain("aria-current");
  });

  it("shows a thread that follows its bot as following, and says so in the chip's tooltip", () => {
    fixture.instances = [claude(true)];
    const markup = threadPicker(scout(null));
    expect(followRow(markup)).toContain('aria-current="true"');
    expect(markup).toContain("Uses Atlas&#x27;s model");
  });

  it("offers nothing a server too old to say whether a thread follows its bot could not do", () => {
    fixture.instances = [claude(true)];
    fixture.bots = [];
    expect(threadPicker(bot())).not.toContain("data-follow-bot-model");
  });
});
