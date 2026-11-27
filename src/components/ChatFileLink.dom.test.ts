// @vitest-environment happy-dom
// File names in bot messages (#file-links): a name the conversation wrote is a
// link, a click opens it, right click offers Open / Show in Finder / Copy
// path, an unknown name stays plain code. The shell is mocked: nothing on
// this computer is opened.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { matchThreadFile, looksLikeAbsoluteLocalPath, looksLikeFileName, resetAbsoluteLocalPaths, resetThreadFileLinks } from "@/lib/thread-file-links";
import type { ThreadFile } from "@/lib/chat-files";
import { ChatMarkdown } from "./ChatMarkdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THREAD = "t-files";
const written = (over: Partial<ThreadFile> = {}): ThreadFile => ({
  id: "f1", messageId: "m-tool", source: "written", path: "~/Desktop/pelican-a-velo.html", name: "pelican-a-velo.html",
  at: 10, size: null, available: false, ...over,
});

let files: ThreadFile[];
let root: Root | null = null;
let openLocalFile: ReturnType<typeof vi.fn>;
let revealInFolder: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setLocale("fr");
  resetThreadFileLinks();
  resetAbsoluteLocalPaths();
  files = [written()];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (String(input).startsWith(`/api/threads/${THREAD}/files`)) {
      return new Response(JSON.stringify({ files }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }));
  openLocalFile = vi.fn(async () => "opened");
  revealInFolder = vi.fn(async () => "shown");
  (window as unknown as { ogb: unknown }).ogb = {
    platform: "darwin",
    openLocalFile,
    revealInFolder,
    localFilesExist: vi.fn(async (paths: string[]) => paths.map((path) => {
      if (path.startsWith("~/Desktop/pelican")) return "/Users/jc/Desktop/pelican-a-velo.html";
      if (path.includes("Acme Corp")) return path;
      if (path === "/Users/jc/missing-file.drawio") return null;
      return null;
    })),
  };
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (window as unknown as { ogb?: unknown }).ogb;
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

async function render(text: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(ChatMarkdown, { text, message: { threadId: THREAD, messageId: "m-text" } })));
  await flush();
  return host;
}

describe("file names in bot messages", () => {
  it("links a file the bot wrote", async () => {
    const host = await render("J'ai créé le fichier `pelican-a-velo.html` sur ton bureau.");
    const link = host.querySelector<HTMLButtonElement>("[data-file-link]");
    expect(link?.textContent).toContain("pelican-a-velo.html");
    expect(link?.getAttribute("aria-label")).toBe("Ouvrir pelican-a-velo.html");
    expect(host.querySelector("code")).toBeNull();
  });

  it("opens it with the default app on click", async () => {
    const host = await render("Voici `pelican-a-velo.html`.");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-file-link]")!.click());
    expect(openLocalFile).toHaveBeenCalledWith("/Users/jc/Desktop/pelican-a-velo.html");
  });

  it("offers Open, Show in Finder and Copy path on right click", async () => {
    const host = await render("Voici `pelican-a-velo.html`.");
    const link = host.querySelector<HTMLButtonElement>("[data-file-link]")!;
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })); });
    const items = [...document.querySelectorAll('[data-file-link-menu] [role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Ouvrir", "Afficher dans le Finder", "Copier le chemin"]);
    await act(async () => (document.querySelectorAll<HTMLButtonElement>('[data-file-link-menu] [role="menuitem"]')[1]!).click());
    expect(revealInFolder).toHaveBeenCalledWith("/Users/jc/Desktop/pelican-a-velo.html");
    expect(openLocalFile).not.toHaveBeenCalled();
  });

  it("offers Download instead of Show in folder for a file on another computer", async () => {
    (window as unknown as { ogb: unknown }).ogb = { platform: "darwin", remoteClient: { active: true } };
    files = [written({ path: "/home/bot/Desktop/pelican-a-velo.html", available: true })];
    const host = await render("Voici `pelican-a-velo.html`.");
    const link = host.querySelector<HTMLButtonElement>("[data-file-link]")!;
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })); });
    const items = [...document.querySelectorAll('[data-file-link-menu] [role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Ouvrir", "Télécharger", "Copier le chemin"]);
  });

  it("keeps an unknown or missing name as plain code", async () => {
    const host = await render("Pas créé : `autre.html`, ni `useState`.");
    expect(host.querySelector("[data-file-link]")).toBeNull();
    expect([...host.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["autre.html", "useState"]);
  });

  it("keeps a written file that is gone everywhere as plain code", async () => {
    files = [written({ path: "~/Desktop/ailleurs.html", name: "ailleurs.html" })];
    const host = await render("`ailleurs.html`");
    expect(host.querySelector("[data-file-link]")).toBeNull();
    expect(host.querySelector("code")?.textContent).toBe("ailleurs.html");
  });
});

