// Isolated Perspicax bridge mounts: two profiles in one Codex parent env keep
// their reserved variables apart (#1895 local half of the multi-profile check).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import {
  PROXY_ENV_PREFIX_VARIABLE,
  isSagaxPerspicaxBridge,
  isolatedPerspicaxBridge,
} from "./mcp-mount.ts";

const bridge = (token: string, harness = "http://127.0.0.1:8799") => ({
  command: process.execPath,
  args: [SPAWNED_PROXIES.perspicax],
  env: {
    SAGAX_PERSPICAX_TOKEN: token,
    SAGAX_HARNESS_URL: harness,
    SAGAX_BOT_ID: "bot-1",
    SAGAX_THREAD_ID: "th-1",
    ELECTRON_RUN_AS_NODE: "1",
  },
});

describe("isolatedPerspicaxBridge", () => {
  it("gives each mount its own prefix so two profiles do not share reserved names", () => {
    const alpha = isolatedPerspicaxBridge("perspicax-alpha", bridge("token-alpha", "http://127.0.0.1:8801"));
    const beta = isolatedPerspicaxBridge("perspicax-beta", bridge("token-beta", "http://127.0.0.1:8802"));

    const stemOf = (name: string) =>
      `SAGAX_MCP_ENV_${createHash("sha256").update(name).digest("hex").toUpperCase()}__`;
    expect(alpha.literal[PROXY_ENV_PREFIX_VARIABLE]).toBe(stemOf("perspicax-alpha"));
    expect(beta.literal[PROXY_ENV_PREFIX_VARIABLE]).toBe(stemOf("perspicax-beta"));
    expect(alpha.literal[PROXY_ENV_PREFIX_VARIABLE]).not.toBe(beta.literal[PROXY_ENV_PREFIX_VARIABLE]);

    expect(alpha.literal).toEqual({
      [PROXY_ENV_PREFIX_VARIABLE]: stemOf("perspicax-alpha"),
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(beta.literal).toEqual({
      [PROXY_ENV_PREFIX_VARIABLE]: stemOf("perspicax-beta"),
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(alpha.server.env).toEqual({
      [`${stemOf("perspicax-alpha")}SAGAX_PERSPICAX_TOKEN`]: "token-alpha",
      [`${stemOf("perspicax-alpha")}SAGAX_HARNESS_URL`]: "http://127.0.0.1:8801",
      [`${stemOf("perspicax-alpha")}SAGAX_BOT_ID`]: "bot-1",
      [`${stemOf("perspicax-alpha")}SAGAX_THREAD_ID`]: "th-1",
    });
    expect(beta.server.env).toEqual({
      [`${stemOf("perspicax-beta")}SAGAX_PERSPICAX_TOKEN`]: "token-beta",
      [`${stemOf("perspicax-beta")}SAGAX_HARNESS_URL`]: "http://127.0.0.1:8802",
      [`${stemOf("perspicax-beta")}SAGAX_BOT_ID`]: "bot-1",
      [`${stemOf("perspicax-beta")}SAGAX_THREAD_ID`]: "th-1",
    });

    // Plain reserved names stay out of the child env table (Codex parent holds
    // only prefixed keys; the bridge restores them at start).
    expect(alpha.server.env.SAGAX_PERSPICAX_TOKEN).toBeUndefined();
    expect(beta.server.env.SAGAX_HARNESS_URL).toBeUndefined();
    expect(Object.keys(alpha.server.env).some((key) => key.startsWith(stemOf("perspicax-beta")))).toBe(false);
    expect(Object.keys(beta.server.env).some((key) => key.startsWith(stemOf("perspicax-alpha")))).toBe(false);
  });

  it("recognizes only the harness-held Perspicax bridge command", () => {
    expect(isSagaxPerspicaxBridge(bridge("tok"))).toBe(true);
    expect(isSagaxPerspicaxBridge({
      command: process.execPath,
      args: [SPAWNED_PROXIES.perspicax, "--extra"],
      env: { SAGAX_PERSPICAX_TOKEN: "tok" },
    })).toBe(false);
    expect(isSagaxPerspicaxBridge({
      command: "node",
      args: [SPAWNED_PROXIES.perspicax],
      env: { SAGAX_PERSPICAX_TOKEN: "tok" },
    })).toBe(false);
    expect(isSagaxPerspicaxBridge({
      command: process.execPath,
      args: [SPAWNED_PROXIES.perspicax],
      env: {},
    })).toBe(false);
    expect(isSagaxPerspicaxBridge({
      type: "http",
      url: "https://px.example.test/mcp",
      headers: {},
    })).toBe(false);
  });
});
