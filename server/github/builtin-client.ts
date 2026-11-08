// Sagax's own GitHub OAuth App (Pulsatrix), built in so "Connect GitHub"
// is always GitHub's link plus a code to type, with no setup on any server
// (owner, 2026-11-08: "every github connection should be done with a link and
// the code to enter"). A client id is public: it is not a secret. The
// organization's own OAuth App (Settings > Developer, organization.githubClientId)
// and SAGAX_GITHUB_CLIENT_ID stay optional overrides.

// The client id of the Pulsatrix GitHub OAuth App, with Enable Device Flow on.
export const BUILTIN_GITHUB_CLIENT_ID = "Ov23liC8fXnxILAQ1Dz2";

/** The client id the device flow uses: the organization's, else the
 * server's environment, else the built-in one. Undefined when none is set. */
export function resolveGithubClientId(
  organization: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  builtin: string = BUILTIN_GITHUB_CLIENT_ID,
): string | undefined {
  return organization?.trim() || env.SAGAX_GITHUB_CLIENT_ID?.trim() || builtin.trim() || undefined;
}
