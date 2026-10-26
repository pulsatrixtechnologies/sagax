/** Isolated gallery for the working-folder field with its Parcourir dropdown
 * (src/components/remote-session/RemoteFolderField.tsx): the bot's Windows
 * computer connected, and a bot with no computer. The capture script
 * (scripts/capture-working-folder-browse.mjs) answers /api itself.
 * Not shipped in the app. ?skin=<id>&lang=<code>&width=<px> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RemoteFolderField } from "../components/remote-session/RemoteFolderField";
import { FIELD, FieldRow, GROUP_CARD } from "../components/SettingsPrimitives";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { RemoteSessionView } from "../../shared/remote-session";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const view: RemoteSessionView = {
  id: "0123456789ab", code: "BQDHS7", state: "connected", os: "windows", elevated: false,
  endAt: "2026-10-23T00:33:00.000Z", hostname: "POSTE-01", suggestions: [],
};

function Card({ id, session, initial }: { id: string; session?: RemoteSessionView; initial: string }) {
  const [cwd, setCwd] = useState(initial);
  return (
    <div data-gallery-card={id} className={GROUP_CARD}>
      <FieldRow label={t("task.folder.path")} hint={t("task.folder.detail")}>
        <RemoteFolderField botId="pepper" view={session} value={cwd} onChange={setCwd} placeholder={t("task.folder.placeholder")} inputClassName={`${FIELD} font-mono`} />
      </FieldRow>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex min-h-screen flex-col gap-4 bg-panel p-4 text-ink" style={{ width: Number(params.get("width") ?? 440) }}>
      <Card id="vm" session={view} initial={"C:\\Users\\zseilam\\Downloads"} />
      <Card id="none" initial="" />
    </div>
  </StrictMode>,
);
