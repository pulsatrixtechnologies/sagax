import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { formatEndLabel, type RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { StoreProvider, type Bot } from "@/state/store";
import type { TerminalEmbed } from "../../../shared/terminal-resources";
import { TerminalChatEmbed } from "../terminal/TerminalChatEmbed";
import { RemoteSessionActions, remoteFileNotice } from "./RemoteSessionActions";
import { RemoteSessionCard, remoteSuggestionText } from "./RemoteSessionCard";
import { remoteClosePhase, RemoteSessionsPanel, RemoteSessionsSection, runRemoteSessionClose, takeRemoteControl } from "./RemoteSessionsSection";

const ADDRESS = "tcABCDEFGHJKMNPQRSTUVWXYZ234567890abcd";

const view: RemoteSessionView = {
  id: "0123456789ab",
  code: "UD6HFH",
  state: "connected",
  os: "windows",
  elevated: true,
  endAt: "2026-10-21T21:15:00.000Z",
  hostname: `POSTE-02 ${ADDRESS}`,
  osName: "Windows 11 Professionnel pour les Stations de travail",
  user: "exemple\\technicien",
  model: "OptiPlex",
  serial: "SN1",
  cpu: "Intel Core i5",
  ram: "16 Go",
  disk: "120 Go libres sur 476 Go",
  suggestions: [{ id: "disk-low" }, { id: "cpu" }],
};

describe("remote session card", () => {
  it("shows the computer and the hints, and never the tunnel address", () => {
    const html = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view, detailsOpen: true }),
    ));
    expect(html).toContain("data-remote-session-card");
    expect(html).toContain("POSTE-02");
    expect(html).toContain("exemple\\technicien");
    expect(html).toContain("UD6HFH");
    expect(html).toContain(formatEndLabel(view.endAt));
    expect(html).toContain("SN1");
    expect(html).toContain("OptiPlex");
    expect(html).toContain("Intel Core i5");
    expect(html).toContain("16 Go");
    expect(html).toContain("120 Go libres sur 476 Go");
    expect(html).toContain(t("remoteSession.suggest.disk-low"));
    expect(html).toContain(t("remoteSession.shell"));
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toContain(view.id);
  });

  it("folds the machine details until the person opens them", () => {
    const html = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view }),
    ));
    expect(html).toContain("POSTE-02");
    expect(html).toContain("UD6HFH");
    expect(html).toContain('data-remote-details-toggle=""');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(t("remoteSession.details"));
    // the folded row sums up the model and the memory, nothing more
    expect(html).toContain("OptiPlex · 16 Go");
    for (const hidden of ["SN1", "Intel Core i5", "120 Go libres sur 476 Go", "data-remote-field=\"serial\""]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("keeps a closed session visible and drops the hints", () => {
    const html = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: { ...view, state: "ended", suggestions: [] } }),
    ));
    expect(html).toContain(t("remoteSession.closed"));
    expect(html).not.toContain("data-remote-hint");
    expect(html).not.toContain(ADDRESS);
  });
});

const GUID = "01234567-89ab-cdef-0123-456789abcdef";
const NODEKEY = `nodekey:${"ab".repeat(32)}`;

