// Routing to the 'user-sandbox' target, the tools that run there, the stdio
// proxy, and the settings routes.
import { describe, expect, it } from "vitest";

import { toolExecutionTarget, USER_SANDBOX_SERVER } from "../../shared/execution-target.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SandboxExecOutput } from "./sandboxd-core.ts";
import type { UserSandboxManager } from "./user-sandbox-manager.ts";
import { restorePrefixedEnvironment, userSandboxProxyRequest } from "../user-sandbox-proxy.ts";
import { createUserSandboxRoutes } from "./user-sandbox-routes.ts";
import { remoteComputerForTurn, resolveExecutionTarget, sandboxPrincipalForTurn, screenVisibleToPrincipal, USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";
import { browsableUrl, callUserSandboxTool, handleUserSandboxMcp, type ToolExec } from "./user-sandbox-tools.ts";

describe("resolveExecutionTarget", () => {
  it("keeps a solo server on its own host", () => {
    expect(resolveExecutionTarget({ organization: false, sandboxConfigured: true, desktopTargeted: false })).toBe("host");
  });

  it("routes an organization turn with no desktop to the person's server environment", () => {
    expect(resolveExecutionTarget({ organization: true, sandboxConfigured: true, desktopTargeted: false })).toBe("user-sandbox");
  });

  it("leaves desktop turns to the person's own computer", () => {
    expect(resolveExecutionTarget({ organization: true, sandboxConfigured: true, desktopTargeted: true })).toBe("user-desktop");
  });

  it("never falls back to the server host in organization mode", () => {
    expect(resolveExecutionTarget({ organization: true, sandboxConfigured: false, desktopTargeted: false })).toBe("none");
  });
});

describe("sandboxPrincipalForTurn", () => {
  const owner = "pr_owner";
  it("runs a conversation in the SPEAKER's environment, never the bot owner's", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: false, speakerPrincipalId: "pr_teammate" })).toBe("pr_teammate");
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: false, speakerPrincipalId: owner })).toBe(owner);
  });

  it("runs routines, and threads or hops a routine starts, in the bot OWNER's environment", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: true, speakerPrincipalId: "pr_teammate" })).toBe(owner);
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: true })).toBe(owner);
  });

  it("runs a room turn in the environment of the person whose message it answers", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: false, speakerPrincipalId: "pr_bob", roomCreatorPrincipalId: "pr_alice" })).toBe("pr_bob");
  });

  it("runs a room follow-up no person asked for in the room creator's environment", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: false, roomCreatorPrincipalId: "pr_alice" })).toBe("pr_alice");
  });

  it("mounts nothing when nobody is known (fail closed)", () => {
    expect(sandboxPrincipalForTurn({ botOwnerPrincipalId: owner, routine: false, speakerPrincipalId: "" })).toBeNull();
  });
});

describe("remoteComputerForTurn", () => {
  it("keeps an organization turn off Boat, VPS and shared team computers", () => {
    expect(remoteComputerForTurn({ organization: true, runOnCloud: false, hasTeamComputer: true })).toEqual({ skipRemote: true, forceCloud: false });
    expect(remoteComputerForTurn({ organization: true, runOnCloud: true, hasTeamComputer: true })).toEqual({ skipRemote: true, forceCloud: true });
  });

  it("still forces Cloud on a solo server for a cloud routine or a team computer", () => {
    expect(remoteComputerForTurn({ organization: false, runOnCloud: true, hasTeamComputer: false })).toEqual({ skipRemote: false, forceCloud: true });
    expect(remoteComputerForTurn({ organization: false, runOnCloud: false, hasTeamComputer: true })).toEqual({ skipRemote: false, forceCloud: true });
    expect(remoteComputerForTurn({ organization: false, runOnCloud: false, hasTeamComputer: false })).toEqual({ skipRemote: false, forceCloud: false });
  });
});

