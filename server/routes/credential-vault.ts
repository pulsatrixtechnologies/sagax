// Settings > Credentials and the vault request card (server/credential-vault.ts).
//
//   POST   /api/me/credentials/list                 { items, onePassword, unavailable?, exportBlocked? }
//   POST   /api/me/credentials        {kind,name,username?,password?,totpSeed?,apiKey?,notes?,domains}
//   PATCH  /api/me/credentials/:id    same fields; a secret left out is kept, "" clears it
//   DELETE /api/me/credentials/:id
//   POST   /api/me/credentials/:id/notes             the owner's own note, never a bot's
//   POST   /api/me/credentials/:id/grants   { botId, mode: "always" }
//   DELETE /api/me/credentials/:id/grants/:botId     revoke
//   POST   /api/me/credentials/onepassword/items     the 1Password picker (names and sites)
//   POST   /api/me/credentials/onepassword/import { via, vaultId, itemId, name?, domains? }
//   POST   /api/me/credentials/import   { format, duplicates: merge|skip, items }  items the app read from a file
//   POST   /api/me/credentials/export   { format, acknowledge: "plaintext", stepUp? } -> { items, onePassword }
//   POST   /api/bots/:botId/vault-cards/:messageId/grant   { threadId, itemId | item | onePassword, mode, addSite?, turnOnly? }
//          turnOnly (2026-10-29): the typed login is lent for the turn this
//          card resumes, kept in memory only, forgotten when that turn ends
//   POST   /api/bots/:botId/vault-cards/:messageId/onepassword { threadId } the 1Password items of the card's site
//   POST   /api/bots/:botId/vault-cards/:messageId/dismiss { threadId }
//   POST   /api/bots/:botId/vault-cards/:messageId/self-start { threadId } arm the bot's browser for the person
//   POST   /api/bots/:botId/vault-cards/:messageId/self-status { threadId } { armed } for the card
//   POST   /api/bots/:botId/vault-cards/:messageId/signed-in { threadId }  the person signed in themselves
//
// The vault is the person's own: the session's principal on an organization
// server, the one local vault on a desktop or a solo server. No answer
// carries a password, a seed or an API key; only booleans say one is saved.
// Member scope (request-auth.ts CLIENT_ALLOW).
//
// Every read is a POST on purpose: a packaged desktop lets any process on
// the computer make loopback GET requests (a bot's shell among them), while
// a mutation needs the desktop's per-launch capability or a paired session.
// The listing (user names), a note and the 1Password picker are therefore
// only answered to the person's own app.
import { randomUUID } from "node:crypto";

