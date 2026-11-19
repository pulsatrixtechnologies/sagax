// #4973: one switch for the engines that read an account's model list live
// from its provider (Claude's /v1/models). On by default; the test setup
// turns it off so no test reaches a real account or the macOS keychain.
export const LIVE_MODEL_LISTS_DISABLE_ENV = "SAGAX_DISABLE_LIVE_MODEL_LISTS";

export function liveModelListsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_MODEL_LISTS_DISABLE_ENV] !== "1";
}
