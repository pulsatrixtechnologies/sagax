// The pinned agent-browser release the harness downloads for the bots'
// browser (docs/plans/browser-engine.md). Digests were computed from the
// official GitHub assets on 2026-10-03, except the explicitly versioned Windows
// vendor build below. Update pins through a reviewed native end-to-end run.
// The Dockerfile retains the official Linux version.
export const AGENT_BROWSER_VERSION = "0.38.2";

export interface AgentBrowserReleaseAsset {
  /** `<platform>-<arch>`; Linux adds `-musl` on Alpine-style systems. */
  target: string;
  /** File name on the GitHub release. */
  asset: string;
  sha256: string;
  bytes: number;
  /** A reviewed platform-specific vendor revision; other assets use the upstream version. */
  version?: string;
  /** Exact release URL for a reviewed vendor build, never a mutable latest URL. */
  url?: string;
}

const RELEASES = new Map<string, AgentBrowserReleaseAsset>([
  [
    "darwin-arm64",
    { target: "darwin-arm64", asset: "agent-browser-darwin-arm64", sha256: "8168b86ab5d94be8f670992dfe4fe1445016518a864b48bda105e64142e7cbf9", bytes: 15570496 },
  ],
  [
    "darwin-x64",
    { target: "darwin-x64", asset: "agent-browser-darwin-x64", sha256: "787cb40e086a188d0bb13ff29a99a0b2380aff3aa5e8600b8f8131a0b98ca69c", bytes: 17210352 },
  ],
  [
    "linux-arm64",
    { target: "linux-arm64", asset: "agent-browser-linux-arm64", sha256: "690c02d952de8497bba4f8cc58b59acbf27dc27b346755869b518f4b411c7f40", bytes: 15633664 },
  ],
  [
    "linux-musl-arm64",
    { target: "linux-musl-arm64", asset: "agent-browser-linux-musl-arm64", sha256: "eafeca9ca0fdb2fa2aa60c4554723348c739656b0ddba0d82ff654d4d33311b1", bytes: 15418440 },
  ],
  [
    "linux-musl-x64",
    { target: "linux-musl-x64", asset: "agent-browser-linux-musl-x64", sha256: "993d462f4dcfc19860d93a6521a452eba4502bfc449fe0120303c2ccb998e675", bytes: 17863544 },
  ],
  [
    "linux-x64",
    { target: "linux-x64", asset: "agent-browser-linux-x64", sha256: "a54b765192db774666f0513fa8b545a298753b6f29e73bcdf4a1e78f18e7c0e1", bytes: 18084048 },
  ],
  [
    "win32-x64",
    {
      // Upstream 0.38.2 still lacks PR #1781 (open on 2026-10-03)'s Windows cold-start fix.
      // Retain the native-verified revision until its replacement is tested.
      // Hosted on our own vendor release (docs/browser-packaging.md).
      target: "win32-x64", version: "0.36.0-omb.1",
      asset: "agent-browser-win32-x64-0.36.0-omb.1.exe",
      url: "https://github.com/pulsatrixtechnologies/sagax/releases/download/browser-engine-v0.36.0-omb.1/agent-browser-win32-x64-0.36.0-omb.1.exe",
      sha256: "33bee834f6a6072ec8688b0914726e0262874d758f69f27e8baf7eaac6b5ed15", bytes: 13806080,
    },
  ],
]);

export function agentBrowserReleaseUrl(asset: AgentBrowserReleaseAsset): string {
  return asset.url ?? `https://github.com/vercel-labs/agent-browser/releases/download/v${AGENT_BROWSER_VERSION}/${asset.asset}`;
}

export function agentBrowserReleaseVersion(asset: AgentBrowserReleaseAsset | null): string {
  return asset?.version ?? AGENT_BROWSER_VERSION;
}

/** The asset for this machine, or null where Vercel publishes none. */
export function resolveAgentBrowserReleaseAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl = false,
): AgentBrowserReleaseAsset | null {
  const key = platform === "linux" && musl ? `linux-musl-${arch}` : `${platform}-${arch}`;
  return RELEASES.get(key) ?? null;
}