describe("screenVisibleToPrincipal", () => {
  it("shows an organization screen only to the person whose turn it is", () => {
    expect(screenVisibleToPrincipal({ organization: true, viewerId: "Pr_Alice", workplacePrincipal: "pr_alice" })).toBe(true);
    expect(screenVisibleToPrincipal({ organization: true, viewerId: "pr_bob", workplacePrincipal: "pr_alice" })).toBe(false);
    expect(screenVisibleToPrincipal({ organization: true, viewerId: "pr_alice" })).toBe(false);
    expect(screenVisibleToPrincipal({ organization: true, workplacePrincipal: "pr_alice" })).toBe(false);
  });

  it("leaves solo screens unchanged", () => {
    expect(screenVisibleToPrincipal({ organization: false, viewerId: "pr_bob", workplacePrincipal: "pr_alice" })).toBe(true);
  });
});

describe("tool execution target labels", () => {
  it("reads the environment from the tool name across engines", () => {
    expect(USER_SANDBOX_SERVER).toBe(USER_SANDBOX_MCP_NAME);
    expect(toolExecutionTarget(`mcp__${USER_SANDBOX_SERVER}__run_command`)).toBe("user-sandbox");
    expect(toolExecutionTarget(`${USER_SANDBOX_SERVER}__read_file`)).toBe("user-sandbox");
    expect(toolExecutionTarget(`${USER_SANDBOX_SERVER}_browse`)).toBe("user-sandbox");
    expect(toolExecutionTarget("mcp__computer__click", "local")).toBe("user-desktop");
    expect(toolExecutionTarget("Bash")).toBeNull();
  });
});

function recorder(result: Partial<SandboxExecOutput> = {}, overQuota = false) {
  const calls: Parameters<ToolExec["exec"]>[0][] = [];
  const exec: ToolExec = {
    exec: async (input) => {
      // the environment resolves a read's path first (resolveInSandbox)
      if (input.argv[0] === "python3") return { exitCode: 0, stdout: JSON.stringify({ sagaxResolved: 1, real: `/workspace/${input.argv[4] ?? ""}`, links: [] }), stderr: "", truncated: false, timedOut: false };
      calls.push(input);
      return { exitCode: 0, stdout: "out", stderr: "", truncated: false, timedOut: false, ...result };
    },
    overQuota: async () => overQuota,
  };
  return { calls, exec };
}

