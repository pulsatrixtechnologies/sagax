// The bot's profile page (#2313), Model & tools > Voice & alerts under the
// plain surface: "Who speaks and who listens", "Voice" and "Notifications"
// each carry their own grey label over one plain card; nothing is bordered,
// underlined or a primary pill, and every voice row is still there.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return { ...actual, useStore: () => ({ state: { ...actual.initialState, config: { tts: true, personalSettings: true } }, dispatch: vi.fn() }) };
});
vi.mock("@/lib/tts", () => ({ speaker: { speak: vi.fn() } }));
vi.mock("@/lib/local-voice", () => ({
  listLocalSystemVoices: () => [], localSystemVoicesAvailable: () => false, remoteSystemVoice: () => "",
  remoteVoiceProvider: () => "host", setRemoteSystemVoice: vi.fn(), setRemoteVoiceProvider: vi.fn(),
}));
vi.mock("@/lib/voice-mode/api", () => ({ fetchProviderVoices: vi.fn(), fetchVoiceProviders: vi.fn(), testVoice: vi.fn() }));
vi.mock("./bot-settings/BotEditorContext", () => ({ useBotEditor: () => ({ draft: false }) }));
vi.mock("@/lib/viewer-bot-overrides", () => ({
  viewerLocalBotSettings: () => false, useViewerBotOverride: () => undefined, saveViewerBotOverride: vi.fn(),
}));

const { VoiceSettings } = await import("./VoiceSettings");
const { VoiceSection } = await import("./bot-settings/VoiceSection");
const { SettingsSurfaceProvider } = await import("./SettingsPrimitives");

const bot = { id: "bot-1", name: "Example bot", speakReplies: true, voiceNotes: true } as Bot;
const plain = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(SettingsSurfaceProvider, { surface: "plain", children: child }));
// HelpTip popovers keep their own outline (a floating surface, not a card).
const withoutPopovers = (markup: string) => markup.replace(/<div[^>]*popover-surface[\s\S]*?<\/div>/g, "");
const BORDER = /\bborder(-\[|-border|-hairline|-accent)/;

describe("Voice & alerts on the profile page (plain surface)", () => {
  it("labels the providers and the voice cards, with every row and no border", () => {
    const markup = plain(createElement(VoiceSettings, { bot, onPatch: vi.fn() }));
    expect(markup).toContain('data-voice-providers="bot"');
    expect(markup).toContain(">Who speaks and who listens<");
    expect(markup).toContain('data-settings-group="botVoice"');
    expect(markup).toContain(">Voice<");
    expect(markup).toContain("Read replies aloud");
    expect(markup).toContain("Voice notes");
    const bare = withoutPopovers(markup);
    expect(bare).not.toMatch(BORDER);
    expect(bare).not.toContain("underline");
    expect(bare).not.toContain("ui-button-primary");
  });

  it("keeps the bordered look outside the profile page", () => {
    const markup = renderToStaticMarkup(createElement(VoiceSettings, { bot, onPatch: vi.fn() }));
    expect(markup).not.toContain('data-settings-group="botVoice"');
    expect(markup).toContain("Read replies aloud");
  });

  it("gives the section's Notifications card its own grey label", () => {
    const markup = plain(createElement(VoiceSection, { bot, derived: { canEdit: () => true, patch: vi.fn() } as never }));
    expect(markup).toContain(">Notifications<");
    expect(markup).toContain('data-settings-group="botNotifications"');
    expect(markup).toContain(">Voice<");
    const bare = withoutPopovers(markup);
    expect(bare).not.toMatch(BORDER);
    expect(bare).not.toContain("underline");
    expect(bare).not.toContain("ui-button-primary");
  });
});
