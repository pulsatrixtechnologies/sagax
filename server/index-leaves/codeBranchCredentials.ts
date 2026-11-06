// @ts-nocheck
/** codeBranchCredentials (#1388). Pure move from server/index.ts. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
export type Host = Record<string, any>;

export function createCodeBranchCredentials(getHost: () => Host): any {
function codeBranchCredentials(viewerId: string | undefined) {
  const host = getHost();
  const { DATA_DIR, githubGitEnvironment, personDisplayName } = host;
  if (host.IDENTITY.kind !== "perspicax") return { git: {}, publish: { push: {}, gh: {} } };
  // An organization server: nothing of the server's own git or gh (no home,
  // global or system config, credential helper or ssh key). The route
  // refuses a request with no person before this.
  const home = join(DATA_DIR, "code-branches", "home-empty");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const git: Record<string, string> = {
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_SSH_COMMAND: "false",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: ""
  };
  if (!viewerId) return { isolated: true, git };
  const person = host.principals.byId(viewerId);
  const connection = host.usablePersonGithub(viewerId);
  const name = personDisplayName(person) || connection?.login || "";
  const email = person?.email?.trim();
  const author = name && email ? { author: { name, email } } : {};
  if (!connection?.token) return { isolated: true, git, ...author };
  // The token rides the push call only, as an extra header scoped to github.com.
  const header = githubGitEnvironment(connection.token);
  return {
    isolated: true,
    git,
    ...author,
    publish: {
      push: { GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_1: header.GIT_CONFIG_KEY_0!, GIT_CONFIG_VALUE_1: header.GIT_CONFIG_VALUE_0! },
      // gh gets a fresh empty home and config folder per call (server/code-branches.ts).
      gh: { GH_TOKEN: connection.token, GH_HOST: "github.com" }
    }
  };

}
  return codeBranchCredentials;
}
