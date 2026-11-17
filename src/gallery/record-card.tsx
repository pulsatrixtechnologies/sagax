/** Isolated gallery for headless screenshots of record cards (#4507). Not
 * shipped in the app. An invented product ("Nimbus Desk") and invented
 * records: nothing here names a real product, company or person.
 * ?lang=fr|en &skin=<id> &scene=<name>
 *   overview   every kind, then every state (default)
 *   ticket | company | project | guid | pinned   one card
 *   loading | noaccess | unknown | notconnected | signin | busy | down | orgask | orgrefused   one state
 *   neighbour  the link hover card (the conforming neighbour) beside a ticket card
 *   chat       live chips in a paragraph, a list and a table: hover, click (pin), Escape
 * The time is held still (scene `now`), so a capture is the same every run. */
import { StrictMode, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { LinkPreviewCard } from "../components/LinkHoverCard";
import { RecordCard } from "../components/RecordCard";
import { loadLocale } from "../lib/i18n";
import { companyCard, guidCard, nimbusProduct, nimbusProductRaw, projectCard, ticketCard, answer, COMPANY_REF, GUID_REF, PROJECT_REF, TICKET_REF, type Lang } from "../lib/record-card-fixtures";
import { seedRecordProducts } from "../lib/record-cards";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { parseRecordCardAnswer, type RecordCardAnswer, type RecordCardMiss, type RecordRef } from "../../shared/record-cards";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang: Lang = params.get("lang") === "en" ? "en" : "fr";
await loadLocale(lang);
const scene = params.get("scene") ?? "overview";
// 2026-11-17 14:34 in Toronto
const NOW = Date.parse("2026-11-17T14:34:00-05:00");

const product = { name: "Nimbus Desk", domain: "desk.example" };
const kindNames: Record<string, string> = lang === "fr"
  ? { ticket: "Billet", company: "Entreprise", project: "Projet" }
  : { ticket: "Ticket", company: "Company", project: "Project" };
const noop = () => {};

function read(raw: RecordCardAnswer | RecordCardMiss) {
  const parsed = "card" in raw || "state" in raw ? raw : { state: "unavailable" as const };
  return {
    card: "card" in parsed ? parsed.card : null,
    miss: "card" in parsed ? null : parsed,
    loading: false, at: NOW - 120_000, refresh: noop, confirm: noop,
  };
}

function Card({ record, label, answerOf, pinned, miss, loading }: { record: RecordRef; label: string; answerOf?: Record<string, unknown>; pinned?: boolean; miss?: RecordCardMiss; loading?: boolean }) {
  const value = miss ?? (answerOf ? parseRecordCardAnswer(answer(answerOf)) : null);
  const base = value ? read(value) : { card: null, miss: null, loading: true, at: 0, refresh: noop, confirm: noop };
  return (
    <div data-gallery-card={record.kind} className="w-fit">
      <RecordCard
        record={record} label={label} kindName={kindNames[record.kind]} product={product}
        read={loading ? { ...base, loading: true, card: null, miss: null } : base}
        pinned={pinned} onClose={noop} onAsk={noop} onConnect={noop} onSignIn={noop} now={NOW}
      />
    </div>
  );
}

const ticket = <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={ticketCard(NOW, lang)} />;
const company = <Card record={COMPANY_REF} label="Acme Fabrication" answerOf={companyCard(NOW, lang)} />;
const project = <Card record={PROJECT_REF} label={lang === "fr" ? "Migration du serveur" : "Server migration"} answerOf={projectCard(NOW, lang)} />;
const guid = <Card record={GUID_REF} label={GUID_REF.id} answerOf={guidCard(NOW, lang)} />;
const pinned = <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} answerOf={ticketCard(NOW, lang)} pinned />;
const miss = (state: RecordCardMiss["state"], extra: Partial<RecordCardMiss> = {}) => (
  <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} miss={{ state, ...extra }} />
);
const states: Record<string, ReactElement> = {
  loading: <Card record={TICKET_REF} label={`#${TICKET_REF.id}`} loading />,
  noaccess: miss("no_access"),
  unknown: miss("unknown"),
  notconnected: miss("not_connected", { productState: "key_missing" }),
  signin: miss("sign_in"),
  busy: miss("busy", { retryAfter: 10 }),
  down: miss("down"),
  orgask: miss("org_ask", { rule: { id: "rule-1", text: "Reading tickets asks first" } }),
  orgrefused: miss("org_refused", { rule: { id: "rule-2", text: "Reading tickets is refused" } }),
};

