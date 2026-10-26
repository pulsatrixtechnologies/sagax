// @vitest-environment happy-dom
// The working-folder dropdown over the Tailcat directory listing.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RemoteListing } from "../../../shared/remote-files";
import type { RemoteSessionView } from "../../../shared/remote-session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
const answers = vi.hoisted(() => ({ map: {} as Record<string, RemoteListing | { error: string }> }));
vi.mock("./remote-session-client", () => ({
  listRemoteDir: async (_bot: string, _id: string, path: string) => { calls.push(path); return answers.map[path] ?? { error: "nope" }; },
}));
vi.mock("./use-remote-sessions", () => ({ useRemoteSessions: () => ({ rows: [], reload: () => {} }) }));
const { RemoteFolderField, browsableSession } = await import("./RemoteFolderField");

const base = { id: "0123456789ab", code: "BQDHS7", state: "connected", elevated: false, endAt: "2026-10-22T00:33:00.000Z", suggestions: [] as RemoteSessionView["suggestions"] } as const;
const win: RemoteSessionView = { ...base, os: "windows" };
const lin: RemoteSessionView = { ...base, os: "linux" };
const HOME = "C:\\Users\\usager";
const listing = (path: string, parent: string | null, names: string[]): RemoteListing => ({
  path, parent, home: HOME, roots: ["C:\\"], truncated: false,
  entries: [...names.map((name) => ({ name, kind: "dir" as const })), { name: "a.txt", kind: "file" as const, size: 1 }],
});

let host: HTMLDivElement;
let root: Root;
let value = "";
function Harness({ view }: { view?: RemoteSessionView }) {
  const [v, set] = useState("");
  value = v;
  return createElement(RemoteFolderField, { botId: "bot", value: v, onChange: set, view });
}
const mount = async (view?: RemoteSessionView) => { await act(async () => { root.render(createElement(Harness, { view })); }); };
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const q = (s: string) => host.querySelector(s);

beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); calls.length = 0; answers.map = {}; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("RemoteFolderField", () => {
  it("lists remote folders only, navigates, and fills a Windows absolute path", async () => {
    answers.map[""] = listing(HOME, "C:\\Users", ["Documents"]);
    answers.map[`${HOME}\\Documents`] = listing(`${HOME}\\Documents`, HOME, ["Projets"]);
    await mount(win);
    await click(q("[data-remote-folder-toggle]"));
    expect(calls).toEqual([""]);
    expect(q("[data-remote-folder-entry=Documents]")).not.toBeNull();
    expect(host.textContent).not.toContain("a.txt");
    await click(q("[data-remote-folder-entry=Documents]"));
    expect(calls[1]).toBe(`${HOME}\\Documents`);
    await click(q("[data-remote-folder-choose]"));
    expect(value).toBe(`${HOME}\\Documents`);
    expect(q("[data-remote-folder-menu]")).toBeNull();
  });
  it("uses POSIX paths on a Linux computer and climbs with the parent row", async () => {
    answers.map[""] = { path: "/home/u", parent: "/home", home: "/home/u", roots: ["/"], truncated: false, entries: [{ name: "src", kind: "dir" }] };
    answers.map["/home"] = { path: "/home", parent: "/", home: "/home/u", roots: ["/"], truncated: false, entries: [] };
    await mount(lin);
    await click(q("[data-remote-folder-toggle]"));
    await click(q("[data-remote-folder-up]"));
    expect(calls[1]).toBe("/home");
    await click(q("[data-remote-folder-choose]"));
    expect(value).toBe("/home");
  });
  it("starts at the typed path when it is valid", async () => {
    answers.map["/srv/app"] = { path: "/srv/app", parent: "/srv", roots: ["/"], truncated: false, entries: [] };
    await mount(lin);
    const input = q("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "/srv/app");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(q("[data-remote-folder-toggle]"));
    expect(calls).toEqual(["/srv/app"]);
  });
  it("disables Parcourir with a reason when no computer is connected, typing still works", async () => {
    await mount(undefined);
    const button = q("[data-remote-folder-toggle]") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(q("[data-remote-folder-reason]")?.textContent).toContain("Type the absolute path");
    expect(calls).toEqual([]);
  });
  it("shows an offline or permission error and cannot choose", async () => {
    answers.map[""] = { error: "The remote computer refused to open that folder." };
    await mount(lin);
    await click(q("[data-remote-folder-toggle]"));
    expect(q("[role=alert]")?.textContent).toContain("refused");
    expect((q("[data-remote-folder-choose]") as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not offer a system folder", async () => {
    answers.map[""] = { path: "C:\\Windows", parent: "C:\\", roots: ["C:\\"], truncated: false, entries: [] };
    await mount(win);
    await click(q("[data-remote-folder-toggle]"));
    expect((q("[data-remote-folder-choose]") as HTMLButtonElement).disabled).toBe(true);
  });
  it("picks only a connected, known computer", () => {
    expect(browsableSession([{ ...win, state: "ended" }, lin])?.os).toBe("linux");
    expect(browsableSession([{ ...win, osKnown: false }])).toBeUndefined();
  });
});
