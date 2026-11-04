import { afterEach, describe, expect, it, vi } from "vitest";

import { applyPersonLabel, canEditPersonLabel, loadPersonLabels, storedPersonLabel, resetPersonLabelsForTests, savePersonLabel } from "./person-labels";

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

describe("person labels on the client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPersonLabelsForTests();
  });

  it("loads the server's labels by principal id, case-insensitively", async () => {
    const fetch = vi.fn(() => ok({ labels: { PR_ADA: "CTO", pr_bob: "  ", pr_cy: 3 } }));
    vi.stubGlobal("fetch", fetch);
    await loadPersonLabels(true);
    expect(fetch).toHaveBeenCalledWith("/api/people/labels", expect.anything());
    expect(storedPersonLabel("pr_ada")).toBe("CTO");
    expect(storedPersonLabel("pr_bob")).toBe("");
    expect(storedPersonLabel("pr_cy")).toBe("");
    expect(storedPersonLabel(null)).toBe("");
  });

  it("applies a person.label frame and clears with null", () => {
    applyPersonLabel("pr_ada", "Dispatch");
    expect(storedPersonLabel("PR_ADA")).toBe("Dispatch");
    applyPersonLabel("pr_ada", null);
    expect(storedPersonLabel("pr_ada")).toBe("");
  });

  it("saves a trimmed label with PUT and shows the server's answer; refuses a long one before sending", async () => {
    const fetch = vi.fn((_path: string, _init?: RequestInit) => ok({ principalId: "pr_ada", label: "CTO" }));
    vi.stubGlobal("fetch", fetch);
    await savePersonLabel("pr_ada", "  CTO ");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/api/people/pr_ada/label");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ label: "CTO" });
    expect(storedPersonLabel("pr_ada")).toBe("CTO");
    await expect(savePersonLabel("pr_ada", "x".repeat(41))).rejects.toThrow("label_too_long");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces a refusal and keeps the label", async () => {
    applyPersonLabel("pr_ada", "CTO");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "nope", code: "person_label_forbidden" }), { status: 403 }))));
    await expect(savePersonLabel("pr_ada", "CFO")).rejects.toThrow("nope");
    expect(storedPersonLabel("pr_ada")).toBe("CTO");
  });

  it("lets the person, an admin and a manager of their team edit; nobody else", () => {
    expect(canEditPersonLabel({ personId: "pr_ada", viewerId: "PR_ADA", viewerAdmin: false })).toBe(true);
    expect(canEditPersonLabel({ personId: "pr_ada", viewerId: "pr_me", viewerAdmin: true })).toBe(true);
    expect(canEditPersonLabel({ personId: "pr_ada", viewerId: "pr_me", viewerAdmin: false, managedTeamIds: ["t1"], personTeamIds: ["t1"] })).toBe(true);
    expect(canEditPersonLabel({ personId: "pr_ada", viewerId: "pr_me", viewerAdmin: false, managedTeamIds: ["t2"], personTeamIds: ["t1"] })).toBe(false);
    expect(canEditPersonLabel({ personId: "pr_ada", viewerId: null, viewerAdmin: false })).toBe(false);
  });
});