import { botVaultPrincipal, bindingUrl, isVaultGrantMode, normalizeVaultDomain, siteAddable, VAULT_ITEM_KINDS, vaultDomainMatches, VAULT_LOGIN_TARGET, vaultHandle, type VaultGrantMode, type VaultItemKind, type VaultItemListing } from "../../shared/credential-vault.ts";
import { isVaultDuplicateMode, isVaultExportFormat, isVaultImportFormat, type VaultExportFormat, type VaultTransferItem } from "../../shared/credential-vault-transfer.ts";
import type { SecretRequestCardData } from "../../shared/wire.ts";
import { CredentialVaultError, type CredentialVault, type PurchaseListing, type VaultItemInput } from "../credential-vault.ts";
import { isSingleUseWallet } from "../../shared/single-use-card.ts";
import type { OnePassword } from "../onepassword.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface CredentialVaultRouteDeps {
  vault: CredentialVault;
  onePassword: OnePassword;
  /** Whose vault this request reads: null refuses (a session-less caller
   * on an organization server). */
  principal(auth: RequestAuth): string | null;
  botExists(botId: string): boolean;
  /** The bot's own browser for this conversation, for a person who signs in
   * there themselves: null to go on, else why not (server/browser-runtime.ts
   * armForPerson, clearAfterPerson). Absent refuses that answer. */
  browser?: {
    armForPerson(botId: string, threadId: string): Promise<string | null>;
    clearAfterPerson(botId: string, threadId: string): Promise<string | null>;
    /** Whether self-start armed that browser and it still is (a restart
     * re-arms it; nothing else may end it before Done). */
    armedForPerson(botId: string, threadId: string): Promise<boolean>;
    /** Done or declined: the sign-in under way ends (the browser stays armed
     * until its next restart). */
    endForPerson(botId: string, threadId: string): Promise<void>;
  };
  cards: {
    /** The pending vault card a bot posted in this conversation, or null. */
    find(botId: string, threadId: string, messageId: string): SecretRequestCardData | null;
    patch(botId: string, threadId: string, messageId: string, secret: SecretRequestCardData): void;
    /** Settle the card and wake the bot with this note. */
    resume(botId: string, threadId: string, messageId: string, outcome: "provided" | "dismissed", prompt: string): boolean;
  };
  audit?(action: "credentials.create" | "credentials.delete" | "credentials.grant" | "credentials.revoke" | "credentials.import" | "credentials.export" | "credentials.signed_in" | "credentials.wallet", auth: RequestAuth, detail: Record<string, unknown>): void;
  /** Whether this caller may take the vault's values out in a file now:
   * null to go on, else the refusal (a security key step-up, a sign-in
   * that is too old, a bot acting for its person). Absent refuses. */
  exportGate?(auth: RequestAuth, input: { format: VaultExportFormat; stepUp: unknown }): { status: number; body: unknown } | null;
  /** Whether the organization turned vault exports off (2026-10-18): the
   * export is refused 403 `export_blocked_by_org` before any other check,
   * and the list carries `exportBlocked` so the app can say why. Absent
   * allows. */
  exportBlocked?(auth: RequestAuth): boolean;
  /** Whether this caller may import: null to go on (absent allows, as for
   * creating an item). */
  importGate?(auth: RequestAuth): { status: number; body: unknown } | null;
  /** Reveal and a purchase answer: the person, or their Primary Bot when
   * they asked. Null to go on. Absent allows (tests). */
  ownerGate?(auth: RequestAuth): { status: number; body: unknown } | null;
  /** A purchase the person chose "money" needs their security key. */
  purchaseStepUp?(auth: RequestAuth, detail: Record<string, unknown>, stepUp: unknown): { status: number; body: unknown } | null;
  /** Set when this answer is the person's Primary Bot. The card then says
   * "via <name>". A caller cannot invent it. */
  viaPrimary?(): string | null;
  /** A purchase was answered: its card in the conversation and the bot's wake-up. */
  purchaseAnswered?(listing: PurchaseListing, note: string): void;
}

/** The most items one import request may carry (the vault keeps 500). */
const MAX_IMPORT_ITEMS = 5_000;
/** An import body: up to 500 items of long notes. */
const IMPORT_BODY_LIMIT = 16 * 1024 * 1024;

const optionalText = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** One item of an import body, as the vault's import takes it: unknown
 * fields dropped, sites normalized, nothing else trusted. Null when it is
 * not an item at all. */
function importItem(raw: unknown): VaultTransferItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!(VAULT_ITEM_KINDS as readonly unknown[]).includes(row.kind) || typeof row.name !== "string") return null;
  // Cards, addresses and contacts are not in a password-manager file. A
  // file must not carry a card number.
  if (row.kind === "card" || row.kind === "address" || row.kind === "contact") return null;
  const domains = Array.isArray(row.domains)
    ? [...new Set(row.domains.map((domain) => normalizeVaultDomain(domain)).filter((domain): domain is string => Boolean(domain)))]
    : [];
  const item: VaultTransferItem = { kind: row.kind as VaultItemKind, name: row.name, domains };
  for (const field of ["username", "password", "totpSeed", "apiKey", "notes"] as const) {
    const value = optionalText(row[field]);
    if (value !== undefined) item[field] = value;
  }
  return item;
}

const ITEM = /^\/api\/me\/credentials\/([a-z0-9]{8,40})(?:\/(notes|grants)(?:\/([\w-]{1,128}))?)?$/;
const CARD = /^\/api\/bots\/([\w-]+)\/vault-cards\/([\w-]+)\/(grant|dismiss|self-start|self-status|signed-in|onepassword)$/;
const OP_ID = /^[a-z0-9]{1,64}$/i;

