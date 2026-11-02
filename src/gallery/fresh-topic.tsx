/** Isolated gallery for Playwright screenshots of New topic clear
 * (asked-for pencil): before = history still above a divider (the bug);
 * after = empty greeting with Back. Not shipped. ?skin=&lang=&view=before|after */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SquarePen } from "lucide-react";
import { t, loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "after";

const bot = { name: "Pepper", description: "Ready when you are." };

function FreshTopicDivider() {
  return (
    <div className="my-2 flex items-center gap-3 text-[11.5px] text-ink-tertiary" role="separator" data-fresh-topic-divider="">
      <span className="h-px flex-1 bg-hairline/60" />
      <span className="truncate">{t("stream.newTopic")}</span>
      <button type="button" className="rounded px-1.5 py-0.5 text-ink-secondary hover:bg-raised hover:text-ink" data-fresh-topic-resume="">
        {t("stream.resumeTopic")}
      </button>
      <span className="h-px flex-1 bg-hairline/60" />
    </div>
  );
}

function EmptyGreeting() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center" data-fresh-empty="">
      <div className="text-[17px] font-semibold text-ink">{bot.name}</div>
      <div className="max-w-[360px] text-[14px] text-ink-secondary">{bot.description}</div>
    </div>
  );
}

function History() {
  return (
    <div className="flex flex-col gap-3" data-fresh-history="">
      <div className="self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px]">What is on the agenda today?</div>
      <div className="self-start rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px]">Three invoices and a backup check.</div>
      <div className="self-end rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px]">Thanks, start with the invoices.</div>
      <div className="self-start rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px]">Opening the invoices folder now.</div>
    </div>
  );
}

function Gallery() {
  return (
    <div className="flex h-screen flex-col bg-app text-ink" data-gallery={view}>
      <header className="flex h-12 items-center justify-between border-b border-hairline px-4">
        <div className="text-[14px] font-medium">{bot.name}</div>
        <button
          type="button"
          title={t("stream.newTopic")}
          aria-label={t("stream.newTopicAria", { name: bot.name })}
          className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-hairline-weak bg-elevated text-ink-secondary"
          data-new-topic=""
        >
          <SquarePen size={15} />
        </button>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-4">
        {view === "before" ? (
          <>
            <History />
            <FreshTopicDivider />
          </>
        ) : (
          <>
            <FreshTopicDivider />
            <EmptyGreeting />
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
