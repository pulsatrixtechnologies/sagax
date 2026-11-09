import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("offline web shell", () => {
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("registers one shell worker and does not cache private API responses", () => {
    expect(page).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(worker).toContain('const CACHE = "sagax-shell-v2"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain("event.request.method !== \"GET\"");
    expect(worker).toContain('cache.match("/index.html")');
  });

  it("never answers a published page or a sign-in with the shell, and never caches them (#1486)", () => {
    const skip = worker.indexOf('url.pathname.startsWith("/pages/")');
    expect(skip).toBeGreaterThan(0);
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    // the skip comes before the worker answers anything
    expect(skip).toBeLessThan(worker.indexOf("event.respondWith"));
  });

  it("leaves media range requests on the network and caches only whole answers (#3043)", () => {
    const skip = worker.indexOf('event.request.headers.has("range")');
    expect(skip).toBeGreaterThan(0);
    expect(skip).toBeLessThan(worker.indexOf("event.respondWith"));
    expect(worker).toContain("fresh.status === 200");
  });
});
