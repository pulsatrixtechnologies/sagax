import { createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, LOCAL_VIEWER, WELCOME_VERSION, type WelcomeViewer } from "@/lib/onboarding";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
vi.mock("@/lib/analytics", () => ({ emailGateDone: () => false }));
// The gate's job is choosing; the flow itself has its own recipe.
vi.mock("./WelcomeFlow", () => ({ WelcomeFlow: () => null }));
vi.mock("./GuidedFirstRun", () => ({ GuidedFirstRun: () => null }));
vi.mock("./LaunchScreen", () => ({ LaunchScreen: () => null }));
vi.mock("@/components/Avatar", () => ({ MausAvatar: () => null }));
// The organization's engine step decides for itself (OrgEngineSetup.tsx);
// here it only stands in where the welcome flow does not open.
vi.mock("@/components/OrgEngineSetup", () => ({ OrgEngineSetupGate: () => null }));
import { SharedWorkspaceHint } from "./SharedWorkspaceHint";
import { useWelcomeViewer, WelcomeGate } from "./WelcomeGate";
import { WelcomeFlow } from "./WelcomeFlow";
import { GuidedFirstRun } from "./GuidedFirstRun";
import { LaunchScreen } from "./LaunchScreen";
import { OrgEngineSetupGate } from "@/components/OrgEngineSetup";

