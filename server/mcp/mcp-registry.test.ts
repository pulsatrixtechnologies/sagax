import { describe, expect, it } from "vitest";

import {
  addDisabledMcpServer,
  botAddedMcpServerEnabled,
  isReservedMcpEnvEntry,
  listMcpServers,
  MAX_MCP_SERVERS,
  MAX_RESULT_BUDGET,
  mcpServerNameError,
  parseMcpServerMutation,
  parseMcpServersImport,
  parseStoredMcpServer,
  renameReservedMcpServer,
  reservedMcpServerLog,
  reservedMcpServerName,
  reservedMcpServers,
  suggestMcpServerName,
} from "./mcp-registry.ts";

describe("custom MCP registry", () => {
  it("parses stdio servers and keeps newly added commands disabled", () => {
    expect(parseMcpServerMutation("notes", { command: "npx", args: ["-y", "notes-mcp"] })).toEqual({
      ok: true,
      server: { command: "npx", args: ["-y", "notes-mcp"], env: {}, enabled: false },
    });
    expect(parseStoredMcpServer("notes", { command: "npx" })).toEqual({
      ok: true,
      server: { command: "npx", args: [], env: {}, enabled: true },
    });
  });

  it("refuses unsafe and reserved routing names", () => {
    expect(mcpServerNameError("Bad.Name")).toMatch(/lowercase/);
    expect(mcpServerNameError("computer")).toMatch(/reserved/);
    expect(mcpServerNameError("data")).toMatch(/reserved/);
    expect(parseStoredMcpServer("data", { command: "custom-data" })).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
    expect(mcpServerNameError("safe-notes")).toBeNull();
  });

  it("2026-10-17: refuses names that could spell a built-in tool or take a Sagax family", () => {
    for (const name of ["mcp", "data__x", "a__b", "sagax-computer", "sagax-flow", "sagax_x", "perspicax_cw", "claude_ai_github", "openmausbot_x"]) {
      expect(mcpServerNameError(name), name).toMatch(/reserved/);
      expect(parseStoredMcpServer(name, { command: "x" }), name).toMatchObject({ ok: false });
    }
    for (const name of ["my_data", "notes_2", "github-mcp", "claude-ai"]) expect(mcpServerNameError(name), name).toBeNull();
    // 2026-10-30: one rule for every server (shared/mcp-reserved-names.ts),
    // the strictest one a person's own servers already had: the families
    // need no separator any more
    for (const name of ["mcp-github", "mcpx", "sagaxy", "perspicaxx", "claude-ai-x"]) expect(mcpServerNameError(name), name).toMatch(/reserved/);
  });

  it("2026-10-17 (#695 follow-up): a saved server under a reserved name is listed apart, with a free name to offer", () => {
    const saved = {
      notes: { command: "npx" },
      mcp: { command: "npx", enabled: true },
      "sagax-tools": { type: "http", url: "https://tools.example/mcp", headers: {} },
      a__b: { command: "x" },
      "mcp-server": { command: "y" },
    };
    // never in the mounted listing
    expect(listMcpServers(saved).map((server) => server.name)).toEqual(["notes"]);
    expect(reservedMcpServers(saved)).toEqual([
      { name: "mcp", suggestedName: "server" },
      { name: "sagax-tools", suggestedName: "tools" },
      { name: "a__b", suggestedName: "a_b" },
      { name: "mcp-server", suggestedName: "server" },
    ]);
    expect(reservedMcpServerName("notes")).toBe(false);
    expect(reservedMcpServerName("Bad.Name")).toBe(false);
    expect(suggestMcpServerName("perspicax_cw", [])).toBe("cw");
    expect(suggestMcpServerName("claude_ai_github", ["github"])).toBe("github-server");
    expect(suggestMcpServerName("computer", [])).toBe("computer-server");
    for (const name of ["mcp", "sagax-x", "a__b", "openmausbot_phone", "data", "claude_ai_" + "x".repeat(22)]) {
      expect(mcpServerNameError(suggestMcpServerName(name, [])!), name).toBeNull();
    }
    expect(reservedMcpServerLog("mcp")).toMatch(/"mcp" is not mounted: its name is reserved by Sagax\. Rename or remove it/);
  });

  it("2026-10-17 (#695 follow-up): renames only a reserved name, to a free allowed one, and saves it off", () => {
    const saved = { notes: { command: "npx" }, mcp: { command: "npx", args: ["srv"], enabled: true }, other: { command: "z" } };
    const renamed = renameReservedMcpServer(saved, "mcp", "my-mcp");
    expect(renamed).toMatchObject({ ok: true, server: { command: "npx", args: ["srv"], enabled: false } });
    if (!renamed.ok) throw new Error("expected ok");
    // the list keeps its order; the old name is gone
    expect(Object.keys(renamed.next)).toEqual(["notes", "my-mcp", "other"]);
    expect(renamed.next.mcp).toBeUndefined();
    expect(listMcpServers(renamed.next).find((server) => server.name === "my-mcp")).toMatchObject({ enabled: false });

    expect(renameReservedMcpServer(saved, "notes", "notes2")).toMatchObject({ ok: false, status: 400 });
    expect(renameReservedMcpServer(saved, "missing", "x")).toMatchObject({ ok: false, status: 404 });
    expect(renameReservedMcpServer(saved, "mcp", "notes")).toMatchObject({ ok: false, status: 409 });
    // never to another reserved name
    for (const to of ["computer", "sagax-y", "x__y", "Bad", 7]) {
      expect(renameReservedMcpServer(saved, "mcp", to), String(to)).toMatchObject({ ok: false, status: 400 });
    }
    // an entry that does not read under any name stays where it is
    expect(renameReservedMcpServer({ mcp: { nonsense: true } }, "mcp", "ok-name")).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses harness-owned environment names in stored and renderer entries", () => {
    for (const key of ["SAGAX_HARNESS_URL", "OGB_BOX_TOKEN", "ELECTRON_RUN_AS_NODE"]) {
      const error = key === "ELECTRON_RUN_AS_NODE"
        ? `Environment variable “${key}” is reserved by Sagax; a custom server may set it to “1” only.`
        : `Environment variable “${key}” is reserved by Sagax.`;
      expect(parseStoredMcpServer("notes", { command: "notes-mcp", env: { [key]: "bad" } })).toEqual({ ok: false, error });
      expect(parseMcpServerMutation("notes", { command: "notes-mcp", env: { [key]: "bad" } })).toEqual({ ok: false, error });
    }
  });

  it("never puts environment values in renderer listings", () => {
    const listings = listMcpServers({
      github: { command: "github-mcp", env: { GITHUB_TOKEN: "ghp_real", MODE: "read-only" } },
    });
    expect(listings).toEqual([{
      name: "github",
      command: "github-mcp",
      args: [],
      envKeys: ["GITHUB_TOKEN", "MODE"],
      enabled: true,
    }]);
    expect(JSON.stringify(listings)).not.toContain("ghp_real");
    expect(JSON.stringify(listings)).not.toContain("read-only");
  });

  it("preserves write-only values only when a matching value is stored", () => {
    const existing = { command: "old", args: [], env: { TOKEN: "secret", DROP: "gone" }, enabled: true };
    expect(parseMcpServerMutation("notes", {
      command: "new",
      env: { TOKEN: true, NEXT: "fresh" },
      enabled: true,
    }, existing)).toEqual({
      ok: true,
      server: { command: "new", args: [], env: { TOKEN: "secret", NEXT: "fresh" }, enabled: true },
    });
    expect(parseMcpServerMutation("notes", { command: "new", env: { MISSING: true } }, existing)).toEqual({
      ok: false,
      error: "No saved value exists for MISSING.",
    });
  });

});

