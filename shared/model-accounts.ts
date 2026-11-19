// M-20261119-015 (the owner, 2026-11-19: "I added multiple accounts but I
// don't see what model comes from what account. My other account has
// Defense access, so models should be identified as such."): a person's
// accounts of one provider each list their own models (the provider's live
// list for that account, server/drivers/claude/account-models.ts). Said
// once here, for the desktop menu, the provider catalog (the phone, bots)
// and the chip: the words that name an account, and the one account of
// several that offers a model, which earns the "Special access" badge.
//
// Where the badge comes from: Anthropic's model list carries no access
// attribute (its rows: id, display_name, created_at, max_input_tokens,
// max_tokens, capabilities, line, lifecycle, deprecated_at, retires_at), and
// Claude Code's bootstrap answers `model_access: null` on an account that
// lists Mythos as on one that does not. So the badge is never read from a
// field: a model only one of the person's sign-in accounts offers is that
// account's special access. Never guessed from a name.
import { HARNESS_TOOL_NAME } from "./harness-matrix.ts";

/** The badge's words (English source; the apps translate them). */
export const SPECIAL_ACCESS_LABEL = "Special access";

const TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(HARNESS_TOOL_NAME).map((name) => name.toLowerCase()));

/** A tool's own name (Codex, Claude Code, the xAI tool) never names an
 * account: the account's address, else the provider, does (#4329 C). */
export function isToolName(name: string): boolean {
  return TOOL_NAMES.has(name.trim().toLowerCase());
}

export interface AccountWordsFacts {
  /** The name the person gave the account in Providers (or the engine's own). */
  displayName?: string;
  /** The account's sign-in address, when the engine says it. */
  email?: string;
}

/** The words that name an account where its models show: the name the
 * person gave it in Providers, else its sign-in address. Undefined when it
 * has neither (the apps number it, "Account 2", as Providers does): never
 * the provider's name again nor a tool's. */
export function accountWords(account: AccountWordsFacts, providerLabel: string): string | undefined {
  const name = account.displayName?.trim() ?? "";
  if (name && name.toLowerCase() !== providerLabel.trim().toLowerCase() && !isToolName(name)) return name;
  return account.email?.trim() || undefined;
}

/** The account a model comes from alone: among two or more accounts of the
 * person, the one that offers it when no other does. Undefined with a single
 * account (nothing to tell apart) or when several offer it. */
export function onlyAccountOffering(offeredBy: Iterable<string>, accounts: Iterable<string>): string | undefined {
  const all = new Set(accounts);
  if (all.size < 2) return undefined;
  const offering = new Set([...offeredBy].filter((instanceId) => all.has(instanceId)));
  return offering.size === 1 ? [...offering][0] : undefined;
}
