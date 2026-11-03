import { describe, expect, it } from "vitest";

import { createRegistrySearch, featuredMatching, listingInRegion, REGISTRY_CACHE_MS, registryListing, registryRegions } from "./plugin-registry.ts";

const row = (name: string, remotes: unknown[], meta: Record<string, unknown> = { isLatest: true, status: "active" }, extra: Record<string, unknown> = {}) => ({
  server: { name, description: `${name} server`, version: "1.0.0", remotes, ...extra },
  _meta: { "io.modelcontextprotocol.registry/official": meta },
});

describe("registry listings", () => {
  it("keeps the latest https remote a person can add, with its domain", () => {
    expect(registryListing(row("io.example/notes", [{ type: "streamable-http", url: "https://mcp.example.test/mcp" }], undefined, {
      title: "Notes", icons: [{ src: "https://cdn.example.test/notes.png" }, { src: "http://insecure.test/x.png" }], websiteUrl: "https://example.test",
    }))).toEqual({
      id: "registry:io.example/notes", name: "Notes", description: "io.example/notes server", url: "https://mcp.example.test/mcp", transport: "http",
      domain: "mcp.example.test", auth: "unknown", source: "registry", reviewed: false, iconUrl: "https://cdn.example.test/notes.png", docsUrl: "https://example.test",
    });
    expect(registryListing(row("io.example/sse", [{ type: "sse", url: "https://sse.example.test/sse", headers: [{ name: "Authorization", isRequired: true }] }])))
      .toMatchObject({ transport: "sse", auth: "headers", name: "sse" });
  });

  it("drops stdio-only, old, inactive, templated and plain-http entries", () => {
    expect(registryListing(row("a/stdio", []))).toBeNull();
    expect(registryListing(row("a/old", [{ type: "streamable-http", url: "https://x.test/mcp" }], { isLatest: false }))).toBeNull();
    expect(registryListing(row("a/gone", [{ type: "streamable-http", url: "https://x.test/mcp" }], { isLatest: true, status: "deleted" }))).toBeNull();
    expect(registryListing(row("a/tpl", [{ type: "streamable-http", url: "https://{tenant}.x.test/mcp" }]))).toBeNull();
    expect(registryListing(row("a/http", [{ type: "streamable-http", url: "http://x.test/mcp" }]))).toBeNull();
    expect(registryListing(null)).toBeNull();
  });

  it("offers one data center per choice of a remote's one variable, and connects to the chosen one", () => {
    const listing = registryListing(row("io.example/crm", [{
      type: "streamable-http", url: "https://{region}.mcp.example.test/mcp",
      variables: { region: { description: "Data center", choices: ["us", "eu"], default: "eu" } },
    }]));
    expect(listing).toMatchObject({ url: "https://eu.mcp.example.test/mcp", domain: "eu.mcp.example.test" });
    expect(listing?.regions).toEqual([
      { id: "us", label: "US", url: "https://us.mcp.example.test/mcp" },
      { id: "eu", label: "EU", url: "https://eu.mcp.example.test/mcp" },
    ]);
    expect(listingInRegion(listing!, "us")).toMatchObject({ url: "https://us.mcp.example.test/mcp", domain: "us.mcp.example.test" });
    expect(listingInRegion(listing!, undefined)).toBe(listing);
    expect(listingInRegion(listing!, "apac")).toBeNull();
    // free text, two variables, or a single choice: not a region list
    expect(registryRegions("https://{tenant}.x.test/mcp", { tenant: { description: "yours" } })).toBeNull();
    expect(registryRegions("https://{a}.{b}.x.test/mcp", { a: { choices: ["1", "2"] }, b: { choices: ["1", "2"] } })).toBeNull();
    expect(registryRegions("https://{r}.x.test/mcp", { r: { choices: ["us"] } })).toBeNull();
    expect(registryRegions("https://{r}.x.test/mcp", { r: { choices: ["us/../x", "eu"] } })).toBeNull();
  });

  it("matches the featured list by words", () => {
    expect(featuredMatching("notion").map((listing) => listing.id)).toEqual(["notion"]);
    expect(featuredMatching("issues jira").map((listing) => listing.id)).toEqual(["atlassian"]);
    expect(featuredMatching("zzzz-nothing")).toEqual([]);
  });
});

describe("registry search", () => {
  it("dedupes, caps, pages and caches for ten minutes", async () => {
    let now = 0;
    const asked: string[] = [];
    const search = createRegistrySearch({
      now: () => now,
      fetch: (async (input: URL) => {
        asked.push(String(input));
        const rows = [
          row("a/one", [{ type: "streamable-http", url: "https://one.test/mcp" }]),
          row("a/one", [{ type: "streamable-http", url: "https://one.test/mcp" }]),
          ...Array.from({ length: 40 }, (_, index) => row(`b/${index}`, [{ type: "sse", url: `https://b${index}.test/sse` }])),
        ];
        return new Response(JSON.stringify({ servers: rows, metadata: { nextCursor: "b/39:1.0.0", count: rows.length } }), { status: 200 });
      }) as typeof fetch,
    });
    const page = await search.search("one", undefined);
    expect(page.available).toBe(true);
    expect(page.results).toHaveLength(30);
    expect(page.results.filter((listing) => listing.id === "registry:a/one")).toHaveLength(1);
    expect(page.nextCursor).toBe("b/39:1.0.0");
    expect(new URL(asked[0]!).searchParams.get("search")).toBe("one");
    await search.search("one", undefined);
    expect(asked).toHaveLength(1);
    now += REGISTRY_CACHE_MS + 1;
    await search.search("one", undefined);
    expect(asked).toHaveLength(2);
    expect(await search.lookup("a/one")).toMatchObject({ url: "https://one.test/mcp" });
  });

  it("degrades to no community results when the registry is down or slow", async () => {
    const down = createRegistrySearch({ fetch: (async () => { throw new TypeError("offline"); }) as typeof fetch });
    expect(await down.search("x")).toEqual({ results: [], nextCursor: null, available: false });
    const slow = createRegistrySearch({
      timeoutMs: 50,
      fetch: ((_: URL, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch,
    });
    expect((await slow.search("x")).available).toBe(false);
    const broken = createRegistrySearch({ fetch: (async () => new Response("nope", { status: 503 })) as typeof fetch });
    expect((await broken.search("x")).available).toBe(false);
  });
});
