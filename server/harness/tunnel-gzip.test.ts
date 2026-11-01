import { createServer, request, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { acceptsGzip, gzipTunnelReplies, sendTunnelJson, varyOnEncoding } from "./tunnel-gzip.ts";
import * as shared from "../../shared/tunnel-gzip.ts";

const big = JSON.stringify({ text: "x".repeat(4000) });
const small = JSON.stringify({ ok: true });
let server: Server | undefined;

async function get(wrap: boolean, body: string, headers: Record<string, string> = {}, method = "GET") {
  const handler = (_req: any, res: any) => {
    if (!sendTunnelJson(res, 200, { "content-type": "application/json" }, body)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    }
  };
  server = createServer(wrap ? gzipTunnelReplies(handler) : handler);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return new Promise<{ headers: any; body: Buffer }>((resolve, reject) => {
    const req = request({ port, host: "127.0.0.1", method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe("tunnel gzip (port of OpenMausBot #3009)", () => {
  it("gzips a large JSON reply on a tunnel listener when the client takes gzip", async () => {
    const res = await get(true, big, { "accept-encoding": "gzip" });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toBe("Accept-Encoding");
    expect(gunzipSync(res.body).toString()).toBe(big);
  });
  it("leaves small replies, refusing clients, HEAD and other listeners alone", async () => {
    expect((await get(true, small, { "accept-encoding": "gzip" })).headers["content-encoding"]).toBeUndefined();
    const plain = await get(true, big, { "accept-encoding": "gzip;q=0" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(big);
    expect((await get(false, big, { "accept-encoding": "gzip" })).headers["content-encoding"]).toBeUndefined();
    expect((await get(true, big, { "accept-encoding": "gzip" }, "HEAD")).headers["content-encoding"]).toBeUndefined();
  });
  it("parses Accept-Encoding and Vary", () => {
    expect(acceptsGzip("br, gzip;q=0.5")).toBe(true);
    expect(acceptsGzip("*;q=0")).toBe(false);
    expect(acceptsGzip("gzip;q=0, *")).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
    expect(varyOnEncoding("Origin")).toBe("Origin, Accept-Encoding");
    expect(varyOnEncoding("accept-encoding")).toBe("accept-encoding");
    expect(varyOnEncoding("*")).toBe("*");
  });
  it("re-exports the shared module from the harness; the companion keeps an equal copy", () => {
    expect(gzipTunnelReplies).toBe(shared.gzipTunnelReplies);
    expect(sendTunnelJson).toBe(shared.sendTunnelJson);
    const code = (text: string) => text.split("\n").filter((line) => !line.startsWith("//")).join("\n");
    const companion = readFileSync(new URL("../../companion/src/tunnel-gzip.ts", import.meta.url), "utf8");
    const sharedSource = readFileSync(new URL("../../shared/tunnel-gzip.ts", import.meta.url), "utf8");
    const harness = readFileSync(new URL("./tunnel-gzip.ts", import.meta.url), "utf8");
    // The companion builds alone (rootDir companion/src): it cannot import shared/.
    expect(companion).not.toContain("../../shared/");
    expect(code(companion)).toBe(code(sharedSource));
    expect(harness).toContain("../../shared/tunnel-gzip.ts");
  });
});
