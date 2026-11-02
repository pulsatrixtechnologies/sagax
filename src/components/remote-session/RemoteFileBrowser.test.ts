// @vitest-environment happy-dom
// The Tailcat card's fold and its remote file browser (2026-10-21, the owner: "Le
// bouton Détails est weird", "Télécharger ... devrait afficher un file
// browser distant. Même chose pour Envoyer un fichier").
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteListing } from "../../../shared/remote-files";
import type { RemoteSessionView } from "../../../shared/remote-session";
import { setLocale, t } from "@/lib/i18n";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { formatRemoteSize } from "./RemoteFileBrowser";
import { RemoteSessionFacts } from "./RemoteSessionFacts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  suggestions: [],
};

const HOME = "C:\\Users\\usager";
const DOCS = "C:\\Users\\usager\\Documents";
const LISTINGS: Record<string, RemoteListing> = {
  [HOME]: {
    path: HOME, parent: "C:\\Users", home: HOME, roots: ["C:\\", "D:\\"], truncated: false,
    entries: [
      { name: "Documents", kind: "dir", modifiedAt: "2026-10-20T13:00:00.000Z" },
      { name: "notes.txt", kind: "file", size: 812, modifiedAt: "2026-10-20T13:00:00.000Z" },
    ],
  },
  [DOCS]: {
    path: DOCS, parent: HOME, home: HOME, roots: ["C:\\", "D:\\"], truncated: false,
    entries: [{ name: "contrat signé.pdf", kind: "file", size: 512_000 }],
  },
  "C:\\Users": { path: "C:\\Users", parent: "C:\\", home: HOME, roots: ["C:\\", "D:\\"], truncated: false, entries: [{ name: "usager", kind: "dir" }] },
  "C:\\Windows": { path: "C:\\Windows", parent: "C:\\", home: HOME, roots: ["C:\\"], truncated: false, entries: [{ name: "System32", kind: "dir" }] },
  "C:\\Users\\usager\\O'Brien": { path: "C:\\Users\\usager\\O'Brien", parent: HOME, home: HOME, roots: ["C:\\"], truncated: false, entries: [] },
  "D:\\": { path: "D:\\", parent: null, home: HOME, roots: ["C:\\", "D:\\"], truncated: true, entries: [{ name: "Partage", kind: "dir" }] },
};

let host: HTMLDivElement;
let root: Root;
let calls: Array<{ action: string; body: Record<string, unknown> }>;
let existing: Set<string>;

const respond = (body: unknown, status = 200, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

beforeEach(() => {
  setLocale("fr");
  calls = [];
  existing = new Set();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const action = url.split("/").pop() ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ action, body: action === "upload" ? { ...body, dataBase64: "…" } : body });
    if (action === "ls") {
      const path = String(body.path || HOME);
      return LISTINGS[path] ? respond(LISTINGS[path]) : respond({ error: "That folder does not exist on the remote computer." }, 404);
    }
    if (action === "upload") {
      if (!body.overwrite && existing.has(`${String(body.dir)}\\${String(body.name)}`)) return respond({ error: `${String(body.name)} is already in that folder.`, code: "exists" }, 409);
      return respond({ name: body.name });
    }
    if (action === "download") return new Response("bytes", { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="contrat signé.pdf"' } });
    return respond({});
  }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLocale("en");
});

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const click = async (selector: string) => {
  const element = $(selector);
  if (!element) throw new Error(`missing ${selector}`);
  await act(async () => { element.click(); });
  await settle();
};
const names = () => [...document.querySelectorAll("[data-remote-entry]")].map((row) => row.getAttribute("data-name"));
const dialog = () => $("[data-remote-file-browser]");

