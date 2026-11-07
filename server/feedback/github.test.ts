import { describe, expect, it } from "vitest";
import { fileIssue, issueStatus, similarTitle, statusOfIssue } from "./github.ts";

type Call = { method: string; url: string; body?: any; auth?: string };

function fakeFetch(routes: Record<string, (call: Call) => { status: number; json: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const call: Call = { method, url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>)?.authorization };
    calls.push(call);
    const key = Object.keys(routes).find((pattern) => `${method} ${url}`.includes(pattern));
    const out = key ? routes[key]!(call) : { status: 404, json: { message: "not found" } };
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const REPORT = { title: "[Feedback] Bug: Save does nothing in settings", body: "## Summary", labels: ["feedback", "feedback:untriaged", "bug"] };

describe("feedback GitHub filer", () => {
  it("creates missing labels and files the issue with them, token in the header only", async () => {
    const { impl, calls } = fakeFetch({
      "GET https://api.github.com/repos/o/r/labels/": () => ({ status: 404, json: {} }),
      "POST https://api.github.com/repos/o/r/labels": () => ({ status: 201, json: {} }),
      "GET https://api.github.com/repos/o/r/issues?": () => ({ status: 200, json: [] }),
      "POST https://api.github.com/repos/o/r/issues": () => ({ status: 201, json: { number: 42, html_url: "https://github.com/o/r/issues/42" } }),
    });
    const out = await fileIssue({ repo: "o/r", token: "t0ken", fetch: impl }, REPORT);
    expect(out).toEqual({ number: 42, url: "https://github.com/o/r/issues/42", duplicate: false });
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/issues"));
    expect(created?.body.labels).toEqual(["feedback", "feedback:untriaged", "bug"]);
    expect(created?.auth).toBe("Bearer t0ken");
    expect(calls.filter((call) => call.url.endsWith("/labels")).length).toBe(4);
    expect(JSON.stringify(calls.map((call) => call.body))).not.toContain("t0ken");
  });

  it("adds a +1 comment to an open issue with a similar title instead of a duplicate", async () => {
    const { impl, calls } = fakeFetch({
      "GET https://api.github.com/repos/o/r/labels/": () => ({ status: 200, json: {} }),
      "GET https://api.github.com/repos/o/r/issues?": () => ({ status: 200, json: [{ number: 7, title: "[Feedback] Bug: Save does nothing in the settings", html_url: "https://github.com/o/r/issues/7" }] }),
      "POST https://api.github.com/repos/o/r/issues/7/comments": () => ({ status: 201, json: {} }),
    });
    const out = await fileIssue({ repo: "o/r", token: "t", fetch: impl }, REPORT);
    expect(out).toEqual({ number: 7, url: "https://github.com/o/r/issues/7", duplicate: true });
    const comment = calls.find((call) => call.url.endsWith("/issues/7/comments"));
    expect(comment?.body.body).toContain("+1");
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/issues"))).toBe(false);
  });

  it("reads the status from the issue", async () => {
    expect(statusOfIssue({ state: "closed", labels: [] })).toBe("resolved");
    expect(statusOfIssue({ state: "open", labels: [{ name: "feedback:in-progress" }] })).toBe("in_progress");
    expect(statusOfIssue({ state: "open", labels: [{ name: "feedback" }], assignees: [{ login: "x" }] })).toBe("in_progress");
    expect(statusOfIssue({ state: "open", labels: [{ name: "feedback" }] })).toBe("received");
    expect(statusOfIssue({ state: "open", labels: [{ name: "feedback" }, { name: "feedback:untriaged" }] })).toBe("sent");
    const { impl } = fakeFetch({ "GET https://api.github.com/repos/o/r/issues/9": () => ({ status: 200, json: { state: "closed", labels: [] } }) });
    expect(await issueStatus({ repo: "o/r", token: "t", fetch: impl }, 9)).toBe("resolved");
  });

  it("compares titles by their words", () => {
    expect(similarTitle("[Feedback] Bug: Save does nothing", "[Feedback] Bug: save does nothing!")).toBe(true);
    expect(similarTitle("[Feedback] Bug: Save does nothing", "[Feedback] Idea: dark mode for the sidebar")).toBe(false);
  });
});
