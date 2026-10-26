// Reading a private GitHub repository for a bot's plugins and skills.
//
// Which credential, in order: the token saved for this marketplace on this
// bot (server/marketplace-tokens.ts), the acting person's own GitHub
// connection (Connect apps > Personal, server/github-connect.ts), then the
// organization's GitHub tokens (Settings > Organization > Plugins and
// GitHub). Before a clone, GET /repos/{owner}/{repo} on api.github.com
// tells which one reads the repository and, when none does, why: GitHub
// answers 404 for a private repository it will not show, 401 for a bad
// token, 403 with `x-github-sso` when the organization's SAML sign-on has
// not authorized the token, and 403 or 429 with `x-ratelimit-remaining: 0`
// at its rate limit. Each cause has its own message and fix.
//
// A token is only ever sent to GitHub's own hosts, in a header, never in a
// URL, an argv, a file or a log line.
import { githubOrigins, githubTokenKind } from "./github-connect.ts";

export type GithubCredentialVia = "marketplace" | "person" | "organization";

export interface GithubCredential {
  token: string;
  via: GithubCredentialVia;
  /** The organization token's label, for messages. Never the token. */
  label?: string;
  /** The person's GitHub login (via "person"): tells a repository of their
   * own account from one of an organization the token may not cover. */
  login?: string;
}

export type GithubAccessCode =
  | "private_needs_token"
  | "not_found_or_no_access"
  | "bad_token"
  | "sso_required"
  | "rate_limited"
  | "forbidden"
  | "org_not_covered";

/** What the person can do about it. */
export type GithubAccessFix = "connect_or_token" | "check_access" | "replace_token" | "authorize_sso" | "wait" | "token_scope" | "reconnect_with_orgs";

export interface GithubAccessFailure {
  code: GithubAccessCode;
  /** The status this server answers with. */
  status: number;
  message: string;
  fix: GithubAccessFix;
  /** GitHub's own link to authorize the token for the organization. */
  ssoUrl?: string;
  /** Epoch ms when the rate limit resets. */
  resetAt?: number;
  /** The organization the person's token does not cover (org_not_covered). */
  organization?: string;
}

const VIA_TEXT: Record<GithubCredentialVia, string> = {
  marketplace: "this marketplace's token",
  person: "your GitHub connection",
  organization: "the organization's GitHub token",
};

/** The failure a GitHub answer means, or null when it is not one. */
export function githubAccessFailure(
  response: { status: number; headers: Headers },
  repo: string,
  credential: GithubCredential | null,
  context: "marketplace" | "skill" = "marketplace",
): GithubAccessFailure | null {
  const { status, headers } = response;
  if (status >= 200 && status < 300) return null;
  const remaining = headers.get("x-ratelimit-remaining");
  if ((status === 403 || status === 429) && remaining === "0") {
    const reset = Number(headers.get("x-ratelimit-reset"));
    const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined;
    const until = resetAt ? ` until ${new Date(resetAt).toISOString().slice(11, 16)} UTC` : "";
    return {
      code: "rate_limited", status: 429, fix: "wait", ...(resetAt ? { resetAt } : {}),
      message: `GitHub's rate limit is reached (${status})${until}. Try again later${credential ? "" : ", or connect GitHub in Connect apps so requests use your own limit"}.`,
    };
  }
  const sso = headers.get("x-github-sso");
  if (status === 403 && sso) {
    const url = /url=(https:\/\/github\.com\/[^\s;,]+)/.exec(sso)?.[1];
    return {
      code: "sso_required", status: 403, fix: "authorize_sso", ...(url ? { ssoUrl: url } : {}),
      message: `The organization that owns ${repo} requires SAML single sign-on: ${credential ? VIA_TEXT[credential.via] : "the token"} is not authorized for it (403). Authorize the token for the organization on GitHub${url ? ` (${url})` : ""}, then try again.`,
    };
  }
  if (status === 401) {
    return {
      code: "bad_token", status: 422, fix: "replace_token",
      message: `GitHub refused ${credential ? VIA_TEXT[credential.via] : "the token"} (401): it is wrong, expired or revoked. Replace it, then try again.`,
    };
  }
  // The person's own connection refused on a repository of another owner:
  // say it does not cover that organization instead of a bare 404 or 403.
  // A fine-grained token reaches one owner only; an OAuth token may lack
  // read:org or the organization's approval of the OAuth App.
  const owner = /^([^/\s]+)\//.exec(repo)?.[1];
  if ((status === 404 || (status === 403 && !headers.get("retry-after"))) && credential?.via === "person" && credential.login && owner && owner.toLowerCase() !== credential.login.toLowerCase()) {
    const why = githubTokenKind(credential.token) === "fine_grained"
      ? "a fine-grained token reaches one owner only (your own account)"
      : "the organization has not granted it access, or it lacks the read:org and repo scopes";
    return {
      code: "org_not_covered", status: 422, fix: "reconnect_with_orgs", organization: owner,
      message: `Your GitHub token does not cover the organization ${owner} (GitHub answered ${status} for ${repo}): ${why}. Reconnect GitHub with access to organizations (Connect apps > GitHub), or check the address.`,
    };
  }
  if (status === 404) {
    if (!credential) {
      return {
        code: "private_needs_token", status: 422, fix: "connect_or_token",
        message: `GitHub answered 404 for ${repo}: it is private, or it does not exist. Connect your GitHub account in Connect apps (Personal), ${context === "marketplace" ? "or add a token for this marketplace" : "or ask an administrator for an organization GitHub token"}.`,
      };
    }
    return {
      code: "not_found_or_no_access", status: 422, fix: "check_access",
      message: `GitHub answered 404 for ${repo} with ${VIA_TEXT[credential.via]}: the address is wrong, or this token cannot read the repository. Check the address, or use a token with read access to it (Contents: read).`,
    };
  }
  if (status === 403) {
    return {
      code: "forbidden", status: 403, fix: "token_scope",
      message: `GitHub refused to show ${repo} (403) to ${credential ? VIA_TEXT[credential.via] : "this server"}: the token lacks read access (Contents: read, or the repo scope).`,
    };
  }
  return null;
}