describe("Détails du poste", () => {
  it("is one full-width row with a chevron, a summary when folded, and aria-expanded", async () => {
    act(() => root.render(createElement(RemoteSessionFacts, { view })));
    const toggle = $("[data-remote-details-toggle]")!;
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain(t("remoteSession.details"));
    expect($("[data-remote-details-summary]")?.textContent).toBe("PowerEdge R650 · 32 Go");
    expect(toggle.querySelector("svg")).not.toBeNull();
    expect($("[data-remote-field=serial]")).toBeNull();

    await click("[data-remote-details-toggle]");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe($("[data-remote-details]")!.id);
    expect(toggle.querySelector("svg")!.getAttribute("class")).toContain("rotate-180");
    expect($("[data-remote-details-summary]")).toBeNull();
    for (const field of ["serial", "model", "cpu", "ram", "disk"]) expect($(`[data-remote-field=${field}]`)).not.toBeNull();

    await click("[data-remote-details-toggle]");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect($("[data-remote-field=serial]")).toBeNull();
  });
});

describe("the action row", () => {
  it("shows three grey pills of the same size; Take control is on the screen card", () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    expect($("[data-remote-take-control]")).toBeNull();
    const secondary = [...document.querySelectorAll<HTMLElement>("[data-remote-action]")];
    expect(secondary.map((button) => button.dataset.remoteAction)).toEqual(["shell", "upload", "download"]);
    for (const button of secondary) {
      expect(button.className).toContain("ui-button");
      expect(button.querySelector("svg")).not.toBeNull();
    }
    for (const button of secondary) expect(button.className).not.toContain("ui-button-primary");
    expect($("[data-remote-action=upload]")!.getAttribute("aria-label")).toBe(t("remoteSession.upload"));
    // no free-text path field any more
    expect(document.querySelector("input[type=text], input:not([type])")).toBeNull();
  });
});

describe("remote file browser: download", () => {
  it("opens on the user's profile, browses into a folder, and downloads the chosen file", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await click("[data-remote-action=download]");
    expect(dialog()?.getAttribute("data-remote-file-browser")).toBe("download");
    expect(dialog()?.getAttribute("role")).toBe("dialog");
    expect(calls[0]).toEqual({ action: "ls", body: { path: "" } });
    expect(names()).toEqual(["Documents", "notes.txt"]);
    expect([...document.querySelectorAll("[data-remote-crumb]")].map((crumb) => crumb.textContent)).toEqual(["C:", "Users", "usager"]);
    expect($<HTMLButtonElement>("[data-remote-browser-pick]")!.disabled).toBe(true);

    await click("[data-remote-entry=dir][data-name=Documents]");
    expect(calls.at(-1)).toEqual({ action: "ls", body: { path: DOCS } });
    expect(names()).toEqual(["contrat signé.pdf"]);

    await click("[data-remote-entry=file]");
    expect($("[data-remote-entry=file]")!.getAttribute("aria-pressed")).toBe("true");
    expect($<HTMLButtonElement>("[data-remote-browser-pick]")!.disabled).toBe(false);
    await click("[data-remote-browser-pick]");
    expect(calls.at(-1)).toEqual({ action: "download", body: { path: `${DOCS}\\contrat signé.pdf` } });
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain(t("remoteSession.downloaded", { name: "contrat signé.pdf" }));
    expect(document.body.innerHTML).not.toContain(ADDRESS);
  });

  it("climbs with the parent button and the breadcrumb, and switches drives", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await click("[data-remote-action=download]");
    await click("[data-remote-browser-up]");
    expect(calls.at(-1)).toEqual({ action: "ls", body: { path: "C:\\Users" } });
    expect(names()).toEqual(["usager"]);

    await click("[data-remote-browser-home]");
    expect(calls.at(-1)).toEqual({ action: "ls", body: { path: HOME } });
    await click(`[data-remote-crumb="C:\\\\Users"]`);
    expect(calls.at(-1)).toEqual({ action: "ls", body: { path: "C:\\Users" } });

    const drive = $<HTMLSelectElement>("[data-remote-browser-drive]")!;
    expect([...drive.options].map((option) => option.textContent)).toEqual(["C:", "D:"]);
    await act(async () => {
      drive.value = "D:\\";
      drive.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(calls.at(-1)).toEqual({ action: "ls", body: { path: "D:\\" } });
    expect($<HTMLButtonElement>("[data-remote-browser-up]")!.disabled).toBe(true);
    expect(document.body.textContent).toContain(t("remoteSession.browser.truncated", { count: 1 }));
  });

  it("says why a folder did not open and offers to try again", async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => respond({ error: "The remote computer did not answer. Try again in a moment." }, 409));
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await click("[data-remote-action=download]");
    expect(dialog()?.querySelector("[role=alert]")?.textContent).toContain("did not answer");
    const retry = [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === t("remoteSession.browser.retry"))!;
    await act(async () => { retry.click(); });
    await settle();
    expect(names()).toEqual(["Documents", "notes.txt"]);
  });
});

