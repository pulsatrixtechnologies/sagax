/** Isolated gallery for headless screenshots of a published page's full-page
 * viewer (src/components/PageViewer.tsx) and its card. Not shipped in the app.
 * ?lang=<code>&skin=<id>&page=<pageId>&kind=html|markdown|presentation
 * &status=published|draft&policy=off&view=dialog|card
 * The page id must be one a pages server behind /pages/ knows (the capture
 * script runs one); without it the frame shows that server's 404. Every
 * message the viewer sends to a bot lands in window.__sent and every write in
 * window.__writes, so a headless run can check what one click did. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { PageViewerDialog } from "../components/PageViewer";
import { PagePublishCard } from "../components/PublishedPages";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import type { PageComment, PageKind, PublishedPageSummary } from "../../shared/published-pages";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const pageId = params.get("page") ?? "galleryPage0001";
const kind = (params.get("kind") ?? "html") as PageKind;
const published = params.get("status") !== "draft";
const linkSharing = params.get("policy") !== "off";

declare global {
  interface Window { __sent: unknown[]; __writes: unknown[] }
}
window.__sent = [];
window.__writes = [];

const now = Date.UTC(2026, 9, 21, 15, 0);
let page: PublishedPageSummary = {
  id: pageId,
  title: kind === "presentation" ? "Bilan du trimestre" : "Rapport mensuel",
  status: published ? "published" : "draft",
  access: published ? "link" : "private",
  expiresAt: null,
  currentVersion: published ? 2 : null,
  botId: "bot-katarina",
  threadId: "thread-katarina",
  createdAt: now - 86_400_000,
  updatedAt: now,
  expired: false,
  versions: [
    { n: 1, kind, title: "Rapport mensuel", createdAt: now - 86_400_000, state: "proposed", bytes: 1200, botId: "bot-katarina" },
    { n: 2, kind, title: "Rapport mensuel", createdAt: now - 3_600_000, state: published ? "published" : "proposed", bytes: 1400, botId: "bot-katarina" },
  ],
  comments: 1,
  ...(published ? { url: `https://sagax.example.com/pages/view/${"x".repeat(22)}.${"y".repeat(32)}`, path: "/pages/view/x", reachable: true } : {}),
};
let comments: PageComment[] = [
  { id: "c1", at: now - 1_800_000, text: "Ajouter les chiffres de septembre.", version: 2, anchor: { tag: "h2", text: "Ventes", path: "body > h2" } },
];

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
  const base = `/api/pages/${pageId}`;
  if (url.pathname === "/api/auth/session") return reply({});
  if (url.pathname === "/api/pages/policy") return reply({ linkSharing });
  if (!url.pathname.startsWith(base)) return realFetch(input, init);
  if (method !== "GET") window.__writes.push({ method, path: url.pathname, body });
  const rest = url.pathname.slice(base.length);
  const source = /^\/versions\/(\d+)\/source$/.exec(rest);
  if (source) {
    const content = kind === "presentation"
      ? "# Bilan du trimestre\n\nKatarina, octobre 2026\n\n---\n\n## Ventes\n\n- Septembre : en hausse\n- Octobre : stable\n\n---\n\n## Prochaines étapes\n\n1. Relancer les clients\n2. Préparer le budget"
      : "<!doctype html><html><body><h1>Rapport mensuel</h1><h2>Ventes</h2><p>Les ventes de septembre sont en hausse.</p></body></html>";
    return reply({ version: { n: Number(source[1]), kind, title: page.title }, content });
  }
  const version = /^\/versions\/(\d+)$/.exec(rest);
  if (version) return reply({ version: { n: Number(version[1]), kind, title: page.title, state: "published", previewPath: `/pages/preview/${pageId}/${version[1]}` } });
  if (rest === "/versions" && method === "POST") {
    const n = page.versions.length + 1;
    page = { ...page, versions: [...page.versions, { n, kind, title: page.title, createdAt: Date.now(), state: "proposed", bytes: 10, botId: page.botId, author: "person" }] };
    return reply({ page, version: n }, 201);
  }
  if (rest === "/reader-comments") return reply({ enabled: true, allowed: true, comments: [
    { id: "r1", at: now - 600_000, name: "Marie", text: "Très clair, merci!", status: "pending" },
    { id: "r2", at: now - 7_200_000, name: "Luc", text: "Les chiffres d'août manquent.", status: "approved" },
  ] });
  if (rest === "/comments" && method === "GET") return reply({ comments });
  if (rest === "/comments" && method === "POST") {
    const comment = { id: `c${comments.length + 1}`, at: Date.now(), text: String(body?.text ?? "") } as PageComment;
    comments = [...comments, comment];
    return reply({ comment }, 201);
  }
  if (rest === "" && method === "PATCH" && typeof body?.title === "string") {
    page = { ...page, title: body.title };
    return reply({ page });
  }
  if (rest === "" || rest === "/publish" || rest === "/revoke") return reply({ page });
  return reply({ ok: true });
};

const store = {
  state: {},
  dispatch: (action: unknown) => { window.__sent.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const message = {
  id: "m1", role: "bot", kind: "text", at: now, text: "Page proposée",
  pagePublish: { pageId, version: published ? 2 : 1, title: page.title },
} as unknown as Message;

function Gallery() {
  const [open, setOpen] = useState(params.get("view") !== "card");
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-3 rounded-2xl bg-card px-4 py-3 text-[14px]">Katarina : voici la page demandée.</div>
        <PagePublishCard message={message} />
        <button type="button" data-gallery-open className="text-[12px] text-accent" onClick={() => setOpen(true)}>open</button>
      </div>
      {open && <PageViewerDialog pageId={pageId} returnFocus={null} onClose={() => setOpen(false)} />}
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
