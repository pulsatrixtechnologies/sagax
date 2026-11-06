/** Isolated gallery for headless screenshots of the team canvas Computers
 * panel (2026-11-06): the real CanvasComputers with a fake store and its
 * routes answered here (Boat inventory, enrolled unattended hosts, the
 * install code). Not shipped in the app.
 * ?lang=<code>&skin=<id>&code=1 opens the Unattended Remote Control form. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { CanvasComputers } from "../components/CanvasComputers";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const hosts = [
  { hostId: `h_${"a".repeat(32)}`, hostname: "Poste-Accueil", org: "Exemple inc.", scope: "full-control", state: "enrolled", enrolledAt: minutesAgo(4000), expiresAt: inDays(80), lastSeenAt: minutesAgo(0.5), online: true, section: "Support" },
  { hostId: `h_${"b".repeat(32)}`, hostname: "Laptop-Atelier", org: "Exemple inc.", scope: "view-only", state: "enrolled", enrolledAt: minutesAgo(9000), expiresAt: inDays(30), lastSeenAt: minutesAgo(300), online: false, section: null },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/auth/session")) return json({});
  if (url.includes("/api/team-computers")) return json({ configured: false, computers: [] });
  if (url.includes("/api/remote-hosts/code")) return json({ code: "K7QM-NP42", enrollUrl: "https://example.com/enroll/K7QM-NP42", org: "Exemple inc.", scope: "full-control", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), installCommand: 'sagax-remote-access install --unattended --org "Exemple inc." --code "K7QM-NP42" --scope full-control --consent-recorded-by "Alex Tremblay"' });
  if (url.includes("/api/remote-hosts")) return json({ available: true, hosts });
  return realFetch(input, init);
};

const store = { state: { bots: [], groups: [], config: {} }, dispatch: () => {} } as unknown as ReturnType<typeof useStore>;
const sections = [{ key: "Support", name: "Support" }, { key: "Ventes", name: "Ventes" }];

function Sample() {
  const [request] = useState(params.get("code") === "1" ? 1 : 0);
  return <CanvasComputers open createRequest={request} drop={null} sections={sections} onClose={() => {}} onDropHandled={() => {}} onChange={() => {}} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div data-gallery-sample="canvas-computers" className="flex h-[760px] w-[420px] justify-end bg-app">
        <Sample />
      </div>
    </BotEditorStore>
  </StrictMode>,
);
