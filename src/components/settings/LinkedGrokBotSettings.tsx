// The link to the person's own bots in the xAI provider's bot app (#2193),
// as a connection of that provider (#4329 lot 2, design B1, B3, B4): in
// Settings > Providers it is the line "Your bots there" in the xAI
// provider's row, its state in grey and one button (Connect or Disconnect);
// on that provider's page, a block says what it does, its state once with
// that button and two plain switches. Connect asks the address and the key
// once. Every technical field (the address, replacing the key, which bots,
// the address to give the other app with its signature header, save, test,
// the day's delivery line, remove) is a subsection of that page's one
// Advanced. The key is never shown after save; the address to give is
// copied, never drawn. Its state and where it shows come from
// shared/provider-catalog.ts.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readableError } from "@/lib/plain-error";
import {
  clearGrokBridge,
  loadGrokBridge,
  saveGrokBridge,
  testGrokBridge,
  type GrokBridgeLinkView,
} from "@/lib/grok-bridge";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { botsLinkShown, botsLinkState } from "../../../shared/provider-catalog";
import { DescribedRow, FIELD, FieldRow, PILL, PRIMARY_PILL, SettingsGroup, SettingsTextRow, Switch } from "../SettingsPrimitives";
import { pluginActionClass } from "../plugins/plugins-style";

export type BotsLinkState = ReturnType<typeof botsLinkState>;
type BotsLinkPatch = Parameters<typeof saveGrokBridge>[0];

const STATE_KEY = {
  connected: "providers.state.connected",
  off: "grokBridge.state.off",
  signedOut: "providers.state.available",
  adminOff: "grokBridge.state.adminOff",
} as const satisfies Record<BotsLinkState, LocaleKey>;

/** The one button of the link: Disconnect when it runs, Connect when it is
 * paused or not linked yet, none when the organization turned it off. */
export function botsLinkAction(state: BotsLinkState): "connect" | "disconnect" | null {
  if (state === "adminOff") return null;
  return state === "connected" ? "disconnect" : "connect";
}

export interface BotsLink {
  view: GrokBridgeLinkView | null;
  state: BotsLinkState | null;
  error: string | null;
  note: string | null;
  busy: boolean;
  /** The drafts of the fields (Connect and Advanced). */
  webhookUrl: string;
  setWebhookUrl: (value: string) => void;
  key: string;
  setKey: (value: string) => void;
  botsText: string;
  setBotsText: (value: string) => void;
  save: (patch: BotsLinkPatch) => Promise<boolean>;
  /** The address and a key (typed, or already saved) are there. */
  canConnect: boolean;
  connect: () => Promise<boolean>;
  saveAdvanced: () => Promise<boolean>;
  test: () => Promise<void>;
  clear: () => Promise<void>;
}

/** The person's link, read once (GET /api/me/grok-bridge): an older server
 * without the route leaves `view` null and nothing is drawn. `active` false
 * reads nothing (a provider page other than the xAI one). */
