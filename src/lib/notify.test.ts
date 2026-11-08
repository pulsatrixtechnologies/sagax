import { afterEach, describe, expect, it, vi } from "vitest";

const sounds = vi.hoisted(() => ({
  enabled: true,
  persistent: true,
  bots: true,
  people: true,
  groups: true,
  approvals: true,
  routines: true,
}));
vi.mock("./notification-preferences", () => ({
  attentionSettings: () => ({
    sound: sounds.enabled,
    persistent: sounds.persistent,
    badge: true,
    nudgeSound: true,
    nudgeShake: true,
    bots: sounds.bots,
    people: sounds.people,
    groups: sounds.groups,
    approvals: sounds.approvals,
    routines: sounds.routines,
  }),
}));

import {
  buildNotificationOptions,
  decisionBannerBody,
  DESKTOP_CONTEXT_MAX,
  requestNotificationPermission,
  resetNotificationPendingCounts,
  showNotification,
  type NotifyFrame,
} from "./notify";

const frame: NotifyFrame = {
  kind: "done",
  botId: "bot-1",
  botName: "Maus",
  threadId: "thread-1",
  title: "Maus finished",
  body: "All done",
};

function installNotification(permission: NotificationPermission, focused = false) {
  const notices: Array<{ title: string; options?: NotificationOptions; onclick: (() => void) | null }> = [];
  const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;
    constructor(public title: string, public options?: NotificationOptions) {
      notices.push(this);
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("document", { hasFocus: () => focused });
  vi.stubGlobal("window", { focus: vi.fn() });
  return { notices, requestPermission };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetNotificationPendingCounts();
  sounds.enabled = true;
  sounds.persistent = true;
  sounds.bots = true;
  sounds.people = true;
  sounds.groups = true;
  sounds.approvals = true;
  sounds.routines = true;
});

describe("desktop notifications", () => {
  it("does not request permission from a background notification frame", () => {
    const { notices, requestPermission } = installNotification("default");
    showNotification(frame, vi.fn());
    expect(requestPermission).not.toHaveBeenCalled();
    expect(notices).toHaveLength(0);
  });

  it("requests permission through the explicit settings action", async () => {
    const { requestPermission } = installNotification("default");
    await requestNotificationPermission();
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("shows a notification after permission is granted with the bot name as title", () => {
    const { notices } = installNotification("granted");
    showNotification(frame, vi.fn());
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      title: "Maus",
      options: { body: frame.body, tag: `sagax:chat:${frame.threadId}` },
    });
  });

  it("stays quiet only when the exact target thread is already visible", () => {
    const { notices } = installNotification("granted", true);

    showNotification(frame, vi.fn(), undefined, frame.threadId);

    expect(notices).toHaveLength(0);
  });

  it("shows a spend notice even over the thread it points at, in its own stack", () => {
    const { notices } = installNotification("granted", true);

    showNotification({ ...frame, kind: "spend", title: "Monthly spend limit reached" }, vi.fn(), "https://avatar.test/a.png", frame.threadId);

    expect(notices).toHaveLength(1);
    expect(notices[0]!.options).toMatchObject({ tag: "sagax:spend", icon: undefined });
  });

  it("still alerts a focused app when another task is visible", () => {
    const { notices } = installNotification("granted", true);

    showNotification(frame, vi.fn(), undefined, "another-thread");

    expect(notices).toHaveLength(1);
  });

  it("opens the exact detached task carried by the notification", () => {
    const { notices } = installNotification("granted");
    const onOpen = vi.fn();

    showNotification({ ...frame, threadId: "detached-routine-thread" }, onOpen);
    notices[0]!.onclick?.();

    expect(window.focus).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({
      botId: frame.botId,
      threadId: "detached-routine-thread",
    });
  });

  it("groups under the chat thread so one banner replaces the previous", () => {
    const { notices } = installNotification("granted");

    showNotification(frame, vi.fn());
    showNotification(
      { ...frame, body: "Second update" },
      vi.fn(),
    );

    expect(notices[0]?.options?.tag).toBe(`sagax:chat:${frame.threadId}`);
    expect(notices[1]?.options?.tag).toBe(`sagax:chat:${frame.threadId}`);
    expect(notices[1]?.options?.body).toContain("2 messages");
    showNotification({ ...frame, botId: "bot-2", threadId: "thread-2" }, vi.fn());
    expect(notices[2]?.options?.tag).toBe("sagax:chat:thread-2");
  });

  it("carries the bot's avatar when its profile has one", () => {
    const { notices } = installNotification("granted");
    const avatarUrl = "/api/attachments/123e4567-e89b-12d3-a456-426614174000.png";

    showNotification(frame, vi.fn(), avatarUrl);
    expect(notices[0]?.options?.icon).toBe(avatarUrl);

    showNotification(frame, vi.fn(), null);
    expect(notices[1]?.options?.icon).toBeUndefined();
  });

  it("respects the Bots type switch", () => {
    sounds.bots = false;
    const { notices } = installNotification("granted");
    showNotification(frame, vi.fn());
    expect(notices).toHaveLength(0);
  });
});

