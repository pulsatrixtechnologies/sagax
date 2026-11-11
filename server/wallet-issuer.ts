// One-time cards from the wallet the person already has (2026-10-29): Shop
// Pay or Link, through that wallet's own command line tool, signed in as the
// person on this computer. Sagax asks only after the person (or their
// Primary Bot, at their request) allowed the purchase, and only when the
// bot fills the card fields on the merchant's page.
//
//   link-cli spend-request create --merchant-name M --merchant-url U
//     --context C --amount <minor units> --currency <iso> --request-approval
//     --format json                                -> { id, status }
//   link-cli spend-request retrieve <id> --interval 2 --max-attempts N
//     --format json                                -> { status }
//   link-cli spend-request retrieve <id> --include card
//     --output-file <0600 file> --format json      -> card in the file only
//
// Shop Pay's CLI (`shop`) takes the same spend-request commands. The card is
// read from the 0600 file the CLI writes (never from its output, which shows
// only brand and last four), the file is removed at once, and the card stays
// in this process's memory for that one purchase. Nothing here logs,
// returns to a bot or journals a number.
import { execChild } from "./process/spawn-helper.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import type { SingleUseWallet } from "../shared/single-use-card.ts";

export interface IssuedCard {
  pan: string;
  cvc: string;
  expMonth: number;
  expYear: number;
  holder?: string;
}

export type IssueOutcome =
  | { ok: true; card: IssuedCard }
  /** waiting: the wallet asked the person to approve on their own device;
   * the same request is checked again at the next fill. */
  | { ok: false; code: "provider_unconfigured" | "not_signed_in" | "waiting" | "declined" | "failed"; detail: string };

export interface WalletStatus {
  installed: boolean;
  signedIn: boolean;
}

export interface WalletIssueRequest {
  /** The approved purchase this card is for (one card per purchase). */
  purchaseId: string;
  merchant: string;
  domain: string;
  /** Major units as approved ("12.50"). */
  amount: string;
  currency: string;
  items?: ReadonlyArray<{ name: string; quantity: number; price?: string }>;
}

export interface WalletIssuer {
  status(wallet: SingleUseWallet, principalId: string): Promise<WalletStatus>;
  issue(wallet: SingleUseWallet, principalId: string, request: WalletIssueRequest): Promise<IssueOutcome>;
}