export function useBotsLink(initial?: GrokBridgeLinkView, active = true): BotsLink {
  const [view, setView] = useState<GrokBridgeLinkView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [key, setKey] = useState("");
  const [botsText, setBotsText] = useState((initial?.bots ?? []).join(", "));

  const take = useCallback((next: GrokBridgeLinkView) => {
    setView(next);
    setWebhookUrl(next.webhookUrl ?? "");
    setBotsText(next.bots.join(", "));
  }, []);

  useEffect(() => {
    if (initial || !active) return;
    let live = true;
    loadGrokBridge().then((next) => { if (live) take(next); }, () => { if (live) setView(null); });
    return () => { live = false; };
  }, [initial, active, take]);

  const save = async (patch: BotsLinkPatch) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      take(await saveGrokBridge(patch));
      if (patch.key !== undefined) setKey("");
      return true;
    } catch (failure) {
      setError(readableError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Connect needs the address and a key (typed now, or one already saved):
  // without the key the server delivers nothing, so it never says Connected.
  const canConnect = Boolean(webhookUrl.trim()) && (Boolean(key.trim()) || view?.keySet === true);
  const connect = async () => canConnect && save({ webhookUrl: webhookUrl.trim(), ...(key.trim() ? { key: key.trim() } : {}), enabled: true });

  const saveAdvanced = () => save({
    webhookUrl: webhookUrl.trim(),
    ...(key.trim() ? { key: key.trim() } : {}),
    bots: botsText.split(/[,;\n]/).map((bot) => bot.trim()).filter(Boolean),
    enabled: view?.enabled ?? true,
  });

  const test = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await testGrokBridge();
      if ("ok" in result && result.ok) setNote(t("grokBridge.test.queued"));
      else setError("error" in result ? result.error : t("grokBridge.test.failed"));
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      take(await clearGrokBridge());
      setKey("");
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  return {
    view, state: view ? botsLinkState(view) : null, error, note, busy,
    webhookUrl, setWebhookUrl, key, setKey, botsText, setBotsText,
    save, canConnect, connect, saveAdvanced, test, clear,
  };
}

/** What the list says of the link when it is the xAI provider's only
 * thing (#4376: one line per row): "Your bots there · Paused". */
export function botsLinkWords(link: Pick<BotsLink, "state">): string | null {
  return link.state ? `${t("grokBridge.title")} · ${t(STATE_KEY[link.state])}` : null;
}

/** Words a search finds the link by (its old names included, design F). */
export const BOTS_LINK_SEARCH_WORDS = "your bots there tes bots là-bas link with grok bot lier à grok bot linked grok bot grok bridge pont grok";

/**
 * The link's first step on the list (#4376: a row carries a button only
 * until it is connected): not linked yet, Connect opens the provider's
 * page, whose Connect step asks the address and the key. Once linked,
 * Disconnect and Connect are on that page (BotsLinkBlock).
 */
export function BotsLinkButton({ link, onOpen }: { link: BotsLink; onOpen: () => void }) {
  if (link.state !== "signedOut") return null;
  return (
    <button type="button" data-bots-link-action="connect" className={pluginActionClass("fill")} disabled={link.busy} onClick={onOpen}
      aria-label={`${t("grokBridge.connect")} · ${t("grokBridge.title")}`}>
      {t("grokBridge.connect")}
    </button>
  );
}

/** Whether the xAI provider's page holds the link (shared/provider-catalog.ts
 * botsLinkShown): once linked, or wherever the organization allows it. */
export function botsLinkOnPage(link: BotsLink): boolean {
  return Boolean(link.view && botsLinkShown(link.view));
}

/** The link's block on the xAI provider's page (design B3). */
export function BotsLinkSection({ link }: { link: BotsLink }) {
  if (!botsLinkOnPage(link)) return null;
  return (
    <SettingsGroup title={t("grokBridge.title")} groupId="provider-bots-link">
      <div data-settings-card="providers.linkedGrokBot" className="px-3.5 py-2.5">
        <BotsLinkBlock link={link} />
      </div>
    </SettingsGroup>
  );
}

/**
 * The block of the link (design B3): the plain sentence, its state once with
 * Connect or Disconnect, the two switches; not linked yet, the Connect step
 * (Address, Key, Connect). Everything else is its subsection of the
 * page's one Advanced (BotsLinkAdvanced).
 */
export function BotsLinkBlock({ link }: { link: BotsLink }) {
  const { view, state, busy } = link;
  if (!view || !state) return null;
  const orgBlocked = state === "adminOff";
  const action = botsLinkAction(state);
  return (
    <div data-bots-link-block="" className="flex min-w-0 flex-col gap-2">
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("grokBridge.intro")}</p>

      {state === "signedOut" && (
        <div data-bots-link-connect="" className="-mx-3.5 border-t border-hairline/40">
          <FieldRow label={t("grokBridge.address")} rowId="grokBridgeAddress" hint={t("grokBridge.addressHelp")}>
            <input className={FIELD} type="url" inputMode="url" dir="ltr" spellCheck={false} autoComplete="off" disabled={busy}
              value={link.webhookUrl} onChange={(e) => link.setWebhookUrl(e.target.value)} placeholder={t("grokBridge.urlPlaceholder")} />
          </FieldRow>
          <FieldRow label={t("grokBridge.connectKey")} rowId="grokBridgeConnectKey" hint={t("grokBridge.keyHelp")}>
            <input className={FIELD} type="password" dir="ltr" spellCheck={false} autoComplete="off" disabled={busy}
              value={link.key} onChange={(e) => link.setKey(e.target.value)} placeholder={t("grokBridge.keyPlaceholder")} />
          </FieldRow>
          <div className="px-3.5 py-2.5">
            <button type="button" data-bots-link-connect-submit="" className={PRIMARY_PILL} disabled={busy || !link.canConnect} onClick={() => void link.connect()}>
              {t("grokBridge.connect")}
            </button>
          </div>
        </div>
      )}

      {view.linked && (
        <div className="-mx-3.5 border-t border-hairline/40">
          {/* the state, said once; the organization turned it off: no button, the link is kept */}
          <DescribedRow label={t(STATE_KEY[state])} rowId="grokBridgeState" description={t(state === "connected" ? "grokBridge.enabledHelp" : "grokBridge.kept")}>
            {action && (
              <button type="button" data-bots-link-action={action} className={PILL} disabled={busy}
                onClick={() => void link.save({ enabled: action === "connect" })}>
                {t(action === "connect" ? "grokBridge.connect" : "grokBridge.disconnect")}
              </button>
            )}
          </DescribedRow>
          {!orgBlocked && (
            <>
              <DescribedRow label={t("grokBridge.mayCall")} rowId="grokBridgeMayCall" description={t("grokBridge.mayCallHelp")}>
                <Switch checked={view.mayCallOwner} disabled={busy} aria-label={t("grokBridge.mayCall")}
                  onClick={() => void link.save({ mayCallOwner: !view.mayCallOwner })} />
              </DescribedRow>
              <DescribedRow label={t("grokBridge.mayText")} rowId="grokBridgeMayText" description={t("grokBridge.mayTextHelp")}>
                <Switch checked={view.mayTextOwner} disabled={busy} aria-label={t("grokBridge.mayText")}
                  onClick={() => void link.save({ mayTextOwner: !view.mayTextOwner })} />
              </DescribedRow>
            </>
          )}
        </div>
      )}

      {(link.error || link.note) && (
        <p role={link.error ? "alert" : "status"} className={cn("text-[12px] leading-4", link.error ? "text-danger" : "text-ink-secondary")}>{link.error ?? link.note}</p>
      )}
    </div>
  );
}