async function chooseLocalFile(file: File) {
  const input = $<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

describe("remote file browser: upload", () => {
  it("picks a local file, then sends it to the folder chosen on the remote computer", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await chooseLocalFile(new File(["pdf"], "facture octobre.pdf", { type: "application/pdf" }));
    expect(dialog()?.getAttribute("data-remote-file-browser")).toBe("upload");
    expect(dialog()?.textContent).toContain(t("remoteSession.browser.uploadTitle", { name: "facture octobre.pdf" }));
    // files are shown for context but cannot be picked as a destination
    expect($<HTMLButtonElement>("[data-remote-entry=file]")!.disabled).toBe(true);
    expect($("[data-remote-destination]")?.textContent).toContain(HOME);

    await click("[data-remote-entry=dir][data-name=Documents]");
    expect($("[data-remote-destination]")?.textContent).toContain(DOCS);
    await click("[data-remote-browser-pick]");
    // a confirmation names the file and the folder before anything is sent
    expect(calls.at(-1)?.action).toBe("ls");
    expect($("[data-remote-confirm]")?.getAttribute("data-remote-confirm")).toBe("send");
    expect($("[data-remote-confirm]")!.textContent).toContain(t("remoteSession.browser.confirmSend", { name: "facture octobre.pdf" }));
    expect($("[data-remote-confirm-path]")!.textContent).toBe(DOCS);
    expect($<HTMLButtonElement>("[data-remote-browser-up]")!.disabled).toBe(true);
    await click("[data-remote-confirm-go]");
    expect(calls.at(-1)).toEqual({ action: "upload", body: { name: "facture octobre.pdf", dataBase64: "…", dir: DOCS } });
    expect(dialog()).toBeNull();
    expect(document.body.textContent).toContain(t("remoteSession.sent", { name: "facture octobre.pdf" }));
  });

  it("keeps the 8 MB limit before anything opens", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    const big = new File(["x"], "gros.iso");
    Object.defineProperty(big, "size", { value: 8 * 1024 * 1024 + 1 });
    await chooseLocalFile(big);
    expect(dialog()).toBeNull();
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain(t("remoteSession.browser.tooLarge"));
  });

  it("keeps the browser open with the reason when the transfer fails", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await chooseLocalFile(new File(["pdf"], "a.pdf"));
    await click("[data-remote-browser-pick]");
    vi.mocked(fetch).mockImplementationOnce(async () => respond({ error: "That folder cannot receive a file." }, 409));
    await click("[data-remote-confirm-go]");
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("That folder cannot receive a file.");
  });
});

