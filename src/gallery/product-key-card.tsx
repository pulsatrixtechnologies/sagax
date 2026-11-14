/** Isolated gallery for headless screenshots of a Perspicax product's key
 * card in the chat (#4185), under the conforming neighbour (the custom secret
 * card). Not shipped in the app. ?lang=<code>&skin=<id>&state=pending|refused|saved|other
 * (other: a viewer of a group conversation who is not the card's person)
 * Fake data only: neutral names, no key value. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SecretRequestCard } from "../components/SecretRequestCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import { parsePersonProduct } from "../../shared/person-products";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const state = params.get("state") ?? "pending";

const product = parsePersonProduct({
  id: "prod-docs", name: "Knowledge Base", state: state === "refused" ? "key_refused" : "key_missing",
  form: { kind: "basic", fields: [
    { slot: "username", label: { en: "Username", fr: "Nom d'utilisateur" }, secret: false, required: true },
    { slot: "password", label: { en: "Password", fr: "Mot de passe" }, secret: true, required: true },
  ] },
  base_url: "https://docs.example.org", reason_code: null, takes_key_kind: "basic",
  profiles: [{ name: "Technicians", mode: "compact", personal: false }],
  key: { source: null, named: false, own: false },
  actions: { set_own_key: true, replace_key: false, test: false, remove_own_key: false, sign_in: false, sign_out: false },
  console_url: "https://px.example.test/console/products/prod-docs",
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/me/perspicax/products/")) return json({ product });
  return realFetch(input, init);
};

const from = { botId: "bot-osprey", name: "Osprey", color: "violet" };
const neighbour = {
  id: "m-custom", role: "bot", kind: "secret", at: 0, text: "", from,
  secret: { target: "customSecret", label: "Example API key", description: "", placeholder: "Paste the secret", helpUrl: "", reason: "To read the example service for you.", delivery: "ref", requestKey: "k0" },
} as unknown as Message;
const card = {
  id: "m-product", role: "bot", kind: "productKey", at: 0, text: "", from,
  secret: {
    target: "perspicaxProduct", label: "Knowledge Base", description: "", placeholder: "", helpUrl: "", requestKey: "k1",
    product: { id: "prod-docs", name: "Knowledge Base", reason: state === "refused" ? "key_refused" : "key_missing", for: "pr_viewer" },
    ...(state === "refused" ? { result: { ok: false, status: 401, code: "unauthorized", at: 1 } } : {}),
    ...(state === "saved" ? { provided: true, resumed: true, result: { ok: true, at: 1 } } : {}),
  },
} as unknown as Message;

const viewer = { principalId: state === "other" ? "pr_colleague" : "pr_viewer", role: "member" };
const store = { state: { bots: [{ id: "bot-osprey", name: "Osprey", color: "violet" }], config: { viewer } }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px] space-y-6" data-gallery-card>
        <SecretRequestCard botId="bot-osprey" threadId="thread-1" message={neighbour} />
        <SecretRequestCard botId="bot-osprey" threadId="thread-1" message={card} />
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
