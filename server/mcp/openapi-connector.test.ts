import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sendPinnedHttp } from "../vault/credential-http.ts";
import { buildOpenApiRequest, OpenApiStore, openApiScope, openApiUrlRefusal } from "./openapi-connector.ts";
import { parseOpenApiSpec } from "./openapi-tools.ts";

const KEY = Buffer.alloc(32, 7);

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SPEC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Notes" },
  servers: [{ url: "https://api.example/v1" }],
  paths: {
    "/notes/{id}": {
      get: {
        operationId: "getNote",
        summary: "Read one note",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "verbose", in: "query", schema: { type: "boolean" } },
        ],
      },
    },
  },
});

describe("OpenAPI connector", () => {
  it("keeps one person's document, headers included, off another person's file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-openapi-"));
    dirs.push(dir);
    const saved = new OpenApiStore(dir, () => ({ kind: "key", key: KEY }));
    const ada = openApiScope(true, "pr_ada");
    const bob = openApiScope(true, "pr_bob");
    expect(ada && bob).toBeTruthy();
    if (!ada || !bob) return;
    const view = saved.save(ada, SPEC, { Authorization: "Bearer secret-value" });
    expect(typeof view).not.toBe("string");
    if (typeof view === "string") return;
    expect(view.headerKeys).toEqual(["Authorization"]);
    expect(view.operations.map((operation) => operation.name)).toEqual(["getnote"]);
    expect(JSON.stringify(view)).not.toContain("secret-value");
    const sealed = readFileSync(join(dir, "principals", "pr_ada", "openapi.enc"), "utf8");
    expect(sealed).not.toContain("secret-value");
    expect(sealed).not.toContain("Bearer");
    expect(saved.read(ada)?.headers.Authorization).toBe("Bearer secret-value");
    expect(saved.view(bob).operations).toEqual([]);
    writeFileSync(join(dir, "principals", "pr_ada", "openapi.json"), JSON.stringify({ title: "Legacy", baseUrl: "https://old.example", headers: { Authorization: "Bearer legacy-secret" }, operations: [] }));
    rmSync(join(dir, "principals", "pr_ada", "openapi.enc"));
    expect(saved.read(ada)?.headers.Authorization).toBe("Bearer legacy-secret");
    expect(readFileSync(join(dir, "principals", "pr_ada", "openapi.enc"), "utf8")).not.toContain("legacy-secret");
  });

  it("builds the call without putting the header in the path", () => {
    const parsed = parseOpenApiSpec(SPEC);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const request = buildOpenApiRequest({
      operation: parsed.operations[0]!,
      baseUrl: parsed.baseUrl,
      headers: { Authorization: "Bearer secret-value" },
      args: { id: "n 1", verbose: true },
    });
    expect(typeof request).not.toBe("string");
    if (typeof request === "string") return;
    expect(request.url).toBe("https://api.example/v1/notes/n%201?verbose=true");
    expect(request.headers.Authorization).toBe("Bearer secret-value");
    expect(request.url).not.toContain("secret-value");
  });

  it("refuses a private address on an organization server and allows it solo", () => {
    expect(openApiUrlRefusal("https://api.example/v1", ["1.1.1.1"], true)).toBeNull();
    expect(openApiUrlRefusal("http://127.0.0.1/v1", ["127.0.0.1"], true)).toMatch(/public internet/);
    expect(openApiUrlRefusal("http://127.0.0.1/v1", ["127.0.0.1"], false)).toBeNull();
    expect(openApiUrlRefusal("https://user:pw@api.example/", ["1.1.1.1"], false)).toMatch(/password/);
    expect(openApiUrlRefusal("https://api.example/", ["169.254.169.254"], false)).toMatch(/not one Sagax will call/);
    expect(openApiUrlRefusal("https://api.example/", ["1.1.1.1", "169.254.169.254"], true)).toMatch(/not one Sagax will call/);
  });

  it("connects to the address it checked and does not follow a second lookup", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("x".repeat(20_000));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      let lookups = 0;
      const pinned = await sendPinnedHttp({ method: "GET", url: `http://rebind.test:${port}/notes` }, {
        allowNonPublic: true,
        maxResponseBytes: 64,
        resolve: async () => {
          lookups += 1;
          return [{ address: "127.0.0.1", family: 4 }];
        },
      });
      expect(lookups).toBe(1);
      expect(hits).toEqual(["/notes"]);
      expect(pinned.ok && pinned.truncated && pinned.bytes).toBe(64);
      hits.length = 0;
      const blocked = await sendPinnedHttp({ method: "GET", url: "http://mixed.test/secret" }, {
        allowNonPublic: false,
        resolve: async () => [{ address: "1.1.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }],
      });
      expect(blocked).toMatchObject({ ok: false, code: "blocked_address" });
      expect(hits).toEqual([]);
      expect(JSON.stringify(blocked)).not.toMatch(/Bearer|Authorization/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
