// @vitest-environment happy-dom
// #4504: the page against the REAL routes and the real service of the server
// (GET and POST /api/me/capability-updates, the capability.updates frame), on
// fake providers: no stand-in for the wire. What the server says is what the
// page's hook, its marks and its notices read.
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../../server/harness/http.ts";
import { CAPABILITY_UPDATES_FRAME, CapabilityUpdates, capabilityUpdatesFrameAllowed, type UpdateItem, type UpdateProvider } from "../../server/capabilities/capability-updates.ts";
import { createCapabilityUpdatesRoutes } from "../../server/routes/capability-updates.ts";
import { dispatchRoutes } from "../../server/routes/table.ts";

let origin = "";
vi.mock("@/state/store", () => ({
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
  // the page's `api`, over the real HTTP server of this test
  api: (path: string, init: { method?: string; body?: string } = {}) => new Promise((resolve, reject) => {
    const url = new URL(path, origin);
    const call = request(url, { method: init.method ?? "GET", headers: init.body ? { "content-type": "application/json" } : {} }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => (response.statusCode! < 400 ? resolve(JSON.parse(text)) : reject(new Error(text))));
    });
    call.on("error", reject);
    call.end(init.body);
  }),
}));

const { updateOf, useCapabilityUpdates, CAPABILITY_UPDATES_EVENT } = await import("./capability-updates");
const { UpdateNotice } = await import("../components/plugins/UpdateNotice");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADA = { id: "pr_ada", manager: false };
const row = (over: Partial<UpdateItem> & Pick<UpdateItem, "key" | "name">): UpdateItem => ({ kind: "plugin", scope: "me", updateAvailable: false, canUpdate: true, ...over });

let rows: UpdateItem[] = [];
let frames: Array<Record<string, unknown>> = [];
let server: Server;
let service: CapabilityUpdates;
const provider: UpdateProvider = {
  kind: "plugin",
  items: () => rows,
  check: async () => false,
  update: async (_person, item) => {
    if (item.name === "Broken") throw new Error("The marketplace could not be reached.");
    rows = rows.map((entry) => entry.key === item.key ? { ...entry, updateAvailable: false, installedVersion: item.availableVersion } : entry);
    return { to: item.availableVersion };
  },
};

let host: HTMLDivElement;
let root: Root;
let state: ReturnType<typeof useCapabilityUpdates>;
function Probe() { state = useCapabilityUpdates(); return null; }

beforeEach(async () => {
  rows = [
    row({ key: "plugin:me:me:code-review@market", name: "Code Review", updateAvailable: true, installedVersion: "1.0.0", availableVersion: "1.1.0", updateNotes: "Reads the whole branch." }),
    row({ key: "plugin:me:me:broken@market", name: "Broken", updateAvailable: true, installedVersion: "1.0.0", availableVersion: "2.0.0" }),
    row({ key: "plugin:me:me:silent@market", name: "Silent", updateUnknown: true }),
    row({ key: "plugin:organization:organization:pack@oc-1", name: "Compliance Pack", scope: "organization", organization: "required", organizationId: "oc-1", updateAvailable: true, installedVersion: "0.9.4", availableVersion: "0.9.5", canUpdate: false }),
  ];
  frames = [];
  service = new CapabilityUpdates({ providers: [provider], log: () => undefined, notify: (person, view) => frames.push({ kind: CAPABILITY_UPDATES_FRAME, audience: person, count: view.count, checkedAt: view.checkedAt }) });
  const routes = [createCapabilityUpdatesRoutes({ updates: service, person: () => ADA })];
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: {} as never, json, readBody });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  await new Promise((done) => server.close(done));
});

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 40)); });

