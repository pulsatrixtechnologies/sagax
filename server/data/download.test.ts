// The guarded https download of a confined data_load: every hop checked
// against the private-address guard with an empty allow policy, redirects by
// hand and only to public https, a byte cap, a timeout, errors that name the
// host and never the path or query, and the socket pinned to the checked
// address.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaProxyResolver, ResolvedAddress } from "../media/media-proxy-guard.ts";
import { DATA_DOWNLOAD_MAX_REDIRECTS, downloadGuarded, pinnedLookup, type DownloadResponse, type DownloadTransport } from "./download.ts";
import { DataFailure } from "./types.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function target(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-data-download-"));
  dirs.push(dir);
  return join(dir, "nested", "file.csv");
}

/** A resolver from a fixed table; an unknown name does not resolve. */
function resolver(table: Record<string, string[]>): MediaProxyResolver {
  return async (hostname) => {
    const found = table[hostname];
    if (!found) throw new Error("ENOTFOUND");
    return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

function reply(status: number, headers: Record<string, string> = {}, body: string | Buffer[] = ""): DownloadResponse {
  const stream = Readable.from(typeof body === "string" ? [Buffer.from(body)] : body) as DownloadResponse;
  stream.statusCode = status;
  stream.headers = headers;
  return stream;
}

/** Answers by URL; records each request with the address it was pinned to. */
function transport(routes: Record<string, () => DownloadResponse>) {
  const calls: Array<{ url: string; address: ResolvedAddress }> = [];
  const open: DownloadTransport = async (url, address) => {
    calls.push({ url: url.href, address });
    const route = routes[url.href];
    if (!route) throw new Error(`unexpected request to ${url.href}`);
    return route();
  };
  return { open, calls };
}

async function failure(promise: Promise<unknown>): Promise<DataFailure> {
  try { await promise; } catch (error) { if (error instanceof DataFailure) return error; throw error; }
  throw new Error("expected a DataFailure");
}

const PUBLIC = resolver({ "data.example.com": ["93.184.216.34"], "cdn.example.net": ["2606:2800:220:1:248:1893:25c8:1946"] });

describe("downloadGuarded", () => {
  it("downloads a public https file to the destination, connected to the checked address", async () => {
    const file = target();
    const { open, calls } = transport({ "https://data.example.com/a.csv?token=secret": () => reply(200, { "content-length": "8" }, "x\n1\n2\n3\n") });
    const result = await downloadGuarded("https://data.example.com/a.csv?token=secret", file, { resolver: PUBLIC, transport: open });
    expect(result).toEqual({ bytes: 8 });
    expect(readFileSync(file, "utf8")).toBe("x\n1\n2\n3\n");
    expect(calls).toEqual([{ url: "https://data.example.com/a.csv?token=secret", address: { address: "93.184.216.34", family: 4 } }]);
  });

  it("refuses private, loopback, link-local and cloud metadata literals before any request", async () => {
    const { open, calls } = transport({});
    for (const url of [
      "https://127.0.0.1/a.csv",
      "https://10.1.2.3/a.csv",
      "https://192.168.1.10/a.csv",
      "https://169.254.169.254/latest/meta-data/",
      "https://168.63.129.16/machine",
      "https://[::1]/a.csv",
      "https://[fd00:ec2::254]/a.csv",
      "https://100.100.100.100/a.csv",
      "https://localhost/a.csv",
    ]) {
      const refused = await failure(downloadGuarded(url, target(), { resolver: PUBLIC, transport: open }));
      expect(refused.error.code).toBe("source_unsupported");
      expect(refused.error.hint).toMatch(/public https/);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a name that resolves to a private or metadata address, even beside a public one", async () => {
    const { open, calls } = transport({});
    const dns = resolver({ "inside.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.216.34", "169.254.169.254"], "cluster.example.com": ["172.20.0.1"] });
    for (const host of ["inside.example.com", "mixed.example.com", "cluster.example.com"]) {
      const refused = await failure(downloadGuarded(`https://${host}/a.csv`, target(), { resolver: dns, transport: open }));
      expect(refused.error.code).toBe("source_unsupported");
      expect(refused.error.message).toContain(host);
    }
    const metadata = await failure(downloadGuarded("https://mixed.example.com/a.csv", target(), { resolver: dns, transport: open }));
    expect(metadata.error.message).toContain("metadata");
    expect(calls).toEqual([]);
  });

  it("ignores the media proxy's operator allowlist", async () => {
    vi.stubEnv("SAGAX_MEDIA_PROXY_ALLOW_HOSTS", "127.0.0.1,10.0.0.0/8,inside.example.com");
    const { open, calls } = transport({});
    const dns = resolver({ "inside.example.com": ["10.0.0.5"] });
    expect((await failure(downloadGuarded("https://127.0.0.1/a.csv", target(), { resolver: dns, transport: open }))).error.code).toBe("source_unsupported");
    expect((await failure(downloadGuarded("https://inside.example.com/a.csv", target(), { resolver: dns, transport: open }))).error.code).toBe("source_unsupported");
    expect(calls).toEqual([]);
  });

  it("refuses http, other schemes and other ports", async () => {
    const { open, calls } = transport({});
    for (const url of ["http://data.example.com/a.csv", "ftp://data.example.com/a.csv", "file:///etc/passwd", "https://data.example.com:8443/a.csv", "not a url"]) {
      expect((await failure(downloadGuarded(url, target(), { resolver: PUBLIC, transport: open }))).error.code).toBe("source_unsupported");
    }
    expect(calls).toEqual([]);
  });

  it("follows a redirect to another public https host, checking it again", async () => {
    const file = target();
    const { open, calls } = transport({
      "https://data.example.com/a.csv": () => reply(302, { location: "https://cdn.example.net/blob/a.csv" }),
      "https://cdn.example.net/blob/a.csv": () => reply(200, {}, "ok"),
    });
    await downloadGuarded("https://data.example.com/a.csv", file, { resolver: PUBLIC, transport: open });
    expect(readFileSync(file, "utf8")).toBe("ok");
    expect(calls.map((call) => call.address.address)).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  });

  it("refuses a redirect to http", async () => {
    const file = target();
    const { open, calls } = transport({ "https://data.example.com/a.csv": () => reply(301, { location: "http://data.example.com/a.csv" }) });
    const refused = await failure(downloadGuarded("https://data.example.com/a.csv", file, { resolver: PUBLIC, transport: open }));
    expect(refused.error).toMatchObject({ code: "source_unsupported" });
    expect(refused.error.message).toMatch(/Only https/);
    expect(calls).toHaveLength(1);
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a redirect to a private or metadata address", async () => {
    for (const location of ["https://169.254.169.254/latest/meta-data/iam", "https://10.0.0.5/x.csv", "https://localhost/x.csv", "https://[::1]/x"]) {
      const { open, calls } = transport({ "https://data.example.com/a.csv": () => reply(307, { location }) });
      const refused = await failure(downloadGuarded("https://data.example.com/a.csv", target(), { resolver: PUBLIC, transport: open }));
      expect(refused.error.code).toBe("source_unsupported");
      expect(calls).toHaveLength(1);
    }
  });

  it("stops after five redirects", async () => {
    const routes: Record<string, () => DownloadResponse> = {};
    for (let i = 0; i <= DATA_DOWNLOAD_MAX_REDIRECTS + 1; i++) routes[`https://data.example.com/${i}`] = () => reply(302, { location: `/${i + 1}` });
    const { open, calls } = transport(routes);
    const refused = await failure(downloadGuarded("https://data.example.com/0", target(), { resolver: PUBLIC, transport: open }));
    expect(refused.error.message).toMatch(/redirected more than 5 times/);
    expect(calls).toHaveLength(DATA_DOWNLOAD_MAX_REDIRECTS + 1);
  });

  it("refuses a body over the cap, declared or streamed, and leaves no file", async () => {
    const declared = target();
    const big = transport({ "https://data.example.com/a.csv": () => reply(200, { "content-length": String(11) }, "01234567890") });
    expect((await failure(downloadGuarded("https://data.example.com/a.csv", declared, { resolver: PUBLIC, transport: big.open, maxBytes: 10 }))).error.message).toMatch(/larger than/);
    expect(existsSync(declared)).toBe(false);
    const streamed = target();
    const chunks = transport({ "https://data.example.com/a.csv": () => reply(200, {}, [Buffer.alloc(6), Buffer.alloc(6)]) });
    expect((await failure(downloadGuarded("https://data.example.com/a.csv", streamed, { resolver: PUBLIC, transport: chunks.open, maxBytes: 10 }))).error.message).toMatch(/larger than/);
    expect(existsSync(streamed)).toBe(false);
  });

  it("times out a slow answer", async () => {
    const slow: DownloadTransport = (_url, _address, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const refused = await failure(downloadGuarded("https://data.example.com/a.csv", target(), { resolver: PUBLIC, transport: slow, timeoutMs: 50 }));
    expect(refused.error).toMatchObject({ code: "timeout", retryable: true });
  });

  it("says not found for a 404, and never echoes the path, query or a token", async () => {
    const { open } = transport({
      "https://data.example.com/hidden/a.csv?token=s3cr3t": () => reply(404),
      "https://data.example.com/b.csv?sig=s3cr3t": () => reply(500),
    });
    const missing = await failure(downloadGuarded("https://data.example.com/hidden/a.csv?token=s3cr3t", target(), { resolver: PUBLIC, transport: open }));
    expect(missing.error.code).toBe("source_not_found");
    const broken = await failure(downloadGuarded("https://data.example.com/b.csv?sig=s3cr3t", target(), { resolver: PUBLIC, transport: open }));
    expect(broken.error).toMatchObject({ code: "source_unsupported", retryable: true });
    const failing: DownloadTransport = async () => { throw Object.assign(new Error("connect ECONNREFUSED https://data.example.com/c.csv?token=s3cr3t"), { code: "ECONNREFUSED" }); };
    const refused = await failure(downloadGuarded("https://data.example.com/c.csv?token=s3cr3t", target(), { resolver: PUBLIC, transport: failing }));
    expect(refused.error.message).toBe("The download from data.example.com failed (ECONNREFUSED).");
    for (const error of [missing, broken, refused]) {
      expect(JSON.stringify(error.error)).not.toMatch(/s3cr3t|hidden|\.csv/);
    }
  });

  it("pins the socket's DNS answer to the checked address", () => {
    const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 });
    const single = vi.fn();
    lookup("rebind.example.com", { family: 0 }, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("rebind.example.com", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });
});
