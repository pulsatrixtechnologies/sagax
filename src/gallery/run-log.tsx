// Dev gallery for the task timeline (RunLog, the Inspector's Run tab) with
// restart lines next to ordinary tool rows. Served by Vite in dev at
// /src/gallery/run-log.html; not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RunLog } from "@/components/RunLog";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { timelineEvents } from "@/lib/taskTimeline";
import { ANSWER_NOT_DELIVERED, RESTART_TURN_NOTE, TURN_CUT_BY_RESTART } from "../../shared/restart-words";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const at = Date.UTC(2026, 10, 8, 14, 0);
const events = timelineEvents([
  { id: "u", at, role: "user", kind: "text", text: "Fais le point sur les billets ouverts" },
  { id: "a", at: at + 4_000, role: "bot", kind: "activity", tool: { name: "Bash", summary: "pnpm control:omb doctor", ok: true } },
  { id: "b", at: at + 9_000, role: "bot", kind: "activity", tool: { name: RESTART_TURN_NOTE } },
  { id: "c", at: at + 12_000, role: "bot", kind: "activity", tool: { name: TURN_CUT_BY_RESTART, ok: false } },
  { id: "d", at: at + 20_000, role: "bot", kind: "activity", tool: { name: ANSWER_NOT_DELIVERED, ok: false } },
  { id: "r", at: at + 30_000, role: "bot", kind: "text", text: "Voici le point." },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex h-screen max-w-[460px] flex-col border-x border-hairline-weak">
        <RunLog events={events} />
      </div>
    </div>
  </StrictMode>,
);
