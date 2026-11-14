// botSpeech (shared/voice-mode.ts): how a bot speaks to a person, the one
// helper the console's bot page and get_agent (#4236) answer `speech` with.
import { describe, expect, it } from "vitest";

import { BOT_SPEECH_PERSONA_MAX, botSpeech } from "./voice-mode.ts";

describe("botSpeech", () => {
  const preference = { voice: "ara", speed: 1.2, language: "en", bots: { bot_a: { tts: "xai", voices: { xai: "rex" } } } };

  it("answers the bot's effective voice for that person, as before", () => {
    expect(botSpeech(preference, "bot_a")).toMatchObject({ xaiVoice: "rex", provider: "xai", voice: "rex", language: "en" });
    expect(botSpeech(preference, "bot_a", "fr").language).toBe("fr");
  });

  it("#4236: the bot's own voice speed wins, else the person's, left out at 1", () => {
    expect(botSpeech(preference, "bot_a", undefined, { voiceSpeed: 0.8 }).speed).toBe(0.8);
    expect(botSpeech(preference, "bot_a", undefined, {}).speed).toBe(1.2);
    expect(botSpeech(preference, "bot_a", undefined, { voiceSpeed: 9 }).speed).toBe(1.2);
    expect(botSpeech({ ...preference, speed: 1 }, "bot_a", undefined, {})).not.toHaveProperty("speed");
  });

  it("#4236: the bot's persona and instructions text, line breaks kept, at most 4000 characters, left out when empty", () => {
    expect(botSpeech(preference, "bot_a", undefined, { persona: "  You are calm.\nAnswer in one sentence.\n" }).persona).toBe("You are calm.\nAnswer in one sentence.");
    expect(botSpeech(preference, "bot_a", undefined, { persona: "x".repeat(BOT_SPEECH_PERSONA_MAX + 50) }).persona).toHaveLength(BOT_SPEECH_PERSONA_MAX);
    expect(botSpeech(preference, "bot_a", undefined, { persona: "   " })).not.toHaveProperty("persona");
    expect(botSpeech(preference, "bot_a")).not.toHaveProperty("persona");
  });
});
