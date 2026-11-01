// Settings > Models and voice (2026-10-14): one page instead of Integrations
// and Models and accounts. 2026-10-28: split in two pages, Models (engines,
// every key, web search, images) and Voice (voice engine, Live calls,
// microphone, the person's voice keys). One list of keys, model, voice and image alike,
// with the rare ones folded under More providers unless saved, the only place
// a key is managed (2026-10-15); the voice engine and image generation use
// their key from that list (Grok the xAI key) and link to it when it is
// missing; the ready engines in view, the others folded; Live calls under
// Advanced.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
import { setLocale } from "@/lib/i18n";
import type { ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: undefined as import("@/state/store").ConfigStatus | undefined, section: "engines" as string, instances: [] as unknown[] }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: fixture.instances, config: fixture.config }, dispatch: vi.fn(), refreshInstances: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));

const baseConfig = (over: Record<string, unknown> = {}) => ({
  box: { configured: false },
  vps: { configured: false, sshAlias: "" },
  rooms: { turnTimeoutMinutes: 5 },
  localVm: { mode: "shared", maxInstances: 2 },
  tts: { configured: false, ready: false, voice: "", provider: "elevenlabs", keys: { elevenlabs: false, fish: false } },
  live: { enabled: true, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
  imageGen: { configured: false },
  ...over,
}) as unknown as ConfigStatus;

async function page(section?: string): Promise<string> {
  if (section) fixture.section = section;
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
}

/** The markup of one part of the page, from its marker to the next one. */
function part(html: string, from: string, to?: string): string {
  const start = html.indexOf(from);
  if (start < 0) return "";
  const end = to ? html.indexOf(to, start) : -1;
  return html.slice(start, end > start ? end : undefined);
}

beforeEach(async () => {
  // 2026-10-30: the Engines and Keys groups below are Models' former view
  const { resetSettingsCards } = await import("./SettingsPrimitives");
  resetSettingsCards();
  fixture.config = baseConfig();
  fixture.section = "engines";
  fixture.instances = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings > Models and voice", () => {
  it.each(["integrations", "Intégrations", "modèle auto"])("is found by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const page = SECTIONS.find((entry) => entry.id === "engines")!;
    // the modal lowercases and trims what was typed before matching
    expect(sectionMatches(page, typed.trim().toLowerCase())).toBe(true);
  });

  // 2026-10-30: every account, key and server is on Providers
  it.each(["router", "OpenRouter", "base URL", "API key", "OpenAI", "Anthropic", "Groq", "ElevenLabs", "Azure", "fournisseurs", "voir comme un membre"])("finds Providers by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const page = SECTIONS.find((entry) => entry.id === "providers")!;
    // the modal lowercases and trims what was typed before matching
    expect(sectionMatches(page, typed.trim().toLowerCase())).toBe(true);
  });

  it.each(["voice", "voix", "ElevenLabs", "microphone", "live calls", "appels en direct", "moteur de voix"])("finds Voice by searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const page = SECTIONS.find((entry) => entry.id === "voice")!;
    expect(sectionMatches(page, typed.trim().toLowerCase())).toBe(true);
  });

  // 0.5.6: the search index follows the regrouped rows.
  it("finds the regrouped rows of Models, Voice and Usage, and opens the folded ones", async () => {
    const { SECTIONS, sectionMatches, cardsMatching } = await import("./SettingsModal");
    const models = SECTIONS.find((entry) => entry.id === "engines")!;
    const voice = SECTIONS.find((entry) => entry.id === "voice")!;
    const usage = SECTIONS.find((entry) => entry.id === "usage")!;
    for (const typed of ["modèle auto", "fournisseur d'images", "recherche web"]) expect(sectionMatches(models, typed), typed).toBe(true);
    expect(sectionMatches(SECTIONS.find((entry) => entry.id === "providers")!, "à configurer")).toBe(true);
    for (const typed of ["moteur de voix", "appels en direct", "micro"]) {
      expect(sectionMatches(voice, typed), typed).toBe(true);
      expect(sectionMatches(models, typed), typed).toBe(false);
    }
    for (const typed of ["par bot", "30 derniers jours", "renouvelle", "sagax business"]) expect(sectionMatches(usage, typed), typed).toBe(true);
    expect(cardsMatching("par bot")).toContain("usage.breakdown");
    expect(cardsMatching("cloud coding")).toContain("connections.cloudAgents");
  });

  it("is two menu entries, Models and Voice: no Integrations, no Models and accounts", async () => {
    const { SECTIONS } = await import("./SettingsModal");
    expect(SECTIONS.map((entry) => entry.id)).not.toContain("connections");
    const html = await page();
    expect(html).toContain(">Models</button>");
    expect(html).toContain(">Voice</button>");
    expect(html).not.toContain("Models and voice");
    expect(html).not.toContain(">Integrations<");
    expect(html).not.toContain("Models and accounts");
    setLocale("fr");
    const fr = await page();
    expect(fr).toContain(">Modèles</button>");
    expect(fr).toContain(">Voix</button>");
    expect(fr).not.toContain("Modèles et voix");
    expect(fr).not.toContain(">Intégrations<");
    expect(fr).not.toContain("Modèles et comptes");
  });

  it("opens Providers from an old Integrations link (2026-10-30)", async () => {
    fixture.section = "connections";
    const html = await page();
    expect(html).toContain("data-providers-page");
  });

  it("keeps models and voice choices while retiring duplicate account and key views", async () => {
    const models = await page();
    expect(models).toContain("data-bot-models-page");
    expect(models).toContain("data-auto-model-explainer");
    expect(models).toContain("data-open-providers");
    expect(models).toContain('data-settings-card="connections.image"');
    for (const retired of ["data-engines-list", "data-keys-section", "data-legacy-toggle", "data-provider-key="]) expect(models).not.toContain(retired);
    const voice = await page("voice");
    expect(voice).toContain('data-voice-providers="person"');
    expect(voice).toContain('data-settings-card="connections.audio"');
    expect(voice).toContain('data-settings-card="voice.advanced"');
    expect(voice).toContain('aria-label="Fish Audio model"');
    expect(voice).toContain('aria-label="Chatterbox server address"');
    for (const retired of ['aria-label="Voice engine"', "data-personal-voice-keys", 'type="password"']) expect(voice).not.toContain(retired);
  });

  it("keeps Live calls on the OpenAI provider with no second key entry", async () => {
    fixture.config = baseConfig({ live: { enabled: true, configured: true, voice: "", readTypedReplies: true, idleMinutes: 5 } });
    const advanced = part(await page("voice"), 'data-settings-card="voice.advanced"');
    expect(advanced).toContain('data-live-key="openai"');
    expect(advanced).toContain("Read replies to typed messages");
    expect(advanced).not.toContain('type="password"');
    setLocale("fr");
    expect(await page("voice")).toContain("Lire les réponses aux messages tapés");
  });

  // 2026-10-14: Decision model is a card of this page while its experiment
  // is on, no longer a menu entry of its own.
  it("holds Decision model as a card while its experiment is on", async () => {
    let html = await page();
    expect(html).not.toContain('data-settings-card="engines.decisionModel"');
    fixture.config = baseConfig({ features: { decisionModel: true } });
    html = await page();
    expect(html).toContain('data-settings-card="engines.decisionModel"');
    // the navigation has no entry for it
    const nav = part(html, "<nav", "</nav>");
    expect(nav).not.toContain(">Decision model<");
  });

  it("opens the card from an old Decision model link", async () => {
    fixture.config = baseConfig({ features: { decisionModel: true } });
    fixture.section = "decisionModel";
    const html = await page();
    expect(html).toContain("data-models-voice");
    expect(html).toContain('data-settings-card="engines.decisionModel"');
  });

  it("points OpenCode users at `opencode auth login` in the OpenCode key dialog", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("opencodeGo");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    expect(html).toContain("More providers for OpenCode bots");
    expect(html).toContain('<code class="font-mono">opencode auth login</code>');
  });

  // A Cloud has no terminal: a key for any OpenCode provider is saved here.
  it("offers keys for other OpenCode providers next to the OpenCode key", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("opencodeGo");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    const opencode = html.indexOf('data-api-key-row="opencodeGo"');
    expect(opencode).toBeGreaterThan(0);
    expect(html.indexOf("data-opencode-provider-keys")).toBeGreaterThan(opencode);
    expect(html).toContain("Keys for other OpenCode providers");
    expect(html).not.toContain(">Optional<");
  });

  it("opens a voice key in the same dialog as a model key", async () => {
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("fishAudio");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    expect(html).toContain('data-provider-key-dialog="fishAudio"');
    expect(html).toContain('data-api-key-row="fishAudio"');
    expect(html).toContain("Fish Audio API keys");
  });

  it("keeps the Anthropic key dialog without the retired every-Claude override", async () => {
    fixture.config = baseConfig({ anthropic: { configured: true, everyClaudeBot: true } });
    const { ProviderKeyDialog, openProviderKeyDialog } = await import("./settings/ProviderKeys");
    openProviderKeyDialog("anthropic");
    const html = renderToStaticMarkup(createElement(ProviderKeyDialog));
    openProviderKeyDialog(null);
    expect(html).toContain('data-api-key-row="anthropic"');
    expect(html).not.toContain("data-anthropic-every-claude-bot");
  });
});
