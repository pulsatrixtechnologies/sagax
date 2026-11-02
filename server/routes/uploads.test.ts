// Characterization of the P3 upload / attachment routes moved out of
// server/index.ts (#1388): resumable phases, image POST, file POST,
// manifest GET, attachment GET. Auth gate already ran; these tests cover
// route ownership (PASS), validation refusals, and happy paths with fakes.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "./table.ts";
import {
  createUploadsRoutes,
  encryptionOwnerForUpload,
  type UploadsRouteDeps,
} from "./uploads.ts";

type Sent = { status: number; body: unknown };

function baseDeps(over: Partial<UploadsRouteDeps> = {}): UploadsRouteDeps {
  return {
    uploadOwner: () => "pr_owner",
    encryptionOwner: () => null,
    extractArchivesHere: () => true,
    resumableUpload: vi.fn(async () => ({ offset: 0, total: 10 })),
    saveImage: vi.fn(async () => ({ path: "/tmp/a.png", mime: "image/png", bytes: 4 })),
    saveSharedFile: vi.fn(async () => ({ path: "/tmp/a.txt", mime: "text/plain", bytes: 4, name: "notes.txt" })),
    isArchive: () => false,
    readManifest: () => null,
    resolveServable: () => null,
    ...over,
  };
}

function call(
  deps: UploadsRouteDeps,
  opts: {
    method: string;
    path: string;
    query?: string;
    headers?: Record<string, string>;
    auth?: RequestAuth;
    bodyChunks?: Buffer[];
  },
) {
  const sent: Sent[] = [];
  const headersOut: Record<string, string> = {};
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  const chunks = opts.bodyChunks ?? [];
  let resume = 0;
  const req = {
    headers: opts.headers ?? {},
    resume: () => { resume += 1; },
    iterator: () => Readable.from(chunks)[Symbol.asyncIterator](),
  } as unknown as IncomingMessage;
  const res = {
    setHeader: (key: string, value: string) => { headersOut[key] = value; },
    writeHead: () => undefined,
    end: () => undefined,
    destroyed: false,
    on: () => undefined,
  } as unknown as ServerResponse;
  const route = createUploadsRoutes(deps);
  return (async () => {
    const out = await route({
      req,
      res,
      url,
      path: url.pathname,
      method: opts.method,
      auth: opts.auth ?? { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth,
      json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: (async () => ({})) as RouteContext["readBody"],
    });
    return { out, sent: sent[0], headersOut, resume };
  })();
}

describe("createUploadsRoutes", () => {
  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { method: "GET", path: "/api/search" })).out).toBe(PASS);
    expect((await call(deps, { method: "POST", path: "/api/groups" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/attachments" })).out).toBe(PASS);
  });

  it("refuses an invalid resumable phase", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/attachments",
      query: "phase=nope&uploadId=11111111-1111-4111-8111-111111111111&total=4",
      headers: { "content-type": "image/png" },
    });
    expect(result.sent).toEqual({ status: 400, body: { error: "invalid upload phase" } });
    expect(result.resume).toBeGreaterThan(0);
    expect(deps.resumableUpload).not.toHaveBeenCalled();
  });

  it("runs the resumable happy path for attachments and files", async () => {
    const resumableUpload = vi.fn(async () => ({ offset: 4, total: 4, saved: { path: "/tmp/a.png", mime: "image/png", bytes: 4, name: "image.png" } }));
    const deps = baseDeps({ resumableUpload });
    const image = await call(deps, {
      method: "POST",
      path: "/api/attachments",
      query: "phase=status&uploadId=11111111-1111-4111-8111-111111111111&total=4",
      headers: { "content-type": "image/png" },
    });
    expect(image.sent?.status).toBe(200);
    expect(image.sent?.body).toMatchObject({ offset: 4, total: 4 });
    expect(resumableUpload).toHaveBeenCalledWith(expect.objectContaining({ image: true, phase: "status" }));

    const file = await call(deps, {
      method: "POST",
      path: "/api/files",
      query: "phase=cancel&uploadId=11111111-1111-4111-8111-111111111111&total=4&name=notes.txt",
      headers: { "content-type": "text/plain" },
    });
    expect(file.sent?.status).toBe(200);
    expect(resumableUpload).toHaveBeenCalledWith(expect.objectContaining({ image: false, phase: "cancel" }));
  });

  it("refuses a non-image content-type on POST /api/attachments", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/attachments",
      headers: { "content-type": "application/pdf" },
    });
    expect(result.sent).toEqual({ status: 400, body: { error: "content-type must be an image type" } });
    expect(deps.saveImage).not.toHaveBeenCalled();
  });

  it("saves an image on the happy path", async () => {
    const saveImage = vi.fn(async () => ({ path: "/tmp/img.png", mime: "image/png", bytes: 3 }));
    const deps = baseDeps({ saveImage });
    const result = await call(deps, {
      method: "POST",
      path: "/api/attachments",
      headers: { "content-type": "image/png", "content-length": "3" },
      bodyChunks: [Buffer.from("png")],
    });
    expect(result.sent).toEqual({
      status: 201,
      body: { path: "/tmp/img.png", mime: "image/png", bytes: 3 },
    });
    expect(saveImage).toHaveBeenCalledOnce();
  });

  it("refuses POST /api/files without a name", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/files",
      headers: { "content-type": "text/plain" },
    });
    expect(result.sent).toEqual({ status: 400, body: { error: "name is required" } });
    expect(deps.saveSharedFile).not.toHaveBeenCalled();
  });

  it("saves a shared file on the happy path", async () => {
    const saveSharedFile = vi.fn(async () => ({
      path: "/tmp/notes.txt",
      mime: "text/plain",
      bytes: 5,
      name: "notes.txt",
    }));
    const deps = baseDeps({ saveSharedFile });
    const result = await call(deps, {
      method: "POST",
      path: "/api/files",
      query: "name=notes.txt",
      headers: { "content-type": "text/plain", "content-length": "5" },
      bodyChunks: [Buffer.from("hello")],
    });
    expect(result.sent?.status).toBe(201);
    expect(result.sent?.body).toMatchObject({ path: "/tmp/notes.txt", name: "notes.txt" });
    expect(saveSharedFile).toHaveBeenCalledOnce();
  });

  it("404s a missing archive manifest", async () => {
    const deps = baseDeps({ readManifest: () => null });
    const result = await call(deps, {
      method: "GET",
      path: "/api/attachments/11111111-1111-4111-8111-111111111111.zip/manifest",
    });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such archive" } });
  });

  it("404s a missing attachment file", async () => {
    const deps = baseDeps({ resolveServable: () => null });
    const result = await call(deps, {
      method: "GET",
      path: "/api/attachments/11111111-1111-4111-8111-111111111111.png",
    });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such attachment" } });
  });

  it("returns a manifest summary when present", async () => {
    const deps = baseDeps({
      readManifest: () => ({ status: "ok", entries: [] } as never),
      summarizeArchive: () => ({ status: "ok", files: 0 }),
    });
    const result = await call(deps, {
      method: "GET",
      path: "/api/attachments/11111111-1111-4111-8111-111111111111.zip/manifest",
    });
    expect(result.sent).toEqual({ status: 200, body: { status: "ok", files: 0 } });
    expect(result.headersOut["cache-control"]).toBe("private, no-store");
  });
});

describe("encryptionOwnerForUpload", () => {
  it("names the session person on an organization server only", () => {
    expect(encryptionOwnerForUpload({ kind: "session", session: { principalId: " pr_1 " } }, true)).toBe("pr_1");
    expect(encryptionOwnerForUpload({ kind: "session", session: { principalId: "pr_1" } }, false)).toBeNull();
    expect(encryptionOwnerForUpload({ kind: "loopback" }, true)).toBeNull();
  });
});
