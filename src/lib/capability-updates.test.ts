// @vitest-environment happy-dom
// Updates of plugins, skills and connectors (#4504): the page reads the count
// and the items, runs one update or all, shows progress and a named failure,
// and reads again when the live channel says something changed.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => api(...args), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const { CAPABILITY_UPDATES_EVENT, CAPABILITY_UPDATES_ROUTE, updateKindOf, updateOf, useCapabilityUpdates } = await import("./capability-updates");
type Updates = import("./capability-updates").CapabilityUpdates;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (over: Record<string, unknown> = {}) => ({
  key: "plugin:me:me:code-review@market", kind: "plugin" as const, name: "Code Review", scope: "me" as const,
  installedVersion: "1.2.0", availableVersion: "1.3.0", updateAvailable: true, canUpdate: true, ...over,
});
const answer = (items = [item()]): Updates => ({ count: items.filter((entry) => entry.updateAvailable && entry.canUpdate).length, checkedAt: 1, checking: false, items });

describe("joining an update to a row", () => {
  it("finds the item by kind and readable name, ignoring case and punctuation, only when an update waits", () => {
    const data = answer([item(), item({ key: "skill:me:me:weekly", kind: "skill", name: "weekly-summary" }), item({ key: "c", kind: "connector", name: "Done", updateAvailable: false })]);
    expect(updateOf(data, "plugin", "code review")?.key).toBe("plugin:me:me:code-review@market");
    expect(updateOf(data, "skill", "Weekly Summary")?.kind).toBe("skill");
    expect(updateOf(data, "connector", "Done")).toBeUndefined();
    expect(updateOf(data, "skill", "Code Review")).toBeUndefined();
    expect(updateOf(null, "plugin", "Code Review")).toBeUndefined();
  });
  it("names a row's kind in the updates' kinds", () => {
    expect([updateKindOf("plugin"), updateKindOf("skill"), updateKindOf("mcp"), updateKindOf("featured"), updateKindOf("app")]).toEqual(["plugin", "skill", "connector", "connector", "connector"]);
  });
});

describe("the page's use of the update routes", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useCapabilityUpdates>;
  const Probe = () => { state = useCapabilityUpdates(); return null; };
  beforeEach(() => {
    api.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it("reads the count and the items on open, from the signed-in person's route", async () => {
    api.mockResolvedValueOnce(answer());
    await act(async () => { root.render(createElement(Probe)); });
    expect(api).toHaveBeenCalledWith(CAPABILITY_UPDATES_ROUTE);
    expect(state.data?.count).toBe(1);
  });

  it("reads again when the live channel says updates changed", async () => {
    api.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer([]));
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { window.dispatchEvent(new CustomEvent(CAPABILITY_UPDATES_EVENT)); });
    expect(api).toHaveBeenCalledTimes(2);
    expect(state.data?.count).toBe(0);
  });

  it("runs one update by its key and shows it running until the answer, then reads the list again", async () => {
    let finish!: (value: unknown) => void;
    api.mockResolvedValueOnce(answer()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(answer([]));
    await act(async () => { root.render(createElement(Probe)); });
    let pending!: Promise<unknown>;
    await act(async () => { pending = state.update(["plugin:me:me:code-review@market"]); });
    expect(api).toHaveBeenLastCalledWith(CAPABILITY_UPDATES_ROUTE, { method: "POST", body: JSON.stringify({ keys: ["plugin:me:me:code-review@market"] }) });
    expect(state.running.has("plugin:me:me:code-review@market")).toBe(true);
    await act(async () => { finish({ results: [{ key: "plugin:me:me:code-review@market", kind: "plugin", name: "Code Review", status: "updated", from: "1.2.0", to: "1.3.0" }], count: 0 }); await pending; });
    expect(state.running.size).toBe(0);
    expect(state.failures).toEqual([]);
    expect(state.data?.count).toBe(0);
  });

  it("update all sends {all: true} and says so while it runs", async () => {
    let finish!: (value: unknown) => void;
    api.mockResolvedValueOnce(answer()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(answer([]));
    await act(async () => { root.render(createElement(Probe)); });
    let pending!: Promise<unknown>;
    await act(async () => { pending = state.updateAll(); });
    expect(api).toHaveBeenCalledWith(CAPABILITY_UPDATES_ROUTE, { method: "POST", body: JSON.stringify({ all: true }) });
    expect(state.updatingAll).toBe(true);
    expect(state.running.has("plugin:me:me:code-review@market")).toBe(true);
    await act(async () => { finish({ results: [], count: 0 }); await pending; });
    expect(state.updatingAll).toBe(false);
  });

  it("names a failed item and why, keeps the item in the list (the old version stays), and lets it be dismissed", async () => {
    api.mockResolvedValueOnce(answer()).mockResolvedValueOnce({ results: [{ key: "plugin:me:me:code-review@market", kind: "plugin", name: "Code Review", status: "failed", error: "The marketplace could not be reached." }], count: 1 }).mockResolvedValueOnce(answer());
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { await state.update(["plugin:me:me:code-review@market"]); });
    expect(state.failures).toEqual([{ key: "plugin:me:me:code-review@market", name: "Code Review", error: "The marketplace could not be reached." }]);
    expect(state.data?.items[0]?.updateAvailable).toBe(true);
    await act(async () => { state.dismissFailure("plugin:me:me:code-review@market"); });
    expect(state.failures).toEqual([]);
  });

  it("a call that throws is a failure of the keys asked, never an unhandled error", async () => {
    api.mockResolvedValueOnce(answer()).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(answer());
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { await state.update(["plugin:me:me:code-review@market"]); });
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]?.name).toBe("Code Review");
  });

  it("shows nothing and does not fail on a server that does not know the route", async () => {
    api.mockRejectedValueOnce(new Error("404"));
    await act(async () => { root.render(createElement(Probe)); });
    expect(state.data).toBeNull();
    expect(state.failures).toEqual([]);
  });
});
