import { afterEach, describe, expect, it } from "vitest";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import {
  CHAT_WIDTH_KEY,
  chatWidthChoice,
  parseChatWidth,
  setChatWidth,
} from "./chat-width-preference";

describe("chatWidth preference", () => {
  afterEach(() => {
    setChatWidth("reading");
    try {
      globalThis.localStorage?.removeItem(CHAT_WIDTH_KEY);
    } catch {
      // jsdom without storage
    }
  });

  it("is one of the person's synced appearance keys", () => {
    expect(USER_PREFERENCE_KEYS).toContain(CHAT_WIDTH_KEY);
  });

  it("defaults to reading and persists the three choices", () => {
    expect(chatWidthChoice.get()).toBe("reading");
    expect(parseChatWidth("wide")).toBe("wide");
    setChatWidth("wide");
    expect(chatWidthChoice.get()).toBe("wide");
    setChatWidth("full");
    expect(chatWidthChoice.get()).toBe("full");
    setChatWidth("reading");
    expect(chatWidthChoice.get()).toBe("reading");
  });
});
