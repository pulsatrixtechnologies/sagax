/** Isolated gallery for Playwright screenshots (no window) of the two chat
 * annotations of 2026-10-21: the reply-to quote above a bot's answer, and the
 * "Created/Updated/Deleted routine · <name>" chips. Not shipped in the app.
 * ?skin=<id>&lang=<code>&only=<sample id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ReplyQuote } from "../components/ReplyQuote";
import { RoutineChangeLine } from "../components/RoutineToggleLine";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import type { RoutineToggleEvent } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const trigger: Message = { id: "u3", role: "user", kind: "text", text: "passe le mot aussi a katarina sur sagax", at: 3 };
const userBubble = (text: string) => (
  <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">{text}</div>
);
const routine = (id: string): RoutineToggleEvent["routines"][number] => ({ id, name: "Revue des billets GECKO", botId: "bot-a" });
const change = (action: "created" | "updated" | "deleted"): RoutineToggleEvent => ({ action, turnKey: "u1", routines: [routine(`r-${action}`)] });

const samples: Array<{ id: string; render: () => React.ReactNode }> = [
  {
    id: "reply-to",
    render: () => (
      <div className="flex w-[520px] flex-col gap-2">
        {userBubble("salut, peux-tu regarder les billets GECKO")}
        {userBubble("et me faire un résumé ce soir")}
        {userBubble("passe le mot aussi a katarina sur sagax")}
        <div className="flex max-w-[460px] flex-col gap-2 self-start rounded-[18px] bg-card px-3 py-2 text-[13px] text-ink">
          <ReplyQuote message={trigger} fallbackName="Toi" compact onJump={() => {}} />
          <span>C'est fait : j'ai transmis la note à Katarina sur Sagax.</span>
        </div>
      </div>
    ),
  },
  {
    id: "routine-chips",
    render: () => (
      <div className="flex w-[420px] flex-col gap-1">
        {userBubble("crée, renomme puis supprime la routine de revue des billets")}
        <RoutineChangeLine event={change("created")} canOpen={() => true} onOpen={() => {}} />
        <RoutineChangeLine event={change("updated")} canOpen={() => true} onOpen={() => {}} />
        <RoutineChangeLine event={change("deleted")} canOpen={() => false} onOpen={() => {}} />
      </div>
    ),
  },
];

function Gallery() {
  return (
    <div className="flex flex-col items-start gap-10 bg-app p-8 text-ink" data-gallery>
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id}>
          {sample.render()}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
