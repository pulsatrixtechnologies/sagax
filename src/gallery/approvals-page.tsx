// Dev preview of the Approvals screen (src/components/approvals/), for
// headless captures: the real ApprovalsPage over a fixture list served by a
// local fetch stand-in. Served by Vite in dev at
// /src/gallery/approvals-page.html; not part of the packaged app.
// ?n=0|3|40&lang=fr|en&skin=<id>&scope=org (adds organization and team cards) &today=1 (a "needs you" card and a proactive proposal, #2689)
// &routine=1 (2026-11-04: the oldest card is a routine run's, named by its routine)
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import type { InboxApproval, InboxHistoryEntry, InboxPayload } from "../../shared/approvals-inbox";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ApprovalsPage } from "@/components/approvals/ApprovalsPage";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "@/state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "pulsatrix") as SkinId);
const COUNT = Number(params.get("n") ?? 3);
const ORG = params.get("scope") === "org";
const ROUTINE = params.get("routine") === "1";
const TODAY = params.get("today") === "1";
const NOW = Date.now();
const MIN = 60_000;

const BOTS = [
  { id: "b-nova", name: "Nova", color: "green" },
  { id: "b-pixel", name: "Pixel", color: "orange" },
  { id: "b-echo", name: "Echo", color: "purple" },
  { id: "b-atlas", name: "Atlas", color: "blue" },
] as const;

function permission(i: number, botIndex: number, ageMin: number, tool: string, input: unknown, patch: Partial<InboxApproval> = {}, cardPatch: Record<string, unknown> = {}): InboxApproval {
  const bot = BOTS[botIndex % BOTS.length]!;
  const json = JSON.stringify(input);
  const message = {
    id: `m${i}`, role: "bot", kind: "options", at: NOW - ageMin * MIN,
    card: {
      title: "Approval needed",
      subtitle: tool === "Bash" ? (input as { command: string }).command : json,
      toolInput: json,
      options: ["Allow", "Deny"],
      requestId: `req-${i}`,
      tool,
      ...(tool === "Bash" ? { commandAllowlist: { command: (input as { command: string }).command, cwd: "~/Projets/app", providerInstanceId: "claude" }, allowSession: true } : { allowSession: true }),
      ...cardPatch,
    },
  } as unknown as Message;
  return {
    key: `t${i}:req-${i}`, threadId: `t${i}`, requestId: `req-${i}`, botId: bot.id, botName: bot.name,
    threadTitle: ["Nettoyage du dépôt", "Suivi des billets", "Rapport mensuel", "Migration du cluster"][i % 4],
    scope: "mine", kind: "permission", at: NOW - ageMin * MIN, decidable: true, bulk: true,
    destination: "computer", tool, message, ...patch,
  };
}

function question(i: number, botIndex: number, ageMin: number): InboxApproval {
  const bot = BOTS[botIndex % BOTS.length]!;
  const message = {
    id: `m${i}`, role: "bot", kind: "options", at: NOW - ageMin * MIN,
    card: {
      title: "Question", subtitle: "", options: [], requestId: `req-${i}`, tool: "AskUserQuestion", requestType: "question",
      questionRequest: { version: 1, questions: [{ question: "Quel environnement dois-je mettre à jour en premier ?", options: [{ label: "Préproduction", description: "Les testeurs internes" }, { label: "Production", description: "Tout le monde" }, { label: "Les deux, dans cet ordre" }] }] },
    },
  } as unknown as Message;
  return {
    key: `t${i}:req-${i}`, threadId: `t${i}`, requestId: `req-${i}`, botId: bot.id, botName: bot.name, threadTitle: "Déploiement de la version",
    scope: "mine", kind: "question", at: NOW - ageMin * MIN, decidable: true, bulk: "question", message,
  };
}