describe("notification sounds", () => {
  it("lets the platform play its sound by default", () => {
    const { notices } = installNotification("granted");
    showNotification(frame, vi.fn());
    expect(notices[0]?.options?.silent).toBeUndefined();
  });

  it("posts silently when sounds are muted on this computer, keeping the banner", () => {
    sounds.enabled = false;
    const { notices } = installNotification("granted");
    showNotification(frame, vi.fn());
    expect(notices).toHaveLength(1);
    expect(notices[0]?.options).toMatchObject({ silent: true });
  });
});

describe("buildNotificationOptions", () => {
  it("keys coalescing on the chat thread and omits a missing avatar", () => {
    expect(buildNotificationOptions({ threadId: "t-9", botId: "bot-9" })).toEqual({
      tag: "sagax:chat:t-9",
      icon: undefined,
    });
  });
});

describe("notifications that stay", () => {
  it("a browser notification stays until the person acts on it, unless turned off", () => {
    const { notices } = installNotification("granted");
    showNotification(frame, vi.fn());
    expect(notices[0]?.options?.requireInteraction).toBe(true);
    sounds.persistent = false;
    showNotification(frame, vi.fn());
    expect(notices[1]?.options?.requireInteraction).toBe(false);
  });

  it("the desktop shell shows it with HIG title, chat replace id, and a click opens the thread", () => {
    const sent: Array<Record<string, unknown>> = [];
    let click: ((id: string, target?: unknown) => void) | undefined;
    vi.stubGlobal("document", { hasFocus: () => false });
    vi.stubGlobal("window", {
      focus: vi.fn(),
      ogb: {
        platform: "darwin",
        notify: (request: Record<string, unknown>) => sent.push(request),
        onNotificationClick: (cb: (id: string, target?: unknown) => void) => { click = cb; return () => {}; },
      },
    });
    const onOpen = vi.fn();
    showNotification(
      { ...frame, kind: "message", botId: "", botName: "", title: "Alice", body: "lunch?", threadId: "dm-thread", groupId: "dm-1" },
      onOpen,
      null,
      null,
      { groupName: "Alice" },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: "Alice",
      subtitle: "Alice",
      body: "lunch?",
      sound: true,
      persistent: true,
      bounce: "critical",
      flash: true,
      replaceId: "sagax:chat:dm-thread",
      hasReply: true,
    });
    click?.(sent[0]!.id as string);
    expect(sent[0]!.target).toEqual({ botId: "", threadId: "dm-thread", groupId: "dm-1" });
    expect(onOpen).toHaveBeenCalledWith({ botId: "", threadId: "dm-thread", groupId: "dm-1" });
    // a second click on the same id does nothing
    click?.(sent[0]!.id as string);
    expect(onOpen).toHaveBeenCalledOnce();
    // the page forgot the id (reload): the target the shell sent back opens it
    click?.("sagax-notification:gone", { botId: "bot-1", threadId: "t-7" });
    expect(onOpen).toHaveBeenLastCalledWith({ botId: "bot-1", threadId: "t-7" });
  });

  it("#2909: a question's desktop banner shows its whole context, lines kept, and the click target names its card", () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal("document", { hasFocus: () => false });
    vi.stubGlobal("window", {
      focus: vi.fn(),
      ogb: {
        platform: "darwin",
        notify: (request: Record<string, unknown>) => sent.push(request),
        onNotificationClick: () => () => {},
      },
    });
    const context = "Deux copies du rapport diffèrent.\n\nCopie : Locale · Date : 7 nov.\nCopie : Serveur · Date : 8 nov.\n\n• Locale : Garde tes changements d'hier\n• Serveur : Reprend la version du serveur, plus récente de 2 Ko";
    const onOpen = vi.fn();
    showNotification(
      { ...frame, kind: "question", title: "Nova : Je garde la copie locale ou celle du serveur ?", body: "Je garde la copie locale ou celle du serveur ?", requestId: "q-1", cardId: "m-q", context },
      onOpen,
    );
    expect(sent).toHaveLength(1);
    const body = sent[0]!.body as string;
    expect(body).toBe(context);
    expect(body.split("\n").length).toBeGreaterThan(4);
    expect(body).not.toMatch(/…$/);
    // the shell keeps the card in the target it sends back on a click
    expect(sent[0]!.target).toEqual({ botId: "bot-1", threadId: "thread-1", requestId: "q-1", cardId: "m-q" });
  });

  it("#2909: decisionBannerBody leaves other kinds to the preview", () => {
    expect(decisionBannerBody({ kind: "done", context: "x" })).toBeUndefined();
    expect(decisionBannerBody({ kind: "approval" })).toBeUndefined();
    expect(decisionBannerBody({ kind: "approval", ask: "Publier la version 2.4 ?", context: "La version 2.4 est prête." })).toBe("Publier la version 2.4 ?\n\nLa version 2.4 est prête.");
    expect(decisionBannerBody({ kind: "needs-you", context: "y".repeat(2000) })!.length).toBe(DESKTOP_CONTEXT_MAX);
  });

  it("the desktop shell is not asked while the person reads that conversation", () => {
    const sent: unknown[] = [];
    vi.stubGlobal("document", { hasFocus: () => true });
    vi.stubGlobal("window", { focus: vi.fn(), ogb: { notify: (request: unknown) => sent.push(request) } });
    showNotification({ ...frame, kind: "message" }, vi.fn(), undefined, frame.threadId);
    expect(sent).toHaveLength(0);
  });
});
