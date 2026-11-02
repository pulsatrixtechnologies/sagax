// A bot's request_login card (target vaultLogin): the person picks a login
// from their credential vault, or saves a new one, and allows it for this
// time (this conversation, 15 minutes) or always for this bot. The bot gets
// a handle, never a value; it fills the login into its browser by reference
// (server/credential-fill.ts). When the login it picks is saved for another
// address of the site, "Also fill it on ..." (unticked) adds the asked one.
// The person may also sign in themselves in the bot's browser and press
// Done (port of OpenMausBot #2707 and #2929, on Sagax's vault card). Once
// answered the card folds into one line.
// 2026-10-21 (parité R10, ligne 82): the card also offers the person's
// 1Password items for the site ("Dans 1Password", the item's name and vault,
// never an id or a value). Allow once is that one request; 1Password may ask
// for its own approval when the bot fills it.
import { useEffect, useState, type FormEvent } from "react";
import { Check, Globe, KeyRound, Loader2, LockKeyhole, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { createCredentialDraft, dismissCard, grantFromCard, loadCardOnePassword, loadCredentials, matchingItems, onePasswordChoiceKey, parseDomains, selfStartFromCard, selfStatusFromCard, signedInFromCard, type CardOnePasswordItem, type VaultItemListing } from "@/lib/credential-vault";
import { t } from "@/lib/i18n";
import { useStore, type Message } from "@/state/store";
import { siteAddable, type VaultGrantMode } from "../../shared/credential-vault";
import { ASK_CHIP, ASK_CHIP_IDLE, ASK_CHIP_PICKED, ASK_FIELD, ASK_PRIMARY_BUTTON, AskCard, AskSettledLine, returnFocusToComposer } from "./AskCard";
import { readableError } from "@/lib/plain-error";

const NEW = "__new__";

export function VaultRequestCard({ botId, threadId, message }: { botId: string; threadId: string; message: Message }) {
  const { state, dispatch } = useStore();
  const secret = message.secret!;
  const request = secret.vault;
  const site = request?.domain ?? request?.name ?? "";
  const botName = message.from?.name ?? state.bots.find((bot) => bot.id === botId)?.name ?? t("vault.card.thisBot");
  const settled = secret.provided === true || secret.dismissed === true || secret.superseded === true;
  const [items, setItems] = useState<VaultItemListing[] | null>(null);
  const [onePasswordItems, setOnePasswordItems] = useState<CardOnePasswordItem[]>([]);
  const [choice, setChoice] = useState<string>("");
  // The site field starts empty: the bot chose the name it asked for, and a
  // look-alike must be typed by the person, not accepted with one click.
  const [draft, setDraft] = useState({ name: "", domains: "", username: "", password: "", totpSeed: "" });
  const [busy, setBusy] = useState(false);
  // Unticked by default: the bot chose the address it asked for.
  const [addSite, setAddSite] = useState(false);
  const [selfSignIn, setSelfSignIn] = useState(false);
  // Whether the bot's browser is still armed for the person (null: not
  // known yet). A restart of Sagax, 30 minutes or a newer card end it, and
  // the card then says the browser is not protected any more.
  const [armed, setArmed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settled || !request) return;
    let live = true;
    if (request.team && request.teamItems?.length) {
      // The bot's shared logins: the card lists them, nothing else to load.
      setItems(request.teamItems.map((row) => ({ ...row, kind: "login", source: "local" }) as unknown as VaultItemListing));
      setChoice(request.teamItems[0]!.id);
      return () => { live = false; };
    }
    loadCredentials()
      .then((state) => {
        if (!live) return;
        const matches = matchingItems(state.items, request);
        setItems(matches);
        setChoice(matches[0]?.id ?? NEW);
      })
      .catch((failure) => { if (live) { setItems([]); setChoice(NEW); setError(readableError(failure)); } });
    // 1Password's own items for this site, when 1Password is on this
    // computer. Silent when it is not: the card works without it.
    loadCardOnePassword(botId, message.id, threadId)
      .then((answer) => { if (live && answer.available) setOnePasswordItems(answer.items); })
      .catch(() => {});
    return () => { live = false; };
  }, [settled, request, botId, message.id, threadId]);

  useEffect(() => {
    if (!selfSignIn || settled) return;
    let live = true;
    const check = () => { selfStatusFromCard(botId, message.id, threadId).then((answer) => { if (live) setArmed(answer.armed); }).catch(() => { if (live) setArmed(false); }); };
    check();
    const timer = setInterval(check, 5_000);
    return () => { live = false; clearInterval(timer); };
  }, [selfSignIn, settled, botId, message.id, threadId]);

  if (!request) return null;

  if (secret.superseded) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("vault.card.title", { site })}>
        <span className="text-ink-secondary">{t("vault.card.title", { site })}</span>
        <span> · {t("vault.card.superseded")}</span>
      </AskSettledLine>
    );
  }
  if (request.signedInSelf) {
    return (
      <AskSettledLine icon={<Check size={13} />} ariaLabel={t("vault.card.title", { site })}>
        <span className="text-ink-secondary">{t("vault.card.signedInSelf", { site })}</span>
      </AskSettledLine>
    );
  }
  if (secret.dismissed) {
    return (
      <AskSettledLine icon={<X size={13} />} ariaLabel={t("vault.card.title", { site })}>
        <span className="text-ink-secondary">{t("vault.card.declined", { site })}</span>
      </AskSettledLine>
    );
  }
  if (secret.provided) {
    const how = request.turnOnly ? t("vault.card.allowedTurnOnly") : request.mode === "always" ? t("vault.card.allowedAlways", { bot: botName }) : t("vault.card.allowedOnce");
    return (
      <AskSettledLine
        ariaLabel={t("vault.card.title", { site })}
        icon={secret.resumed || !secret.error ? undefined : <KeyRound size={13} />}
        detail={secret.error && <p role="alert" className="ms-[19px] mt-1 text-[12px] text-danger">{secret.error}</p>}
      >
        <span className="text-ink-secondary">{t("vault.card.allowed", { name: request.itemName ?? site })}</span>
        {request.onePassword && <span> · 1Password</span>}
        <span> · {how}</span>
      </AskSettledLine>
    );
  }

  const grant = async (mode: VaultGrantMode, event?: FormEvent, turnOnly = false) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const fromOnePassword = onePasswordItems.find((item) => onePasswordChoiceKey(item) === choice);
      const target = fromOnePassword
        ? { onePassword: { vaultId: fromOnePassword.vaultId, itemId: fromOnePassword.itemId } }
        : choice === NEW
          ? { item: createCredentialDraft({ ...draft, domains: parseDomains(draft.domains) }) }
          : { itemId: choice };
      await grantFromCard(botId, message.id, threadId, mode, target, !fromOnePassword && mode === "always" && choice !== NEW && addSite && canAddSite, turnOnly && choice === NEW && mode === "once");
      setDraft((current) => ({ ...current, password: "", totpSeed: "" }));
      returnFocusToComposer();
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };
  const decline = () => { void dismissCard(botId, message.id, threadId).catch(() => {}); };
  const chosen = items?.find((item) => item.id === choice);
  const onePasswordChosen = onePasswordItems.some((item) => onePasswordChoiceKey(item) === choice);
  // a 1Password item already saved in the vault under the same name is
  // shown once, as the saved login
  const savedNames = new Set((items ?? []).filter((item) => item.source === "1password").map((item) => item.name.toLowerCase()));
  const onePasswordShown = onePasswordItems.filter((item) => !savedNames.has(item.title.toLowerCase()));
  // Only another address of the chosen login's own site, never a look-alike
  // or a shared hosting name (the server checks the same: siteAddable).
  const canAddSite = Boolean(!request.team && chosen && siteAddable(chosen.domains, request.domain));
  const startSelf = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await selfStartFromCard(botId, message.id, threadId);
      setArmed(true);
      setSelfSignIn(true);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };
  const signedIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signedInFromCard(botId, message.id, threadId);
      returnFocusToComposer();
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof typeof draft, label: string, type = "text", autoComplete = "off") => (
    <input
      type={type}
      autoComplete={autoComplete}
      spellCheck={false}
      dir="ltr"
      value={draft[key]}
      onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
      placeholder={label}
      aria-label={label}
      disabled={busy}
      className={cn(ASK_FIELD, "min-w-[10rem] flex-1")}
    />
  );

  return (
    <AskCard
      ariaLabel={t("vault.card.title", { site })}
      icon={<KeyRound size={15} />}
      title={t("vault.card.title", { site })}
      explanation={t("vault.card.explanation", { bot: botName, site })}
      onDismiss={decline}
      dismissLabel={t("vault.card.notNow")}
    >
      {items === null ? (
        <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><Loader2 size={13} className="animate-spin" /> {t("vault.card.loading")}</div>
      ) : (
        <form onSubmit={(event) => void grant("once", event)} className="flex flex-col gap-2" data-vault-card>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("vault.card.choose")}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={choice === item.id}
                onClick={() => { setChoice(item.id); setAddSite(false); }}
                className={cn(ASK_CHIP, choice === item.id ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
              >
                <span className="truncate">{item.name}{item.username ? ` · ${item.username}` : ""}</span>
              </button>
            ))}
            {!request.team && <button
              type="button"
              role="radio"
              aria-checked={choice === NEW}
              onClick={() => setChoice(NEW)}
              className={cn(ASK_CHIP, choice === NEW ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
            >
              {t("vault.card.newLogin")}
            </button>}
          </div>
          {onePasswordShown.length > 0 && (
            <div className="flex flex-col gap-1.5" data-vault-onepassword>
              <span className="text-[11.5px] font-medium text-ink-tertiary">{t("vault.card.inOnePassword")}</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("vault.card.inOnePassword")}>
                {onePasswordShown.map((item) => {
                  const key = onePasswordChoiceKey(item);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={choice === key}
                      onClick={() => { setChoice(key); setAddSite(false); }}
                      className={cn(ASK_CHIP, choice === key ? ASK_CHIP_PICKED : ASK_CHIP_IDLE)}
                    >
                      <span className="truncate">{item.title}{item.vaultName ? ` · ${item.vaultName}` : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {choice !== NEW && !onePasswordChosen && request.domain && canAddSite && (
            <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary" data-vault-add-site>
              <input type="checkbox" checked={addSite} disabled={busy} onChange={(event) => setAddSite(event.target.checked)} className="mt-0.5" />
              <span>{t("vault.card.alsoFill", { site: request.domain, sites: chosen?.domains.join(", ") ?? "" })}</span>
            </label>
          )}
          {choice === NEW && (
            <div className="flex flex-col gap-2">
              {request.domain && (
                <p role="note" className="text-[12px] leading-relaxed text-ink-secondary" data-vault-lookalike>
                  {t("vault.card.checkSite", { site: request.domain })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {field("name", t("vault.field.name"))}
                {field("domains", t("vault.field.sites"))}
              </div>
              <div className="flex flex-wrap gap-2">
                {field("username", t("vault.field.username"), "text", "off")}
                {field("password", t("vault.field.password"), "password", "new-password")}
              </div>
              {field("totpSeed", t("vault.field.totpOptional"), "password", "off")}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || !choice || (addSite && canAddSite)} className={ASK_PRIMARY_BUTTON}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
              {t("vault.card.allowOnce")}
            </button>
            {/* 2026-10-29: a login typed here, lent for this turn only, never saved */}
            {choice === NEW && (
              <button type="button" disabled={busy} onClick={() => void grant("once", undefined, true)} className={cn(ASK_CHIP, ASK_CHIP_IDLE)} data-vault-turn-only title={t("vault.card.turnOnlyHint")}>
                {t("vault.card.turnOnly")}
              </button>
            )}
            {/* a 1Password item: this request only (review of #954) */}
            {!onePasswordChosen && chosen?.source !== "1password" && (
              <button type="button" disabled={busy || !choice} onClick={() => void grant("always")} className={cn(ASK_CHIP, ASK_CHIP_IDLE)} data-vault-always>
                {t("vault.card.allowAlways", { bot: botName })}
              </button>
            )}
          </div>
          <span className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">
            <LockKeyhole size={11} /> {t(onePasswordChosen || chosen?.source === "1password" ? "vault.card.onePasswordPrivacy" : "vault.card.privacy")}
          </span>
        </form>
      )}
      {!selfSignIn ? (
        <button type="button" disabled={busy} onClick={() => void startSelf()} className="mt-2 self-start text-[12px] text-ink-secondary underline underline-offset-2" data-vault-self>
          {t("vault.card.signInMyself")}
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-hairline p-2" data-vault-self-panel>
          {armed === false ? (
            <p role="alert" className="text-[12px] leading-relaxed text-danger" data-vault-self-unprotected>{t("vault.card.selfUnprotected", { bot: botName })}</p>
          ) : (
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("vault.card.selfHint", { bot: botName, site })}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => dispatch({ type: "toggleComputer", open: true })} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
              <Globe size={13} /> {t("vault.card.openBrowser")}
            </button>
            <button type="button" disabled={busy} onClick={() => void signedIn()} className={cn(ASK_CHIP, ASK_CHIP_IDLE)}>
              <Check size={13} /> {t("vault.card.signedInDone")}
            </button>
            {armed === false && (
              <button type="button" disabled={busy} onClick={() => void startSelf()} className={cn(ASK_CHIP, ASK_CHIP_IDLE)} data-vault-self-rearm>
                {t("vault.card.selfRearm")}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </AskCard>
  );
}
