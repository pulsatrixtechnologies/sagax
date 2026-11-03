// PUT/DELETE /api/me/avatar (server/routes/me-avatar.ts) with a mocked
// Perspicax: type and size refusals before anything is sent, the 256 px
// square made here, the person's own token forwarded, the cache and the
// directory refreshed on success, and a solo server left alone.
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { AvatarImage, OwnAvatarWrite } from "../perspicax/perspicax-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { AVATAR_SIDE, createMeAvatarRoutes, imageSize, ME_AVATAR_UPLOAD_MAX_BYTES, normalizeOwnAvatar, type MeAvatarRouteDeps } from "./me-avatar.ts";
import { dispatchRoutes } from "./table.ts";

const ALICE = "pr_00000001-0000-4000-8000-000000000000";
const SIGN_IN = `pxlo1.alice.${"s".repeat(40)}`;

const { Resvg } = createRequire(import.meta.url)("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
/** A real PNG of `width` x `height` (two colours, so a crop is visible). */
function png(width: number, height: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width / 2}" height="${height}" fill="red"/><rect x="${width / 2}" width="${width / 2}" height="${height}" fill="blue"/></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}
/** A minimal JPEG header declaring `width` x `height` (SOF0). */
function jpegHeader(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

describe("own avatar images", () => {
  it("reads the size a PNG or a JPEG declares", () => {
    expect(imageSize(png(300, 150))).toEqual({ width: 300, height: 150 });
    expect(imageSize(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(Buffer.from("GIF89a"))).toBeNull();
  });

  it("keeps a 256 px square under the limit as it is, and crops anything else", () => {
    const square = png(AVATAR_SIDE, AVATAR_SIDE);
    const kept = normalizeOwnAvatar(square);
    expect(kept).toMatchObject({ ok: true, resized: false });
    expect(kept.ok && kept.image.bytes.equals(square)).toBe(true);
    const wide = normalizeOwnAvatar(png(600, 300));
    expect(wide).toMatchObject({ ok: true, resized: true, image: { contentType: "image/png" } });
    expect(wide.ok && imageSize(wide.image.bytes)).toEqual({ width: AVATAR_SIDE, height: AVATAR_SIDE });
  });

  it("refuses what is not a PNG or a JPEG, and an image it cannot read", () => {
    expect(normalizeOwnAvatar(Buffer.from("GIF89a....."))).toEqual({ ok: false, code: "avatar_type" });
    expect(normalizeOwnAvatar(Buffer.from("<svg/>"))).toEqual({ ok: false, code: "avatar_type" });
    expect(normalizeOwnAvatar(Buffer.from("89504e470d0a1a0a", "hex"))).toEqual({ ok: false, code: "avatar_unreadable" });
    expect(normalizeOwnAvatar(png(300, 150), () => { throw new Error("decode"); })).toEqual({ ok: false, code: "avatar_unreadable" });
  });
});

describe("PUT and DELETE /api/me/avatar", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  });

  async function serve(patch: Partial<MeAvatarRouteDeps> = {}, opts: { organization?: boolean; answer?: OwnAvatarWrite } = {}) {
    const writes: Array<{ token: string; image: AvatarImage | null }> = [];
    const applied: Array<{ principalId: string; sub: string; avatar: string | null }> = [];
    const routes = [createMeAvatarRoutes({
      organization: () => opts.organization ?? true,
      person: (auth) => (auth.kind === "session" && auth.session.principalId === ALICE ? { principalId: ALICE, sub: "alice" } : null),
      subjectToken: async (principalId) => (principalId === ALICE ? { ok: true, token: SIGN_IN } : { ok: false, error: "no_session" }),
      write: async (token, image) => {
        writes.push({ token, image });
        return opts.answer ?? { ok: true, avatar: image ? "0123456789abcdef" : null };
      },
      applied: (change) => {
        applied.push(change);
        return change.avatar ? `/api/people/${change.principalId}/avatar?v=${change.avatar}` : null;
      },
      log: () => {},
      ...patch,
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const who = req.headers["x-who"] as string | undefined;
      const auth = (who ? { kind: "session", scopes: ["client"], session: { principalId: who } } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
      const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody });
      if (!handled) json(res, 404, { from: "inline" });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, body?: Buffer, who: string | null = ALICE, type = "image/png") => {
      const res = await fetch(`${base}/api/me/avatar`, {
        method,
        headers: { ...(who ? { "x-who": who } : {}), ...(body ? { "content-type": type } : {}) },
        ...(body ? { body: new Uint8Array(body) } : {}),
      });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    };
    return { call, writes, applied };
  }

  it("sends a 256 px square as is, with the person's own sign-in token, then refreshes", async () => {
    const { call, writes, applied } = await serve();
    const square = png(AVATAR_SIDE, AVATAR_SIDE);
    const answer = await call("PUT", square);
    expect(answer).toEqual({ status: 200, body: { ok: true, avatarUrl: `/api/people/${ALICE}/avatar?v=0123456789abcdef` } });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.token).toBe(SIGN_IN);
    expect(writes[0]!.image?.contentType).toBe("image/png");
    expect(writes[0]!.image?.bytes.equals(square)).toBe(true);
    // the cache, the principal, the directory and the streams follow
    expect(applied).toEqual([{ principalId: ALICE, sub: "alice", avatar: "0123456789abcdef" }]);
  });

  it("crops and scales a photo that is not a 256 px square before sending it", async () => {
    const { call, writes } = await serve();
    expect((await call("PUT", png(800, 400))).status).toBe(200);
    expect(imageSize(writes[0]!.image!.bytes)).toEqual({ width: AVATAR_SIDE, height: AVATAR_SIDE });
  });

  it("refuses a wrong type or a too large body before anything reaches Perspicax", async () => {
    const { call, writes, applied } = await serve();
    expect(await call("PUT", Buffer.from("GIF89a not a png"), ALICE, "image/gif")).toMatchObject({ status: 415, body: { code: "avatar_type" } });
    expect(await call("PUT", Buffer.from("<svg onload=alert(1)/>"), ALICE, "image/svg+xml")).toMatchObject({ status: 415, body: { code: "avatar_type" } });
    const huge = Buffer.alloc(ME_AVATAR_UPLOAD_MAX_BYTES + 1, 0);
    png(4, 4).copy(huge);
    expect(await call("PUT", huge)).toMatchObject({ status: 413, body: { code: "avatar_too_large" } });
    expect(await call("PUT", Buffer.from("89504e470d0a1a0a", "hex"))).toMatchObject({ status: 400, body: { code: "avatar_unreadable" } });
    expect(writes).toEqual([]);
    expect(applied).toEqual([]);
  });

  it("removes the photo with DELETE", async () => {
    const { call, writes, applied } = await serve();
    expect(await call("DELETE")).toEqual({ status: 200, body: { ok: true, avatarUrl: null } });
    expect(writes).toEqual([{ token: SIGN_IN, image: null }]);
    expect(applied).toEqual([{ principalId: ALICE, sub: "alice", avatar: null }]);
  });

  it("answers only for the session's own person, never the server console or someone else", async () => {
    const { call, writes } = await serve();
    expect(await call("PUT", png(256, 256), null)).toMatchObject({ status: 403, body: { code: "avatar_session_only" } });
    expect(await call("DELETE", undefined, "pr_00000002-0000-4000-8000-000000000000")).toMatchObject({ status: 403, body: { code: "avatar_session_only" } });
    expect(writes).toEqual([]);
  });

  it("asks to sign in again without a live sign-in token, and maps Perspicax's refusals", async () => {
    const noToken = await serve({ subjectToken: async () => ({ ok: false, error: "no_session" }) });
    expect(await noToken.call("PUT", png(256, 256))).toMatchObject({ status: 409, body: { code: "avatar_sign_in_again" } });
    expect(noToken.writes).toEqual([]);
    const cases: Array<[OwnAvatarWrite, number, string]> = [
      [{ ok: false, error: "subject", status: 403 }, 409, "avatar_sign_in_again"],
      [{ ok: false, error: "unsupported", status: 405 }, 501, "avatar_perspicax_outdated"],
      [{ ok: false, error: "rejected", status: 400 }, 400, "avatar_rejected"],
      [{ ok: false, error: "link", status: 401 }, 502, "avatar_unreachable"],
      [{ ok: false, error: "unreachable" }, 502, "avatar_unreachable"],
    ];
    for (const [answer, status, code] of cases) {
      const { call, applied } = await serve({}, { answer });
      expect(await call("PUT", png(256, 256)), code).toMatchObject({ status, body: { code } });
      // nothing changes on this server when Perspicax refused
      expect(applied).toEqual([]);
    }
  });

  it("leaves a solo server's requests to the rest of the server", async () => {
    const { call, writes } = await serve({}, { organization: false });
    expect(await call("PUT", png(256, 256))).toEqual({ status: 404, body: { from: "inline" } });
    expect(await call("DELETE")).toEqual({ status: 404, body: { from: "inline" } });
    expect(writes).toEqual([]);
  });
});
