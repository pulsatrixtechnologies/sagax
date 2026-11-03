// Every HTTP route the server matches, read from the server sources: the
// exact paths (`path === "/api/…"`), the prefixes (`path.startsWith("/api/…")`)
// and the patterns (regex literals `/^\/api\/…/`) that route handlers test a
// request against, each with the method guard written beside it. Sagax routes
// are code, not a registry, so this is the list of what the running server can
// answer. scripts/tool-policy/tool-policy-coverage.test.ts holds every one to a
// policy entry in server/tools/tool-policy.ts. server/auth/request-auth.ts is left out:
// its path rules are the auth gate, not routes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type RouteKind = "exact" | "prefix" | "pattern";
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";
export interface InventoryRoute { kind: RouteKind; route: string; method: RouteMethod; file: string; line: number }

const METHOD = /\bmethod\s*(===|!==)\s*"(GET|POST|PUT|PATCH|DELETE)"/g;
const EXACT = /\bpath(?:name)?\s*===\s*"(\/api\/[^"$]*)"/g;
const PREFIX = /\bpath(?:name)?\.startsWith\("(\/api\/[^"$]*)"\)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "testing" || name === "node_modules" ? [] : sources(full);
    return /\.(ts|mts)$/.test(name) && name !== "request-auth.ts" && !/\.test\.|\.e2e\./.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

/** Regex literals that start `/^\/api\/` on one line. */
function patterns(line: string): string[] {
  const found: string[] = [];
  let at = line.indexOf("/^\\/api\\/");
  while (at >= 0) {
    let i = at + 1, cls = false;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === "\\") { i++; continue; }
      if (c === "[") cls = true; else if (c === "]") cls = false; else if (c === "/" && !cls) break;
    }
    if (i < line.length) found.push(line.slice(at + 1, i));
    at = line.indexOf("/^\\/api\\/", i + 1);
  }
  return found;
}

const METHOD_ONLY = /^\s*if \((?:!\w+ \|\| )?(?:method !== "(?:GET|POST|PUT|PATCH|DELETE)"(?: && )?)+\) return\b/;

/** The methods a line guards: `method === "POST"` names POST; a bare
 * early return on `!==` (`if (method !== "GET" && method !== "POST") return
 * PASS`) names the methods it lets through. A `!==` mixed with another
 * condition says nothing. */
function methodsOn(text: string): RouteMethod[] {
  const guards = [...text.matchAll(METHOD)];
  const is = guards.filter((m) => m[1] === "===").map((m) => m[2] as RouteMethod);
  if (is.length) return is;
  return METHOD_ONLY.test(text) ? guards.map((m) => m[2] as RouteMethod) : [];
}

function methodsNear(lines: string[], i: number): RouteMethod[] {
  const same = methodsOn(lines[i]!);
  if (same.length) return same;
  for (const j of [i - 1, i - 2, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6]) {
    if (j < 0 || j >= lines.length) continue;
    const near = methodsOn(lines[j]!);
    if (near.length) return near;
  }
  return ["ANY"];
}

/** A pattern kept in a constant (`const ROUTE = /^\/api\/…/`) is matched
 * where the constant is used (`ROUTE.exec(path)`): the method guard sits
 * there, not beside the definition. The union over its uses, else the
 * definition's own neighbourhood. */
function methodsOfConstant(lines: string[], i: number): RouteMethod[] | null {
  const name = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\/\^/.exec(lines[i]!)?.[1];
  if (!name) return null;
  const use = new RegExp(`\\b${name}\\.(exec|test)\\(`);
  const found = new Set<RouteMethod>();
  lines.forEach((text, j) => {
    if (j === i || !use.test(text) || /^\s*(\/\/|\*)/.test(text)) return;
    for (const method of methodsNear(lines, j)) found.add(method);
  });
  if (!found.size) return null;
  return found.has("ANY") ? ["ANY"] : [...found];
}

export function routeInventory(root: string): InventoryRoute[] {
  const seen = new Map<string, InventoryRoute>();
  for (const full of sources(join(root, "server"))) {
    const file = relative(root, full).split("\\").join("/");
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (/^\s*(\/\/|\*)/.test(text)) return;
      const hits: Array<[RouteKind, string]> = [
        ...[...text.matchAll(EXACT)].map((m) => ["exact", m[1]!] as [RouteKind, string]),
        ...[...text.matchAll(PREFIX)].map((m) => ["prefix", m[1]!] as [RouteKind, string]),
        ...patterns(text).map((p) => ["pattern", p] as [RouteKind, string]),
      ];
      // `path.startsWith("/api/")` is the API gate itself, not a route
      const routes = hits.filter(([kind, route]) => !(kind === "prefix" && route === "/api/"));
      if (!routes.length) return;
      const methods = (routes.some(([kind]) => kind === "pattern") && methodsOfConstant(lines, i)) || methodsNear(lines, i);
      for (const [kind, route] of routes) for (const method of methods) {
        const key = `${method} ${kind} ${route}`;
        if (!seen.has(key)) seen.set(key, { kind, route, method, file, line: i + 1 });
      }
    });
  }
  return [...seen.values()].sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method) || a.kind.localeCompare(b.kind));
}