type Node = ReactElement<Record<string, unknown> & { onClick?: () => void; onClose?: () => void; onOpenServer?: () => void; onSolo?: () => void; children?: ReactNode }>;
function render(component: () => ReactNode) {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = component();
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree: tree as Node | null };
}
/** No welcome surface: nothing, or only the organization's engine step. */
const quiet = (tree: Node | null) => tree === null || tree.type === OrgEngineSetupGate;
const gate = (viewer: WelcomeViewer | null) => render(() => WelcomeGate({ viewer }));
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const fresh = { onboarding: EMPTY_ONBOARDING };
// The desktop app's own page: the full bridge, remoteClient included.
const LOCAL_PAGE = { ogb: { platform: "darwin", remoteClient: { active: false }, workspaces: {} } };
// A hosted workspace the desktop app opened (Server → Connect hosted
// workspace…): preload exposes only its remote-safe subset, still truthy.
const REMOTE_PAGE = { ogb: { platform: "darwin", workspaces: {}, getCapabilities: () => ({}) } };
// The packaged desktop's own page with the bridges the launch screen uses.
const environmentsState = vi.hoisted(() => ({ value: { environments: [] as unknown[] } }));
const serverModeState = vi.hoisted(() => ({ value: { active: false } as { active: boolean } }));
const DESKTOP_PAGE = {
  ogb: {
    platform: "darwin",
    remoteClient: { active: false },
    workspaces: {},
    environments: { state: () => Promise.resolve(environmentsState.value) },
    orgJoin: { probe: vi.fn(), join: vi.fn() },
    serverMode: { state: () => Promise.resolve(serverModeState.value), leave: vi.fn() },
  },
};
beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.effects = [];
  store.dispatch.mockReset();
  store.api.mockReset();
  store.state = { config: fresh, welcomeOpen: false, launchOpen: false, launchMode: "solo", appSettingsOpen: false, appSettingsSection: "general", bots: [] };
  environmentsState.value = { environments: [] };
  serverModeState.value = { active: false };
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("fetch", vi.fn());
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who gets the welcome flow", () => {
  it("opens the guided first run for the desktop app's own window", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    const { tree } = gate(LOCAL_VIEWER);
    expect(tree?.type).toBe(GuidedFirstRun);
    expect(tree?.props).toMatchObject({ initialStep: undefined, replay: false });
  });

  it("opens the hosted beat set for a hosted workspace's admin", () => {
    const { tree } = gate({ hosted: true, canSave: true });
    expect(tree?.type).toBe(WelcomeFlow);
    expect(tree?.props.hosted).toBe(true);
  });

  it("gives an organization server's admin the guided first run, which asks for no profile", async () => {
    // the desktop app joined an organization server: the page is the server's
    // (reduced bridge) and the server's answer decides, never a guess. The
    // lean guide collects no name or email, so a managed profile needs no
    // special greeting here.
    vi.stubGlobal("window", REMOTE_PAGE);
    store.api.mockResolvedValueOnce({
      kind: "session", scopes: ["admin", "client"], identity: "perspicax", name: "Jean-Christophe", email: "jc@example.test",
      profileManagedBy: "perspicax", profileManageUrl: "https://pulsatrix.example.test/console/me",
    });
    let viewer: WelcomeViewer | null = null;
    const read = () => render(() => {
      viewer = useWelcomeViewer();
      return null;
    });
    read();
    for (const effect of fixture.effects) effect();
    await flush();
    read();
    expect(viewer).not.toBeNull();
    fixture.values = [];
    const { tree } = gate(viewer);
    expect(tree?.type).toBe(GuidedFirstRun);
    // a solo server's first run is the same guide
    fixture.values = [];
    expect(gate({ hosted: false, canSave: true }).tree?.type).toBe(GuidedFirstRun);
  });

  it("leaves an OMB Cloud home's first run to its engine sign-in", () => {
    vi.stubGlobal("window", REMOTE_PAGE);
    expect(quiet(gate({ hosted: false, canSave: true, cloudHome: true }).tree)).toBe(true);
    // Settings → Replay welcome tour still opens it there
    store.state = { ...store.state, welcomeOpen: true };
    expect(gate({ hosted: false, canSave: true, cloudHome: true }).tree?.type).toBe(GuidedFirstRun);
  });

  it("gives a hosted member a note instead, and nothing that writes the workspace config", async () => {
    const { tree, html } = gate({ hosted: true, canSave: false });
    expect(tree?.type).toBe(SharedWorkspaceHint);
    expect(html).toContain("Your team&#x27;s shared Sagax");
    expect(html).not.toContain("role=\"dialog\"");
    fixture.values = [];
    const hint = render(() => SharedWorkspaceHint({ replay: false, onClose: vi.fn() }));
    const gotIt = (hint.tree!.props.children as Node[]).flatMap(function all(node): Node[] {
      if (!isValidElement(node)) return [];
      const children = (node as Node).props.children;
      return [node as Node, ...(Array.isArray(children) ? children : [children]).flatMap(all)];
    }).find((node) => node.type === "button")!;
    gotIt.props.onClick!();
    await flush();
    expect(store.api).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("omb.onboarding.sharedWorkspaceHint")).toBe("1");
    // once dismissed, a fresh visit in this browser does not show it again
    fixture.values = [];
    expect(render(() => SharedWorkspaceHint({ replay: false, onClose: vi.fn() })).html).toBe("");
    // but Settings → Replay welcome tour shows it again
    fixture.values = [];
    expect(render(() => SharedWorkspaceHint({ replay: true, onClose: vi.fn() })).html).toContain("shared Sagax");
    // storage that throws (private window) still shows it and never breaks
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    fixture.values = [];
    expect(render(() => SharedWorkspaceHint({ replay: false, onClose: vi.fn() })).html).toContain("shared Sagax");
  });

  it("never opens the flow for a hosted member, even when the admin has not finished it", () => {
    store.state = { ...store.state, config: {} };
    expect(gate({ hosted: true, canSave: false }).tree?.type).toBe(SharedWorkspaceHint);
    store.state = { ...store.state, welcomeOpen: true };
    const replay = gate({ hosted: true, canSave: false }).tree!;
    expect(replay.type).toBe(SharedWorkspaceHint);
    expect(replay.props.replay).toBe(true);
    replay.props.onClose!();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleWelcome", open: false });
  });

  it("adds nothing for a member of a server that is not hosted, such as the owner's own paired browser", () => {
    // no note: the team copy would be false there, and it would be new UI
    const { tree, html } = gate({ hosted: false, canSave: false });
    expect(quiet(tree)).toBe(true);
    expect(html).toBe("");
    // an explicit Settings replay still opens the ordinary flow, as before
    store.state = { ...store.state, welcomeOpen: true };
    const replay = gate({ hosted: false, canSave: false }).tree!;
    expect(replay.type).toBe(GuidedFirstRun);
    expect(replay.props).toMatchObject({ replay: true });
  });

  it("treats a hosted workspace opened inside the desktop app like a browser", () => {
    vi.stubGlobal("window", REMOTE_PAGE);
    expect(gate({ hosted: true, canSave: false }).tree?.type).toBe(SharedWorkspaceHint);
    const admin = gate({ hosted: true, canSave: true }).tree!;
    expect(admin.type).toBe(WelcomeFlow);
    expect(admin.props.hosted).toBe(true);
  });

  it("shows nothing to a remote client member or while a browser's session is unknown", () => {
    expect(quiet(gate(null).tree)).toBe(true);
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    expect(quiet(gate({ hosted: true, canSave: false }).tree)).toBe(true);
    expect(quiet(gate(LOCAL_VIEWER).tree)).toBe(true);
  });

  it("stays closed after the admin finished it", () => {
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION } } };
    expect(quiet(gate({ hosted: true, canSave: true }).tree)).toBe(true);
    expect(quiet(gate(LOCAL_VIEWER).tree)).toBe(true);
  });
});