describe("environment tools", () => {
  it("lists the shell, file, browser and computer-use tools", async () => {
    const listed = await handleUserSandboxMcp("tools/list", {}, recorder().exec) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["run_command", "read_file", "write_file", "list_files", "browse", "computer_list_tools", "computer_use"]);
  });

  it("runs a command through bash in the sandbox and reports the exit code", async () => {
    const { calls, exec } = recorder({ exitCode: 2, stderr: "boom" });
    const result = await callUserSandboxTool("run_command", { command: "ls /nope", timeout_seconds: 5 }, exec);
    expect(calls[0]).toEqual({ argv: ["bash", "-lc", "ls /nope"], timeoutSec: 5 });
    const long = recorder();
    await callUserSandboxTool("run_command", { command: "sleep 1", timeout_seconds: 99_999 }, long.exec);
    expect(long.calls[0]!.timeoutSec).toBe(600);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("[exit 2]");
  });

  it("writes content through env, never through the command line, on the resolved path", async () => {
    const { calls, exec } = recorder();
    await callUserSandboxTool("write_file", { path: "notes/a.txt", content: "hello $(rm -rf /)" }, exec);
    expect(calls[0]!.argv.join(" ")).not.toContain("hello");
    expect(Buffer.from(calls[0]!.env!.SAGAX_CONTENT_B64!, "base64").toString()).toBe("hello $(rm -rf /)");
    // the paths are sh's own arguments ($1 asked, $2 resolved, $3 identity,
    // $4 size, $5 the open guard), not the script
    expect(calls[0]!.argv.slice(3, 8)).toEqual(["sh", "notes/a.txt", "/workspace/notes/a.txt", "", "17"]);
    expect(calls[0]!.argv[2]).toContain('python3 -I -c "$5" write "$2" "$3" "$t"');
    expect(calls[0]!.argv[8]).toContain("O_NOFOLLOW");
    expect(Object.keys(calls[0]!.env!)).toEqual(["SAGAX_CONTENT_B64"]);
    expect(calls[0]!.stdinBase64).toBeUndefined();
  });

  it("writes large content on stdin (one variable is limited to 128 KiB)", async () => {
    const { calls, exec } = recorder();
    const content = "x".repeat(200 * 1024);
    const result = await callUserSandboxTool("write_file", { path: "big.txt", content }, exec);
    expect(result.isError).toBeFalsy();
    expect(calls[0]!.env).toBeUndefined();
    expect(Buffer.from(calls[0]!.stdinBase64!, "base64").toString()).toBe(content);
    expect(calls[0]!.argv[7]).toBe(String(200 * 1024));
    expect(calls[0]!.argv.join(" ")).not.toContain("xxxx");
  });

  it("refuses to write when the workspace is over quota", async () => {
    const { calls, exec } = recorder({}, true);
    const result = await callUserSandboxTool("write_file", { path: "a", content: "x" }, exec);
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("passes paths after -- so they are never options", async () => {
    const { calls, exec } = recorder();
    await callUserSandboxTool("read_file", { path: "-rf" }, exec);
    // the paths are sh's own arguments ($1, $2), never env (the Kubernetes
    // backend runs only the command line) nor part of the script; the guard
    // opens the resolved path itself and `head` reads that descriptor
    expect(calls[0]!.argv[2]).toBe('exec python3 -I -c "$5" read "$2" "$3" "$4"');
    expect(calls[0]!.argv.slice(3, 8)).toEqual(["sh", "-rf", "/workspace/-rf", "", "200000"]);
    expect(calls[0]!.argv[2]).not.toContain("-rf\"");
    expect(calls[0]!.env).toBeUndefined();
  });

  it("browses only http(s) URLs without credentials", async () => {
    expect(browsableUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(() => browsableUrl("file:///etc/passwd")).toThrow();
    expect(() => browsableUrl("https://u:p@example.com")).toThrow();
    const { calls, exec } = recorder();
    await callUserSandboxTool("browse", { url: "https://example.com" }, exec);
    expect(calls[0]!.argv[0]).toBe("chromium");
    expect(calls[0]!.argv).toContain("--dump-dom");
  });
});

describe("user-sandbox stdio proxy", () => {
  it("reads its own capability from a driver-given prefix (Codex's shared environment)", () => {
    const env: NodeJS.ProcessEnv = {
      SAGAX_PROXY_ENV_PREFIX: "SAGAX_MCP_ENV_SAGAX_COMPUTER__",
      SAGAX_MCP_ENV_SAGAX_COMPUTER__SAGAX_SANDBOX_TOKEN: "mine",
      SAGAX_MCP_ENV_SAGAX_COMPUTER__SAGAX_TOOL_SERVER: "sagax-computer",
      SAGAX_MCP_ENV_SAGAX_ENVIRONMENT__SAGAX_SANDBOX_TOKEN: "theirs",
    };
    restorePrefixedEnvironment(env);
    expect(env.SAGAX_SANDBOX_TOKEN).toBe("mine");
    expect(env.SAGAX_TOOL_SERVER).toBe("sagax-computer");
    const plain: NodeJS.ProcessEnv = { SAGAX_SANDBOX_TOKEN: "direct" };
    restorePrefixedEnvironment(plain);
    expect(plain).toEqual({ SAGAX_SANDBOX_TOKEN: "direct" });
  });

  it("answers initialize locally and forwards tools calls to the internal endpoint only", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fakeFetch = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const connection = { url: "http://127.0.0.1:4000/", token: "turn-token" };
    const init = await userSandboxProxyRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, connection, fakeFetch) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("sagax-environment");
    await userSandboxProxyRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_command", arguments: { command: "true" } } }, connection, fakeFetch);
    expect(seen).toEqual([{ url: "http://127.0.0.1:4000/api/internal/sandbox/mcp", auth: "Bearer turn-token" }]);
  });

  it("refuses a non-loopback harness URL", async () => {
    const result = await userSandboxProxyRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { url: "http://evil.example:4000/", token: "t" },
      (async () => { throw new Error("must not be called"); }) as unknown as typeof fetch,
    ) as { error: { message: string } };
    expect(result.error.message).toMatch(/not connected/);
  });
});

