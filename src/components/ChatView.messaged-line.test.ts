// #3270: a turn that messages other bots reads as ONE centered quiet line
// in the real chat view, "Messaged [face] A and [face] B", Tool calls hidden
// or shown, in the app's language. A failed send keeps its own chip.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, InstanceInfo, Message } from "@/state/store";
import { setLocale } from "@/lib/i18n";

setLocale("en");

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), showToolCalls: false, count: 6 }));

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const ids = Array.from({ length: fixture.count }, (_, i) => `r${i}`);
  return { ...original, useStore: () => ({
    state: {
      ...original.initialState,
      config: { features: { showToolCalls: fixture.showToolCalls } },
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      groups: ids.map((id) => ({
        id: `dm-${id}`, threadId: `dm-${id}-t`, name: id, dm: true, memberIds: ["bot", id],
        defaultResponder: { kind: "member", botId: id }, bulletin: "", unread: false, createdAt: 1, messages: [],
      }) as unknown as Group),
      bots: [
        { id: "bot", threadId: "t1", name: "Pepper", color: "green" },
        ...ids.map((id, i) => ({ id, threadId: `${id}-t`, name: NAMES[i], color: "blue" })),
      ],
    },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const NAMES = ["Osprey · Desk ops", "test", "Ledger", "Harbor", "Quill", "Beacon"];
const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  fixture.showToolCalls = false;
  setLocale("en");
});

const at = new Date(2026, 10, 9, 9, 0).getTime();
const text = (id: string, role: Message["role"], body: string, second: number): Message =>
  ({ id, role, kind: "text", text: body, at: at + second * 1000 }) as Message;
const chip = (i: number, ok = true): Message => ({
  id: `c${i}`, role: "bot", kind: "activity", at: at + (3 + i) * 1000,
  tool: { name: `Messaged @${NAMES[i]}`, ok },
  comm: { groupId: `dm-r${i}`, withBotId: `r${i}`, withName: NAMES[i]!, withColor: "blue", direction: "sent", text: "Hello!" },
}) as Message;

function render(recipients: number, opts: { failLast?: boolean } = {}) {
  const messages = [
    text("u", "user", "Say hello to them.", 0),
    text("b1", "bot", "Sending a hello now.", 1),
    ...Array.from({ length: recipients }, (_, i) => chip(i, !(opts.failLast && i === recipients - 1))),
    text("b2", "bot", "Done.", 30),
  ];
  messages.forEach((message, i) => { if (i > 0) message.parentId = messages[i - 1]!.id; });
  const bot = {
    id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, messages, activeLeafId: messages.at(-1)!.id,
    modelSelection: { instanceId: "test", model: "m" },
  } as Bot;
  return renderToStaticMarkup(createElement(ChatView, { bot }));
}

const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ,/g, ",");
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("Messaged line (#3270)", () => {
  it("draws two recipients as one centered line with Tool calls hidden", () => {
    const markup = render(2);
    expect(count(markup, 'data-testid="messaged-line"')).toBe(1);
    expect(markup).not.toContain('data-testid="bot-comm-chip"');
    expect(plain(markup)).toContain("Messaged Osprey · Desk ops and test");
    expect(markup).not.toContain("@Osprey");
    expect(count(markup, 'data-testid="messaged-line-recipient"')).toBe(2);
    // the bot's two lines stay around it
    expect(markup.indexOf("Sending a hello now.")).toBeLessThan(markup.indexOf('data-testid="messaged-line"'));
    expect(markup.indexOf('data-testid="messaged-line"')).toBeLessThan(markup.indexOf("Done."));
  });

  it("draws the same one line with Tool calls shown", () => {
    fixture.showToolCalls = true;
    const markup = render(2);
    expect(count(markup, 'data-testid="messaged-line"')).toBe(1);
    expect(markup).not.toContain('data-testid="bot-comm-chip"');
  });

  it("says it in French with the French conjunction", () => {
    setLocale("fr");
    const markup = render(2);
    expect(plain(markup)).toContain("Écrit à Osprey · Desk ops et test");
    expect(plain(markup)).not.toContain("Messaged");
  });

  it("names three recipients, then how many more", () => {
    const markup = render(6);
    expect(count(markup, 'data-testid="messaged-line-recipient"')).toBe(3);
    expect(plain(markup)).toContain("Messaged Osprey · Desk ops, test, Ledger, and 3 others");
    expect(markup).toContain('data-testid="messaged-line-more"');
  });

  it("keeps a failed send's own chip", () => {
    const markup = render(2, { failLast: true });
    expect(count(markup, 'data-testid="messaged-line"')).toBe(1);
    expect(count(markup, 'data-testid="messaged-line-recipient"')).toBe(1);
    expect(count(markup, 'data-testid="bot-comm-chip"')).toBe(1);
  });

  // #3275: the failed chip's words come from the catalog, not the server's tool name
  it("says a failed send in the chat's language", () => {
    setLocale("fr");
    const markup = render(2, { failLast: true });
    expect(plain(markup)).toContain("N'a pas pu écrire à test");
    expect(plain(markup)).not.toContain("Messaged @test");
    setLocale("en");
    expect(plain(render(2, { failLast: true }))).toContain("Could not message test");
  });
});
