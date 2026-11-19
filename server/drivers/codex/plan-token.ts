// upstream #4063: a ChatGPT plan's token renewed while Codex works, through `auth.command` and a local bridge
// (../chatgpt-plan-token-bridge.ts). Sagax keeps a Codex process warm across turns, so one bridge serves the
// account: its socket and secret stay the same until the account changes, and the warm process stays reusable.
import { startChatGptTokenBridge, type ChatGptTokenBridge } from "../chatgpt-plan-token-bridge.ts";

/** What a bridged process adds to Codex's environment; none of it may reach the agent's shell. */
export const PLAN_TOKEN_BRIDGE_ENV = ["SAGAX_CODEX_AUTH_SOCKET", "SAGAX_CODEX_AUTH_SECRET", "ELECTRON_RUN_AS_NODE"];

/** The first Codex whose `auth.command` renews a provider token during a run. */
const RENEWS_FROM: readonly [number, number] = [0, 165];

export function codexRenewsPlanToken(version: string): boolean {
  const match = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > RENEWS_FROM[0] || (major === RENEWS_FROM[0] && minor >= RENEWS_FROM[1]);
}

/** Whether this driver's Codex can renew the token. The answer is kept until a snapshot reads another version, so a
 * turn does not wait on `codex --version` each time. A failed read is not kept: the next turn asks again. */
export function planTokenRenewal(readVersion: () => Promise<{ version: string } | { reason: string }>) {
  let known: boolean | undefined;
  let pending: Promise<boolean> | undefined;
  return {
    supported(): Promise<boolean> {
      if (known !== undefined) return Promise.resolve(known);
      pending ??= readVersion().then((probe) => "version" in probe ? (known = codexRenewsPlanToken(probe.version)) : false)
        .finally(() => { pending = undefined; });
      return pending;
    },
    /** Records the version a snapshot just read and answers whether it renews. */
    noteVersion(version: string): boolean {
      return (known = codexRenewsPlanToken(version));
    },
  };
}

/** One bridge per account generation. `stillCurrent` throws once the account changed or the instance went away; it
 * runs before and after every token read, so a retired account's token is never handed out. */
export function planTokenBridges(accessToken: () => Promise<string>) {
  let held: { generation: number; bridge: Promise<ChatGptTokenBridge> } | undefined;
  const close = () => {
    const previous = held;
    held = undefined;
    void previous?.bridge.then((bridge) => bridge.close(), () => {});
  };
  return {
    /** The bridge env for this account generation, started on first use. */
    async env(generation: number, stillCurrent: () => void): Promise<Record<string, string>> {
      if (held?.generation !== generation) {
        close();
        const bridge = startChatGptTokenBridge(async () => {
          stillCurrent();
          const token = await accessToken();
          stillCurrent();
          return token;
        });
        held = { generation, bridge };
        bridge.catch(() => { if (held?.bridge === bridge) held = undefined; });
      }
      const bridge = await held.bridge;
      stillCurrent();
      // The token command runs on this app's own runtime, which in the desktop app is Electron.
      return { ...bridge.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    },
    close,
  };
}