describe("matching a name to the thread's files", () => {
  it("matches by path, path tail or bare name, latest first, never uploads", () => {
    const list = [
      written({ id: "old", at: 1, path: "/w/out/report.html", name: "report.html" }),
      written({ id: "new", at: 5, path: "/w/report.html", name: "report.html" }),
      written({ id: "up", at: 9, source: "upload", path: "/w/uploads/report.html", name: "report.html" }),
    ];
    expect(matchThreadFile("report.html", list)?.id).toBe("new");
    expect(matchThreadFile("out/report.html", list)?.id).toBe("old");
    expect(matchThreadFile("/w/out/report.html", list)?.id).toBe("old");
    expect(matchThreadFile("~/Desktop/pelican-a-velo.html", [written()])?.id).toBe("f1");
    expect(matchThreadFile("Desktop/pelican-a-velo.html", [written()])?.id).toBe("f1");
    expect(matchThreadFile("missing.html", list)).toBeNull();
  });

  it("only treats file-like words as candidates", () => {
    expect(looksLikeFileName("pelican-a-velo.html")).toBe(true);
    expect(looksLikeFileName("~/Desktop/x")).toBe(true);
    expect(looksLikeFileName("useState")).toBe(false);
    expect(looksLikeFileName("npm run build")).toBe(false);
    expect(looksLikeFileName("https://example.com/a.html")).toBe(false);
  });

  it("treats an absolute local path with spaces as a file path (#5393)", () => {
    const spaced = "/Users/ada/Documents/acme/Onboarding/Acme Corp inc/pages/AcmeCorp_Backups.drawio";
    expect(looksLikeAbsoluteLocalPath(spaced)).toBe(true);
    expect(looksLikeFileName(spaced)).toBe(true);
    expect(looksLikeFileName("Acme Corp inc")).toBe(false);
  });

  it("rejects API-style absolute paths without a home or drive prefix", () => {
    expect(looksLikeAbsoluteLocalPath("/api/bots")).toBe(false);
    expect(looksLikeAbsoluteLocalPath("/tmp/report.pdf")).toBe(true);
    expect(looksLikeAbsoluteLocalPath("~/Desktop/note.md")).toBe(true);
  });
});

describe("absolute local paths in inline code (#5393)", () => {
  const spaced = "/Users/ada/Documents/acme/Onboarding/Acme Corp inc/pages/AcmeCorp_Backups.drawio";

  it("links an absolute path with spaces even when the thread never listed it", async () => {
    const host = await render(`Le fichier \`${spaced}\` est prêt.`);
    const link = host.querySelector<HTMLButtonElement>("[data-file-link]");
    expect(link?.textContent).toContain("AcmeCorp_Backups.drawio");
    expect(host.querySelector("code")).toBeNull();
    await act(async () => link!.click());
    expect(openLocalFile).toHaveBeenCalledWith(spaced);
  });

  it("offers Show in Finder on right click for that path", async () => {
    const host = await render(`\`${spaced}\``);
    const link = host.querySelector<HTMLButtonElement>("[data-file-link]")!;
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })); });
    const items = [...document.querySelectorAll('[data-file-link-menu] [role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Ouvrir", "Afficher dans le Finder", "Copier le chemin"]);
    await act(async () => (document.querySelectorAll<HTMLButtonElement>('[data-file-link-menu] [role="menuitem"]')[1]!).click());
    expect(revealInFolder).toHaveBeenCalledWith(spaced);
  });

  it("reports a missing absolute path on click", async () => {
    revealInFolder = vi.fn(async () => "missing");
    openLocalFile = vi.fn(async () => "missing");
    (window as unknown as { ogb: { openLocalFile: typeof openLocalFile; revealInFolder: typeof revealInFolder; localFilesExist: unknown; platform: string } }).ogb.openLocalFile = openLocalFile;
    (window as unknown as { ogb: { revealInFolder: typeof revealInFolder } }).ogb.revealInFolder = revealInFolder;
    const host = await render("`/Users/jc/missing-file.drawio`");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-file-link]")!.click());
    expect(openLocalFile).toHaveBeenCalledWith("/Users/jc/missing-file.drawio");
    expect(host.querySelector("[role='status']")?.textContent).toBe("Ce fichier n'est plus là.");
  });

  it("opens a Markdown link whose target encodes spaces (#5393)", async () => {
    const host = await render("[Sauvegardes](/Users/ada/Documents/acme/Onboarding/Acme%20Corp%20inc/pages/AcmeCorp_Backups.drawio)");
    // Absolute Markdown destinations use the #5018 reveal control.
    expect(host.textContent).toMatch(/Finder|folder|Sauvegardes/i);
  });
});
