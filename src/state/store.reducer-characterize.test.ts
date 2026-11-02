// Characterization of reducer cases with thin coverage before the #1383
// store split. Synthetic fixtures only. Behavior must stay identical after
// the slice extraction.
import { describe, expect, it } from "vitest";
import { dataSheetKey, type DataSheet } from "../../shared/data-surface";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { WebhookAttempt, WebhookIngressStatus, WebhookTrigger } from "@/lib/webhooks";
import type { ComputerStart } from "@/lib/computer-start";
import {
  closeBotCatalog,
  initialState,
  openBotCatalog,
  reducer,
  type AppState,
  type Bot,
  type Group,
  type Message,
} from "./store";

const bot = (id: string, extra: Partial<Bot> = {}): Bot =>
  ({
    id,
    threadId: `t-${id}`,
    name: id,
    title: "",
    description: "",
    notifications: true,
    color: "green",
    unread: false,
    modelSelection: { instanceId: "fake", model: "test" },
    messages: [],
    ...extra,
  }) as Bot;

const group = (id: string, extra: Partial<Group> = {}): Group =>
  ({
    id,
    threadId: `tg-${id}`,
    name: id,
    memberIds: [],
    humanIds: ["pr_me"],
    defaultResponder: { kind: "everyone" },
    bulletin: "",
    unread: false,
    createdAt: 1,
    messages: [],
    ...extra,
  }) as Group;

const message = (id: string, extra: Partial<Message> = {}): Message =>
  ({
    id,
    kind: "user",
    text: id,
    at: 1,
    ...extra,
  }) as Message;

const routine = (id: string, extra: Partial<Routine> = {}): Routine =>
  ({
    id,
    botId: "maya",
    name: id,
    enabled: true,
    schedule: { type: "manual" },
    ...extra,
  }) as Routine;

const run = (id: string, extra: Partial<RoutineRun> = {}): RoutineRun =>
  ({
    id,
    routineId: "r1",
    botId: "maya",
    status: "succeeded",
    ...extra,
  }) as RoutineRun;

const webhook = (id: string, extra: Partial<WebhookTrigger> = {}): WebhookTrigger =>
  ({
    id,
    name: id,
    enabled: true,
    ...extra,
  }) as WebhookTrigger;

const attempt = (id: string, webhookId: string, extra: Partial<WebhookAttempt> = {}): WebhookAttempt =>
  ({
    id,
    webhookId,
    at: 1,
    outcome: "accepted",
    ...extra,
  }) as WebhookAttempt;

const base = (): AppState => ({
  ...initialState,
  bots: [bot("maya", { tasks: [{ threadId: "t-maya", title: "Main", createdAt: 1 }] })],
  groups: [group("crew", { tasks: [{ threadId: "tg-crew", title: "Main", createdAt: 1 }] })],
  selectedId: "maya",
});

describe("views with thin coverage", () => {
  it("showCode opens the code view and closes side panels", () => {
    const open = reducer(
      { ...base(), settingsOpen: true, pluginsOpen: true, codeFocus: { nonce: 3 } },
      { type: "showCode", runId: "run-1" },
    );
    expect(open).toMatchObject({
      activeView: "code",
      codeFocus: { runId: "run-1", nonce: 4 },
      settingsOpen: false,
      pluginsOpen: false,
    });
  });

  it("showApprovals and showRemoteSessions switch the active view", () => {
    expect(reducer(base(), { type: "showApprovals" }).activeView).toBe("approvals");
    expect(reducer(base(), { type: "showRemoteSessions" }).activeView).toBe("remote-sessions");
  });
});

describe("sections and instances", () => {
  it("sections replaces the section list", () => {
    expect(reducer(base(), { type: "sections", sections: ["Ops", "Lab"] }).sections).toEqual(["Ops", "Lab"]);
  });

  it("instances replaces the instance list", () => {
    const instances = [{ id: "fake", label: "Fake", models: { options: [] } }] as unknown as AppState["instances"];
    expect(reducer(base(), { type: "instances", instances }).instances).toEqual(instances);
  });
});

