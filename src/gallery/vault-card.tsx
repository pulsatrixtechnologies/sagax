/** Isolated gallery for headless screenshots of a bot's sign-in request
 * card with the person's 1Password items (parité R10, ligne 82). Not
 * shipped in the app. ?lang=<code>&skin=<id>&state=pending|allowed|turn
 * (&empty=1: no saved login, the card opens on a new one, "This turn only").
 * Fake data only. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VaultRequestCard } from "../components/VaultRequestCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const allowed = params.get("state") === "allowed";
const turn = params.get("state") === "turn";
const empty = params.get("empty") === "1";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/me/credentials/list")) {
    if (empty) return json({ items: [], onePassword: { available: false } });
    return json({
      items: [{ id: "abcd1234ef", kind: "login", name: "Portail Exemple", username: "ada@example.test", domains: ["example.test"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local", grants: [], createdAt: 0, updatedAt: 0 }],
      onePassword: { available: true, via: "cli" },
    });
  }
  if (url.includes("/onepassword")) {
    if (empty) return json({ available: false, items: [] });
    return json({ available: true, onePassword: { available: true, via: "cli" }, items: [
      { vaultId: "vlt1", itemId: "aaaa1111", title: "Exemple travail", vaultName: "Travail", domains: ["example.test"] },
      { vaultId: "vlt2", itemId: "bbbb2222", title: "Exemple admin", vaultName: "Perso", domains: ["admin.example.test"] },
    ] });
  }
  return realFetch(input, init);
};

const message = {
  id: "vault-m1", role: "bot", kind: "secret", at: 0, text: "Login for example.test",
  from: { botId: "bot-osprey", name: "Osprey", color: "violet" },
  secret: {
    target: "vaultLogin", label: "Login for example.test", description: "", placeholder: "", helpUrl: "", requestKey: "k1",
    vault: { principalId: "local", domain: "example.test", ...(allowed ? { itemId: "x", itemName: "Exemple travail", mode: "once", onePassword: true } : {}), ...(turn ? { itemName: "example.test", mode: "once", turnOnly: true } : {}) },
    ...(allowed || turn ? { provided: true, resumed: true } : {}),
  },
} as unknown as Message;

const store = { state: { bots: [{ id: "bot-osprey", name: "Osprey", color: "violet" }] }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px]" data-gallery-card>
        <VaultRequestCard botId="bot-osprey" threadId="thread-1" message={message} />
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