describe("the page reads what the real route answers", () => {
  it("counts only what can be updated, marks the rows by their updateKey, gives an unknown source and an organization row no mark", async () => {
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    // the organization's row and the unknown source are not counted
    expect(state.data?.count).toBe(2);
    expect(updateOf(state.data, "plugin", "Code Review", "plugin:me:me:code-review@market")?.availableVersion).toBe("1.1.0");
    expect(updateOf(state.data, "plugin", "Silent", "plugin:me:me:silent@market")).toBeUndefined();
    // an organization row is joined by its declaration id, never by name
    expect(updateOf(state.data, "plugin", "Compliance Pack", undefined, "oc-1")?.canUpdate).toBe(false);
    expect(updateOf(state.data, "plugin", "Compliance Pack")).toBeUndefined();
  });

  it("update one: the version moves, the mark and the count go, and the person's frame says so", async () => {
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    await act(async () => { await state.update(["plugin:me:me:code-review@market"]); });
    await settle();
    expect(state.failures).toEqual([]);
    expect(state.data?.count).toBe(1);
    expect(updateOf(state.data, "plugin", "Code Review", "plugin:me:me:code-review@market")).toBeUndefined();
    // the live frame reaches this person only, with the count: the app reads the list again on it
    expect(frames.length).toBeGreaterThan(0);
    expect(capabilityUpdatesFrameAllowed(frames.at(-1)!, "pr_ada", "pr_local")).toBe(true);
    expect(capabilityUpdatesFrameAllowed(frames.at(-1)!, "pr_bob", "pr_local")).toBe(false);
  });

  it("update all: the one that can go goes, a failure is named with its reason and the old version stays, the organization's is not asked", async () => {
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    await act(async () => { await state.updateAll(); });
    await settle();
    expect(state.failures.map((failure) => [failure.name, failure.unknown ?? false])).toEqual([["Broken", false]]);
    expect(state.failures[0]!.error).toContain("could not be reached");
    expect(state.data?.items.find((entry) => entry.name === "Code Review")?.updateAvailable).toBe(false);
    expect(state.data?.items.find((entry) => entry.name === "Compliance Pack")?.installedVersion).toBe("0.9.4");
    const out = document.createElement("div");
    document.body.append(out);
    const noticeRoot = createRoot(out);
    await act(async () => { noticeRoot.render(createElement(UpdateNotice, { failure: state.failures[0]!, onRetry: vi.fn(), onClose: vi.fn() })); });
    expect(out.textContent).toContain("Broken");
    expect(out.textContent).toContain("could not be reached");
    expect(out.textContent).toContain("old version stays");
    await act(async () => noticeRoot.unmount());
    out.remove();
  });

  it("an update asked of an unknown source answers unknown: said calmly as 'could not be checked', never as a failure; the organization's item says its console decides", async () => {
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    await act(async () => { await state.update(["plugin:me:me:silent@market", "plugin:organization:organization:pack@oc-1"]); });
    expect(state.failures.map((failure) => [failure.name, failure.unknown ?? false])).toEqual([["Silent", true], ["Compliance Pack", false]]);
    const out = document.createElement("div");
    document.body.append(out);
    const noticeRoot = createRoot(out);
    await act(async () => { noticeRoot.render(createElement(UpdateNotice, { failure: state.failures[0]!, onRetry: vi.fn(), onClose: vi.fn() })); });
    expect(out.textContent).toContain("could not be checked");
    await act(async () => { noticeRoot.render(createElement(UpdateNotice, { failure: state.failures[1]!, onRetry: vi.fn(), onClose: vi.fn() })); });
    expect(out.textContent).toContain("organization manages");
    await act(async () => noticeRoot.unmount());
    out.remove();
  });

  it("reads the list again on the live frame's window event", async () => {
    await act(async () => { root.render(createElement(Probe)); });
    await settle();
    rows = rows.map((entry) => entry.name === "Silent" ? { ...entry, updateUnknown: undefined, updateAvailable: true, installedVersion: "1", availableVersion: "2" } : entry);
    await act(async () => { window.dispatchEvent(new CustomEvent(CAPABILITY_UPDATES_EVENT)); });
    await settle();
    expect(updateOf(state.data, "plugin", "Silent", "plugin:me:me:silent@market")?.availableVersion).toBe("2");
  });
});