/** Runs one command; resolves stdout, rejects with the exit (no output kept). */
export type CommandRunner = (bin: string, args: string[], options: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<string>;

const BIN: Record<SingleUseWallet, string> = { shop_pay: "shop", link: "link-cli" };
/** ISO 4217 currencies without minor units: the amount is passed as is. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const APPROVED = new Set(["approved"]);
const WAITING = new Set(["created", "pending_approval", "requires_action"]);

/** "12.50" CAD is 1250; "1200.00" JPY is 1200. Null when it does not read. */
export function minorUnits(amount: string, currency: string): number | null {
  const match = /^(\d{1,6})\.(\d{2})$/.exec(amount);
  if (!match) return null;
  if (ZERO_DECIMAL.has(currency.toUpperCase())) return Number(match[1]);
  return Number(match[1]) * 100 + Number(match[2]);
}

function oneLine(value: string, max: number): string {
  // a card-like run never goes to the wallet's own record either
  return value.replace(/(?:\d[\s.\-_/]*){13,19}/g, " ").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The wallet asks for at least 100 characters of context. */
export function spendContext(request: WalletIssueRequest): string {
  const items = (request.items ?? []).slice(0, 5).map((item) => `${item.quantity} x ${oneLine(item.name, 60)}`).join(", ");
  return oneLine(
    `The person approved this purchase in Sagax: ${request.amount} ${request.currency.toUpperCase()} at ${request.merchant} (${request.domain})` +
      `${items ? ` for ${items}` : ""}. Their own assistant completes the checkout on that page with this one-time card, once.`,
    900,
  );
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function cardFrom(raw: unknown): IssuedCard | null {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const card = row && typeof row.card === "object" && row.card ? row.card as Record<string, unknown> : row;
  if (!card) return null;
  const pan = String(card.number ?? "").replace(/\D/g, "");
  const cvc = String(card.cvc ?? "").replace(/\D/g, "");
  const expMonth = Number(card.exp_month);
  let expYear = Number(card.exp_year);
  if (expYear > 0 && expYear < 100) expYear += 2000;
  if (!/^\d{13,19}$/.test(pan) || !/^\d{3,4}$/.test(cvc) || !(expMonth >= 1 && expMonth <= 12) || !(expYear >= 2000 && expYear <= 2100)) return null;
  const billing = card.billing_address && typeof card.billing_address === "object" ? card.billing_address as Record<string, unknown> : null;
  const holder = typeof card.name === "string" ? card.name : typeof billing?.name === "string" ? billing.name : "";
  return { pan, cvc, expMonth, expYear, ...(holder.trim() ? { holder: holder.trim().slice(0, 80) } : {}) };
}

const defaultRunner: CommandRunner = (bin, args, options) => new Promise((resolve, reject) => {
  execChild(bin, args, { timeout: options.timeoutMs, env: options.env, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => {
    if (error) reject(Object.assign(new Error("wallet command failed"), { code: (error as NodeJS.ErrnoException).code, stdout: String(stdout ?? "") }));
    else resolve(String(stdout));
  });
});

/** Where a CLI installed with npm, Homebrew or the wallet's installer lives,
 * beyond PATH (a desktop app often starts with a short PATH). */
function searchDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME || homedir();
  return [
    ...(env.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".npm-global", "bin"),
    join(home, ".local", "bin"),
    join(home, ".volta", "bin"),
  ].filter(Boolean);
}

export function findWalletBin(wallet: SingleUseWallet, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = BIN[wallet];
  const names = process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const dir of searchDirs(env)) {
    for (const candidate of names) {
      const path = join(dir, candidate);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** The wallet CLI issuer. `authFile` names a person's own session file on an
 * organization server (the CLI's --auth); the desktop's person uses the CLI's
 * default session. */
export function cliWalletIssuer(options: {
  run?: CommandRunner;
  findBin?: (wallet: SingleUseWallet) => string | null;
  authFile?: (wallet: SingleUseWallet, principalId: string) => string | null;
  env?: NodeJS.ProcessEnv;
  /** How long one fill waits for the person's approval in the wallet. */
  approvalWaitMs?: number;
  tempDir?: () => string;
} = {}): WalletIssuer {
  const run = options.run ?? defaultRunner;
  const env = { ...(options.env ?? process.env), NO_UPDATE_NOTIFIER: "1" };
  const findBin = options.findBin ?? ((wallet) => findWalletBin(wallet, env));
  const approvalWaitMs = options.approvalWaitMs ?? 90_000;
  /** purchase -> the wallet's spend request, kept while it waits. */
  const requests = new Map<string, string>();
  const statusCache = new Map<string, { at: number; status: WalletStatus }>();

  const auth = (wallet: SingleUseWallet, principalId: string): string[] => {
    const file = options.authFile?.(wallet, principalId);
    return file ? ["--auth", file] : [];
  };

  return {
    async status(wallet, principalId) {
      const key = `${wallet}\0${principalId}`;
      const cached = statusCache.get(key);
      if (cached && Date.now() - cached.at < 30_000) return cached.status;
      const bin = findBin(wallet);
      let status: WalletStatus = { installed: Boolean(bin), signedIn: false };
      if (bin) {
        try {
          const answer = parseJson(await run(bin, ["auth", "status", ...auth(wallet, principalId), "--format", "json"], { timeoutMs: 15_000, env }));
          status = { installed: true, signedIn: answer?.authenticated === true };
        } catch {
          status = { installed: true, signedIn: false };
        }
      }
      statusCache.set(key, { at: Date.now(), status });
      return status;
    },

    async issue(wallet, principalId, request) {
      const bin = findBin(wallet);
      if (!bin) return { ok: false, code: "provider_unconfigured", detail: `${BIN[wallet]} is not installed on this computer` };
      const amount = minorUnits(request.amount, request.currency);
      if (amount === null) return { ok: false, code: "failed", detail: "the amount does not read" };
      const authArgs = auth(wallet, principalId);
      let id = requests.get(request.purchaseId);
      try {
        if (!id) {
          const created = parseJson(await run(bin, [
            "spend-request", "create",
            "--merchant-name", oneLine(request.merchant, 80),
            "--merchant-url", `https://${request.domain}`,
            "--context", spendContext(request),
            "--amount", String(amount),
            "--currency", request.currency.toLowerCase(),
            "--request-approval",
            ...authArgs,
            "--format", "json",
          ], { timeoutMs: 60_000, env }));
          if (!created || typeof created.id !== "string" || !/^[\w-]{1,128}$/.test(created.id)) {
            return { ok: false, code: "failed", detail: "the wallet did not open a request" };
          }
          id = created.id;
          requests.set(request.purchaseId, id);
        }
        const attempts = Math.max(1, Math.round(approvalWaitMs / 2_000));
        const polled = parseJson(await run(bin, ["spend-request", "retrieve", id, "--interval", "2", "--max-attempts", String(attempts), ...authArgs, "--format", "json"], { timeoutMs: approvalWaitMs + 30_000, env }));
        const status = typeof polled?.status === "string" ? polled.status : "";
        if (WAITING.has(status)) return { ok: false, code: "waiting", detail: "the wallet waits for the person's approval" };
        if (!APPROVED.has(status)) {
          requests.delete(request.purchaseId);
          return { ok: false, code: "declined", detail: `the wallet answered ${status || "nothing"}` };
        }
        const dir = mkdtempSync(join(options.tempDir?.() ?? tmpdir(), "sagax-wallet-"));
        const file = join(dir, "card.json");
        try {
          await run(bin, ["spend-request", "retrieve", id, "--include", "card", "--output-file", file, ...authArgs, "--format", "json"], { timeoutMs: 60_000, env });
          const card = cardFrom(parseJson(readFileSync(file, "utf8")));
          if (!card) return { ok: false, code: "failed", detail: "the wallet's card did not read" };
          requests.delete(request.purchaseId);
          return { ok: true, card };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch (error) {
        const stdout = String((error as { stdout?: unknown }).stdout ?? "");
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, code: "provider_unconfigured", detail: `${BIN[wallet]} is not installed on this computer` };
        if (/not (?:logged|signed) in|unauthenticated|auth login/i.test(stdout)) return { ok: false, code: "not_signed_in", detail: "the wallet is not signed in" };
        return { ok: false, code: "failed", detail: "the wallet command failed" };
      }
    },
  };
}