function refusal(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof CredentialVaultError) return { status: error.status, body: { error: error.message, code: error.code } };
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 600) return { status, body: { error: error instanceof Error ? error.message : "refused" } };
  return null;
}

/** What the bot is told after the person allowed a login. A handle, the
 * sites and the fields; never a value. */
export function grantedNote(item: VaultItemListing, mode: VaultGrantMode): string {
  const fields = [item.username ? "username" : "", item.hasPassword ? "password" : "", item.hasTotp ? "totp" : "", item.hasApiKey ? "apiKey" : ""].filter(Boolean);
  // a 1Password item: its own title never reaches the bot, and once is one
  // sign-in (review of #954)
  const onePassword = item.source === "1password";
  const what = onePassword ? "a login from their 1Password" : `the saved login "${item.name}"`;
  const when = item.lent ? " for this turn only (it is forgotten when this turn ends; never ask for it again in chat)" : mode !== "once" ? "" : onePassword ? " for one sign-in in this conversation (it ends a minute after your first fill)" : " in this conversation for the next 15 minutes";
  return `Sagax credential update: the person allowed you to use ${what}, handle ${vaultHandle(item.id)}, on ${item.domains.join(", ")}` +
    `${when}. Fields: ${fields.join(", ") || "none"}. ` +
    (item.kind === "apiKey" && item.injection
      ? "Continue the task: call the API with vault_http_request and this handle (Sagax adds the key itself), or fill it in the browser with fill_credential. You never receive the value, and must not ask for it in chat."
      : "Continue the task: in the browser, call fill_credential with this handle and field login to sign in (or one field at a time). You never receive the value, and must not ask for it in chat.") +
    (item.source === "1password" ? " This login lives in 1Password: at the fill, 1Password may ask the person to approve on their computer; if the fill says 1Password did not answer, tell them and wait, never ask for the password." : "");
}

/** What the bot is told after the person signed in themselves in its
 * browser (the card's other answer, from OpenMausBot #2707's sign-in
 * request): no handle, no value, only that the session is there. */
export function signedInNote(site: string): string {
  return `Sagax sign-in update: the person signed in to ${site} themselves, in your browser. Check that you are signed in (a snapshot), then continue the task that paused for it. Never ask them for a password or a one-time code in chat.`;
}

export function declinedNote(): string {
  return "Sagax credential update: the person declined to share a login. Continue without signing in if possible, or briefly explain what you could not do. Do not ask for a password in chat.";
}

