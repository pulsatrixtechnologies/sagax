// Fill a vault field into the computer's focused form control. The bot names
// a handle only; Sagax resolves the value, types it, and never returns it.
// Same redaction guard as the browser path (server/filled-secret-guard.ts).
import { botVaultPrincipal, isVaultFillField, type VaultFillField } from "../shared/credential-vault.ts";
import { LOGIN_MODE, REDACTED_CREDENTIAL, type FillRequest } from "./credential-fill.ts";
import type { CredentialVault, FillResolution, OnePasswordFieldReader } from "./credential-vault.ts";
import { noteFilledSecret } from "./filled-secret-guard.ts";

export const COMPUTER_FILL_CREDENTIAL_TOOL = "fill_credential";

export const COMPUTER_FILL_CREDENTIAL_TOOL_SPEC = {
  name: COMPUTER_FILL_CREDENTIAL_TOOL,
  description:
    "Fill a login the person (or this team bot's managers) saved in Sagax into the focused form field on the computer, without ever seeing it. credential is the handle request_login gave you (cred_...). field is username, password, totp, apiKey, or a card/contact/address field after a purchase approval. Sagax types the value into the focused control; you never receive it. Prefer this over type_text for any secret.",
  inputSchema: {
    type: "object",
    properties: {
      credential: { type: "string", description: "The handle request_login gave you, cred_..." },
      field: { type: "string", description: "Which saved field to type." },
    },
    required: ["credential", "field"],
    additionalProperties: false,
  },
} as const;

export type TypeSecret = (value: string) => Promise<void> | void;

export type ComputerFillAccess = {
  resolveComputer(request: { handle: string; field: VaultFillField }): Promise<
    { ok: true; value: string; label: string } | { ok: false; message: string; code: string }
  >;
};

/** Parse fill_credential arguments for the computer surface. Login mode is
 * browser-only (multi-step pages); on the computer fill one field at a time. */
export function parseComputerFillArguments(params: unknown): FillRequest | string {
  const args = (params as { arguments?: unknown } | null)?.arguments ?? params;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "fill_credential needs credential and field.";
  const { credential, field } = args as Record<string, unknown>;
  if (typeof credential !== "string" || !credential.trim()) return "fill_credential needs the credential handle request_login gave you.";
  if (field === LOGIN_MODE) return "On the computer, fill one field at a time (username, password, totp). field login is for the browser.";
  if (!isVaultFillField(field)) return `field must be a saved vault field, not ${String(field)}.`;
  return { credential: credential.trim(), field };
}

/** Resolve from the team bot vault first, then the person's vault. */
export function computerFillResolverFor(
  vault: CredentialVault,
  context: { principalId: string; botId: string; threadId: string },
  readOnePassword?: OnePasswordFieldReader,
): ComputerFillAccess {
  const teamPrincipal = botVaultPrincipal(context.botId);
  const labelOf = (resolved: Extract<FillResolution, { ok: true }>) =>
    resolved.item.source === "1password" ? "a 1Password login" : resolved.item.name;
  return {
    async resolveComputer(request) {
      const fromTeam = await vault.resolveForComputerFill(teamPrincipal, { ...request, botId: context.botId, threadId: context.threadId }, readOnePassword);
      if (fromTeam.ok) return { ok: true as const, value: fromTeam.value, label: labelOf(fromTeam) };
      if (fromTeam.code !== "unknown_item" && fromTeam.code !== "unavailable") {
        return { ok: false as const, message: fromTeam.message, code: fromTeam.code };
      }
      const resolved = await vault.resolveForComputerFill(context.principalId, { ...request, botId: context.botId, threadId: context.threadId }, readOnePassword);
      return resolved.ok
        ? { ok: true as const, value: resolved.value, label: labelOf(resolved) }
        : { ok: false as const, message: resolved.message, code: resolved.code };
    },
  };
}

/** Type a vault field into the focused control. The tool result never
 * contains the value (only the label and field). */
export async function fillComputerField(
  access: ComputerFillAccess,
  request: FillRequest,
  typeSecret: TypeSecret,
): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const resolved = await access.resolveComputer({ handle: request.credential, field: request.field });
  if (!resolved.ok) return { ok: false, text: resolved.message };
  noteFilledSecret(resolved.value);
  try {
    await typeSecret(resolved.value);
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "The computer could not type the field." };
  }
  return {
    ok: true,
    text: `Filled ${request.field} from "${resolved.label}" into the focused field. The value is ${REDACTED_CREDENTIAL}; it never appears here.`,
  };
}
