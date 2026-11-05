/** Isolated gallery for headless frame captures of a routine run's card
 * flipping status fast (JC, 0.8.35: "the app flashes"). The chat's own row
 * (RoutineRunRow) under a few messages, bottom-pinned as the chat is; a
 * harness drives the status with window.__setRunStatus(status) and reads the
 * card's geometry. Neutral fictional bot and routine; nothing connects. Not
 * shipped in the app.
 * ?width=<px>&height=<px>&skin=<id> */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { RoutineRunRow } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale("en");
const width = Number(params.get("width") ?? 1100);
const height = Number(params.get("height") ?? 760);

const NOW = Date.now();
const report = [
  "The 18 open projects are there (385 tickets). The completion recalc moved 4 of them:",
  "",
  ...Array.from({ length: 18 }, (_, index) => `- Project ${index + 1}: ${40 + index}% complete, ${10 + index} tickets open`),
].join("\n");
const card = (status: string): Message => ({
  id: "m-run", role: "bot", kind: "routine.run", at: NOW, from: { botId: "atlas" },
  routineRun: { runId: "x1", routineId: "r1", routineName: "Project completion recalc", status, scheduledFor: NOW, executionThreadId: "atlas-run-thread", summary: report },
} as unknown as Message);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: [], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/instances")) return json({ instances: [] });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [] });
  if (url.includes("/api/webhooks")) return json({ webhooks: [], attempts: [], ingress: {} });
  return json({});
};

declare global { interface Window { __setRunStatus?: (status: string) => void } }

function Shell() {
  const [status, setStatus] = useState("running");
  useEffect(() => { window.__setRunStatus = setStatus; }, []);
  return (
    <div className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Atlas</div>
        <div data-gallery-transcript className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-6 py-4">
          <div className="ml-auto w-fit rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">Recalc the completion of my open projects.</div>
          <div className="w-fit rounded-2xl bg-card px-4 py-2.5 text-[14px]">On it: the routine runs now.</div>
          <RoutineRunRow message={card(status)} botId="atlas" />
          <div className="h-16 rounded-2xl border border-hairline/60 bg-raised" data-gallery-composer />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