describe("routines and webhooks patches", () => {
  it("routineFoldersPatched merges one bot's folders", () => {
    const next = reducer(
      { ...base(), routineFolders: { maya: ["a"], other: ["b"] } },
      { type: "routineFoldersPatched", botId: "maya", folders: ["x", "y"] },
    );
    expect(next.routineFolders).toEqual({ maya: ["x", "y"], other: ["b"] });
  });

  it("routinePatched inserts or replaces by id", () => {
    const first = reducer(base(), { type: "routinePatched", routine: routine("r1", { name: "One" }) });
    expect(first.routines.map((r) => r.id)).toEqual(["r1"]);
    const second = reducer(first, { type: "routinePatched", routine: routine("r1", { name: "One-b" }) });
    expect(second.routines).toHaveLength(1);
    expect(second.routines[0]?.name).toBe("One-b");
    const third = reducer(second, { type: "routinePatched", routine: routine("r2") });
    expect(third.routines.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("routineDeleted and routineRunsRemoved drop matching rows", () => {
    const seeded = {
      ...base(),
      routines: [routine("r1"), routine("r2")],
      routineRuns: [run("run-1"), run("run-2"), run("run-3")],
    };
    expect(reducer(seeded, { type: "routineDeleted", routineId: "r1" }).routines.map((r) => r.id)).toEqual(["r2"]);
    expect(reducer(seeded, { type: "routineRunsRemoved", ids: ["run-1", "run-3"] }).routineRuns.map((r) => r.id)).toEqual([
      "run-2",
    ]);
  });

  it("webhooksHydrated replaces the webhook surface", () => {
    const ingress = { ok: true } as unknown as WebhookIngressStatus;
    const next = reducer(base(), {
      type: "webhooksHydrated",
      webhooks: [webhook("wh1")],
      attempts: [attempt("a1", "wh1")],
      ingress,
      graphConnectors: [],
    });
    expect(next.webhooks.map((w) => w.id)).toEqual(["wh1"]);
    expect(next.webhookAttempts.map((a) => a.id)).toEqual(["a1"]);
    expect(next.webhookIngress).toEqual(ingress);
    expect(next.webhookGraphConnectors).toEqual([]);
  });

  it("webhookPatched inserts or replaces, webhookDeleted clears attempts too", () => {
    const seeded = reducer(base(), {
      type: "webhooksHydrated",
      webhooks: [webhook("wh1", { name: "Old" })],
      attempts: [attempt("a1", "wh1"), attempt("a2", "wh2")],
      ingress: null as unknown as WebhookIngressStatus,
    });
    const patched = reducer(seeded, { type: "webhookPatched", webhook: webhook("wh1", { name: "New" }) });
    expect(patched.webhooks[0]?.name).toBe("New");
    const added = reducer(patched, { type: "webhookPatched", webhook: webhook("wh2") });
    expect(added.webhooks.map((w) => w.id)).toEqual(["wh2", "wh1"]);
    const deleted = reducer(added, { type: "webhookDeleted", webhookId: "wh1" });
    expect(deleted.webhooks.map((w) => w.id)).toEqual(["wh2"]);
    expect(deleted.webhookAttempts.map((a) => a.id)).toEqual(["a2"]);
  });

  it("webhookAttempted upserts and caps history", () => {
    const first = reducer(base(), { type: "webhookAttempted", attempt: attempt("a1", "wh1") });
    const second = reducer(first, { type: "webhookAttempted", attempt: attempt("a1", "wh1", { outcome: "rejected" }) });
    expect(second.webhookAttempts).toHaveLength(1);
    expect(second.webhookAttempts[0]?.outcome).toBe("rejected");
  });
});

describe("connection, errors, and marks", () => {
  it("connected tracks everConnected and disconnectedAt", () => {
    const up = reducer(base(), { type: "connected", value: true });
    expect(up).toMatchObject({ connected: true, everConnected: true, disconnectedAt: null });
    const down = reducer(up, { type: "connected", value: false });
    expect(down.connected).toBe(false);
    expect(typeof down.disconnectedAt).toBe("number");
    const stillDown = reducer({ ...down, disconnectedAt: 42 }, { type: "connected", value: false });
    expect(stillDown.disconnectedAt).toBe(42);
  });

  it("error stores the neutral no-route line when selected", () => {
    const next = reducer(base(), { type: "error", message: "no route for that path" });
    expect(next.error).toBeTruthy();
    expect(reducer(next, { type: "error", message: null }).error).toBeNull();
  });

  it("markUnread sets the bot unread flag", () => {
    expect(reducer(base(), { type: "markUnread", botId: "maya" }).bots[0]?.unread).toBe(true);
  });

  it("decideRequest and effect-only actions leave state identical", () => {
    const state = base();
    expect(reducer(state, { type: "decideRequest", botId: "maya", messageId: "m1", decision: "allow" } as never)).toBe(state);
    expect(reducer(state, { type: "stopParallelTask", botId: "maya", threadId: "t-maya" })).toBe(state);
    expect(reducer(state, { type: "steerQueued", botId: "maya", queueId: "q1" })).toBe(state);
    expect(reducer(state, { type: "duplicateBot", botId: "maya" })).toBe(state);
    expect(reducer(state, { type: "followBotModel", botId: "maya" })).toBe(state);
    expect(reducer(state, { type: "refreshTaskPermissions", botId: "maya", threadId: "t-maya" })).toBe(state);
  });
});

describe("cards, computer, and catalog", () => {
  it("cardSettled patches a bot message card by requestId", () => {
    const cardMsg = message("m1", {
      card: { requestId: "req-1", prompt: "?", options: [], answered: false } as never,
    });
    const state = { ...base(), bots: [bot("maya", { messages: [cardMsg] })] };
    const next = reducer(state, {
      type: "cardSettled",
      threadId: "t-maya",
      requestId: "req-1",
      patch: { answered: "yes" },
    });
    expect(next.bots[0]?.messages[0]?.card).toMatchObject({ requestId: "req-1", answered: "yes" });
  });

  it("computerStart and computerControl update their maps", () => {
    const start = { state: "starting" } as unknown as ComputerStart;
    const withStart = reducer(base(), { type: "computerStart", botId: "maya", start });
    expect(withStart.computerStarts.maya).toEqual(start);
    const cleared = reducer(withStart, { type: "computerStart", botId: "maya", start: null });
    expect(cleared.computerStarts.maya).toBeUndefined();
    const held = reducer(base(), { type: "computerControl", botId: "maya", held: true, helpReason: "need-help" });
    expect(held.computerControl.maya).toEqual({ held: true, helpReason: "need-help" });
  });

  it("openBotCatalog and closeBotCatalog drive the Connect apps bots tab", () => {
    const opened = reducer(base(), openBotCatalog({ section: "templates" }));
    expect(opened.pluginsOpen).toBe(true);
    expect(opened.pluginsSurface).toBe("apps");
    expect(opened.pluginsPage).toBe("bots");
    expect(opened.botCatalogTarget).toEqual({ section: "templates" });
    const already = reducer({ ...opened, botCatalogOpen: true }, openBotCatalog({ section: "templates" }));
    // A later Browse Bots link updates the target while the window stays open.
    expect(already.botCatalogTarget).toEqual({ section: "templates" });
    const retargeted = reducer({ ...opened, botCatalogOpen: true }, openBotCatalog({ section: "templates", installUrl: "https://example.invalid/bot" }));
    expect(retargeted.botCatalogTarget).toEqual({ section: "templates", installUrl: "https://example.invalid/bot" });
    expect(reducer({ ...opened, botCatalogOpen: true }, closeBotCatalog())).toMatchObject({
      botCatalogOpen: false,
      botCatalogTarget: null,
    });
  });
});

describe("focus, tour, launch, welcome", () => {
  it("focusMessageConsumed marks only the matching nonce", () => {
    const focused = reducer(base(), {
      type: "focusMessage",
      threadId: "t-maya",
      messageId: "m1",
    });
    const nonce = focused.focusMessage!.nonce;
    expect(reducer(focused, { type: "focusMessageConsumed", nonce: nonce + 1 })).toBe(focused);
    expect(reducer(focused, { type: "focusMessageConsumed", nonce }).focusMessage?.consumed).toBe(true);
  });

  it("unreadDividerDone clears only the matching thread", () => {
    const withDivider = { ...base(), unreadDivider: { threadId: "t-maya", messageId: "m1" } };
    expect(reducer(withDivider, { type: "unreadDividerDone", threadId: "other" })).toBe(withDivider);
    expect(reducer(withDivider, { type: "unreadDividerDone", threadId: "t-maya" }).unreadDivider).toBeNull();
  });

  it("toggleTour, toggleLaunch and toggleWelcome close settings underneath", () => {
    const settings = { ...base(), appSettingsOpen: true, shortcutsOpen: true };
    expect(reducer(settings, { type: "toggleTour", open: true })).toMatchObject({
      tourOpen: true,
      appSettingsOpen: false,
    });
    expect(reducer(settings, { type: "toggleLaunch", open: true, mode: "server" })).toMatchObject({
      launchOpen: true,
      launchMode: "server",
      appSettingsOpen: false,
      shortcutsOpen: false,
    });
    expect(reducer(settings, { type: "toggleWelcome", open: true })).toMatchObject({
      welcomeOpen: true,
      appSettingsOpen: false,
      shortcutsOpen: false,
    });
  });

  it("closeRoutineRunSheet clears the sheet when present", () => {
    const open = { ...base(), routineRunSheet: { runId: "run-1" } };
    expect(reducer(open, { type: "closeRoutineRunSheet" }).routineRunSheet).toBeNull();
    expect(reducer(base(), { type: "closeRoutineRunSheet" })).toEqual(base());
  });
});

describe("tasks, groups, and data with thin coverage", () => {
  it("taskMadeConfidential marks that task", () => {
    const next = reducer(base(), { type: "taskMadeConfidential", botId: "maya", threadId: "t-maya" });
    expect(next.bots[0]?.tasks?.[0]?.confidential).toBe(true);
  });

  it("previewThread and switchTaskFailed respect switchingTo", () => {
    const switching = {
      ...base(),
      bots: [bot("maya", { switchingTo: "t-other", tasks: [{ threadId: "t-maya", title: "Main", createdAt: 1 }] })],
    };
    const preview = reducer(switching, {
      type: "previewThread",
      botId: "maya",
      threadId: "t-other",
      page: { messages: [message("m1")], hasMore: false, activeLeafId: "m1" },
    });
    expect(preview.bots[0]?.switchPreview).toMatchObject({ threadId: "t-other", hasMore: false, activeLeafId: "m1" });
    const ignored = reducer(switching, {
      type: "previewThread",
      botId: "maya",
      threadId: "t-wrong",
      page: { messages: [], hasMore: false, activeLeafId: null },
    });
    expect(ignored.bots[0]?.switchPreview).toBeUndefined();
    const failed = reducer(
      { ...switching, bots: [bot("maya", { switchingTo: "t-other", switchPreview: { threadId: "t-other", messages: [], hasMore: false, activeLeafId: null } })] },
      { type: "switchTaskFailed", botId: "maya", threadId: "t-other" },
    );
    expect(failed.bots[0]).toMatchObject({ switchingTo: undefined, switchPreview: undefined });
  });

  it("patchGroup merges optimistic room edits", () => {
    const next = reducer(base(), { type: "patchGroup", groupId: "crew", patch: { name: "Crew 2", bulletin: "hi" } });
    expect(next.groups[0]).toMatchObject({ id: "crew", name: "Crew 2", bulletin: "hi" });
  });

  it("pinGroupTask and setConversationTurnLimit update group tasks or the dm", () => {
    const pinned = reducer(base(), {
      type: "pinGroupTask",
      groupId: "crew",
      threadId: "tg-crew",
      pinned: true,
      title: "Main",
    });
    expect(pinned.groups[0]?.tasks?.[0]?.pinned).toBe(true);
    const unpinned = reducer(pinned, {
      type: "pinGroupTask",
      groupId: "crew",
      threadId: "tg-crew",
      pinned: false,
      title: "Main",
    });
    expect(unpinned.groups[0]?.tasks?.[0]?.pinned).toBeUndefined();
    const limited = reducer(base(), {
      type: "setConversationTurnLimit",
      groupId: "crew",
      threadId: "tg-crew",
      minutes: 15,
      dm: false,
    });
    expect(limited.groups[0]?.tasks?.[0]?.turnTimeoutMinutes).toBe(15);
    const dm = reducer(base(), {
      type: "setConversationTurnLimit",
      groupId: "crew",
      threadId: "tg-crew",
      minutes: 30,
      dm: true,
    });
    expect(dm.groups[0]?.turnTimeoutMinutes).toBe(30);
  });

  it("switchBranch walks to the newest leaf under the message", () => {
    const msgs = [
      message("root"),
      message("a", { parentId: "root", at: 2 }),
      message("b", { parentId: "root", at: 3 }),
      message("b1", { parentId: "b", at: 4 }),
    ];
    const state = { ...base(), bots: [bot("maya", { messages: msgs, activeLeafId: "a" })] };
    const next = reducer(state, { type: "switchBranch", botId: "maya", messageId: "root" });
    expect(next.bots[0]?.activeLeafId).toBe("b1");
  });

  it("dataSheet stores the sheet under its bot/thread key", () => {
    const sheet = {
      version: 1,
      botId: "maya",
      updatedAt: "2026-11-01T00:00:00.000Z",
      sources: [],
      cards: [],
    } as DataSheet;
    const next = reducer(base(), { type: "dataSheet", sheet, threadId: "secret", tables: [] });
    const key = dataSheetKey("maya", "secret");
    expect(next.dataSheets[key]).toEqual(sheet);
    expect(next.dataTables[key]).toEqual([]);
  });
});