const CHAT = lang === "fr"
  ? `J'ai regardé [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) : l'imprimante est revenue après la réinstallation du pilote. Les autres fiches liées :

- [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}), le client
- [Migration du serveur](sagax://record/nimbus_desk/project/${PROJECT_REF.id}), le projet en cours

| Fiche | Lien |
| --- | --- |
| Billet | [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) |
| Entreprise | [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}) |`
  : `I looked at [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}): the printer came back after the driver was reinstalled. The other linked records:

- [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}), the customer
- [Server migration](sagax://record/nimbus_desk/project/${PROJECT_REF.id}), the current project

| Record | Link |
| --- | --- |
| Ticket | [#${TICKET_REF.id}](sagax://record/nimbus_desk/ticket/${TICKET_REF.id}) |
| Company | [Acme Fabrication](sagax://record/nimbus_desk/company/${COMPANY_REF.id}) |`;

// a stand-in console: the product list and the cards, as the routes answer
seedRecordProducts([nimbusProduct()]);
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/perspicax/products")) return json({ products: [nimbusProductRaw()] });
  const match = /\/api\/me\/records\/nimbus_desk\/(\w+)\/([^?]+)/.exec(url);
  if (match) {
    const mode = params.get("answer");
    if (mode) return json({ state: mode, ...(mode === "busy" ? { retryAfter: 10 } : {}) });
    const make = { ticket: ticketCard, company: companyCard, project: projectCard }[match[1]!];
    return json(make ? answer(make(Date.now(), lang)) : { state: "unknown" });
  }
  return realFetch(input, init);
};

function Frame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`min-h-screen bg-app p-2 text-ink ${wide ? "" : ""}`}>{children}</div>;
}

function Label({ children }: { children: string }) {
  return <p className="mb-1.5 mt-5 text-[12px] leading-4 text-ink-secondary first:mt-0">{children}</p>;
}

function Page() {
  if (scene === "chat") {
    return (
      <Frame>
        <div className="max-w-[44rem] pt-[22rem] text-[15px] leading-6" data-gallery-chat>
          <ChatMarkdown text={CHAT} botId="bot-gallery" message={{ threadId: "thread-gallery", messageId: "m-1" }} />
        </div>
      </Frame>
    );
  }
  if (scene === "neighbour") {
    return (
      <Frame>
        <div className="flex flex-wrap items-start gap-6" data-gallery-neighbour>
          <div><Label>{lang === "fr" ? "Voisine : la carte de lien" : "Neighbour: the link card"}</Label><LinkPreviewCard href="https://github.com/example/project/pull/2547" github={{ kind: "pull", owner: "example", repo: "project", number: 2547 } as never} /></div>
          <div><Label>{lang === "fr" ? "La carte de fiche" : "The record card"}</Label>{ticket}</div>
        </div>
      </Frame>
    );
  }
  const single: Record<string, ReactElement> = { ticket, company, project, guid, pinned, ...states };
  if (single[scene]) return <Frame>{single[scene]}</Frame>;
  return (
    <Frame>
      <Label>{lang === "fr" ? "Billet" : "Ticket"}</Label>{ticket}
      <Label>{lang === "fr" ? "Entreprise (volet de gauche seulement)" : "Company (left pane only)"}</Label>{company}
      <Label>{lang === "fr" ? "Projet" : "Project"}</Label>{project}
      <Label>{lang === "fr" ? "Chargement" : "Loading"}</Label>{states.loading}
      {(["noaccess", "unknown", "notconnected", "signin", "busy", "down", "orgask", "orgrefused"] as const).map((name) => (
        <div key={name}><Label>{name}</Label>{states[name]}</div>
      ))}
    </Frame>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Page /></StrictMode>);