function fixtures(n: number): InboxApproval[] {
  const out: InboxApproval[] = [];
  const base = [
    () => permission(0, 0, 4, "Bash", { command: "rm -rf build/ && pnpm build" }, { risk: "execute" }),
    () => question(1, 1, 75),
    () => permission(2, 2, 26 * 60, "mcp__linear__create_issue", { title: "Corriger la page de connexion", team: "Web" }, { risk: "write", needsKey: true, bulk: "needs-key" }),
  ];
  for (let i = 0; i < n; i++) {
    if (i < base.length) { out.push(base[i]!()); continue; }
    // a send in the person's name: answered on its own card, never in a bulk answer
    if (i === 6) { out.push(permission(i, i, 18, "mcp__outlook__send_mail", { to: "client@example.com", subject: "Suivi de votre demande" }, { risk: "write", bulk: "special" }, { outboundRequest: { tool: "mcp__outlook__send_mail", app: "Outlook" } })); continue; }
    const kind = i % 5;
    if (kind === 0) out.push(question(i, i, i * 7));
    else if (kind === 1) out.push(permission(i, i, i * 9, "Read", { file_path: `/Users/ada/Projets/app/docs/guide-${i}.md` }, { risk: "read" }));
    else if (kind === 2) out.push(permission(i, i, i * 31, "Bash", { command: `git push origin feat/lot-${i}` }, { risk: "execute" }));
    else if (kind === 3) out.push(permission(i, i, i * 3, "WebFetch", { url: "https://example.com/docs/guide" }, { risk: "read" }));
    else out.push(permission(i, i, i * 50, "mcp__github__list_issues", { repo: "example/app", state: "open" }, { risk: "read" }));
  }
  if (TODAY) {
    // #2689: a bot's "needs you" card and a proactive proposal in the same box
    const attention = { id: "m-att", role: "bot", at: NOW - 38 * 60 * MIN,
      attention: { kind: "needs", items: [{ text: "Approuver la facture de novembre" }, { text: "Le fournisseur attend une réponse avant vendredi" }], botId: "b-pixel", botName: "Pixel", threadId: "t-att", sourceMessageId: "src" } } as unknown as Message;
    out.push({ key: "t-att:attention:m-att", threadId: "t-att", requestId: "attention:m-att", botId: "b-pixel", botName: "Pixel", threadTitle: "Factures", scope: "mine", kind: "attention", at: NOW - 38 * 60 * MIN, decidable: true, bulk: "question", message: attention });
    const proposal = { id: "m-pro", role: "bot", kind: "options", at: NOW - 95 * MIN,
      card: { title: "Nouveau courriel de Carla : « Contrat à signer »", subtitle: "Je peux le lire et préparer une réponse. On y va ?", options: ["Oui, vas-y", "Non merci"], proactiveProposal: { id: "pp1" } } } as unknown as Message;
    out.push({ key: "t-pro:proactive:pp1", threadId: "t-pro", requestId: "proactive:pp1", botId: "b-echo", botName: "Echo", scope: "mine", kind: "proposal", proactiveId: "pp1", at: NOW - 95 * MIN, decidable: true, bulk: "proposal", message: proposal });
  }
  if (ROUTINE && n > 0) {
    out.push(permission(950, 3, 30 * 60, "WebFetch", { url: "https://example.com/rapports/matin" }, { risk: "read", routineName: "Revue du matin", threadTitle: "Revue du matin · 4 nov., 9 h 00", destination: "sandbox" }));
  }
  if (ORG && n > 0) {
    out.push({ ...permission(900, 3, 12, "Bash", { command: "kubectl rollout restart deploy/web" }, { risk: "execute", destination: "server", bulk: "special" }, { adminApproval: true }), scope: "org", ownerName: "Bob" });
    out.push({ key: "t901:req-901", threadId: "t901", requestId: "req-901", botId: "b-other", botName: "Orion", scope: "team", kind: "permission", at: NOW - 140 * MIN, decidable: false, bulk: "not-yours", waitingOn: "owner", waitingOnName: "Carla", ownerName: "Carla", tool: "Bash", risk: "execute" });
  }
  return out;
}

let pending = fixtures(COUNT);
const history: InboxHistoryEntry[] = [
  { at: new Date(NOW - 8 * MIN).toISOString(), decision: "user-approved", who: "Ada", botName: "Nova", tool: "Bash", summary: "pnpm test:unit --shards 4", threadId: "h1" },
  { at: new Date(NOW - 42 * MIN).toISOString(), decision: "user-denied", who: "Ada", botName: "Pixel", tool: "Bash", summary: "rm -rf ~/Library/Caches", threadId: "h2" },
  { at: new Date(NOW - 3 * 60 * MIN).toISOString(), decision: "user-approved", who: "Ada", botName: "Echo", question: true, summary: "Production", threadId: "h3" },
  { at: new Date(NOW - 26 * 60 * MIN).toISOString(), decision: "user-approved", who: "Bob (console)", botName: "Atlas", tool: "mcp__linear__create_issue", summary: "Corriger la page de connexion", via: "console", threadId: "h4" },
  { at: new Date(NOW - 50 * 60 * MIN).toISOString(), decision: "user-undone", who: "Ada", botName: "Nova", tool: "Write", summary: "docs/notes.md", threadId: "h5" },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/approvals") {
    const payload: InboxPayload = { pending, history: url.searchParams.get("history") === "1" ? history : [], scopes: { org: ORG, team: ORG } };
    return reply(200, payload);
  }
  if (url.pathname === "/api/approvals/bulk") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { decision: string; items: Array<{ threadId: string; requestId: string }> };
    const keys = new Set(body.items.map((item) => `${item.threadId}:${item.requestId}`));
    pending = pending.filter((entry) => !keys.has(entry.key));
    return reply(200, { decision: body.decision, answered: keys.size, results: [...keys].map((key) => ({ key, ok: true })) });
  }
  const respond = /^\/api\/threads\/([\w-]+)\/respond$/.exec(url.pathname);
  if (respond) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { requestId: string };
    pending = pending.filter((entry) => !(entry.threadId === respond[1] && entry.requestId === body.requestId));
    return reply(200, { ok: true });
  }
  if (url.pathname === "/api/approvals/handled") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messageId: string };
    pending = pending.filter((entry) => entry.requestId !== `attention:${body.messageId}`);
    return reply(200, { ok: true });
  }
  const proactive = /^\/api\/bots\/[\w-]+\/proactive\/([\w-]+)$/.exec(url.pathname);
  if (proactive) {
    pending = pending.filter((entry) => entry.proactiveId !== proactive[1]);
    return reply(200, { ok: true });
  }
  if (url.pathname.startsWith("/api/")) return reply(404, { error: "preview" });
  return realFetch(input, init);
};

function Hydrate() {
  const { dispatch } = useStore();
  useEffect(() => {
    const bots = BOTS.map((bot) => ({ ...bot, soul: "", tasks: [], messages: [] }) as unknown as Bot);
    dispatch({ type: "hydrate", bots, groups: [], sections: [] } as never);
    dispatch({ type: "showApprovals" });
  }, [dispatch]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <Hydrate />
        <div className="flex h-screen bg-app text-ink">
          <ApprovalsPage />
        </div>
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  </StrictMode>,
);
