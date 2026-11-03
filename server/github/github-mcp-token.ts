// The GitHub plugin's MCP server reads the one GitHub connection
// (2026-10-28). A marketplace plugin ships its server as Claude Code does,
// with the token left to the environment:
//
//   "headers": { "Authorization": "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" }
//
// Sagax never expanded that placeholder, so the server went out with the
// literal text and the Installed row said Connected for an account nobody
// had connected. Now the placeholder is the person's GitHub connection
// (the GitHub plugin's page in Capabilities): at each turn it is replaced with the
// token of the person the turn runs for, never written to config.json and
// never listed; the listing says whether that person has one.
import type { McpServerSpec } from "../contracts.ts";

/** The variable names a GitHub server reads its token from. */
export const GITHUB_TOKEN_VARIABLES = ["GITHUB_PERSONAL_ACCESS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] as const;

const PLACEHOLDER = new RegExp(`\\$\\{(?:${GITHUB_TOKEN_VARIABLES.join("|")})(?::-[^}]*)?\\}`, "g");
const HAS_PLACEHOLDER = new RegExp(PLACEHOLDER.source);

function values(spec: McpServerSpec): Record<string, string> {
  return "url" in spec ? spec.headers ?? {} : spec.env ?? {};
}

/** The server takes its token from the GitHub connection. Pure. */
export function readsGithubToken(spec: McpServerSpec): boolean {
  return Object.values(values(spec)).some((value) => HAS_PLACEHOLDER.test(value));
}

/** The servers with each GitHub placeholder replaced by `token`. Without a
 * token they go as they are (the server refuses the literal text, as
 * before). Never mutates its argument. Pure. */
export function withGithubToken<T extends Record<string, McpServerSpec>>(servers: T, token: string | undefined): T {
  if (!token) return servers;
  const out: Record<string, McpServerSpec> = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!readsGithubToken(spec)) {
      out[name] = spec;
      continue;
    }
    const filled = Object.fromEntries(Object.entries(values(spec)).map(([key, value]) => [key, value.replace(PLACEHOLDER, () => token)]));
    out[name] = "url" in spec ? { ...spec, headers: filled } : { ...spec, env: filled };
  }
  return out as T;
}

// A GitHub server acts as the person of the turn (2026-10-28). On an
// organization server a server-wide GitHub MCP server (one an admin added,
// signed in to, or gave a fixed Authorization header) reached every
// member's turn with that one sign-in, so a member's bot acted on GitHub as
// the admin. Now, on an organization server, every GitHub server of a turn
// carries the GitHub connection of the person the turn runs for (the GitHub
// plugin's page in Capabilities), whatever sign-in or header it was saved with;
// a person without a connection gets no GitHub server at all, and the bot
// tells them to connect GitHub.

const GITHUB_HOSTS = ["github.com", "githubcopilot.com", "ghe.com"];

/** A GitHub MCP server: it reads the GitHub connection, or its address is
 * on GitHub (api.githubcopilot.com, api.github.com, a GitHub Enterprise
 * Cloud host). Pure. */
export function isGithubMcpServer(spec: McpServerSpec): boolean {
  if (readsGithubToken(spec)) return true;
  if (!("url" in spec)) return false;
  let host: string;
  try {
    host = new URL(spec.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return GITHUB_HOSTS.some((root) => host === root || host.endsWith(`.${root}`));
}

/** Organization server: each GitHub server of a turn as the person of the
 * turn. With `token` (that person's GitHub connection) its placeholder or
 * its Authorization header is that token, never the saved one; without, the
 * server is left out and named in `withheld`. Every other server goes as it
 * is. Never mutates its argument. Pure. */
export function githubServersAsPerson<T extends Record<string, McpServerSpec>>(servers: T, token: string | undefined): { servers: T; withheld: string[] } {
  const out: Record<string, McpServerSpec> = {};
  const withheld: string[] = [];
  for (const [name, spec] of Object.entries(servers)) {
    if (!isGithubMcpServer(spec)) {
      out[name] = spec;
      continue;
    }
    if (!token) {
      withheld.push(name);
      continue;
    }
    if (readsGithubToken(spec)) {
      out[name] = withGithubToken({ [name]: spec }, token)[name]!;
      continue;
    }
    if (!("url" in spec)) {
      // unreachable: a command is a GitHub server only through its placeholder
      withheld.push(name);
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(spec.headers ?? {})) if (key.toLowerCase() !== "authorization") headers[key] = value;
    headers.Authorization = `Bearer ${token}`;
    out[name] = { ...spec, headers };
  }
  return { servers: out as T, withheld };
}

/** The one line a turn's prompt carries when a GitHub server was left out:
 * the bot says the person has no GitHub connection, never borrows one. */
export function githubWithheldPrompt(withheld: readonly string[]): string {
  if (!withheld.length) return "";
  return ` GitHub: the person you work for has no GitHub connection of their own, so ${withheld.map((name) => `"${name}"`).join(", ")} is not available in this conversation. For anything on GitHub, tell them to click "Connect GitHub" on the GitHub plugin's page (Capabilities > Sources > GitHub connection); never use anyone else's GitHub access.`;
}
