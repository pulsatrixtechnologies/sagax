// Tailcat stage 1: the panel always shows its section, the card carries every
// fact and the action buttons. Since 2026-10-22 the screen is in the chat
// (RemoteScreenCard) and Take control opens its window, never the Computer tab.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import { visiblePanelTabs } from "../bot-settings/panel-tabs";
import { RemoteSessionCard } from "./RemoteSessionCard";
import { RemoteSessionsPanel } from "./RemoteSessionsSection";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "BQDHS7",
  state: "connected",
  os: "windows",
  elevated: false,
  endAt: "2026-10-22T00:33:00.000Z",
  hostname: "POSTE-01",
  osName: "Windows Server 2022",
  user: "exemple\\usager",
  model: "PowerEdge R650",
  serial: "SN40",
  cpu: "Intel Xeon Silver",
  ram: "32 Go",
  disk: "200 Go libres sur 500 Go",
  suggestions: [{ id: "rights" }, { id: "cpu" }],
};

describe("tailcat stage 1", () => {
  afterEach(() => {
    setLocale("en");
  });

  it("never shows the Computer tab for a remote session: Simple hides it, a bot that works nowhere has none", () => {
    expect(visiblePanelTabs({ advanced: false, computerOff: false })).toEqual(["details", "library"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: true })).toEqual(["details", "library"]);
    expect(visiblePanelTabs({ advanced: true, computerOff: false })).toEqual(["details", "library", "computer"]);
  });

  it("the panel row shows computer, user, code and end time, with Prendre le contrôle and a two-step close", () => {
    setLocale("fr");
    const props = { botId: "melonie", rows: [view], error: null, onTakeControl: () => undefined, onClose: () => undefined };
    const first = renderToStaticMarkup(createElement(RemoteSessionsPanel, { ...props, confirmId: null }));
    for (const part of ["POSTE-01", "exemple\\usager", "Windows Server 2022", formatEndLabel(view.endAt), "Prendre le contrôle", "Fermer la session", "Shell", "Envoyer", "Télécharger"]) {
      expect(first).toContain(part);
    }
    expect(first).toContain('data-remote-close="ask"');
    expect(first).not.toContain("Confirmer la fermeture");
    const second = renderToStaticMarkup(createElement(RemoteSessionsPanel, { ...props, confirmId: view.id }));
    expect(second).toContain('data-remote-close="confirm"');
    expect(second).toContain("Confirmer la fermeture");
    expect(second).toContain(">Confirmer<");
    expect(`${first}${second}`).not.toContain(view.id);
    expect(`${first}${second}`).not.toContain(ADDRESS);
  });

  it("the chat card shows every fact (details unfolded) and the actions, never the id or the tunnel", () => {
    setLocale("fr");
    const card = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, hostname: `POSTE-01 ${ADDRESS}` }, detailsOpen: true }),
    ));
    for (const field of ["poste", "user", "rights", "session", "serial", "model", "cpu", "ram", "disk"]) {
      expect(card).toContain(`data-remote-field="${field}"`);
    }
    for (const value of ["POSTE-01", "exemple\\usager", t("remoteSession.rights.standard"), "BQDHS7", "SN40", "PowerEdge R650", "Intel Xeon Silver", "32 Go", "200 Go libres sur 500 Go"]) {
      expect(card).toContain(value);
    }
    // the screen card comes first, the facts card under it
    expect(card.indexOf("data-remote-screen-card")).toBeGreaterThanOrEqual(0);
    expect(card.indexOf("data-remote-screen-card")).toBeLessThan(card.indexOf("data-remote-session-card"));
    expect(card).toContain(t("remoteSession.shell"));
    expect(card).toContain(t("remoteSession.upload"));
    expect(card).toContain(t("remoteSession.download"));
    expect(card).toContain('data-remote-hint="rights"');
    expect(card).not.toContain(view.id);
    expect(card).not.toContain(ADDRESS);
    const elevated = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, elevated: true } }),
    ));
    expect(elevated).toContain(t("remoteSession.rights.admin"));
  });
});
