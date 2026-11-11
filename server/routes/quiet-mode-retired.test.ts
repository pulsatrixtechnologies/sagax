// #3581: quiet mode is retired: what it did is how every bot behaves. Its
// four routes are gone, so a released app's call falls through to the
// server's 404 (the 0.8.87 desktop catches it and draws no switch).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { requiredScope } from "../auth/request-auth.ts";

const SERVER = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("the quiet mode routes are retired (#3581)", () => {
  const paths = ["/api/me/quiet", "/api/bots/bot-1/quiet"];

  it("no server route answers GET or PUT on them", () => {
    const routes = sources(SERVER).filter((file) => /\\\/quiet\$|\/quiet["`$]|routes\/quiet-mode\.ts/.test(readFileSync(file, "utf8")));
    expect(routes.map((file) => file.slice(SERVER.length))).toEqual([]);
  });

  it("a client session is not let through to a route that no longer exists", () => {
    for (const path of paths) for (const method of ["GET", "PUT"]) expect(requiredScope(method, path)).toBe("admin");
  });
});
