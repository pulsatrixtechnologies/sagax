import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { BotChatHeader } from "../components/BotHeaderPill";
import { ChatHeaderBar } from "../components/ChatHeaderBar";
import {
  CONVERSATION_HEADER_KEY,
  CONVERSATION_HEADERS,
  conversationHeaderChoice,
  parseConversationHeader,
  setConversationHeader,
} from "./conversation-header";

// The owner, 2026-11-23: the centred pill and the plain title at the top left
// are both fine; the person chooses in Settings > Appearance, the pill is the
// default (#4536).
describe("conversation header: centred pill or title at the top left (#4536)", () => {
  afterEach(() => {
    setConversationHeader("pill");
    try {
      globalThis.localStorage?.removeItem(CONVERSATION_HEADER_KEY);
    } catch {
      // jsdom without storage
    }
  });

  it("is one of the person's synced appearance keys, and a setting a bot can change", () => {
    expect(USER_PREFERENCE_KEYS).toContain(CONVERSATION_HEADER_KEY);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.conversationHeader");
    expect(spec?.value).toBe("enum:pill|title");
    expect(spec?.where).toContain("Conversation");
  });

  it("defaults to the centred pill and persists the two choices", () => {
    expect(CONVERSATION_HEADERS).toEqual(["pill", "title"]);
    expect(conversationHeaderChoice.get()).toBe("pill");
    expect(parseConversationHeader(null)).toBe("pill");
    expect(parseConversationHeader("nope")).toBe("pill");
    expect(parseConversationHeader("title")).toBe("title");
    setConversationHeader("title");
    expect(conversationHeaderChoice.get()).toBe("title");
    setConversationHeader("pill");
    expect(conversationHeaderChoice.get()).toBe("pill");
  });

  it("the conversation draws the look the person chose: the bar's alignment and the pill's fill follow the choice", () => {
    const header = readFileSync(new URL("../components/ChatView.tsx-parts/ChatViewHeader.tsx", import.meta.url), "utf8");
    expect(header).toMatch(/align=\{conversationHeader === "title" \? "start" : "center"\}/);
    const presence = readFileSync(new URL("../components/ChatView.tsx-parts/useChatViewPresence.tsx", import.meta.url), "utf8");
    expect(presence).toMatch(/plain=\{conversationHeader === "title"\}/);
  });

  it("pill: centred on the column, with the pill's fill; title: at the left, on the chat ground, no fill", () => {
    const name = (plain: boolean) => createElement(BotChatHeader, { name: "Pepper", label: "Research", panelOpen: false, plain, onToggle: () => {}, avatar: createElement("span") });
    const pill = renderToStaticMarkup(createElement(ChatHeaderBar, { align: "center", center: name(false) }));
    expect(pill).toContain('data-chat-header-align="center"');
    expect(pill).toContain("m-auto");
    expect(pill).toContain("rounded-full");
    expect(pill).not.toContain("data-chat-title");
    const title = renderToStaticMarkup(createElement(ChatHeaderBar, { align: "start", center: name(true) }));
    expect(title).toContain('data-chat-header-align="start"');
    expect(title).toContain("bg-app");
    expect(title).toContain("data-chat-title");
    expect(title).not.toContain("rounded-full");
  });

  it("has its row in Settings > Appearance > Conversation, beside the space under the composer", () => {
    const page = readFileSync(new URL("../components/settings/AppearanceSettings.tsx", import.meta.url), "utf8");
    expect(page).toContain('rowId="conversationHeader"');
    expect(page).toMatch(/<ComposerBottomSpaceRow \/>\s*<ConversationHeaderRow \/>/);
  });
});
