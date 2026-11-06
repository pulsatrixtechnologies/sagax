// Custom secrets a bot asks for on the secure card: a one-use ref for Sagax tools, or a private file for the bot's commands.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CUSTOM_SECRET_LABEL_MAX,
  CUSTOM_SECRET_REASON_MAX,
  CUSTOM_SECRET_TARGET,
  SECRET_DELIVERIES,
  type SecretDelivery,
} from "../../shared/credential-request.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { addHeldSecretScrubber } from "../../shared/redact.ts";
import { SECRET_VALUE_MAX_BYTES, SecretVault, type SavedSecret, type SecretFileHome } from "../secret-vault.ts";

export type { SavedSecret, SecretFileHome };

const SWEEP_MS = 10 * 60 * 1000;

/** What the bot is told a saved custom secret is, and how to use it without ever seeing or showing the value. */
export function savedSecretText(label: string, saved: SavedSecret | null): string {
  if (!saved) {
    return `The person saved ${label}, but it expired or Sagax restarted before you used it. Ask again with request_credential if you still need it.`;
  }
  if ("ref" in saved) {
    return `The person saved ${label} as ${saved.ref}. Put it in an add_mcp_server env, header or oauth.clientSecret value, alone or inside text such as "Bearer ${saved.ref}": Sagax swaps in the value. It works once, only for you in this conversation, for an hour, and you never see the value.`;
  }
  return `The person saved ${label} to the file ${saved.file}. Read it only inside a command, such as TOKEN="$(cat '${saved.file}')"; never print, echo, log or copy it anywhere else. It is deleted after 24 hours.`;
}

export function deliveryNote(botName: string, delivery: SecretDelivery): string {
  return delivery === "file"
    ? `${botName}'s commands can read it from a private file for 24 hours; it is never added to chat.`
    : `${botName} gets a one-use reference for Sagax's own tools and never sees it.`;
}

export function parseCustomSecretRequest(body: Record<string, unknown>):
  | { label: string; reason: string; placeholder: string; delivery: SecretDelivery }
  | { error: string } {
  const text = (value: unknown, max: number) => typeof value === "string"
    ? [...value].map((ch) => (ch.charCodeAt(0) < 0x20 || ch === "\u007f" ? " " : ch)).join("").trim().slice(0, max)
    : "";
  const label = text(body.label, CUSTOM_SECRET_LABEL_MAX);
  const reason = text(body.reason ?? body.reasonLine, CUSTOM_SECRET_REASON_MAX);
  if (!label) return { error: "request_credential needs credential_id for a key Sagax keeps, or label for any other secret." };
  if (!reason) return { error: "request_credential needs reason: one short line on what the secret is for and where the person finds it." };
  if (!SECRET_DELIVERIES.includes(body.delivery as SecretDelivery)) {
    return { error: "request_credential needs delivery: ref for Sagax's own tools such as add_mcp_server, or file for your own commands." };
  }
  return { label, reason, placeholder: text(body.placeholder, CUSTOM_SECRET_LABEL_MAX), delivery: body.delivery as SecretDelivery };
}

export function isCustomSecret(secret: Pick<SecretRequestCardData, "target"> | undefined | null): boolean {
  return secret?.target === CUSTOM_SECRET_TARGET;
}

export function createCustomSecretVault(deps: {
  dataDir: string;
  savedAt: (threadId: string, messageId: string) => number | null;
  threadExists: (threadId: string) => boolean;
  onChange?: (listener: (change: { type: string }) => void) => void;
}): SecretVault & {
  storeCustom: (owner: { botId: string; threadId: string }, messageId: string, secret: SecretRequestCardData, value: string, home: SecretFileHome) => SavedSecret;
  redeemMcpServer: <T>(body: T, botId: string, threadId: string) => ReturnType<SecretVault["redeem"]>;
} {
  const vault = new SecretVault();
  addHeldSecretScrubber((text) => vault.scrub(text));

  const sweepBases = (): string[] => {
    const under = (folder: string) => {
      try {
        return readdirSync(folder).map((name) => join(folder, name));
      } catch {
        return [];
      }
    };
    return [...under(join(deps.dataDir, "workspaces")), join(deps.dataDir, "vm-home"), ...under(join(deps.dataDir, "vm-homes"))];
  };
  const sweep = () => {
    try {
      vault.sweep(sweepBases(), deps.savedAt, deps.threadExists);
    } catch (error) {
      console.warn(`secret files: sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  sweep();
  setInterval(sweep, SWEEP_MS).unref();
  deps.onChange?.((change) => {
    if (change.type === "thread.deleted" || change.type === "bot.deleted" || change.type === "group.deleted") sweep();
  });

  return Object.assign(vault, {
    storeCustom(owner: { botId: string; threadId: string }, messageId: string, secret: SecretRequestCardData, value: string, home: SecretFileHome): SavedSecret {
      if (secret.delivery === "file") {
        const file = vault.saveFile(owner, messageId, value, home);
        return { file };
      }
      const ref = vault.saveRef(owner, messageId, secret.label, value);
      return { ref };
    },
    redeemMcpServer<T>(body: T, botId: string, threadId: string) {
      return vault.redeem(
        body,
        { botId, threadId },
        (path) =>
          (path.length === 2 && (path[0] === "env" || path[0] === "headers"))
          || (path.length === 2 && path[0] === "oauth" && path[1] === "clientSecret"),
        "add_mcp_server's env, headers and oauth.clientSecret",
      );
    },
  });
}

export { SECRET_VALUE_MAX_BYTES, CUSTOM_SECRET_TARGET };
