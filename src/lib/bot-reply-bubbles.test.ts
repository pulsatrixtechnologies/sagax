// Two appearance toggles, both leaving the reference look by default:
// bot reply bubbles (on) and the accent on them (off, the phone's own key).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { botBubbleAccent, botReplyBubbleClass, botReplyBubbles } from "./bot-reply-bubbles";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("bot reply bubbles", () => {
  it("leaves the reference look for a person who touches nothing", () => {
    expect(botReplyBubbles.get()).toBe("on");
    expect(botBubbleAccent.get()).toBe("0");
    expect(botReplyBubbleClass(true, false)).toBe("bg-bubble-bot px-3 py-[7px]");
  });

  it("draws no bubble when off, tints only when asked", () => {
    expect(botReplyBubbleClass(false, false)).toBe("py-[7px]");
    expect(botReplyBubbleClass(false, true)).toBe("py-[7px]");
    expect(botReplyBubbleClass(true, true)).toBe("bg-bubble-bot bot-reply-accent px-3 py-[7px]");
  });

  it("shares the phone's key and syncs both choices", () => {
    expect(botBubbleAccent.key).toBe("sagax.botBubble.v1");
    expect(read("ios/Sources/CompanionCore/BotBubble.swift")).toContain('"sagax.botBubble.v1"');
    expect(USER_PREFERENCE_KEYS).toContain("sagax.botBubble.v1");
    expect(USER_PREFERENCE_KEYS).toContain("sagax.botReplyBubbles.v1");
  });

  it("styles only the bot's own class, never the shared grey", () => {
    const css = read("src/styles.css");
    expect(css).not.toMatch(/\n\.bg-bubble-bot\s*\{[^}]*color-mix/);
    expect(css).toMatch(/\.bg-bubble-bot\.bot-reply-accent\s*\{/);
    for (const file of ["src/components/ChatView.tsx-parts/Bubble.tsx", "src/components/GroupView.tsx-parts/RoomTextMessage.tsx", "src/components/LiveReply.tsx"]) {
      expect(read(file), file).toContain("useBotReplyBubbleClass");
    }
    // another person's message in a room keeps the plain grey
    expect(read("src/components/GroupView.tsx-parts/RoomTextMessage.tsx")).toContain('"chat-text whitespace-pre-wrap bg-bubble-bot px-3 py-[7px] text-ink"');
  });

  it("puts both rows in the appearance page's Conversation group", () => {
    const page = read("src/components/settings/AppearanceSettings.tsx");
    expect(page).toContain('rowId="botReplyBubbles"');
    expect(page).toContain('rowId="botBubbleAccent"');
  });
});
