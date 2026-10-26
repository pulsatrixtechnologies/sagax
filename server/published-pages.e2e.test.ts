// Published pages through the real server (server/index.ts wiring): the
// reading link is answered before the auth gate with the sandbox CSP and no
// cookie, publish and revoke go through the person's API, and a revoked
// link is gone. The proposal is written to the fixture's own data folder,
// as the bot's card route would.
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { PublishedPages } from "./published-pages.ts";

it("serves a published page in its wrapper and sandboxed frame, and stops at once when it is revoked", async () => {
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Rapport", kind: "html", content: "<!doctype html><p>Bonjour</p><script>fetch('/api/config')</script>" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, body: await response.json() as any };
    };
    // nothing to read before the person publishes
    expect((await api(`/api/pages/${id}`)).body.page).toMatchObject({ status: "draft" });
    // the app previews it through the wrapper, never a srcdoc
    const previewPath: string = (await api(`/api/pages/${id}/versions/1`)).body.version.previewPath;
    const preview = await fetch(`${url}${previewPath}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-security-policy")).toContain(`/pages/preview-frame/${id}/1;`);
    const previewFrame = /<iframe src="([^"]+)"/.exec(await preview.text())![1]!.replace(/&amp;/g, "&");
    expect((await fetch(`${url}${previewFrame}`, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(200);
    const published = await api(`/api/pages/${id}/publish`, "POST", { version: 1, access: "link", expiresAt: null });
    expect(published.status).toBe(200);
    const path: string = published.body.page.path;
    const wrapper = await fetch(`${url}${path}`, { headers: { origin: "https://elsewhere.example" } });
    expect(wrapper.status).toBe(200);
    expect(wrapper.headers.get("set-cookie")).toBeNull();
    expect(wrapper.headers.get("content-security-policy")).toContain(`/pages/frame/${path.slice("/pages/view/".length)};`);
    const body = await wrapper.text();
    expect(body).toContain("never enter a password here");
    const frameSrc = /<iframe src="([^"]+)"/.exec(body)![1]!.replace(/&amp;/g, "&");
    // never as a top-level document
    expect((await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "document" } })).status).toBe(404);
    const frame = await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(frame.status).toBe(200);
    const csp = frame.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/; sandbox allow-scripts$/);
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(frame.headers.get("set-cookie")).toBeNull();
    expect(frame.headers.get("access-control-allow-origin")).toBeNull();
    expect(await frame.text()).toContain("<p>Bonjour</p>");
    expect((await api(`/api/pages/${id}/revoke`, "POST", {})).status).toBe(200);
    expect((await fetch(`${url}${path}`)).status).toBe(404);
    expect((await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(404);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("lot R8 through the real server: rename, the person's edit (secrets out), comments, annotation preview and the public-link switch", async () => {
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Rapport", kind: "markdown", content: "# Titre" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, body: await response.json() as any };
    };
    expect((await api(`/api/pages/${id}`, "PATCH", { title: "Bilan" })).body.page.title).toBe("Bilan");
    const edited = await api(`/api/pages/${id}/versions`, "POST", { kind: "presentation", content: "# Un\n\nghp_abcdefghijklmnopqrstuvwxyz0123456789\n\n---\n\n# Deux" });
    expect(edited.status).toBe(201);
    const source = await api(`/api/pages/${id}/versions/${edited.body.version}/source`);
    expect(source.body.version.kind).toBe("presentation");
    expect(source.body.content).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect((await api(`/api/pages/${id}/comments`, "POST", { text: "Plus court" })).status).toBe(201);
    expect((await api(`/api/pages/${id}/comments`)).body.comments).toHaveLength(1);
    // the annotation preview: the frame runs only the nonce'd annotation script
    const preview = await fetch(`${url}/pages/preview/${id}/${edited.body.version}?annotate=1`);
    const frameSrc = /<iframe src="([^"]+)"/.exec(await preview.text())![1]!.replace(/&amp;/g, "&");
    expect(frameSrc).toContain("&a=1");
    const frame = await fetch(`${url}${frameSrc}`, { headers: { "sec-fetch-dest": "iframe" } });
    expect(frame.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[^']+'/);
    expect(await frame.text()).toContain("sagax-page-annotation");
    // the switch: this computer's owner is its admin
    expect((await api("/api/admin/pages/policy", "PUT", { linkSharing: false })).body).toEqual({ linkSharing: false, readerComments: true });
    expect((await api(`/api/pages/${id}/publish`, "POST", { version: edited.body.version, access: "link", expiresAt: null })).status).toBe(403);
    expect((await api(`/api/pages/${id}/publish`, "POST", { version: edited.body.version, access: "org", expiresAt: null })).status).toBe(200);
  } finally {
    await fixture.close();
  }
}, 120_000);