export function createCredentialVaultRoutes(deps: CredentialVaultRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const mine = path === "/api/me/credentials" || path.startsWith("/api/me/credentials/");
    const card = mine ? null : CARD.exec(path);
    if (!mine && !card) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const principalId = deps.principal(auth);
    if (!principalId) return json(res, 403, { error: "Sign in to use your credential vault.", code: "no_person" });
    const body = async (): Promise<Record<string, unknown>> => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
      const parsed = await readBody(req);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    };
    try {
      if (card) {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const [, botId, messageId, action] = card;
        const input = await body();
        const threadId = typeof input.threadId === "string" ? input.threadId : "";
        const secret = deps.cards.find(botId!, threadId, messageId!);
        if (!secret || secret.target !== VAULT_LOGIN_TARGET || !secret.vault) return json(res, 404, { error: "no such login request" });
        if (secret.vault.principalId !== principalId) return json(res, 403, { error: "Only the person this request was made for can answer it.", code: "not_yours" });
        if (secret.provided || secret.dismissed || secret.superseded) return json(res, 409, { error: "this login request was already answered" });
        if (action === "dismiss") {
          await deps.browser?.endForPerson(botId!, threadId);
          if (!deps.cards.resume(botId!, threadId, messageId!, "dismissed", declinedNote())) return json(res, 409, { error: "this login request is no longer available" });
          return json(res, 200, { dismissed: true });
        }
        // The person signs in themselves in the bot's browser (port of
        // OpenMausBot #2707). self-start arms that browser first, as a fill
        // does: refused where the bot ran a script (a page could hold its
        // listener), then scripts, screenshots and preview frames are off
        // until a restart. Done empties the page's password and code fields
        // before the bot is resumed, and marks the card only once resumed.
        if (action === "self-start") {
          if (!deps.browser) return json(res, 409, { error: "The bot's browser is not available here.", code: "no_browser" });
          const refused = await deps.browser.armForPerson(botId!, threadId);
          if (refused) return json(res, 409, { error: refused, code: "browser_not_clean" });
          return json(res, 200, { armed: true });
        }
        // 2026-10-21 (parité R10, ligne 82): the person's 1Password items for
        // the card's site (names, vaults and sites only), so a request is
        // answered from 1Password itself: Allow once is that one request
        // (this conversation, 15 minutes), and the value is read from
        // 1Password only at fill time, where 1Password asks for its own
        // approval. Never on an organization server (status "organization").
        if (action === "onepassword") {
          const status = await deps.onePassword.status();
          if (!status.available || !status.via) return json(res, 200, { available: false, onePassword: status, items: [] });
          const site = secret.vault.domain;
          const items = site ? await deps.onePassword.itemsForSite(site, principalId) : [];
          return json(res, 200, {
            available: true,
            onePassword: status,
            items: items.map((item) => ({ vaultId: item.vaultId, itemId: item.id, title: item.title, vaultName: item.vaultName, domains: item.domains, category: item.category })),
          });
        }
        if (action === "self-status") {
          // Whether the browser is still armed for the person (a restart of
          // Sagax, 30 minutes, a replaced card end it): the card says so.
          return json(res, 200, { armed: deps.browser ? await deps.browser.armedForPerson(botId!, threadId) : false });
        }
        if (action === "signed-in") {
          if (!deps.browser) return json(res, 409, { error: "The bot's browser is not available here.", code: "no_browser" });
          if (!await deps.browser.armedForPerson(botId!, threadId)) {
            return json(res, 409, { error: "This browser was not prepared for your sign-in. Press \"I'll sign in myself instead\" again, sign in, then press Done.", code: "not_armed" });
          }
          const unclear = await deps.browser.clearAfterPerson(botId!, threadId);
          if (unclear) return json(res, 409, { error: unclear, code: "browser_busy" });
          if (!deps.cards.resume(botId!, threadId, messageId!, "dismissed", signedInNote(secret.vault.domain ?? secret.vault.name ?? "the site"))) {
            return json(res, 409, { error: "this login request is no longer available" });
          }
          await deps.browser.endForPerson(botId!, threadId);
          const settled = deps.cards.find(botId!, threadId, messageId!) ?? secret;
          if (settled.vault) deps.cards.patch(botId!, threadId, messageId!, { ...settled, vault: { ...settled.vault, signedInSelf: true } });
          deps.audit?.("credentials.signed_in", auth, { botId });
          return json(res, 200, { signedIn: true });
        }
        const mode = input.mode;
        if (!isVaultGrantMode(mode)) return json(res, 400, { error: "mode must be once or always" });
        if (input.turnOnly === true) {
          // "This turn only": the login typed on the card is lent, never saved
          if (mode !== "once" || input.addSite === true || !input.item || typeof input.item !== "object" || input.onePassword || typeof input.itemId === "string") {
            return json(res, 400, { error: "This turn only lends a login typed on the card, once.", code: "turn_only_new_login" });
          }
          const lent = deps.vault.lend(principalId, input.item as VaultItemInput, { botId: botId!, threadId });
          await deps.browser?.endForPerson(botId!, threadId);
          deps.audit?.("credentials.grant", auth, { botId, mode: "turn", via: "card" });
          deps.cards.patch(botId!, threadId, messageId!, { ...secret, vault: { ...secret.vault, itemName: lent.name, mode: "once", turnOnly: true } });
          if (!deps.cards.resume(botId!, threadId, messageId!, "provided", grantedNote(lent, "once"))) {
            deps.vault.forgetLent(threadId);
            return json(res, 409, { error: "this login request is no longer available" });
          }
          return json(res, 200, { item: lent });
        }
        if (secret.vault.team) {
          // The bot's shared login: the owner picks one the card listed and
          // allows it once or always. Nothing is created, lent or edited.
          const picked = typeof input.itemId === "string" ? secret.vault.teamItems?.find((row) => row.id === input.itemId) : undefined;
          if (!picked || input.turnOnly === true || input.addSite === true || input.onePassword || input.item) {
            return json(res, 400, { error: "Choose one of this bot's shared logins.", code: "unknown_item" });
          }
          const teamPrincipal = botVaultPrincipal(botId!);
          const shared = deps.vault.item(teamPrincipal, picked.id);
          if (!shared || (shared.kind !== "login" && shared.kind !== "apiKey") || !shared.domains.length) return json(res, 404, { error: "No such item", code: "unknown_item" });
          const teamGrant = deps.vault.grant(teamPrincipal, shared.id, { botId: botId!, mode, threadId, ...(shared.source === "1password" ? { singleUse: true } : {}) });
          await deps.browser?.endForPerson(botId!, threadId);
          deps.audit?.("credentials.grant", auth, { id: shared.id, botId, mode, via: "team-card" });
          deps.cards.patch(botId!, threadId, messageId!, { ...secret, vault: { ...secret.vault, itemId: shared.id, itemName: shared.name, mode } });
          if (!deps.cards.resume(botId!, threadId, messageId!, "provided", grantedNote(teamGrant, mode))) {
            return json(res, 409, { error: "this login request is no longer available" });
          }
          return json(res, 200, { item: teamGrant });
        }
        if (input.addSite === true && mode !== "always") return json(res, 400, { error: "A site is added to a login only with Always: a one-time grant changes nothing for good.", code: "add_site_once" });
        if (input.addSite === true && typeof input.itemId !== "string") return json(res, 400, { error: "Type the sites of a new login yourself.", code: "invalid_domains" });
        let item: VaultItemListing | null;
        const fromOnePassword = input.onePassword && typeof input.onePassword === "object" && !Array.isArray(input.onePassword) ? input.onePassword as Record<string, unknown> : null;
        if (fromOnePassword) {
          // A 1Password item picked on the card: checked against 1Password's
          // own listing for this site, saved once as a reference (no value),
          // then granted like any login.
          if (input.addSite === true) return json(res, 400, { error: "A 1Password item keeps the sites saved in 1Password.", code: "invalid_domains" });
          const vaultId = typeof fromOnePassword.vaultId === "string" && OP_ID.test(fromOnePassword.vaultId) ? fromOnePassword.vaultId : "";
          const itemId = typeof fromOnePassword.itemId === "string" && OP_ID.test(fromOnePassword.itemId) ? fromOnePassword.itemId : "";
          const status = await deps.onePassword.status();
          if (!status.available || !status.via) return json(res, 409, { error: "1Password is not available on this computer.", code: "onepassword_unavailable" });
          const site = secret.vault.domain;
          const listed = site && vaultId && itemId ? (await deps.onePassword.itemsForSite(site, principalId)).find((row) => row.id === itemId && row.vaultId === vaultId) : undefined;
          if (!listed) return json(res, 404, { error: "This 1Password item is not one of this site's.", code: "unknown_item" });
          const ref = { via: status.via, vaultId, itemId };
          item = deps.vault.findOnePassword(principalId, ref);
          if (!item) {
            item = deps.vault.create(principalId, {
              kind: listed.category === "API_CREDENTIAL" ? "apiKey" : "login",
              name: listed.title || "1Password item",
              domains: listed.domains,
            }, { source: "1password", onePassword: ref });
            deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind, via: "1password-card" });
          }
        } else if (typeof input.itemId === "string") item = deps.vault.item(principalId, input.itemId);
        else if (input.item && typeof input.item === "object") {
          item = deps.vault.create(principalId, input.item as VaultItemInput);
          deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind, via: "card" });
        } else return json(res, 400, { error: "send itemId or a new item" });
        if (!item) return json(res, 404, { error: "No such item", code: "unknown_item" });
        if (item.kind !== "login" && item.kind !== "apiKey") return json(res, 400, { error: "Only a login or an API key can be filled into a page." });
        // "Also fill it on <site>": the site the bot asked for joins the
        // login's sites only when the person ticked it on the card (unticked
        // by default: the bot chose that address). Port of the card's save
        // target of OpenMausBot #2929, on Sagax's own vault.
        let addedSite = false;
        if (input.addSite === true) {
          // Only another address of the login's own site: never a wildcard
          // the bot chose, a shared hosting name or a look-alike
          // (siteAddable), whatever the card was told.
          const site = secret.vault.domain;
          if (!site) return json(res, 400, { error: "This request names no site to add.", code: "invalid_domains" });
          if (!vaultDomainMatches(item.domains, bindingUrl(site))) {
            if (!siteAddable(item.domains, site)) return json(res, 400, { error: `${site} is not another address of this login's site; it is not added. Edit the login's sites yourself if it belongs there.`, code: "site_not_related" });
            item = deps.vault.update(principalId, item.id, { domains: [...item.domains, site] });
            addedSite = true;
          }
        }
        if (!item.domains.length) return json(res, 400, { error: "This item has no site it may be filled on. Add one first.", code: "invalid_domains" });
        // a 1Password item is allowed once only, for one sign-in (review of #954)
        if (item.source === "1password" && mode !== "once") return json(res, 400, { error: "A 1Password item is allowed for this request only.", code: "onepassword_once_only" });
        const granted = deps.vault.grant(principalId, item.id, { botId: botId!, mode, threadId, ...(item.source === "1password" ? { singleUse: true } : {}) });
        // A login chosen after "I'll sign in myself": that sign-in ends.
        await deps.browser?.endForPerson(botId!, threadId);
        deps.audit?.("credentials.grant", auth, { id: item.id, botId, mode, via: "card", ...(addedSite ? { addedSite: true } : {}) });
        deps.cards.patch(botId!, threadId, messageId!, { ...secret, vault: { ...secret.vault, itemId: item.id, itemName: item.name, mode, ...(item.source === "1password" ? { onePassword: true } : {}) } });
        if (!deps.cards.resume(botId!, threadId, messageId!, "provided", grantedNote(granted, mode))) {
          return json(res, 409, { error: "this login request is no longer available" });
        }
        return json(res, 200, { item: granted });
      }

      if (path === "/api/me/credentials/list") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const unavailable = deps.vault.unavailableReason(principalId);
        return json(res, 200, {
          items: unavailable ? [] : deps.vault.list(principalId),
          purchases: unavailable ? [] : deps.vault.pendingPurchases(principalId),
          wallets: await deps.vault.walletLinksLive(principalId),
          onePassword: await deps.onePassword.status(),
          ...(unavailable ? { unavailable } : {}),
          ...(deps.exportBlocked?.(auth) ? { exportBlocked: true } : {}),
        });
      }
      if (path === "/api/me/credentials") {
        if (method === "POST") {
          const item = deps.vault.create(principalId, await body() as VaultItemInput);
          deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind });
          return json(res, 201, { item });
        }
        return json(res, 405, { error: "POST only" });
      }
      if (path === "/api/me/credentials/onepassword/items") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const status = await deps.onePassword.status(true);
        if (!status.available) return json(res, 409, { error: "1Password is not available on this computer.", code: "onepassword_unavailable", onePassword: status });
        return json(res, 200, { items: await deps.onePassword.listItems() });
      }
      if (path === "/api/me/credentials/onepassword/import") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const input = await body();
        const status = await deps.onePassword.status();
        if (!status.available || !status.via) return json(res, 409, { error: "1Password is not available on this computer.", code: "onepassword_unavailable" });
        const vaultId = typeof input.vaultId === "string" ? input.vaultId : "";
        const itemId = typeof input.itemId === "string" ? input.itemId : "";
        const listed = (await deps.onePassword.listItems()).find((row) => row.id === itemId && row.vaultId === vaultId);
        if (!listed) return json(res, 404, { error: "No such 1Password item", code: "unknown_item" });
        const item = deps.vault.create(principalId, {
          kind: listed.category === "API_CREDENTIAL" ? "apiKey" : "login",
          name: typeof input.name === "string" && input.name.trim() ? input.name : listed.title || "1Password item",
          domains: input.domains ?? listed.domains,
        }, { source: "1password", onePassword: { via: status.via, vaultId, itemId } });
        deps.audit?.("credentials.create", auth, { id: item.id, kind: item.kind, via: "1password" });
        return json(res, 201, { item });
      }
      if (path === "/api/me/credentials/import") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const gated = deps.importGate?.(auth);
        if (gated) return json(res, gated.status, gated.body);
        if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
        const input = await readBody(req, IMPORT_BODY_LIMIT);
        if (!input || typeof input !== "object" || Array.isArray(input)) return json(res, 400, { error: "send format, duplicates and items" });
        if (!isVaultImportFormat(input.format)) return json(res, 400, { error: "unknown import format", code: "invalid_format" });
        if (!isVaultDuplicateMode(input.duplicates)) return json(res, 400, { error: "duplicates must be merge or skip" });
        if (!Array.isArray(input.items) || input.items.length > MAX_IMPORT_ITEMS) return json(res, 400, { error: `items must be a list of at most ${MAX_IMPORT_ITEMS}` });
        const items = (input.items as unknown[]).map(importItem);
        if (items.some((item) => item === null)) return json(res, 400, { error: "every item needs a kind and a name", code: "invalid_item" });
        const outcome = deps.vault.importItems(principalId, items as VaultTransferItem[], input.duplicates);
        // counts only: never a name, a site or a value
        deps.audit?.("credentials.import", auth, { format: input.format, mode: input.duplicates, received: items.length, ...outcome });
        return json(res, 200, outcome);
      }
      const reveal = /^\/api\/me\/credentials\/([a-z0-9]{8,40})\/reveal$/.exec(path);
      if (reveal) {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const owned = deps.ownerGate?.(auth);
        if (owned) return json(res, owned.status, owned.body);
        const input = await body();
        const value = deps.vault.reveal(principalId, reveal[1]!, input.field);
        return json(res, 200, { value });
      }
      if (path === "/api/me/credentials/wallets") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const input = await body();
        if (!isSingleUseWallet(input.wallet) || typeof input.chosen !== "boolean") return json(res, 400, { error: "wallet must be shop_pay or link", code: "unknown_wallet" });
        deps.vault.chooseWallet(principalId, input.wallet, input.chosen);
        deps.audit?.("credentials.wallet", auth, { wallet: input.wallet, chosen: input.chosen });
        return json(res, 200, { wallets: await deps.vault.walletLinksLive(principalId) });
      }
      if (path === "/api/me/credentials/purchases") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        return json(res, 200, { purchases: deps.vault.pendingPurchases(principalId) });
      }
      const purchase = /^\/api\/me\/credentials\/purchases\/(pay_[a-f0-9]{16})\/answer$/.exec(path);
      if (purchase) {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const owned = deps.ownerGate?.(auth);
        if (owned) return json(res, owned.status, owned.body);
        const input = await body();
        const detail = { purchaseId: purchase[1], decision: input.decision };
        const stepped = deps.purchaseStepUp?.(auth, detail, input.stepUp);
        if (stepped) return json(res, stepped.status, stepped.body);
        const via = deps.viaPrimary?.() ?? undefined;
        const answered = deps.vault.answerPurchase(principalId, purchase[1]!, input.decision, via ?? undefined);
        deps.audit?.("credentials.grant", auth, { purchaseId: purchase[1], decision: input.decision, ...(via ? { via: "primary-bot" } : {}) });
        deps.purchaseAnswered?.(answered.listing, answered.note);
        return json(res, 200, { purchase: answered.listing, note: answered.note });
      }
      if (path === "/api/me/credentials/export") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        if (deps.exportBlocked?.(auth)) return json(res, 403, { error: "Your organization does not allow exporting the vault.", code: "export_blocked_by_org" });
        const input = await body();
        if (!isVaultExportFormat(input.format)) return json(res, 400, { error: "unknown export format", code: "invalid_format" });
        if (input.acknowledge !== "plaintext") return json(res, 400, { error: "Confirm that the file holds your passwords in clear.", code: "acknowledge_required" });
        const refused = deps.exportGate ? deps.exportGate(auth, { format: input.format, stepUp: input.stepUp }) : { status: 403, body: { error: "Export is not available here.", code: "export_unavailable" } };
        if (refused) return json(res, refused.status, refused.body);
        const exported = deps.vault.exportItems(principalId, input.format);
        deps.audit?.("credentials.export", auth, { format: input.format, count: exported.items.length, referencesLeftOut: exported.onePassword, notInFormat: exported.notInFormat });
        return json(res, 200, exported);
      }
      const match = ITEM.exec(path);
      if (!match) return json(res, 404, { error: "not found" });
      const [, id, sub, botId] = match;
      if (sub === "notes") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        return json(res, 200, { notes: deps.vault.revealNotes(principalId, id!) });
      }
      if (sub === "grants") {
        if (method === "POST" && !botId) {
          const input = await body();
          if (typeof input.botId !== "string" || !deps.botExists(input.botId)) return json(res, 404, { error: "no such bot" });
          if (input.mode !== "always") return json(res, 400, { error: "From Settings a bot is allowed always; a one-time grant comes from a request card." });
          if (deps.vault.item(principalId, id!)?.source === "1password") return json(res, 400, { error: "A 1Password item is allowed for one request at a time, from its card.", code: "onepassword_once_only" });
          const item = deps.vault.grant(principalId, id!, { botId: input.botId, mode: "always" });
          deps.audit?.("credentials.grant", auth, { id, botId: input.botId, mode: "always" });
          return json(res, 200, { item });
        }
        if (method === "DELETE" && botId) {
          const item = deps.vault.revoke(principalId, id!, botId);
          deps.audit?.("credentials.revoke", auth, { id, botId });
          return json(res, 200, { item });
        }
        return json(res, 405, { error: "POST /grants or DELETE /grants/:botId" });
      }
      if (method === "PATCH") return json(res, 200, { item: deps.vault.update(principalId, id!, await body() as VaultItemInput) });
      if (method === "DELETE") {
        if (!deps.vault.remove(principalId, id!)) return json(res, 404, { error: "No such item", code: "unknown_item" });
        deps.audit?.("credentials.delete", auth, { id });
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: "PATCH or DELETE" });
    } catch (error) {
      const refused = refusal(error);
      if (refused) return json(res, refused.status, refused.body);
      throw error;
    }
  };
}

