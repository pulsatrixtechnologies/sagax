// @ts-nocheck
/** syncGithubToSandbox (#1388). Pure move from server/index.ts. */
import { githubSandboxArgv } from "../github/github-connect.ts";
export type Host = Record<string, any>;

export function createSyncGithubToSandbox(getHost: () => Host): any {
async function syncGithubToSandbox(principalId: string, connection: { token: string; login: string } | null, botId?: string, previous?: { token: string; login: string } | null) {
  const host = getHost();

  if (!host.userSandbox) return false;
  try {
    // Never over a sign-in the person made in the environment (gh auth login): see githubSandboxArgv.
    const { argv, env } = githubSandboxArgv(connection, previous);
    const result = await host.userSandbox.exec(principalId, { argv, env, timeoutSec: 30, maxOutputBytes: 4096 }, botId);
    return result.exitCode === 0;
  } catch (error) {
    console.warn(`[github] server environment not updated: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

}
  return syncGithubToSandbox;
}