describe("the launch screen before the tour", () => {
  it("opens first on a fresh desktop app, before the welcome tour", () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    const { tree } = gate(LOCAL_VIEWER);
    expect(tree?.type).toBe(LaunchScreen);
    expect(tree?.props.initialMode).toBe("solo");
  });

  it("goes on to the tour once no server is chosen, without waiting for the save", () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    gate(LOCAL_VIEWER).tree!.props.onSolo!();
    expect(gate(LOCAL_VIEWER).tree?.type).toBe(GuidedFirstRun);
  });

  it("remembers no server: the next launch opens the tour directly", () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, launchMode: "solo" } } };
    expect(gate(LOCAL_VIEWER).tree?.type).toBe(GuidedFirstRun);
  });

  it("never shows it to a browser, a hosted page or someone who finished the tour", () => {
    expect(gate(LOCAL_VIEWER).tree?.type).toBe(GuidedFirstRun);
    vi.stubGlobal("window", REMOTE_PAGE);
    expect(gate({ hosted: true, canSave: true }).tree?.type).toBe(WelcomeFlow);
    vi.stubGlobal("window", DESKTOP_PAGE);
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION } } };
    expect(quiet(gate(LOCAL_VIEWER).tree)).toBe(true);
  });

  it("comes back after server mode was left (signed out), even with other servers saved", async () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION, launchMode: "server" } } };
    environmentsState.value = { environments: [{ id: "a", name: "Example", origin: "https://bot.example.test" }] };
    serverModeState.value = { active: true };
    expect(quiet(gate(LOCAL_VIEWER).tree)).toBe(true);
    for (const effect of fixture.effects) effect();
    await flush();
    expect(quiet(gate(LOCAL_VIEWER).tree)).toBe(true);
    fixture.values = [];
    serverModeState.value = { active: false };
    gate(LOCAL_VIEWER);
    for (const effect of fixture.effects) effect();
    await flush();
    const again = gate(LOCAL_VIEWER).tree!;
    expect(again.type).toBe(LaunchScreen);
    expect(again.props.initialMode).toBe("server");
  });

  it("opens from Settings and closes back to the app on no server", () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    store.state = { ...store.state, launchOpen: true, launchMode: "server", config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION, launchMode: "solo" } } };
    const screen = gate(LOCAL_VIEWER).tree!;
    expect(screen.type).toBe(LaunchScreen);
    expect(screen.props.initialMode).toBe("server");
    screen.props.onSolo!();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleLaunch", open: false });
  });

  it("the server row opens server mode and the guide resumes on the engine step", () => {
    vi.stubGlobal("window", DESKTOP_PAGE);
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, launchMode: "solo" } } };
    const flow = gate(LOCAL_VIEWER).tree!;
    expect(flow.type).toBe(GuidedFirstRun);
    flow.props.onOpenServer!();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleLaunch", open: true, mode: "server" });
    store.state = { ...store.state, launchOpen: true, launchMode: "server" };
    gate(LOCAL_VIEWER).tree!.props.onSolo!();
    store.state = { ...store.state, launchOpen: false };
    expect(gate(LOCAL_VIEWER).tree?.props.initialStep).toBe("engine");
  });
});

describe("useWelcomeViewer", () => {
  const viewer = () => {
    let value: WelcomeViewer | null = null;
    render(() => {
      value = useWelcomeViewer();
      return null;
    });
    return value;
  };

  it("knows the desktop app's own window without asking", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    expect(viewer()).toEqual(LOCAL_VIEWER);
    for (const effect of fixture.effects) effect();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("asks the server from a hosted page the desktop app opened, whose bridge is reduced", async () => {
    vi.stubGlobal("window", REMOTE_PAGE);
    store.api.mockResolvedValueOnce({ kind: "session", scopes: ["client"], hosted: true });
    expect(viewer()).toBeNull();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(store.api).toHaveBeenCalledExactlyOnceWith("/api/auth/session", { timeoutMs: 10_000 });
    expect(viewer()).toEqual({ hosted: true, canSave: false });
  });

  it("asks a browser's server once and reads hosted and scope from the answer", async () => {
    store.api.mockResolvedValueOnce({ kind: "session", scopes: ["client"], hosted: true });
    expect(viewer()).toBeNull();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(store.api).toHaveBeenCalledExactlyOnceWith("/api/auth/session", { timeoutMs: 10_000 });
    expect(viewer()).toEqual({ hosted: true, canSave: false });
  });

  it("keeps today's behaviour when the answer does not come", async () => {
    store.api.mockRejectedValueOnce(new Error("offline"));
    viewer();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(viewer()).toEqual(LOCAL_VIEWER);
  });
});
