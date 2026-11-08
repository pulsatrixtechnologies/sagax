// Dev gallery for the lines a Sagax restart leaves in a chat, a parallel
// task that never started, and the composer before and after a question is
// answered, in the reader's language. Served by Vite in dev at
// /src/gallery/restart-rows.html; not part of the packaged app.
// ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { FailedTurnRow } from "@/components/ChatView.tsx-parts/ErrorRows";
import { composerPlaceholder } from "@/lib/composer-placeholder";
import { stepLabel } from "@/lib/step-label";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider } from "@/state/store";
import { failedTurnTool } from "../../shared/failed-turn";
import { PARALLEL_NOT_STARTED, RESTART_TURN_NOTE, TURN_CUT_BY_RESTART, TURN_NOT_RESUMED, TURN_RESUME_FAILED_PREFIX } from "../../shared/restart-words";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

// No server behind the gallery: the store's loads get empty answers.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: [], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section data-variant={id} className="flex flex-col items-start gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      {children}
    </section>
  );
}

function Composer({ question }: { question: boolean }) {
  const text = composerPlaceholder({ approval: false, question, attachmentPending: false, recording: false, busy: false, botName: "Quasar" });
  return <div className="w-full rounded-2xl border border-hairline/60 bg-panel px-4 py-3 text-[14px] text-ink-tertiary">{text}</div>;
}

function Preview() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col">
        <Row id="cut" label="Tour coupé par un redémarrage">
          <FailedTurnRow engine={undefined} tool={failedTurnTool(TURN_CUT_BY_RESTART)} />
        </Row>
        <Row id="resume-failed" label="Reprise échouée">
          <FailedTurnRow engine={undefined} tool={failedTurnTool(`${TURN_RESUME_FAILED_PREFIX}engine unavailable`)} />
        </Row>
        <Row id="not-resumed" label="Tour non repris">
          <FailedTurnRow engine={undefined} tool={failedTurnTool(TURN_NOT_RESUMED)} />
        </Row>
        <Row id="turn-note" label="Note de redémarrage">
          <div className="text-[13px] text-ink-secondary">{stepLabel({ name: RESTART_TURN_NOTE, ok: true })}</div>
        </Row>
        <Row id="parallel" label="Tâche parallèle non démarrée">
          <FailedTurnRow engine={undefined} tool={failedTurnTool(PARALLEL_NOT_STARTED)} />
        </Row>
        <Row id="composer-open" label="Question ouverte">
          <Composer question />
        </Row>
        <Row id="composer-answered" label="Question répondue">
          <Composer question={false} />
        </Row>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <DesktopCapabilitiesProvider>
        <Preview />
      </DesktopCapabilitiesProvider>
    </StoreProvider>
  </StrictMode>,
);