/** Most telling first: what the person must fix before anything else. */
const RANK: Record<GithubAccessCode, number> = {
  sso_required: 0, bad_token: 1, org_not_covered: 2, forbidden: 3, not_found_or_no_access: 4, rate_limited: 5, private_needs_token: 6,
};

export type GithubProbe =
  | { ok: true; credential: GithubCredential | null }
  /** GitHub could not be asked (offline, a stand-in host): clone and see. */
  | { ok: "unknown"; credential: GithubCredential | null }
  | { ok: false; failure: GithubAccessFailure };

/** Which credential reads `owner/repo`, trying each in order, then none. */
export async function probeGithubRepo(
  repo: { owner: string; repo: string },
  credentials: readonly GithubCredential[],
  options: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<GithubProbe> {
  const fetcher = options.fetch ?? fetch;
  const api = githubOrigins(options.env ?? process.env).api;
  const name = `${repo.owner}/${repo.repo}`;
  const url = `${api}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  const failures: GithubAccessFailure[] = [];
  // Each credential, then none: a public repository reads without one.
  const tries: Array<GithubCredential | null> = [...credentials, null];
  for (const credential of tries) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: {
          accept: "application/vnd.github+json", "user-agent": "Sagax", "x-github-api-version": "2022-11-28",
          ...(credential ? { authorization: `Bearer ${credential.token}` } : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: "unknown", credential: credentials[0] ?? null };
    }
    await response.body?.cancel().catch(() => undefined);
    const failure = githubAccessFailure(response, name, credential);
    if (!failure) {
      if (response.status >= 200 && response.status < 300) return { ok: true, credential };
      return { ok: "unknown", credential: credential ?? credentials[0] ?? null };
    }
    failures.push(failure);
  }
  // Every credential tried and refused: an unauthenticated limit is not a
  // verdict on the repository (git is not rate limited the same way).
  failures.sort((a, b) => RANK[a.code] - RANK[b.code]);
  const worst = failures[0]!;
  if (worst.code === "rate_limited" && !credentials.length) return { ok: "unknown", credential: null };
  return { ok: false, failure: worst };
}

const GITHUB_HOSTS = new Set(["github.com", "api.github.com", "raw.githubusercontent.com", "codeload.github.com", "objects.githubusercontent.com"]);

function hostOf(input: Parameters<typeof fetch>[0]): string {
  try {
    return new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname;
  } catch {
    return "";
  }
}

/** A fetch for skill imports: on GitHub's hosts it tries each credential in
 * turn until one is not refused (401, 403 or 404), and remembers the one
 * that worked for the rest of the import. Other hosts get no token. */
export function githubCredentialFetch(credentials: readonly GithubCredential[], fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): typeof fetch & { used(): GithubCredential | null } {
  let chosen: GithubCredential | null = null;
  const apiHost = hostOf(githubOrigins(env).api);
  const run = (async (input, init) => {
    const host = hostOf(input);
    if ((!GITHUB_HOSTS.has(host) && host !== apiHost) || !credentials.length) return fetcher(input, init);
    const order = chosen ? [chosen, ...credentials.filter((entry) => entry !== chosen)] : [...credentials];
    let last: Response | null = null;
    for (const credential of order) {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${credential.token}`);
      const response = await fetcher(input, { ...init, headers });
      if (response.status !== 401 && response.status !== 403 && response.status !== 404) {
        chosen = credential;
        return response;
      }
      if (last) await last.body?.cancel().catch(() => undefined);
      last = response;
    }
    // A public repository reads without a token, even a refused one.
    const bare = await fetcher(input, init);
    if (bare.ok) {
      await last?.body?.cancel().catch(() => undefined);
      return bare;
    }
    await bare.body?.cancel().catch(() => undefined);
    return last!;
  }) as typeof fetch & { used(): GithubCredential | null };
  run.used = () => chosen;
  return run;
}

export class GithubAccessError extends Error {
  readonly failure: GithubAccessFailure;
  constructor(failure: GithubAccessFailure) {
    super(failure.message);
    this.name = "GithubAccessError";
    this.failure = failure;
  }
}

/** The skill importer's fetch: credentials as above, and a refusal from
 * GitHub's API becomes its real cause instead of "GitHub API 404". */
export function githubSkillFetch(credentials: readonly GithubCredential[], fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): typeof fetch {
  const inner = githubCredentialFetch(credentials, fetcher, env);
  const apiHost = hostOf(githubOrigins(env).api);
  return async (input, init) => {
    const response = await inner(input, init);
    const host = hostOf(input);
    if (response.ok || (host !== apiHost && host !== "api.github.com")) return response;
    const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
    const repo = /^\/repos\/([^/]+)\/([^/]+)/.exec(path);
    const failure = githubAccessFailure(response, repo ? `${decodeURIComponent(repo[1]!)}/${decodeURIComponent(repo[2]!)}` : "this repository", inner.used() ?? credentials[0] ?? null, "skill");
    if (!failure) return response;
    await response.body?.cancel().catch(() => undefined);
    throw new GithubAccessError(failure);
  };
}