describe("settings routes", () => {
  const session = (principalId?: string): RequestAuth => ({
    kind: "session", via: "cookie", scopes: ["client"],
    session: { id: "s1", label: "", scopes: ["client"], createdAt: 0, expiresAt: Date.now() + 1e6, lastUsedAt: 0, ...(principalId ? { principalId } : {}) },
  } as unknown as RequestAuth);
  const fakeManager = {
    status: async (principalId: string) => ({ state: "running", principalId }),
    reset: async (principalId: string) => ({ state: "running", reset: principalId }),
  } as unknown as UserSandboxManager;

  async function call(handler: ReturnType<typeof createUserSandboxRoutes>, method: string, path: string, auth: RequestAuth, body: unknown = null) {
    let answer: { status: number; body: Record<string, unknown> } | null = null;
    const out = await handler({
      req: {} as RouteContext["req"], res: { setHeader() {} } as unknown as RouteContext["res"], url: new URL(`http://x${path}`), path, method, auth,
      json: ((_res: unknown, status: number, payload: Record<string, unknown>) => { answer = { status, body: payload }; }) as RouteContext["json"],
      readBody: (async () => body) as RouteContext["readBody"],
    });
    return out === PASS ? null : answer;
  }

  it("serves only the caller's own environment", async () => {
    const handler = createUserSandboxRoutes({ manager: () => fakeManager, organization: true });
    const answer = await call(handler, "GET", "/api/me/server-environment", session("pr_me"));
    expect(answer).toMatchObject({ status: 200, body: { configured: true, principalId: "pr_me" } });
    expect(await call(handler, "GET", "/api/me/server-environment", session())).toMatchObject({ status: 403 });
    expect(await call(handler, "GET", "/api/me/other", session("pr_me"))).toBeNull();
  });

  it("resets only after an explicit confirmation", async () => {
    const handler = createUserSandboxRoutes({ manager: () => fakeManager, organization: true });
    expect(await call(handler, "POST", "/api/me/server-environment/reset", session("pr_me"), {})).toMatchObject({ status: 400, body: { code: "confirm" } });
    expect(await call(handler, "POST", "/api/me/server-environment/reset", session("pr_me"), { confirm: true })).toMatchObject({ status: 200, body: { reset: "pr_me" } });
  });

  it("does not exist on a solo server and says off without a provisioner", async () => {
    expect(await call(createUserSandboxRoutes({ manager: () => fakeManager, organization: false }), "GET", "/api/me/server-environment", session("pr_me"))).toMatchObject({ status: 404 });
    expect(await call(createUserSandboxRoutes({ manager: () => null, organization: true }), "GET", "/api/me/server-environment", session("pr_me"))).toMatchObject({ status: 200, body: { configured: false } });
  });
});

describe("no VM per bot in organization mode", () => {
  it("reads a saved per-bot Local VM mode as shared on an organization server", async () => {
    const { localVmMode } = await import("../config.ts");
    const cfg = { localVm: { mode: "per-bot" } } as Parameters<typeof localVmMode>[0];
    expect(localVmMode(cfg, { SAGAX_IDENTITY: "perspicax" })).toBe("shared");
    expect(localVmMode(cfg, {})).toBe("per-bot");
  });
});