describe("remote file browser: replace and refused folders", () => {
  it("asks before replacing a file already there, naming it and its folder, then sends overwrite", async () => {
    existing.add(`${HOME}\\notes.txt`);
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await chooseLocalFile(new File(["x"], "notes.txt"));
    await click("[data-remote-browser-pick]");
    await click("[data-remote-confirm-go]");
    expect(calls.at(-1)).toEqual({ action: "upload", body: { name: "notes.txt", dataBase64: "…", dir: HOME } });
    expect($("[data-remote-confirm]")?.getAttribute("data-remote-confirm")).toBe("replace");
    expect($("[data-remote-confirm]")!.textContent).toContain(t("remoteSession.browser.confirmReplace", { name: "notes.txt" }));
    expect($("[data-remote-confirm-path]")!.textContent).toBe(HOME);
    expect($("[data-remote-confirm-go]")!.textContent).toContain(t("remoteSession.browser.replace"));

    // Retour goes back to browsing, nothing replaced
    const back = [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === t("remoteSession.browser.back"))!;
    await act(async () => { back.click(); });
    await settle();
    expect($("[data-remote-confirm]")).toBeNull();
    expect(calls.filter((call) => call.action === "upload")).toHaveLength(1);

    await click("[data-remote-browser-pick]");
    await click("[data-remote-confirm-go]");
    await click("[data-remote-confirm-go]");
    expect(calls.at(-1)).toEqual({ action: "upload", body: { name: "notes.txt", dataBase64: "…", dir: HOME, overwrite: true } });
    expect(dialog()).toBeNull();
  });

  it("refuses a system folder and a folder name scp cannot carry, before any confirmation", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await chooseLocalFile(new File(["x"], "a.txt"));
    // the next listing the browser asks for answers this folder
    const open = async (path: string) => {
      vi.mocked(fetch).mockImplementationOnce(async () => respond(LISTINGS[path]));
      await click("[data-remote-browser-home]");
    };
    await open("C:\\Windows");
    expect($("[data-remote-dest-note]")?.textContent).toBe(t("remoteSession.browser.systemFolder"));
    expect($<HTMLButtonElement>("[data-remote-browser-pick]")!.disabled).toBe(true);
    await open("C:\\Users\\usager\\O'Brien");
    expect($("[data-remote-dest-note]")?.textContent).toBe(t("remoteSession.browser.unsafeName"));
    expect($<HTMLButtonElement>("[data-remote-browser-pick]")!.disabled).toBe(true);
    expect(calls.some((call) => call.action === "upload")).toBe(false);
  });

  it("locks the stale listing after a failed folder: no parent, no breadcrumb", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await click("[data-remote-action=download]");
    vi.mocked(fetch).mockImplementationOnce(async () => respond({ error: "The remote computer did not answer. Try again in a moment." }, 409));
    await click("[data-remote-entry=dir][data-name=Documents]");
    expect(dialog()?.querySelector("[role=alert]")).not.toBeNull();
    expect($<HTMLButtonElement>("[data-remote-browser-up]")!.disabled).toBe(true);
    for (const crumb of document.querySelectorAll<HTMLButtonElement>("[data-remote-crumb]")) expect(crumb.disabled).toBe(true);
    expect($<HTMLButtonElement>("[data-remote-browser-home]")!.disabled).toBe(false);
    expect($("nav")!.getAttribute("title")).toBe(HOME);
  });

  it("keeps the focus in the window after a folder opens, so Escape still closes it", async () => {
    act(() => root.render(createElement(RemoteSessionActions, { botId: "melonie", view })));
    await click("[data-remote-action=download]");
    $("[data-remote-entry=dir][data-name=Documents]")!.focus();
    await click("[data-remote-entry=dir][data-name=Documents]");
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).toBeNull();
  });
});

describe("formatRemoteSize", () => {
  it("speaks the reader's units", () => {
    expect(formatRemoteSize(812, "fr")).toMatch(/^812\s?o$/);
    expect(formatRemoteSize(2_456_789, "fr")).toMatch(/^2,3\s?Mo$/);
    expect(formatRemoteSize(2_456_789, "en")).toBe("2.3 MB");
    expect(formatRemoteSize(undefined)).toBe("");
  });
});