/** Whose vault a request reads. An organization server: the signed-in
 * person only. Otherwise the one local vault, for a paired session, for the
 * desktop's own loopback (its mutations carry Electron's per-launch
 * capability), or for loopback on a headless server only when the operator
 * opted in: there a bot's shell is a loopback caller too. */
export function vaultPrincipalFor(auth: RequestAuth, context: { organization: boolean; desktop: boolean; loopbackOptIn: boolean; localPrincipal: string }): string | null {
  if (context.organization) {
    const id = auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() : undefined;
    // "bot:" is the team vault namespace; a person never lives there.
    if (id?.startsWith("bot:")) return null;
    return id || null;
  }
  if (auth.kind === "session") return context.localPrincipal;
  if (auth.trust === "service") return null;
  return context.desktop || context.loopbackOptIn ? context.localPrincipal : null;
}

/** A fresh vault card for a bot's request_login (kind "secret"). */
export function vaultRequestCard(input: { principalId: string; botName: string; name?: string; domain?: string; reason?: string; teamItems?: Array<{ id: string; name: string; domains: string[] }> }): SecretRequestCardData {
  const what = input.domain ?? input.name ?? "a site";
  return {
    target: VAULT_LOGIN_TARGET,
    label: `Login for ${what}`,
    description: `${input.botName} asks to sign in to ${what} with a login from your vault.${input.reason ? ` ${input.reason}` : ""} It can type it into that site's page but never read it.`,
    placeholder: "",
    helpUrl: "",
    requestKey: randomUUID(),
    vault: {
      principalId: input.principalId,
      ...(input.teamItems?.length ? { team: true as const, teamItems: input.teamItems } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.domain ? { domain: input.domain } : {}),
    },
  };
}