/** The link's subsection of the xAI provider page's one Advanced (design B3),
 * once linked: every technical field of the old screen, reworded, under the
 * link's name. The organization turned it off: only Remove the link stays. */
export function BotsLinkAdvanced({ link }: { link: BotsLink }) {
  const { view } = link;
  if (!view?.linked || !botsLinkOnPage(link)) return null;
  return (
    <AdvancedPart cardId="providers.linkedGrokBot.advanced" label={t("grokBridge.title")}>
      <BotsLinkAdvancedFields link={link} />
    </AdvancedPart>
  );
}

/** A titled subsection of a page's Advanced, as a connection's own part there
 * (ProviderPage.tsx ConnectionAdvanced): its name, then its rows. */
function AdvancedPart({ cardId, label, children }: { cardId: string; label: string; children: ReactNode }) {
  return (
    <div data-settings-card={cardId} data-bots-link-advanced="" className="flex min-w-0 flex-col">
      <span className="px-3.5 pt-2.5 text-[12px] font-medium text-ink">{label}</span>
      {children}
    </div>
  );
}

function BotsLinkAdvancedFields({ link }: { link: BotsLink }) {
  const { view, busy } = link;
  if (!view) return null;
  const orgBlocked = view.orgAllowed === false;
  const inboundPath = view.linkId ? `/api/bridge/grok/${view.linkId}` : null;
  const remove = (
    <button type="button" className={cn(PILL, "text-danger")} disabled={busy} onClick={() => void link.clear()}>
      {t("grokBridge.clear")}
    </button>
  );
  if (orgBlocked) return <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">{remove}</div>;
  return (
    <div className="flex min-w-0 flex-col">
      <FieldRow label={t("grokBridge.webhook")} rowId="grokBridgeWebhook" hint={t("grokBridge.webhookHelp")}>
        <input className={FIELD} type="url" inputMode="url" dir="ltr" spellCheck={false} autoComplete="off" disabled={busy}
          value={link.webhookUrl} onChange={(e) => link.setWebhookUrl(e.target.value)} placeholder={t("grokBridge.urlPlaceholder")} />
      </FieldRow>
      <FieldRow label={t("grokBridge.key")} rowId="grokBridgeKey" hint={view.keySet ? t("grokBridge.keySet") : t("grokBridge.keyHelp")}>
        <input className={FIELD} type="password" dir="ltr" spellCheck={false} autoComplete="off" disabled={busy}
          value={link.key} onChange={(e) => link.setKey(e.target.value)} placeholder={view.keySet ? t("grokBridge.keyReplace") : t("grokBridge.keyPlaceholder")} />
      </FieldRow>
      <FieldRow label={t("grokBridge.bots")} rowId="grokBridgeBots" hint={t("grokBridge.botsHelp")}>
        <input className={FIELD} spellCheck={false} autoComplete="off" disabled={busy}
          value={link.botsText} onChange={(e) => link.setBotsText(e.target.value)} placeholder={t("grokBridge.botsPlaceholder")} />
      </FieldRow>
      {inboundPath && (
        <DescribedRow label={t("grokBridge.inbound")} rowId="grokBridgeInbound" description={t("grokBridge.inboundHint")}>
          <CopyAddress path={inboundPath} />
        </DescribedRow>
      )}
      {view.stats && (
        <div data-grok-bridge-stats="">
          <SettingsTextRow>
            {`${t("grokBridge.stats", { sent: String(view.stats.sentToday), dead: String(view.stats.deadLetters) })} ${t(view.stats.circuitOpen ? "grokBridge.circuitOpen" : "grokBridge.circuitClosed")}`}
          </SettingsTextRow>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <button type="button" className={PRIMARY_PILL} disabled={busy || !link.webhookUrl.trim()} onClick={() => void link.saveAdvanced()}>
          {t("grokBridge.save")}
        </button>
        <button type="button" className={PILL} disabled={busy || !view.keySet || !view.enabled} onClick={() => void link.test()}>
          {t("grokBridge.test")}
        </button>
        {remove}
      </div>
    </div>
  );
}

/** The address the other app sends to: copied, never drawn (its link id is opaque). */
function CopyAddress({ path }: { path: string }) {
  const { state, copy } = useCopyFeedback(path);
  return (
    <button type="button" className={PILL} title={path} data-grok-bridge-inbound="" onClick={copy}>
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {state === "copied" ? t("providers.copied") : t("grokBridge.copyInbound")}
    </button>
  );
}
