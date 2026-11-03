// A personal computer's owner as their organization knows them: the private
// message the signed-in desktop sends, what the server keeps, and the avatar
// route it answers (server/people/owner-identity.ts).
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOwnerAvatarRoute, OWNER_IDENTITY_MESSAGE, OwnerIdentityStore, parseOwnerIdentityMessage } from "./owner-identity.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("owner png")]);
const JPEG = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from("owner jpeg")]);
const wire = (overrides: Record<string, unknown> = {}) => ({
  type: OWNER_IDENTITY_MESSAGE,
  identity: {
    origin: "https://sagax.example.test", principalId: "pr_0b1c", name: "Alex Martin", email: "owner@example.test",
    avatar: { version: "0123456789abcdef", data: PNG.toString("base64") },
    ...overrides,
  },
});

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "owner-identity-")); });
afterEach(async () => { await removeTempDir(dir); });

describe("the desktop's private message", () => {
  it("reads an identity with its avatar, and a sign-out", () => {
    const parsed = parseOwnerIdentityMessage(wire());
    expect(parsed?.identity).toMatchObject({ origin: "https://sagax.example.test", principalId: "pr_0b1c", name: "Alex Martin", email: "owner@example.test" });
    expect(parsed?.identity?.avatar).toEqual({ version: "0123456789abcdef", contentType: "image/png", bytes: PNG });
    expect(parseOwnerIdentityMessage(wire({ avatar: { version: "v2", data: JPEG.toString("base64") } }))?.identity?.avatar?.contentType).toBe("image/jpeg");
    expect(parseOwnerIdentityMessage(wire({ avatar: undefined }))?.identity?.avatar).toBeUndefined();
    expect(parseOwnerIdentityMessage({ type: OWNER_IDENTITY_MESSAGE, identity: null })).toEqual({ identity: null });
  });

  it("leaves other messages alone", () => {
    expect(parseOwnerIdentityMessage({ type: "openmausbot:managed-composio" })).toBeUndefined();
    expect(parseOwnerIdentityMessage(null)).toBeUndefined();
    expect(parseOwnerIdentityMessage("openmausbot:owner-identity")).toBeUndefined();
  });

  it("refuses a malformed identity rather than keeping part of it", () => {
    for (const bad of [
      wire({ origin: "https://sagax.example.test/path" }),
      wire({ origin: "file:///etc" }),
      wire({ principalId: "../x" }),
      wire({ avatar: { version: "a.b", data: PNG.toString("base64") } }),
      wire({ avatar: { version: "v", data: Buffer.from("<svg/>").toString("base64") } }),
      wire({ avatar: { version: "v", data: Buffer.alloc(300 * 1024, 0x89).toString("base64") } }),
      { type: OWNER_IDENTITY_MESSAGE, identity: "owner" },
    ]) expect(() => parseOwnerIdentityMessage(bad)).toThrow();
    // a bad address is dropped, not fatal
    expect(parseOwnerIdentityMessage(wire({ email: "not an address" }))?.identity?.email).toBeUndefined();
  });
});

describe("what the personal server keeps", () => {
  it("keeps the identity across a restart, privately, and forgets it at sign-out", () => {
    const file = join(dir, "owner-identity.json");
    const store = new OwnerIdentityStore(file);
    expect(store.get()).toBeNull();
    expect(store.sessionFields("pr_local")).toEqual({});
    store.set(parseOwnerIdentityMessage(wire())!.identity);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new OwnerIdentityStore(file);
    expect(again.get()?.avatar?.bytes.equals(PNG)).toBe(true);
    expect(again.sessionFields("pr_local")).toEqual({
      name: "Alex Martin", email: "owner@example.test", avatarUrl: "/api/people/pr_local/avatar?v=0123456789abcdef",
    });
    again.set(null);
    expect(new OwnerIdentityStore(file).get()).toBeNull();
    expect(readFileSync.bind(null, file)).toThrow();
  });

  it("names no avatar when the organization has none, and reads a damaged file as signed out", () => {
    const file = join(dir, "owner-identity.json");
    const store = new OwnerIdentityStore(file);
    store.set(parseOwnerIdentityMessage(wire({ avatar: undefined }))!.identity);
    expect(store.sessionFields("pr_local")).toEqual({ name: "Alex Martin", email: "owner@example.test" });
    writeFileSync(file, "{not json");
    expect(new OwnerIdentityStore(file).get()).toBeNull();
  });
});

describe("GET /api/people/:id/avatar on a personal server", () => {
  const call = async (store: OwnerIdentityStore, path: string, method = "GET") => {
    const route = createOwnerAvatarRoute({ store, localPrincipalId: () => "pr_local" });
    const out: { status?: number; body?: unknown; headers?: Record<string, string>; bytes?: Buffer } = {};
    const url = new URL(`http://localhost${path}`);
    const ctx = {
      req: { headers: {} },
      res: {
        writeHead: (status: number, headers: Record<string, string>) => { out.status = status; out.headers = headers; },
        end: (bytes: Buffer) => { out.bytes = bytes; },
      },
      url, path: url.pathname, method, auth: { kind: "loopback", scopes: ["admin", "client"] },
      json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; },
    } as unknown as RouteContext;
    return { ...out, passed: (await route(ctx)) === PASS, ...out };
  };

  it("serves the owner's avatar, cacheable only at its current version", async () => {
    const store = new OwnerIdentityStore(join(dir, "owner-identity.json"));
    store.set(parseOwnerIdentityMessage(wire())!.identity);
    const current = await call(store, "/api/people/pr_local/avatar?v=0123456789abcdef");
    expect(current.status).toBe(200);
    expect(current.headers).toMatchObject({ "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" });
    expect(current.bytes?.equals(PNG)).toBe(true);
    expect((await call(store, "/api/people/pr_local/avatar?v=old")).headers?.["cache-control"]).toBe("no-store");
  });

  it("answers 404 for anyone else or without an avatar, and leaves other routes alone", async () => {
    const store = new OwnerIdentityStore(join(dir, "owner-identity.json"));
    expect((await call(store, "/api/people/pr_local/avatar?v=x")).status).toBe(404);
    store.set(parseOwnerIdentityMessage(wire())!.identity);
    expect((await call(store, "/api/people/pr_other/avatar?v=0123456789abcdef")).status).toBe(404);
    expect((await call(store, "/api/people/pr_local/avatar", "POST")).passed).toBe(true);
    expect((await call(store, "/api/people/pr_local")).passed).toBe(true);
  });
});
