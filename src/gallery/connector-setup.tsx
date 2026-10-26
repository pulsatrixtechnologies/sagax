/** Isolated gallery for headless screenshots of the "Connect Microsoft
 * Teams" card (shared/connector-setup.ts). No server: the buttons do nothing
 * here. Not shipped in the app. ?skin=<id>&lang=<code>&only=<sample> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { ConnectorSetupView } from "../../shared/connector-setup";
import { ConnectorSetupBody } from "../components/connector-setup/ConnectorSetupCard";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const teams: ConnectorSetupView = {
  id: "cs_0123456789abcdef01", connector: "microsoft-teams", label: "Microsoft Teams", provider: "grok",
  url: "https://grok.com/connectors", status: "waiting", owner: "0123456789abcdef", createdAt: 1,
};
const outlook: ConnectorSetupView = { ...teams, id: "cs_0123456789abcdef02", connector: "outlook", label: "Outlook", provider: "claude", url: "https://claude.ai/customize/connectors" };

const noop = () => {};
const samples: Array<{ id: string; width: number; render: () => JSX.Element }> = [
  { id: "waiting", width: 560, render: () => <ConnectorSetupBody view={teams} checking={false} opened={false} onConnect={noop} onDone={noop} /> },
  { id: "opened", width: 560, render: () => <ConnectorSetupBody view={teams} checking={false} opened onConnect={noop} onDone={noop} /> },
  { id: "pending", width: 560, render: () => <ConnectorSetupBody view={{ ...teams, status: "pending" }} checking={false} opened onConnect={noop} onDone={noop} /> },
  { id: "checking", width: 560, render: () => <ConnectorSetupBody view={outlook} checking opened onConnect={noop} onDone={noop} /> },
  { id: "connected", width: 560, render: () => <ConnectorSetupBody view={{ ...teams, status: "connected" }} checking={false} opened onConnect={noop} onDone={noop} /> },
  { id: "narrow", width: 340, render: () => <ConnectorSetupBody view={teams} checking={false} opened onConnect={noop} onDone={noop} /> },
];

function Gallery() {
  return (
    <div className="flex flex-col items-start gap-8 bg-app p-6 text-ink">
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id} style={{ width: sample.width }}>
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
