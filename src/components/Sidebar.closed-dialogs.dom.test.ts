// @vitest-environment happy-dom
// #3624: the sidebar renders on every frame of a working bot (its row shows
// the bot at work), and nothing it holds closed renders with it: the
// confirm dialogs, the share and leave dialogs, the primary bot picker are
// mounted only while they are asked. Counted in renders per frame.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, Message } from "@/state/store";

const renders = vi.hoisted(() => ({ confirm: 0, share: 0, leave: 0, primary: 0 }));
vi.mock("./ConfirmDialog", () => ({ ConfirmDialog: () => { renders.confirm += 1; return null; } }));
vi.mock("./ShareTeamDialog", () => ({ ShareTeamDialog: () => { renders.share += 1; return null; } }));
vi.mock("./LeaveGroupDialog", () => ({ LeaveGroupDialog: () => { renders.leave += 1; return null; } }));
vi.mock("./PrimaryBotPicker", () => ({ PrimaryBotPicker: () => { renders.primary += 1; return null; } }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AppSidebar } = await import("./AppSidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const { setLocale } = await import("@/lib/i18n");
setLocale("en");

const bot = (id: string, name: string): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", color: "green", notifications: true, unread: false, section: "Ops",
  modelSelection: { instanceId: "test", model: "m" },
  messages: [{ id: `m-${id}`, role: "bot", kind: "text", text: "Synthetic reply.", at: 1 }],
  tasks: [{ threadId: `t-${id}`, title: "General", createdAt: 1 }],
} as Bot);

let state: AppState;
let root: Root;
let host: HTMLDivElement;
const sidebar = createElement(AppSidebar, { drawerOpen: false, onDrawerOpenChange: () => {}, composeOpen: false, onCompose: () => {} });

const dispatch = (_action: Action) => {};
const commands = { flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

async function draw() {
  // the store's commands are stable, as StoreProvider's are
  const value = { state, dispatch, ...commands };
  await act(async () => { root.render(createElement(BotEditorStore, { value: value as never, children: sidebar })); });
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  Object.assign(renders, { confirm: 0, share: 0, leave: 0, primary: 0 });
  state = { ...initialState, hydrated: true, selectedId: "atlas", bots: [bot("atlas", "Atlas"), bot("iris", "Iris"), bot("milo", "Milo")], groups: [], sections: ["Ops"] } as AppState;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the sidebar's closed dialogs while a bot works (#3624)", () => {
  it("renders none of them for the frames of a working bot", async () => {
    await draw();
    for (let n = 0; n < 20; n++) {
      state = {
        ...state,
        bots: state.bots.map((entry) => entry.id !== "iris" ? entry : {
          ...entry, busy: true, messages: [...entry.messages, { id: `tool-${n}`, role: "bot", kind: "activity", text: "", at: 2 + n } as Message],
        }),
      };
      await draw();
    }
    // the sidebar did draw the working row
    expect(host.querySelector("[data-sidebar]")).not.toBeNull();
    expect(renders).toEqual({ confirm: 0, share: 0, leave: 0, primary: 0 });
  });
});
