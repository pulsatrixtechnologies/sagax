import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

import { QUERY_TOOL, QUERY_TOOL_NAME, ResultStore, answerQuery, describeShape } from "./mcp-shape.ts";

const product = (i: number) => ({ id: `p${i}`, name: `Protein Bar ${i}`, price: 199 + i, blurb: "x".repeat(300) });

describe("describeShape", () => {
  it("names the top-level keys and the size and item keys of each array", () => {
    const shape = describeShape({ nextOffset: "1", products: Array.from({ length: 312 }, (_, i) => product(i)) });
    expect(shape).toBe("object{nextOffset, products}; products: 312 items{id, name, price, blurb}");
  });

  it("describes a bare array and caps a long key list", () => {
    const wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(describeShape([wide, wide])).toBe("2 items{k0, k1, k2, k3, k4, k5, k6, k7, k8, k9, k10, k11, …}");
    expect(describeShape([1, 2, 3])).toBe("3 items");
    expect(describeShape("plain")).toBe("string");
  });
});

describe("ResultStore", () => {
  it("hands out short handles and returns what it holds", () => {
    const store = new ResultStore();
    const value = { products: [product(1)] };
    const handle = store.put("search_products", value);
    expect(handle).toBe("r1");
    expect(store.put("search_products", value)).toBe("r2");
    expect(store.get("r1")).toEqual({ tool: "search_products", value });
    expect(store.get("r9")).toBeUndefined();
  });

  it("drops the oldest result once the held bytes pass its capacity", () => {
    const store = new ResultStore({ maxBytes: 2_000 });
    const first = store.put("a", { blurb: "x".repeat(900) });
    const second = store.put("b", { blurb: "x".repeat(900) });
    const third = store.put("c", { blurb: "x".repeat(900) });
    expect(store.get(first)).toBeUndefined();
    expect(store.get(second)).toBeDefined();
    expect(store.get(third)).toBeDefined();
  });
});

describe("answerQuery", () => {
  const store = new ResultStore();
  const handle = store.put("search_products", { nextOffset: "1", products: Array.from({ length: 300 }, (_, i) => product(i)) });

  it("returns only what the query selects", () => {
    const answer = answerQuery(store, { result: handle, query: "products[?price < `202`].{name: name, price: price}" }, 8_000);
    expect(answer.isError).toBeUndefined();
    expect(JSON.parse(answer.content[0]!.text)).toEqual([
      { name: "Protein Bar 0", price: 199 }, { name: "Protein Bar 1", price: 200 }, { name: "Protein Bar 2", price: 201 },
    ]);
  });

  it("cuts an answer that is itself too big, so the whole result never comes back", () => {
    const answer = answerQuery(store, { result: handle, query: "@" }, 2_000);
    expect(answer.content[0]!.text.length).toBeLessThan(2_400);
    expect(answer.content[0]!.text).toContain("TRUNCATED by Sagax");
    expect(answer.content[0]!.text).toContain(`"${handle}"`);
  });

  it("explains a query it cannot parse and shows the shape to query against", () => {
    const answer = answerQuery(store, { result: handle, query: "products[?price <" }, 8_000);
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toContain("Invalid token");
    expect(answer.content[0]!.text).toContain("products: 300 items{id, name, price, blurb}");
  });

  it("tells the model to call the tool again when a handle is gone", () => {
    const answer = answerQuery(store, { result: "r77", query: "@" }, 8_000);
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toContain("no longer held");
    expect(answer.content[0]!.text).toContain("call the original tool again");
  });

  it("rejects arguments that are not a handle and a query", () => {
    expect(answerQuery(store, { result: 3, query: "@" }, 8_000).isError).toBe(true);
    expect(answerQuery(store, { result: handle }, 8_000).isError).toBe(true);
    expect(answerQuery(store, null, 8_000).isError).toBe(true);
  });

  it("answers a query that selects nothing with null, not an error", () => {
    const answer = answerQuery(store, { result: handle, query: "nope.missing" }, 8_000);
    expect(answer.isError).toBeUndefined();
    expect(answer.content[0]!.text).toBe("null");
  });
});

