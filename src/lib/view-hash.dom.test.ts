// @vitest-environment happy-dom
// `#approvals` and `#code` open their screen at load and when the hash changes
// in an open tab; any other hash is left alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLeftViewHash, followViewHash, watchViewHash } from "./view-hash";

function setHash(hash: string) {
  history.replaceState(null, "", `/${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

describe("view hash", () => {
  afterEach(() => { history.replaceState(null, "", "/"); });

  it("opens Approvals and keeps its filters in the address", () => {
    const dispatch = vi.fn();
    const loc = { hash: "#approvals?tab=history", pathname: "/", search: "" };
    const historyApi = { state: null, replaceState: vi.fn() };
    expect(followViewHash(dispatch, loc, historyApi)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "showApprovals" });
    expect(historyApi.replaceState).not.toHaveBeenCalled();
  });

  it("opens a Code run and clears the hash", () => {
    const dispatch = vi.fn();
    const historyApi = { state: { k: 1 }, replaceState: vi.fn() };
    followViewHash(dispatch, { hash: "#code/run_1", pathname: "/app", search: "?x=1" }, historyApi);
    expect(dispatch).toHaveBeenCalledWith({ type: "showCode", runId: "run_1" });
    expect(historyApi.replaceState).toHaveBeenCalledWith({ k: 1 }, "", "/app?x=1");
  });

  it("leaves other hashes alone", () => {
    for (const hash of ["#inbox", "#code=abc", "#thread=t&bot=b", ""]) {
      const dispatch = vi.fn();
      const historyApi = { state: null, replaceState: vi.fn() };
      expect(followViewHash(dispatch, { hash, pathname: "/pair", search: "" }, historyApi)).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
      expect(historyApi.replaceState).not.toHaveBeenCalled();
    }
  });

  it("follows hash changes after mount and stops on cleanup", () => {
    const dispatch = vi.fn();
    const stop = watchViewHash(dispatch);
    expect(dispatch).not.toHaveBeenCalled();

    setHash("#approvals");
    expect(dispatch).toHaveBeenLastCalledWith({ type: "showApprovals" });

    setHash("#code/run_2");
    expect(dispatch).toHaveBeenLastCalledWith({ type: "showCode", runId: "run_2" });
    expect(location.hash).toBe("");

    setHash("#inbox");
    expect(dispatch).toHaveBeenCalledTimes(2);

    stop();
    setHash("#approvals");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("drops the Approvals or Code address once that screen is left", () => {
    const historyApi = { state: { k: 1 }, replaceState: vi.fn() };
    const at = (hash: string) => ({ hash, pathname: "/app", search: "?x=1" });
    expect(clearLeftViewHash("approvals", at("#approvals?tab=history"), historyApi)).toBe(false);
    expect(clearLeftViewHash("code", at("#code/run_1"), historyApi)).toBe(false);
    expect(clearLeftViewHash("chat", at("#inbox"), historyApi)).toBe(false);
    expect(clearLeftViewHash("chat", at("#code=abc"), historyApi)).toBe(false);
    expect(historyApi.replaceState).not.toHaveBeenCalled();
    expect(clearLeftViewHash("chat", at("#approvals?tab=history"), historyApi)).toBe(true);
    expect(clearLeftViewHash("approvals", at("#code"), historyApi)).toBe(true);
    expect(historyApi.replaceState).toHaveBeenNthCalledWith(1, { k: 1 }, "", "/app?x=1");
    expect(historyApi.replaceState).toHaveBeenCalledTimes(2);
  });

  it("opens Approvals again from the same address after leaving it", () => {
    const dispatch = vi.fn();
    const stop = watchViewHash(dispatch);
    setHash("#approvals");
    expect(dispatch).toHaveBeenCalledTimes(1);
    // the person goes back to a chat: the address no longer names Approvals
    clearLeftViewHash("chat");
    expect(location.hash).toBe("");
    // so following #approvals again is a real change, and it opens again
    location.hash = "#approvals";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "showApprovals" });
    stop();
  });
});
