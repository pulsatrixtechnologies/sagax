/** Headless gallery for Settings > Vault > Payments (2026-11-01).
 * Synthetic data only. ?skin=&lang=&tab=payments|all|logins|contacts
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { CredentialsSettings } from "../components/settings/CredentialsSettings";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.26", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const tab = params.get("tab") ?? "payments";
if (tab) {
  const url = new URL(location.href);
  url.searchParams.set("tab", tab);
  history.replaceState(null, "", url);
}

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.includes("/api/me/credentials/list")) {
    return json({
      items: [
        {
          id: "cardada01", kind: "card", name: "Carte boutique", domains: [],
          hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local",
          card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, holder: "Ada Lovelace" },
          grants: [], createdAt: 1, updatedAt: 1,
        },
        {
          id: "loginmail1", kind: "login", name: "Portail exemple", username: "ada@example.test",
          domains: ["example.test"], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false,
          source: "local", grants: [], createdAt: 1, updatedAt: 1,
        },
        {
          id: "addrhome1", kind: "address", name: "Maison", domains: [],
          hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false, source: "local",
          address: { recipient: "Ada Lovelace", line1: "1 Rue des Tests", city: "Montreal", postal: "H2X 1Y4", country: "CA" },
          grants: [], createdAt: 1, updatedAt: 1,
        },
      ],
      purchases: [{
        id: "pay_aaaaaaaaaaaaaaaa", botId: "bot-nova", threadId: "thread-1",
        merchant: "Boutique Exemple", domain: "shop.example.test", amount: "45.20", currency: "CAD",
        cardName: "Carte boutique", cardLast4: "4242", cardBrand: "visa",
        title: "Pay 45.20 CAD to Boutique Exemple with visa ···· 4242?",
        line: "2 items. Card ending 4242 (visa). The bot never sees the number or the security code.",
        status: "pending", createdAt: Date.now() - 60_000,
      }],
      history: [{
        id: "pay_bbbbbbbbbbbbbbbb", botId: "bot-nova", threadId: "thread-2",
        merchant: "Librairie Exemple", domain: "books.example.test", amount: "28.00", currency: "CAD",
        cardName: "Carte boutique", cardLast4: "4242", cardBrand: "visa",
        title: "Pay 28.00 CAD to Librairie Exemple with visa ···· 4242?",
        line: "1 item.", status: "once", createdAt: Date.now() - 86400_000, doneAt: Date.now() - 86000_000,
        orderRef: "LX-1042",
      }],
      wallets: {
        shop_pay: { chosen: true, ready: false, missing: "shop CLI" },
        link: { chosen: true, ready: true, missing: "" },
      },
      payments: {
        defaultMethod: { type: "card", cardId: "cardada01" },
        bots: { "bot-nova": { enabled: true, perPurchaseLimit: "100.00", perMonthLimit: "400.00", merchants: ["example.test"] } },
      },
      methods: [
        { id: "card:cardada01", type: "card", label: "Carte boutique", detail: "visa ···· 4242", brand: "visa", last4: "4242", isDefault: true },
        { id: "wallet:link", type: "wallet", label: "Link", detail: "Connected", brand: "wallet", wallet: "link", isDefault: false, ready: true },
        { id: "wallet:shop_pay", type: "wallet", label: "Shop Pay", detail: "Not live yet: shop CLI", brand: "wallet", wallet: "shop_pay", isDefault: false, ready: false },
      ],
      onePassword: { available: false },
    });
  }
  if (url.includes("/api/me/credentials/payments")) {
    return json({
      payments: { defaultMethod: { type: "card", cardId: "cardada01" }, bots: { "bot-nova": { enabled: true } } },
      methods: [
        { id: "card:cardada01", type: "card", label: "Carte boutique", detail: "visa ···· 4242", brand: "visa", last4: "4242", isDefault: true },
      ],
    });
  }
  if (url.includes("/api/me/credentials/wallets")) {
    return json({
      wallets: {
        shop_pay: { chosen: true, ready: false, missing: "shop CLI" },
        link: { chosen: true, ready: true, missing: "" },
      },
    });
  }
  if (url.includes("/purchases/") && url.includes("/answer")) {
    return json({ purchase: { id: "pay_aaaaaaaaaaaaaaaa", status: "once", title: "ok", line: "ok", merchant: "Boutique Exemple", amount: "45.20", currency: "CAD", cardName: "x", cardLast4: "4242" } });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const store = {
  ...initialState,
  bots: [
    { id: "bot-nova", name: "Nova", color: "orange", kind: "personal" },
    { id: "bot-osprey", name: "Osprey", color: "violet", kind: "personal" },
  ],
};

function Gallery() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink" data-gallery-vault-payments="" data-gallery-ready={ready ? "1" : "0"}>
      <div className="mx-auto w-full max-w-[720px] rounded-2xl border border-hairline/40 bg-panel p-4 shadow-sm">
        <CredentialsSettings />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={{ state: store as never, dispatch: () => {}, flushBotPatches: async () => null } as never}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