describe("QUERY_TOOL", () => {
  it("is a read-only tool whose schema asks for a handle and a JMESPath query", () => {
    expect(QUERY_TOOL.name).toBe(QUERY_TOOL_NAME);
    expect(QUERY_TOOL_NAME).toBe("query_result");
    expect(QUERY_TOOL.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(QUERY_TOOL.inputSchema).toMatchObject({ type: "object", required: ["result", "query"] });
    expect(QUERY_TOOL.description).toContain("JMESPath");
  });
});

// query_result is pre-allowed (no approval card) because it can only read the
// result its own gate already holds. These tests hold it to that: no file is
// read, no connection or process is opened, the upstream server is never
// called again (mcp-gate.test.ts), and one gate's results (one MCP connection
// of one conversation) are never reachable from another's.
describe("query_result reads only the held result", () => {
  const require = createRequire(import.meta.url);
  afterEach(() => { vi.restoreAllMocks(); });

  it("imports nothing that can reach a file, the network or a process", () => {
    const source = readFileSync(new URL("./mcp-shape.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s.*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
    expect(imports.sort()).toEqual(["./mcp-trim.ts", "jmespath"]);
    const trim = readFileSync(new URL("./mcp-trim.ts", import.meta.url), "utf8");
    expect(trim).not.toMatch(/^import\s/m);
    // the JMESPath library is one self-contained file: no require, no import, no eval
    const library = readFileSync(require.resolve("jmespath"), "utf8");
    expect(library).not.toMatch(/\brequire\s*\(/);
    expect(library).not.toMatch(/\bimport\s*\(/);
    expect(library).not.toMatch(/\beval\s*\(|new Function\s*\(/);
  });

  it("answers without touching the file system, the network or a child process", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const net = require("node:net") as typeof import("node:net");
    const http = require("node:http") as typeof import("node:http");
    const https = require("node:https") as typeof import("node:https");
    const child = require("node:child_process") as typeof import("node:child_process");
    const spies = [
      vi.spyOn(fs, "readFileSync"), vi.spyOn(fs, "openSync"), vi.spyOn(fs, "readFile"), vi.spyOn(fs, "readdirSync"),
      vi.spyOn(fs, "existsSync"), vi.spyOn(fs, "statSync"), vi.spyOn(fs.promises, "readFile"), vi.spyOn(fs.promises, "open"),
      vi.spyOn(net, "connect"), vi.spyOn(net, "createConnection"), vi.spyOn(http, "request"), vi.spyOn(http, "get"),
      vi.spyOn(https, "request"), vi.spyOn(https, "get"), vi.spyOn(child, "spawn"), vi.spyOn(child, "exec"),
      vi.spyOn(child, "execFile"), vi.spyOn(child, "spawnSync"), vi.spyOn(child, "execSync"), vi.spyOn(globalThis, "fetch"),
    ];
    const store = new ResultStore();
    const handle = store.put("search_products", { products: Array.from({ length: 50 }, (_, i) => product(i)) });
    const queries = [
      "products[?price > `240`].name",
      "length(products)",
      "sort_by(products, &price)[0:3].id",
      // look-alikes of a path or an address are only names to JMESPath: nothing is opened
      "\"/etc/passwd\"",
      "\"file:///etc/passwd\"",
      "\"http://127.0.0.1:1/\"",
      "`\"/etc/passwd\"`",
      "products[0].\"../../secret\"",
      "not valid [[[",
    ];
    for (const query of queries) answerQuery(store, { result: handle, query }, 8_000);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(answerQuery(store, { result: handle, query: "\"/etc/passwd\"" }, 8_000).content[0]!.text)).toBeNull();
    expect(answerQuery(store, { result: handle, query: "`\"/etc/passwd\"`" }, 8_000).content[0]!.text).toBe("\"/etc/passwd\"");
  });

  it("never reaches another gate's result: each conversation's connection holds its own", () => {
    // two gates, as two conversations (or two people) each get on their own MCP connection
    const mine = new ResultStore();
    const theirs = new ResultStore();
    const myHandle = mine.put("search", { owner: "me", items: [1, 2, 3] });
    const theirHandle = theirs.put("search", { owner: "someone else", items: [9] });
    // handles are per gate: the same name in another gate is that gate's own result, never mine
    expect(myHandle).toBe(theirHandle);
    expect(answerQuery(mine, { result: myHandle, query: "owner" }, 8_000).content[0]!.text).toBe("\"me\"");
    expect(answerQuery(theirs, { result: theirHandle, query: "owner" }, 8_000).content[0]!.text).toBe("\"someone else\"");
    // a handle a gate never handed out is refused, whoever made it
    expect(answerQuery(theirs, { result: "r2", query: "@" }, 8_000)).toMatchObject({ isError: true });
    // and the query can name nothing outside the held value
    expect(answerQuery(mine, { result: myHandle, query: "@.items" }, 8_000).content[0]!.text).toBe("[1,2,3]");
  });

  it("returns at most the budget, so no query hands back the whole payload", () => {
    const store = new ResultStore();
    const handle = store.put("search_products", { products: Array.from({ length: 300 }, (_, i) => product(i)) });
    const answer = answerQuery(store, { result: handle, query: "@" }, 2_000).content[0]!.text;
    expect(answer.length).toBeLessThanOrEqual(2_000);
  });
});