describe("addDisabledMcpServer", () => {
  const notes = { command: "old", args: ["a"], env: { TOKEN: "kept" }, enabled: true };

  it("stores a stdio server and a remote url server switched off, secrets included", () => {
    expect(addDisabledMcpServer({}, {
      name: "notes",
      command: "npx",
      args: ["-y", "notes-mcp"],
      env: { NOTES_TOKEN: "secret-token" },
      note: "dropped",
    })).toEqual({
      ok: true,
      name: "notes",
      server: { command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "secret-token" }, enabled: false },
      next: { notes: { command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "secret-token" }, enabled: false } },
    });
    const remote = {
      type: "sse" as const,
      url: "https://docs.example/mcp",
      headers: { Authorization: "Bearer real" },
      oauth: { clientId: "corp-app", clientSecret: "app-secret", scopes: ["mcp.read"] },
      enabled: false,
    };
    expect(addDisabledMcpServer({}, {
      name: "docs",
      url: remote.url,
      type: "sse",
      headers: remote.headers,
      oauth: { clientId: "corp-app", clientSecret: "app-secret", scopes: ["mcp.read"] },
    })).toEqual({ ok: true, name: "docs", server: remote, next: { docs: remote } });
  });

  it("refuses a body that contains enabled and leaves the map unchanged", () => {
    const current = { notes: { ...notes } };
    expect(addDisabledMcpServer(current, { name: "other", command: "npx", enabled: true })).toEqual({
      ok: false,
      status: 400,
      error: "A bot cannot change the on/off switch. Send the server without it: on Auto or Full access it is saved on, otherwise off until the user turns it on in MCP server settings.",
    });
    expect(addDisabledMcpServer(current, { name: "other", command: "npx", enabled: false }).ok).toBe(false);
    expect(current).toEqual({ notes });
  });

  it("refuses an existing name and leaves that server unchanged", () => {
    const current = { notes: { ...notes }, other: { command: "stay", args: [], env: {}, enabled: false } };
    const before = structuredClone(current);
    expect(addDisabledMcpServer(current, { name: "notes", command: "new", env: { TOKEN: "nope" }, enabled: false })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(addDisabledMcpServer(current, { name: "notes", command: "new", env: { TOKEN: "nope" } })).toEqual({
      ok: false,
      status: 409,
      error: "An MCP server with that name already exists.",
    });
    expect(current).toEqual(before);
  });

  it("refuses a new server once the installation is already full", () => {
    const current: Record<string, unknown> = {};
    for (let i = 0; i < MAX_MCP_SERVERS; i++) current[`s${i}`] = { command: "x", args: [], env: {}, enabled: false };
    const before = structuredClone(current);
    expect(addDisabledMcpServer(current, { name: "extra", command: "npx" })).toEqual({
      ok: false,
      status: 400,
      error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.`,
    });
    expect(addDisabledMcpServer(current, { name: "s0", command: "new" })).toMatchObject({ ok: false, status: 409 });
    expect(current).toEqual(before);
  });
});

describe("botAddedMcpServerEnabled (#1098)", () => {
  it("switches a bot's new server on at Auto or Full, never a command on an organization server", () => {
    expect(botAddedMcpServerEnabled({ approvalMode: "auto", organization: false, remote: false })).toBe(true);
    expect(botAddedMcpServerEnabled({ approvalMode: "full", organization: false, remote: false })).toBe(true);
    expect(botAddedMcpServerEnabled({ approvalMode: "auto", organization: true, remote: true })).toBe(true);
    expect(botAddedMcpServerEnabled({ approvalMode: "auto", organization: true, remote: false })).toBe(false);
    expect(botAddedMcpServerEnabled({ approvalMode: "full", organization: true, remote: false })).toBe(false);
    expect(botAddedMcpServerEnabled({ approvalMode: "ask", organization: false, remote: true })).toBe(false);
    expect(botAddedMcpServerEnabled({ approvalMode: "edits", organization: false, remote: true })).toBe(false);
  });
});

describe("parseMcpServersImport", () => {
  // The block every other agent tool shares: Claude Code, Cursor and Claude
  // Desktop all write {"mcpServers": {name: {command, args, env}}}. Pasting
  // it here should just work, with the same rules as the form.
  it("reads the standard mcpServers block, disabled until explicitly enabled", () => {
    const result = parseMcpServersImport(JSON.stringify({
      mcpServers: {
        notes: { command: "npx", args: ["-y", "@example/notes-mcp"], env: { NOTES_TOKEN: "t" } },
        "Linear Tasks": { command: "linear-mcp" },
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.servers)).toEqual(["notes", "linear-tasks"]);
    expect(result.servers.notes).toEqual({ command: "npx", args: ["-y", "@example/notes-mcp"], env: { NOTES_TOKEN: "t" }, enabled: false });
    expect(result.servers["linear-tasks"]).toEqual({ command: "linear-mcp", args: [], env: {}, enabled: false });
  });

  it("accepts a bare map, one server, or a single entry with a name", () => {
    const bare = parseMcpServersImport('{"fs": {"command": "mcp-fs", "args": ["/tmp"]}}');
    expect(bare.ok && Object.keys(bare.servers)).toEqual(["fs"]);
    const single = parseMcpServersImport('{"name": "fs", "command": "mcp-fs"}');
    expect(single.ok && Object.keys(single.servers)).toEqual(["fs"]);
  });

  it("imports executable paths with spaces without treating them as shell commands", () => {
    for (const command of ["/Applications/Fixture Tools/mcp", "C:\\Program Files\\Fixture\\mcp.exe"]) {
      expect(parseMcpServersImport(JSON.stringify({ constructor: { command, enabled: true } }))).toEqual({
        ok: true, servers: { constructor: { command, args: [], env: {}, enabled: false } },
      });
    }
  });

  it("rejects colliding normalized names and invalid late entries without returning a partial import", () => {
    expect(parseMcpServersImport(JSON.stringify({ "Notes App": { command: "notes" }, "notes-app": { command: "other" } })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/twice/) });
    expect(parseMcpServersImport(JSON.stringify({ good: { command: "notes" }, bad: { command: "other", env: { TOKEN: true } } })))
      .toMatchObject({ ok: false });
  });

  it("accepts remote servers in their own shape, refuses reserved names and junk", () => {
    expect(parseMcpServersImport('{"mcpServers": {"web": {"type": "http", "url": "https://x.example/mcp", "headers": {"Authorization": "Bearer t"}, "enabled": true}}}')).toEqual({
      ok: true,
      // enabled from the paste is dropped: nothing is reached before it was tested
      servers: { web: { type: "http", url: "https://x.example/mcp", headers: { Authorization: "Bearer t" }, enabled: false } },
    });
    expect(parseMcpServersImport('{"name": "docs", "url": "https://x.example/sse", "type": "sse"}')).toEqual({
      ok: true,
      servers: { docs: { type: "sse", url: "https://x.example/sse", headers: {}, enabled: false } },
    });
    expect(parseMcpServersImport('{"mcpServers": {"web": {"url": "x.example/mcp"}}}')).toMatchObject({ ok: false, error: expect.stringMatching(/full address/) });
    expect(parseMcpServersImport('{"mcpServers": {"computer": {"command": "x"}}}')).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/i) });
    expect(parseMcpServersImport('{"mcpServers": {"ok": {"command": "x", "env": {"SAGAX_TOKEN": "1"}}}}')).toMatchObject({ ok: false });
    expect(parseMcpServersImport("not json")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/i) });
    expect(parseMcpServersImport("npx -y @scope/notes-mcp --read-only")).toEqual({
      ok: true,
      servers: { "notes-mcp": { command: "npx", args: ["-y", "@scope/notes-mcp", "--read-only"], env: {}, enabled: false } },
    });
    expect(parseMcpServersImport('npx -y pkg "arg with spaces"')).toMatchObject({
      ok: true,
      servers: { pkg: { command: "npx", args: ["-y", "pkg", "arg with spaces"], enabled: false } },
    });
    expect(parseMcpServersImport("bash -c id")).toMatchObject({ ok: false, error: expect.stringMatching(/shell/i) });
    expect(parseMcpServersImport("npx -y pkg | sh")).toMatchObject({ ok: false, error: expect.stringMatching(/shell/i) });
    expect(parseMcpServersImport("/opt/tools/server --flag")).toMatchObject({
      ok: true,
      servers: { server: { command: "/opt/tools/server", args: ["--flag"], enabled: false } },
    });
    expect(parseMcpServersImport("[]")).toMatchObject({ ok: false });
    expect(parseMcpServersImport("https://mcp.example.com/mcp")).toEqual({
      ok: true,
      servers: { "example-com": { type: "http", url: "https://mcp.example.com/mcp", headers: {}, enabled: false } },
    });
    expect(parseMcpServersImport("https://h/x/foo")).toEqual({
      ok: true,
      servers: { h: { type: "http", url: "https://h/x/foo", headers: {}, enabled: false } },
    });
    expect(parseMcpServersImport("https://h/x?a=1&b=2").ok).toBe(true);
    expect(parseMcpServersImport("https://user:pw@h/mcp")).toMatchObject({ ok: false, error: expect.stringMatching(/header/i) });
    expect(parseMcpServersImport(JSON.stringify({ planted: { command: "https://h/x/foo" } }))).toMatchObject({ ok: false, error: expect.stringMatching(/not a program/i) });
    expect(parseMcpServersImport(JSON.stringify({ planted: { command: "bash", args: ["-c", "id"] } }))).toMatchObject({ ok: false, error: expect.stringMatching(/shell/i) });
  });
});

describe("remote (url) MCP servers", () => {
  it("parses a url entry, defaulting to streamable HTTP; a new one starts off", () => {
    expect(parseMcpServerMutation("docs", { url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" } })).toEqual({
      ok: true,
      server: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer t" }, enabled: false },
    });
    expect(parseStoredMcpServer("docs", { type: "sse", url: "http://127.0.0.1:8123/sse" })).toEqual({
      ok: true,
      server: { type: "sse", url: "http://127.0.0.1:8123/sse", headers: {}, enabled: true },
    });
  });

  it("refuses bad addresses, header names and mixed shapes", () => {
    expect(parseStoredMcpServer("docs", { url: "docs.example/mcp" })).toEqual({ ok: false, error: "Use a full address, like https://example.com/mcp." });
    expect(parseStoredMcpServer("docs", { url: "ftp://docs.example/mcp" })).toEqual({ ok: false, error: "The address must start with http:// or https://." });
    expect(parseStoredMcpServer("docs", { url: "https://user:pw@docs.example/mcp" })).toEqual({ ok: false, error: "Put credentials in a header, not in the address." });
    expect(parseStoredMcpServer("docs", { url: "https://docs.example/mcp", headers: { "Bad Header": "v" } })).toEqual({ ok: false, error: "Header “Bad Header” is not a valid header name." });
    expect(parseStoredMcpServer("docs", { url: "https://docs.example/mcp", headers: { "X-A": "a\nb" } })).toEqual({ ok: false, error: "Header “X-A” must be a single line." });
    expect(parseStoredMcpServer("docs", { url: "https://docs.example/mcp", command: "npx" })).toMatchObject({ ok: false });
    expect(parseStoredMcpServer("docs", { type: "http" })).toMatchObject({ ok: false });
  });

  it("lists a url server by address and header names only", () => {
    const listings = listMcpServers({ docs: { url: "https://docs.example/mcp", headers: { Authorization: "Bearer real", "X-Org": "acme" } } });
    expect(listings).toEqual([{ name: "docs", type: "http", url: "https://docs.example/mcp", headerKeys: ["Authorization", "X-Org"], enabled: true }]);
    expect(JSON.stringify(listings)).not.toContain("real");
    expect(JSON.stringify(listings)).not.toContain("acme");
  });

  it("keeps saved header values behind write-only placeholders", () => {
    const existing = { type: "http" as const, url: "https://docs.example/mcp", headers: { Authorization: "Bearer old" }, enabled: true };
    expect(parseMcpServerMutation("docs", { url: "https://docs.example/mcp", headers: { Authorization: true, "X-Org": "acme" } }, existing)).toEqual({
      ok: true,
      server: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer old", "X-Org": "acme" }, enabled: true },
    });
    // a placeholder cannot borrow from a server of the other shape
    expect(parseMcpServerMutation(
      "docs",
      { url: "https://docs.example/mcp", headers: { Authorization: true } },
      { command: "old", args: [], env: { Authorization: "x" }, enabled: true },
    )).toEqual({ ok: false, error: "No saved value exists for Authorization." });
  });
});

describe("a url server's sign-in app", () => {
  const url = "https://docs.example/mcp";
  const saved = {
    type: "http" as const, url, headers: {}, enabled: true,
    oauth: { clientId: "corp-app", clientSecret: "app-secret-value", scopes: ["api://mcp/read"] },
  };

  it("stores a client id, secret and scopes, and lists only whether a secret is saved", () => {
    expect(parseStoredMcpServer("docs", { url, oauth: { clientId: " corp-app ", scopes: ["a", "a", "offline_access"] } })).toEqual({
      ok: true,
      server: { type: "http", url, headers: {}, oauth: { clientId: "corp-app", scopes: ["a", "offline_access"] }, enabled: true },
    });
    const listings = listMcpServers({ docs: saved });
    expect(listings).toEqual([{
      name: "docs", type: "http", url, headerKeys: [], enabled: true,
      oauth: { clientId: "corp-app", scopes: ["api://mcp/read"], clientSecretConfigured: true },
    }]);
    expect(JSON.stringify(listings)).not.toContain("app-secret-value");
  });

  it("keeps a saved secret behind a placeholder only for the same client id", () => {
    expect(parseMcpServerMutation("docs", { url, oauth: { clientId: "corp-app", clientSecret: true } }, saved)).toEqual({
      ok: true,
      server: { type: "http", url, headers: {}, oauth: { clientId: "corp-app", clientSecret: "app-secret-value" }, enabled: true },
    });
    expect(parseMcpServerMutation("docs", { url, oauth: { clientId: "other-app", clientSecret: true } }, saved)).toEqual({
      ok: false, error: "No client secret is saved for this client ID. Enter it again, or leave it out for an app without one.",
    });
    expect(parseMcpServerMutation("docs", { url, oauth: { clientId: "corp-app", clientSecret: true } })).toMatchObject({ ok: false });
    // a stored entry never takes the placeholder
    expect(parseStoredMcpServer("docs", { url, oauth: { clientId: "corp-app", clientSecret: true } })).toMatchObject({ ok: false });
    // leaving the app out removes it, secret and all
    expect(parseMcpServerMutation("docs", { url }, saved)).toEqual({ ok: true, server: { type: "http", url, headers: {}, enabled: true } });
  });

  it("refuses an empty client id, a scope with spaces and unknown fields, with a sentence that teaches", () => {
    expect(parseStoredMcpServer("docs", { url, oauth: { clientId: "  " } })).toEqual({
      ok: false, error: "Enter the client ID of the app registered with this server's sign-in provider.",
    });
    expect(parseStoredMcpServer("docs", { url, oauth: { clientId: "a", scopes: ["read write"] } })).toEqual({
      ok: false, error: "Scopes are single words, like offline_access or api://my-app/mcp.read.",
    });
    expect(parseStoredMcpServer("docs", { url, oauth: { clientId: "a", callbackPort: 8080 } })).toMatchObject({ ok: false });
  });
});

describe("custom MCP environment names (port de OpenMausBot #2865)", () => {
  it("accepts ELECTRON_RUN_AS_NODE=1 for an Electron binary and refuses any other value", () => {
    expect(parseMcpServerMutation("app", { command: "/Applications/App.app/Contents/MacOS/App", env: { ELECTRON_RUN_AS_NODE: "1" } }))
      .toMatchObject({ ok: true, server: { env: { ELECTRON_RUN_AS_NODE: "1" } } });
    expect(parseMcpServerMutation("app", { command: "app", env: { ELECTRON_RUN_AS_NODE: "0" } }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/“1” only/) });
    expect(parseStoredMcpServer("app", { command: "app", env: { ELECTRON_RUN_AS_NODE: "" } })).toMatchObject({ ok: false });
  });

  it("keeps the harness names reserved whatever their value", () => {
    for (const name of ["SAGAX_TOOL_SERVER", "OGB_BOX_TOKEN"]) {
      expect(isReservedMcpEnvEntry(name, "1"), name).toBe(true);
      expect(parseMcpServerMutation("app", { command: "app", env: { [name]: "1" } })).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
    }
    expect(isReservedMcpEnvEntry("ELECTRON_RUN_AS_NODE", "1")).toBe(false);
    expect(isReservedMcpEnvEntry("NOTES_TOKEN", "x")).toBe(false);
  });
});

describe("a server's own result size limit", () => {
  it("is stored for a command and a URL server, listed back, and optional", () => {
    const stdio = parseMcpServerMutation("fx", { command: "npx", resultBudget: 40_000 });
    expect(stdio.ok && stdio.server.resultBudget).toBe(40_000);
    const remote = parseMcpServerMutation("fx", { type: "http", url: "https://mcp.example.test/mcp", resultBudget: 0 });
    expect(remote.ok && remote.server.resultBudget).toBe(0);
    const none = parseMcpServerMutation("fx", { command: "npx" });
    expect(none.ok && "resultBudget" in none.server).toBe(false);
    const listed = listMcpServers({ a: { command: "npx", resultBudget: 9_000 }, b: { command: "npx" }, c: { type: "http", url: "https://mcp.example.test/mcp", resultBudget: 0 } });
    expect(listed.map((server) => server.resultBudget)).toEqual([9_000, undefined, 0]);
  });

  it("refuses negative, fractional, non-numeric and oversized values", () => {
    for (const bad of [-1, 1.5, "8000", Number.NaN, MAX_RESULT_BUDGET + 1]) {
      expect(parseMcpServerMutation("fx", { command: "npx", resultBudget: bad }).ok).toBe(false);
    }
    expect(parseMcpServerMutation("fx", { command: "npx", resultBudget: MAX_RESULT_BUDGET }).ok).toBe(true);
  });

  it("survives a pasted config block", () => {
    const parsed = parseMcpServersImport(JSON.stringify({ mcpServers: { fx: { command: "npx", resultBudget: 20_000 } } }));
    expect(parsed.ok && parsed.servers.fx?.resultBudget).toBe(20_000);
  });
});