describe("remote session surfaces", () => {
  afterEach(() => setLocale("en"));

  it("shows the French sidebar and the card facts, and an empty list says so", () => {
    setLocale("fr");
    const empty = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionsSection, { bot: { id: "melonie" } as Bot }),
    ));
    // no active session: the whole section is hidden (header and text)
    expect(empty).not.toContain("data-remote-sessions");
    expect(empty).not.toContain("Sessions à distance");
    const emptyProps = {
      botId: "melonie",
      rows: [] as RemoteSessionView[],
      confirmId: null,
      error: null,
      onTakeControl: () => undefined,
      onClose: () => undefined,
    };
    expect(renderToStaticMarkup(createElement(RemoteSessionsPanel, emptyProps))).toBe("");
    setLocale("en");
    expect(renderToStaticMarkup(createElement(RemoteSessionsPanel, emptyProps))).toBe("");
    // at least one session: the section shows with its row
    const withRow = renderToStaticMarkup(createElement(StoreProvider, null, createElement(RemoteSessionsPanel, { ...emptyProps, rows: [view] })));
    expect(withRow).toContain("data-remote-sessions");
    expect(withRow).toContain("data-remote-session-row");
    setLocale("fr");

    const shown: RemoteSessionView = {
      ...view,
      hostname: `POSTE-02 ${GUID} ${ADDRESS}`,
      user: `exemple\\technicien ${NODEKEY}`,
    };
    const sidebar = renderToStaticMarkup(createElement(RemoteSessionsPanel, {
      botId: "melonie",
      rows: [shown],
      confirmId: null,
      error: null,
      onTakeControl: () => undefined,
      onClose: () => undefined,
    }));
    expect(sidebar).toContain("Sessions à distance");
    // the code is in the tooltip only, never a second line
    expect(sidebar).toContain(t("remoteSession.codeTitle", { code: "UD6HFH" }));
    expect(sidebar).not.toContain(">UD6HFH<");
    expect(sidebar).toContain(formatEndLabel(shown.endAt));
    expect(sidebar).toContain("POSTE-02");
    expect(sidebar).not.toContain(GUID);
    expect(sidebar).not.toContain(NODEKEY);
    expect(sidebar).not.toContain(ADDRESS);
    expect(sidebar).not.toContain(shown.id);
    expect(sidebar).toContain(t("remoteSession.takeControl"));
    expect(sidebar).toContain(`aria-label="${t("remoteSession.close")}"`);
    expect(sidebar).not.toContain(t("remoteSession.confirmClose"));

    const asking = renderToStaticMarkup(createElement(RemoteSessionsPanel, {
      botId: "melonie",
      rows: [shown],
      confirmId: shown.id,
      error: null,
      onTakeControl: () => undefined,
      onClose: () => undefined,
    }));
    expect(asking).toContain(t("remoteSession.confirmClose"));

    const bare: RemoteSessionView = {
      ...view,
      hostname: undefined,
      osName: undefined,
      user: undefined,
      model: undefined,
      serial: undefined,
      cpu: undefined,
      ram: undefined,
      disk: undefined,
      suggestions: [],
    };
    const card = renderToStaticMarkup(createElement(
      StoreProvider,
      null,
      createElement(RemoteSessionCard, { botId: "melonie", threadId: "thread-1", view: bare, detailsOpen: true }),
    ));
    expect(card).toContain("UD6HFH");
    expect(card).toContain(t("remoteSession.unknown"));
    expect(card).toContain(t("remoteSession.field.serial"));
    expect(card).toContain(t("remoteSession.field.cpu"));
    expect(card).toContain(t("remoteSession.rights.admin"));
    expect(card).not.toContain(GUID);
    expect(card).not.toContain(ADDRESS);
    expect(card).not.toContain(bare.id);
  });

  it("takes control in the window, never the Computer tab, and closes in two steps", async () => {
    setLocale("fr");
    const focused: string[] = [];
    const opened: string[] = [];
    takeRemoteControl({
      botId: "melonie",
      sessionId: view.id,
      focusLocal: (_bot: string, id: string) => focused.push(id),
      focusRemote: (_bot: string, id: string) => focused.push(`remote:${id}`),
      openWindow: () => opened.push("window"),
    });
    expect(focused).toEqual([view.id, `remote:${view.id}`]);
    expect(opened).toEqual(["window"]);

    expect(remoteClosePhase(null, view.id)).toBe("ask");
    expect(remoteClosePhase(view.id, view.id)).toBe("commit");
    const calls: string[] = [];
    await runRemoteSessionClose({
      confirmId: null,
      viewId: view.id,
      close: async () => { calls.push("close"); return null; },
      onAsk: () => calls.push("ask"),
      onClosed: () => calls.push("closed"),
      onError: () => calls.push("error"),
    });
    await runRemoteSessionClose({
      confirmId: view.id,
      viewId: view.id,
      close: async () => { calls.push("close"); return null; },
      onAsk: () => calls.push("ask"),
      onClosed: () => calls.push("closed"),
      onError: () => calls.push("error"),
    });
    expect(calls).toEqual(["ask", "close", "closed"]);
    expect(calls).not.toContain("focus");
  });

  it("sends the short diagnostic prompt and names the remote terminal and the file result", () => {
    setLocale("fr");
    const prompt = remoteSuggestionText("disk-low", "POSTE-02");
    expect(prompt).toBe(t("remoteSession.prompt.disk-low", { host: "POSTE-02" }));
    expect(prompt).not.toContain(ADDRESS);
    expect(prompt).not.toContain(GUID);
    expect(remoteSuggestionText("missing", "POSTE-02")).toBeNull();

    const actions = renderToStaticMarkup(createElement(RemoteSessionActions, { botId: "melonie", view }));
    expect(actions).toContain(t("remoteSession.shell"));
    expect(actions).toContain(t("remoteSession.upload"));
    expect(actions).toContain(t("remoteSession.download"));
    const closed = renderToStaticMarkup(createElement(RemoteSessionActions, { botId: "melonie", view: { ...view, state: "ended" } }));
    expect(closed).toContain(t("remoteSession.closed"));
    expect(closed).not.toContain(t("remoteSession.shell"));

    expect(remoteFileNotice("sent", "notes.txt")).toBe(t("remoteSession.sent", { name: "notes.txt" }));
    expect(remoteFileNotice("downloaded", "C:/Users/usager/Desktop/notes.txt")).toBe(t("remoteSession.downloaded", { name: "notes.txt" }));

    const embed: TerminalEmbed = {
      sessionId: "term-1",
      resourceId: view.id,
      provider: "tailcat",
      hostLabel: "POSTE-02",
      label: "not-the-remote-label",
      status: "ended",
    };
    const terminal = renderToStaticMarkup(createElement(TerminalChatEmbed, { embed }));
    expect(terminal).toContain(t("remoteSession.terminal"));
    expect(terminal).toContain("POSTE-02");
    expect(terminal).not.toContain("not-the-remote-label");
    expect(terminal).not.toContain(ADDRESS);
    expect(terminal).not.toContain(view.id);
  });
});
