// #3623: which upstreams of the gate run as a thread of its own process.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { threadScript } from "./gate-upstream.ts";

const NODE = "/opt/node/bin/node";
const OWN = "/app/dist-server";

describe("threadScript", () => {
  it("takes a script of Sagax's own, started with this executable", () => {
    expect(threadScript(NODE, [join(OWN, "harness-mcp-proxy.js"), "data"], NODE, OWN)).toBe(join(OWN, "harness-mcp-proxy.js"));
    expect(threadScript(NODE, [join(OWN, "drivers", "agents-proxy.js")], NODE, OWN)).toBe(join(OWN, "drivers", "agents-proxy.js"));
    expect(threadScript(NODE, [join(OWN, "mcp-remote-proxy.ts")], NODE, OWN)).toBe(join(OWN, "mcp-remote-proxy.ts"));
  });

  it("leaves everything else a process", () => {
    // another executable (a person's own server, npx, a wrapper)
    expect(threadScript("npx", [join(OWN, "x.js")], NODE, OWN)).toBeUndefined();
    expect(threadScript("/usr/bin/node", [join(OWN, "x.js")], NODE, OWN)).toBeUndefined();
    // flags before the script (the local computer's proxy)
    expect(threadScript(NODE, ["--experimental-strip-types", join(OWN, "local-computer-proxy.ts")], NODE, OWN)).toBeUndefined();
    // a script outside the gate's directory, or one that climbs out of it
    expect(threadScript(NODE, ["/tmp/server.js"], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [join(OWN, "..", "other", "server.js")], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [`${OWN}-evil/server.js`], NODE, OWN)).toBeUndefined();
    // not a script, or none at all
    expect(threadScript(NODE, [join(OWN, "tool")], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, ["relative.js"], NODE, OWN)).toBeUndefined();
    expect(threadScript(NODE, [], NODE, OWN)).toBeUndefined();
  });
});
