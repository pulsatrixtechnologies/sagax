/** Isolated gallery for headless screenshots of the claude.ai artifact cards
 * (src/components/ClaudeArtifactCard.tsx, #2018) beside the plain page card.
 * Not shipped in the app. fetch is mocked: no claude.ai request leaves.
 * ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactCard } from "../components/ArtifactCard";
import { ClaudeArtifactCard, ClaudeArtifactConsentCard } from "../components/ClaudeArtifactCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "@/state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const OWNED = "https://claude.ai/artifact/OwnedPage0001";
const OTHER = "https://claude.ai/artifact/SharedPage0002";
const SIGNED_OUT = "https://claude.ai/artifact/SignedOut0003";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const SUMMARIES: Record<string, { status?: number; body: unknown }> = {
  [OWNED]: { body: { url: OWNED, title: "Plan du trimestre", owned: true, updatedAt: ago(12), summary: "Trois objectifs pour le trimestre, avec un responsable et une date pour chacun. Le tableau de suivi est à la fin." } },
  [OTHER]: { body: { url: OTHER, title: "Guide d'accueil de l'équipe", owned: false, updatedAt: ago(60 * 26), summary: "Les étapes de la première semaine : accès, outils, personnes à rencontrer." } },
  [SIGNED_OUT]: { status: 409, body: { error: "claude_not_signed_in" } },
};
const THREADS = [
  { id: "c1", status: "open", author: "Alex", createdAt: ago(40), text: "Le deuxième objectif manque une date. On vise la fin novembre?", replies: [{ author: "Sam", createdAt: ago(25), text: "Oui, fin novembre." }] },
  { id: "c2", status: "open", author: "Sam", createdAt: ago(8), text: "Ajouter le lien vers le tableau de suivi.", replies: [] },
];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!raw.startsWith("/api/")) return realFetch(input, init);
  const url = new URL(raw, location.origin);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/claude-artifacts/summary") {
    const hit = SUMMARIES[url.searchParams.get("url") ?? ""];
    return hit ? json(hit.body, hit.status) : json({ error: "not_found" }, 404);
  }
  if (url.pathname === "/api/claude-artifacts/comments") return json({ threads: THREADS });
  if (url.pathname.startsWith("/api/claude-artifacts/comments/")) return json({ ok: true });
  return json({}, 404);
}) as typeof window.fetch;

const section = (id: string, children: React.ReactNode) => <section data-gallery-card={id} className="mb-4 max-w-[560px]">{children}</section>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
        {section("page", <ArtifactCard page={{ title: "Rapport hebdomadaire", url: "https://pages.example.com/rapport" }} />)}
        {section("owned", <ClaudeArtifactCard url={OWNED} />)}
        {section("other", <ClaudeArtifactCard url={OTHER} />)}
        {section("consent", <ClaudeArtifactConsentCard url="https://claude.ai/artifact/OtherAcct0004" account="moteur@example.com" onSendToBot={() => undefined} />)}
        {section("signed-out", <ClaudeArtifactCard url={SIGNED_OUT} title="Notes de réunion" />)}
      </main>
    </StoreProvider>
  </StrictMode>,
);
