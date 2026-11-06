// The bot panel's Computer row thumbnail through the route table: each
// computer answers its own newest capture, switching computers answers
// another picture, a person's own desktop capture stays theirs, and the
// bot's own captures reach only who may see them.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope } from "../auth/request-auth.ts";
import { ComputerThumbnails, THUMBNAIL_WIDTH, decodeImageDataUrl, thumbnailComputerForResource } from "../computer/computer-thumbnails.ts";
import { createComputerThumbnailRoutes } from "./computer-thumbnail.ts";
import { dispatchRoutes } from "./table.ts";

/** A PNG header the size checks read (the scaler is replaced in tests). */
function png(width: number, height: number, tag = 0): Buffer {
  const bytes = Buffer.alloc(40);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(tag, 32);
  return bytes;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

let clock = 1_800_000_000_000;
function thumbnails(): ComputerThumbnails {
  return new ComputerThumbnails({
    now: () => (clock += 1_000),
    render: async (_bytes, _mime, size) => Buffer.from(`scaled:${size.width}x${size.height}`),
  });
}

async function serve(store: ComputerThumbnails, organization = false): Promise<string> {
  const routes = [createComputerThumbnailRoutes<{ id: string; owner: string }>({
    thumbnails: store,
    bot: (id) => (id === "pepper" ? { id, owner: "alice" } : undefined),
    viewerId: (auth) => (auth.kind === "session" ? auth.session.principalId ?? "" : ""),
    mayViewShared: (auth, bot) => !organization || auth.kind !== "session" || auth.session.principalId === bot.owner,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const who = req.headers["x-viewer"];
    const auth = typeof who === "string"
      ? { kind: "session", scopes: ["client"], session: { id: who, principalId: who } }
      : { kind: "loopback", scopes: ["admin"] };
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: auth as never, json, readBody });
    if (!handled) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const picture = async (base: string, query: string, viewer?: string) => {
  const res = await fetch(`${base}/api/bots/pepper/computer/thumbnail?${query}`, { headers: viewer ? { "x-viewer": viewer } : {} });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
};
const meta = async (base: string, computer: string, viewer?: string) => {
  const res = await fetch(`${base}/api/bots/pepper/computer/thumbnail?computer=${computer}&format=json`, { headers: viewer ? { "x-viewer": viewer } : {} });
  return await res.json() as { computer: string; at: number | null; mime: string | null };
};
const put = (base: string, computer: string, image: unknown, viewer?: string) => fetch(`${base}/api/bots/pepper/computer/thumbnail?computer=${computer}`, {
  method: "PUT",
  headers: { "content-type": "application/json", ...(viewer ? { "x-viewer": viewer } : {}) },
  body: JSON.stringify({ image }),
});

describe("computer thumbnail store", () => {
  it("maps the bot's computer resource to the computer the row shows", () => {
    expect(thumbnailComputerForResource("computer:host")).toBe("local");
    expect(thumbnailComputerForResource("computer:vm:abc")).toBe("vm");
    expect(thumbnailComputerForResource("computer:box:abc")).toBe("cloud");
    expect(thumbnailComputerForResource("computer:box-bot:pepper")).toBe("cloud");
    expect(thumbnailComputerForResource("computer:vps:x")).toBe("cloud");
    expect(thumbnailComputerForResource(undefined)).toBeNull();
  });

  it("scales a capture to the thumbnail width and keeps the frame for the larger view", async () => {
    const store = thumbnails();
    const saved = await store.record("pepper", "vm", { bytes: png(1280, 800), mime: "image/png" });
    expect(saved!.thumb.toString()).toBe(`scaled:${THUMBNAIL_WIDTH}x100`);
    expect(saved!.full.length).toBe(40);
    // A small picture is kept as is.
    const small = await store.record("pepper", "cloud", { bytes: png(120, 80), mime: "image/png" });
    expect(small!.thumb.equals(small!.full)).toBe(true);
  });

  it("never lets an older frame replace a newer one", async () => {
    const store = thumbnails();
    await store.record("pepper", "vm", { bytes: png(100, 100, 2), mime: "image/png" }, "", 2_000);
    await store.record("pepper", "vm", { bytes: png(100, 100, 1), mime: "image/png" }, "", 1_000);
    expect(store.get("pepper", "vm")!.at).toBe(2_000);
  });

  it("reads only image data URLs", () => {
    expect(decodeImageDataUrl(`data:image/png;base64,${png(10, 10).toString("base64")}`)?.mime).toBe("image/png");
    expect(decodeImageDataUrl("data:text/html;base64,PGI+")).toBeNull();
    expect(decodeImageDataUrl(`data:image/png;base64,${Buffer.from("not a png").toString("base64")}`)).toBeNull();
    expect(decodeImageDataUrl(42)).toBeNull();
  });
});

describe("computer thumbnail API", () => {
  it("is open to a client session to read and to send its own capture", () => {
    expect(requiredScope("GET", "/api/bots/pepper/computer/thumbnail")).toBe("client");
    expect(requiredScope("PUT", "/api/bots/pepper/computer/thumbnail")).toBe("client");
    expect(requiredScope("DELETE", "/api/bots/pepper/computer/thumbnail")).not.toBe("client");
  });

  it("answers the selected computer's own capture, and switching computers answers another picture", async () => {
    const store = thumbnails();
    await store.record("pepper", "vm", { bytes: png(100, 60, 1), mime: "image/png" });
    await store.record("pepper", "cloud", { bytes: png(100, 60, 2), mime: "image/png" });
    await store.record("pepper", "local", { bytes: png(100, 60, 3), mime: "image/png" });
    const base = await serve(store);

    const vm = await picture(base, "computer=vm");
    expect(vm.status).toBe(200);
    expect(vm.headers.get("content-type")).toBe("image/png");
    expect(vm.headers.get("cache-control")).toBe("private, no-store");
    expect(vm.headers.get("x-thumbnail-computer")).toBe("vm");
    expect(vm.bytes.readUInt32BE(32)).toBe(1);

    const cloud = await picture(base, "computer=cloud");
    expect(cloud.headers.get("x-thumbnail-computer")).toBe("cloud");
    expect(cloud.bytes.readUInt32BE(32)).toBe(2);
    expect(cloud.bytes.equals(vm.bytes)).toBe(false);
    expect(Number(cloud.headers.get("x-captured-at"))).toBeGreaterThan(Number(vm.headers.get("x-captured-at")));

    const local = await picture(base, "computer=local");
    expect(local.bytes.readUInt32BE(32)).toBe(3);
    // Auto: the newest capture of any computer.
    expect((await picture(base, "computer=auto")).headers.get("x-thumbnail-computer")).toBe("local");
    expect((await meta(base, "vm")).at).toBe(Number(vm.headers.get("x-captured-at")));
  });

  it("serves the scaled thumbnail by default and the frame as taken for the larger view", async () => {
    const store = thumbnails();
    await store.record("pepper", "vm", { bytes: png(1280, 800), mime: "image/png" });
    const base = await serve(store);
    expect((await picture(base, "computer=vm")).bytes.toString()).toBe(`scaled:${THUMBNAIL_WIDTH}x100`);
    expect((await picture(base, "computer=vm&size=full")).bytes.length).toBe(40);
  });

  it("says when a computer has no capture yet, and refuses an unknown computer", async () => {
    const base = await serve(thumbnails());
    const none = await picture(base, "computer=vm");
    expect(none.status).toBe(404);
    expect(JSON.parse(none.bytes.toString())).toMatchObject({ code: "no_thumbnail" });
    expect(await meta(base, "vm")).toEqual({ computer: "vm", at: null, mime: null });
    expect((await picture(base, "computer=../etc")).status).toBe(400);
    expect((await fetch(`${base}/api/bots/nobody/computer/thumbnail`)).status).toBe(404);
  });

  it("keeps a person's own desktop capture for them only", async () => {
    const store = thumbnails();
    const base = await serve(store, true);
    const image = `data:image/png;base64,${png(100, 60, 7).toString("base64")}`;
    const sent = await put(base, "local:desk-1", image, "bob");
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ computer: "local:desk-1", mime: "image/png" });
    expect((await picture(base, "computer=local:desk-1", "bob")).bytes.readUInt32BE(32)).toBe(7);
    expect((await picture(base, "computer=local:desk-1", "alice")).status).toBe(404);
  });

  it("shows the bot's own captures on an organization server only to who may see them", async () => {
    const store = thumbnails();
    await store.record("pepper", "vm", { bytes: png(100, 60, 1), mime: "image/png" });
    const base = await serve(store, true);
    expect((await picture(base, "computer=vm", "alice")).status).toBe(200);
    expect((await picture(base, "computer=vm", "bob")).status).toBe(404);
  });

  it("takes a capture only of the person's own computer, as an image, under the size limit", async () => {
    const base = await serve(thumbnails());
    const image = `data:image/png;base64,${png(100, 60).toString("base64")}`;
    expect((await put(base, "vm", image)).status).toBe(400);
    expect((await put(base, "local", "data:text/plain;base64,aGk=")).status).toBe(400);
    expect((await put(base, "local", `data:image/png;base64,${Buffer.concat([png(100, 60), Buffer.alloc(2_100_000, 1)]).toString("base64")}`)).status).toBe(413);
    expect((await put(base, "local", image)).status).toBe(200);
  });
});
