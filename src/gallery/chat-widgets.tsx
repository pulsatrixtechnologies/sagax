/** Isolated gallery for Playwright screenshots of the declarative chat
 * widgets (message kind "widget", show_widget). Not shipped in the app.
 * Every sample of shared/widget-samples.ts is drawn by the real renderer;
 * a press is answered here (nothing leaves the page) and folds the card
 * as the server's answer would.
 * ?skin=<id>&lang=<code>&only=<sample name>&narrow=1&booked=<slot index of bookingCard> */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { WidgetCardFrame } from "../components/widget/WidgetCardFrame";
import { WidgetMessage } from "../components/widget/WidgetMessage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import { WIDGET_SAMPLES } from "../../shared/widget-samples";
import { parseWidgetInput, widgetActions, widgetToText, type WidgetPayload } from "../../shared/widget";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const only = params.get("only");
const narrow = params.get("narrow") === "1";

// The send route, answered in the page: a press is taken (202) and goes nowhere.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\/api\/bots\/[\w-]+\/messages$/.test(url) && init?.method === "POST") {
    return new Response(JSON.stringify({ ok: true, threadId: "gallery" }), { status: 202, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

const store = { state: { config: { profile: { name: "Alex Doe" } } }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

function message(name: string, extra: Partial<WidgetPayload> = {}): Message | null {
  const parsed = parseWidgetInput(WIDGET_SAMPLES[name]);
  if (!parsed.ok) return null;
  // a booked Booking: the time at this index of its slots was pressed
  const booked = name === "bookingCard" ? widgetActions(parsed.value)[Number(params.get("booked"))] : undefined;
  if (booked && params.has("booked")) extra = { ...extra, settled: { ref: booked.ref, label: booked.label, tone: "submit", at: 0 } };
  return { id: `gallery-${name}`, role: "bot", kind: "widget", at: 0, text: widgetToText(parsed.value), widget: { v: 1, root: parsed.value, ...extra } };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-gallery-section={title}>
      <h2 className="mb-3 font-mono text-[12px] text-ink-tertiary">{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  const names = Object.keys(WIDGET_SAMPLES).filter((name) => !only || name === only);
  const settled = message("pullRequests", { settled: { ref: "confirm", label: "Merge the two ready", tone: "confirm", at: 0 } });
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className={narrow ? "mx-auto flex max-w-[380px] flex-col gap-10" : "mx-auto flex max-w-3xl flex-col gap-10"}>
        <h1 className="text-lg font-semibold">Widgets déclaratifs (show_widget)</h1>
        {names.map((name) => {
          const row = message(name);
          return row ? (
            <Section key={name} title={name}>
              <WidgetMessage botId="gallery" threadId="gallery" message={row} />
            </Section>
          ) : null;
        })}
        {!only && settled && (
          <Section title="settled">
            <WidgetMessage botId="gallery" threadId="gallery" message={settled} />
          </Section>
        )}
        {!only && (
          <Section title="WidgetCardFrame">
            <WidgetCardFrame label="Carte réutilisable" title="Carte réutilisable" caption="Le cadre que l'hôte MCP Apps réutilisera" meta="ui://" fallbackText="Carte réutilisable">
              <p className="text-[14px] leading-5 text-ink-secondary">Contenu de l'appelant (par exemple un iframe ui:// isolé).</p>
            </WidgetCardFrame>
          </Section>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
