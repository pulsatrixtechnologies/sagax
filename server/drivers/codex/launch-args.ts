/** Launch argv helpers for Codex app-server turns. */
import { existsSync, mkdirSync } from "node:fs";
import type { ProviderSnapshot, TurnAccessInput } from "../../contracts.ts";
import { splitCliString } from "../../env-path.ts";
import { codexVersionBehind, readLatestCodexRelease } from "../codex-release.ts";
import { plainRecord } from "./plain.ts";
import type { CodexConfig } from "./config.ts";

/** Ask the configured executable to update itself. This matters when the user
 * selected a non-PATH Codex: installing a second global copy would leave
 * Sagax pointing at the old binary. */
export function codexUpdateCommand(cli: string, platform: NodeJS.Platform = process.platform): string {
  if (cli === "codex") return "codex update";
  const trimmed = cli.trim();
  // Match resolveCliSpawn's one tokenizer pass, including its exception for
  // real unquoted paths containing spaces. A wrapper's fixed arguments must
  // precede `update`, just as they precede `app-server` and `--version`.
  const tokens = trimmed.includes(" ") && existsSync(trimmed)
    ? [trimmed]
    : splitCliString(trimmed);
  const quote = platform === "win32"
    ? (token: string) => `'${token.replaceAll("'", "''")}'`
    : (token: string) => `'${token.replaceAll("'", `'\\''`)}'`;
  const command = (tokens.length > 0 ? tokens : [trimmed]).map(quote).join(" ");
  return platform === "win32" ? `& ${command} update` : `${command} update`;
}

export async function codexReleaseUpdate(version: string, cli: string): Promise<ProviderSnapshot["update"] | undefined> {
  const latest = await readLatestCodexRelease();
  if (!latest || !codexVersionBehind(version, latest)) return undefined;
  return {
    title: `Update Codex to ${latest}`,
    message: `A newer stable Codex CLI is available (installed: ${version}). Update it, then refresh models. Model availability also depends on your signed-in account.`,
    command: codexUpdateCommand(cli),
  };
}

/** The documented token-sharing Responses bridge carries no hosted
 * tool_search (#2035 verified Codex 0.159.0 sends none), so a plan turn's
 * MCP tools are all loaded up front. Its URL servers go through the remote
 * proxy's tool directory instead (mcp-directory.ts). */
export function chatgptPlanCodexArgs(): string[] {
  return [
    "-c", 'model_provider="openai_chatgpt_plan"',
    "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
    "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
    "-c", 'model_providers.openai_chatgpt_plan.env_key="SAGAX_CHATGPT_TOKEN"',
    "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
    "-c", "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
    "-c", "model_providers.openai_chatgpt_plan.supports_websockets=false",
    "-c", 'cli_auth_credentials_store="ephemeral"',
    "-c", "features.tool_search=false",
    "-c", "shell_environment_policy.ignore_default_excludes=false",
    // SAGAX_CHATGPT_TOKEN is excluded on the thread, in the policy's
    // own representation (extendShellExclusions): a `-c exclude` here would
    // replace the lower layers' list and drop their filters.
  ];
}

export function managedCodexArgs(config: NonNullable<CodexConfig["managed"]>): string[] {
  // Credential stays in the instance environment, never argv or config.toml.
  // https://learn.chatgpt.com/docs/config-file/config-reference
  return [
    "-c", 'model_provider="openmaus_company"',
    "-c", 'model_providers.openmaus_company.name="Company"',
    "-c", `model_providers.openmaus_company.base_url=${JSON.stringify(config.url)}`,
    "-c", 'model_providers.openmaus_company.env_key="SAGAX_COMPANY_API_KEY"',
    "-c", 'model_providers.openmaus_company.wire_api="responses"',
    "-c", "model_providers.openmaus_company.requires_openai_auth=false",
    "-c", 'cli_auth_credentials_store="ephemeral"',
    "-c", "shell_environment_policy.ignore_default_excludes=false",
  ];
}

/** Slice 4: a turn on the bot owner's own OpenAI key (kept in Perspicax,
 * read for this turn only). Same shape as managedCodexArgs: the key rides in
 * SAGAX_OWNER_OPENAI_API_KEY in the child environment, never argv or a file,
 * and no login is stored. */
export function ownerKeyCodexArgs(): string[] {
  return [
    "-c", 'model_provider="pulsa_owner"',
    "-c", 'model_providers.pulsa_owner.name="Owner key"',
    "-c", 'model_providers.pulsa_owner.base_url="https://api.openai.com/v1"',
    "-c", 'model_providers.pulsa_owner.env_key="SAGAX_OWNER_OPENAI_API_KEY"',
    "-c", 'model_providers.pulsa_owner.wire_api="responses"',
    "-c", "model_providers.pulsa_owner.requires_openai_auth=false",
    "-c", 'cli_auth_credentials_store="ephemeral"',
    "-c", "shell_environment_policy.ignore_default_excludes=false",
  ];
}

/** The child environment and provider args one turn's credentials call for. */
export function codexAccessLaunch(env: Record<string, string | undefined>, access: TurnAccessInput | undefined): { ownerKey: boolean } {
  if (!access) return { ownerKey: false };
  if (access.via === "subscription" && access.codexHome) {
    env.CODEX_HOME = access.codexHome;
    return { ownerKey: false };
  }
  if ((access.via === "owner-key" || access.via === "speaker-key") && access.codexOwnerKey && access.environment?.SAGAX_OWNER_OPENAI_API_KEY) {
    if (access.codexHome) {
      mkdirSync(access.codexHome, { recursive: true, mode: 0o700 });
      env.CODEX_HOME = access.codexHome;
    }
    env.SAGAX_OWNER_OPENAI_API_KEY = access.environment.SAGAX_OWNER_OPENAI_API_KEY;
    return { ownerKey: true };
  }
  return { ownerKey: false };
}

/** What a guest-driven turn's app-server starts with: the shell, unified
 * exec and image reads off (codex-cli 0.159.0 `features`). 2026-10-28: web
 * search stays, from OpenAI's cached index (`web_search="cached"`): it runs
 * on OpenAI's side, never on this machine, and opens no live page a guest's
 * words could point at another site. */
export const GUEST_CONFINED_CODEX_ARGS = [
  "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.view_image=false", "-c", 'web_search="cached"',
] as const;

/** Whether the effective config (config/read) shows the shell turned off. */
export function codexShellDisabled(config: unknown): boolean {
  const features = plainRecord(plainRecord(config)?.features);
  return features?.shell_tool === false && features?.unified_exec === false && features?.view_image === false;
}
