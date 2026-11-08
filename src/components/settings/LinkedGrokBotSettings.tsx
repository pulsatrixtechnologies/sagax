// Settings > Providers > Advanced > Link with Grok Bot (#2193; in Advanced since #2295): the person's own webhook URL
// and sealed key. Their Sagax bots reach only this link. Never shows the key
// after save. Test sends a signed envelope. Phone opt-ins for owner call/text.
// Drawn like its neighbour Web search (#2682): FieldRow fields, notes as
// SettingsTextRow, Save as the primary pill, the inbound address copied only.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  clearGrokBridge,
  loadGrokBridge,
  saveGrokBridge,
  testGrokBridge,
  type GrokBridgeLinkView,
} from "@/lib/grok-bridge";
import { Check, Copy } from "lucide-react";

import { useCopyFeedback } from "@/lib/copy-text";
import { DescribedRow, FIELD, FieldRow, PILL, PRIMARY_PILL, SettingsGroup, SettingsTextRow, Switch } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";

export function LinkedGrokBotSettings({ initial }: { initial?: GrokBridgeLinkView }) {
  const [view, setView] = useState<GrokBridgeLinkView | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [key, setKey] = useState("");
  const [botsText, setBotsText] = useState((initial?.bots ?? []).join(", "));
  const [testNote, setTestNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadGrokBridge();
      setView(next);
      setWebhookUrl(next.webhookUrl ?? "");
      setBotsText(next.bots.join(", "));
      setError(null);
    } catch (failure) {
      setError(readableError(failure));
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    void refresh();
  }, [initial, refresh]);

  const save = async (patch: Parameters<typeof saveGrokBridge>[0]) => {
    setBusy(true);
    setError(null);
    setTestNote(null);
    try {
      const next = await saveGrokBridge(patch);
      setView(next);
      setWebhookUrl(next.webhookUrl ?? "");
      setBotsText(next.bots.join(", "));
      if (patch.key !== undefined) setKey("");
      return true;
    } catch (failure) {
      setError(readableError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSaveLink = () => {
    const bots = botsText.split(/[,;\n]/).map((b) => b.trim()).filter(Boolean);
    void save({
      webhookUrl: webhookUrl.trim(),
      ...(key.trim() ? { key: key.trim() } : {}),
      bots,
      enabled: view?.enabled ?? true,
    });
  };

  const onTest = async () => {
    setBusy(true);
    setError(null);
    setTestNote(null);
    try {
      const result = await testGrokBridge();
      if ("ok" in result && result.ok) setTestNote(t("grokBridge.test.queued"));
      else setError("error" in result ? result.error : t("grokBridge.test.failed"));
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await clearGrokBridge();
      setView(next);
      setWebhookUrl("");
      setKey("");
      setBotsText("");
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div data-settings-card="providers.linkedGrokBot">
        <SettingsGroup title={t("grokBridge.title")} groupId="linkedGrokBot">
          <SettingsTextRow tone={error ? "danger" : "neutral"} live>{error ?? t("grokBridge.loading")}</SettingsTextRow>
        </SettingsGroup>
      </div>
    );
  }

  const orgBlocked = view.orgAllowed === false;
  const inboundPath = view.linkId ? `/api/bridge/grok/${view.linkId}` : null;

  return (
    <div data-settings-card="providers.linkedGrokBot" data-grok-bridge={view.linked ? (view.enabled ? "on" : "off") : "none"}>
      <SettingsGroup title={t("grokBridge.title")} groupId="linkedGrokBot">
        <SettingsTextRow tone={orgBlocked ? "warning" : "neutral"}>{orgBlocked ? t("grokBridge.orgDisabled") : t("grokBridge.intro")}</SettingsTextRow>

        <DescribedRow
          label={t("grokBridge.enabled")}
          rowId="grokBridgeEnabled"
          description={t("grokBridge.enabledHelp")}
        >
          <Switch
            checked={view.enabled}
            disabled={busy || orgBlocked || !view.linked}
            aria-label={t("grokBridge.enabled")}
            onClick={() => void save({ enabled: !view.enabled })}
          />
        </DescribedRow>

        <FieldRow label={t("grokBridge.webhook")} rowId="grokBridgeWebhook" hint={t("grokBridge.webhookHelp")}>
          <input
            className={FIELD}
            type="url"
            inputMode="url"
            dir="ltr"
            spellCheck={false}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={t("grokBridge.urlPlaceholder")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </FieldRow>

        <FieldRow label={t("grokBridge.key")} rowId="grokBridgeKey" hint={view.keySet ? t("grokBridge.keySet") : t("grokBridge.keyHelp")}>
          <input
            className={FIELD}
            dir="ltr"
            type="password"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={view.keySet ? t("grokBridge.keyReplace") : t("grokBridge.keyPlaceholder")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </FieldRow>

        <FieldRow label={t("grokBridge.bots")} rowId="grokBridgeBots" hint={t("grokBridge.botsHelp")}>
          <input
            className={FIELD}
            spellCheck={false}
            value={botsText}
            onChange={(e) => setBotsText(e.target.value)}
            placeholder={t("grokBridge.botsPlaceholder")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </FieldRow>

        <DescribedRow label={t("grokBridge.mayCall")} rowId="grokBridgeMayCall" description={t("grokBridge.mayCallHelp")}>
          <Switch
            checked={view.mayCallOwner}
            disabled={busy || orgBlocked || !view.linked}
            aria-label={t("grokBridge.mayCall")}
            onClick={() => void save({ mayCallOwner: !view.mayCallOwner })}
          />
        </DescribedRow>

        <DescribedRow label={t("grokBridge.mayText")} rowId="grokBridgeMayText" description={t("grokBridge.mayTextHelp")}>
          <Switch
            checked={view.mayTextOwner}
            disabled={busy || orgBlocked || !view.linked}
            aria-label={t("grokBridge.mayText")}
            onClick={() => void save({ mayTextOwner: !view.mayTextOwner })}
          />
        </DescribedRow>

        {inboundPath && (
          <DescribedRow label={t("grokBridge.inbound")} rowId="grokBridgeInbound" description={t("grokBridge.inboundHint")}>
            <CopyAddress path={inboundPath} />
          </DescribedRow>
        )}

        {view.stats && (
          <div data-grok-bridge-stats="">
            <SettingsTextRow>
              {t("grokBridge.stats", {
                sent: String(view.stats.sentToday),
                dead: String(view.stats.deadLetters),
                circuit: view.stats.circuitOpen ? t("grokBridge.circuitOpen") : t("grokBridge.circuitClosed"),
              })}
            </SettingsTextRow>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
          <button type="button" className={PRIMARY_PILL} disabled={busy || orgBlocked || !webhookUrl.trim()} onClick={onSaveLink}>
            {t("grokBridge.save")}
          </button>
          <button type="button" className={PILL} disabled={busy || orgBlocked || !view.linked || !view.keySet || !view.enabled} onClick={() => void onTest()}>
            {t("grokBridge.test")}
          </button>
          {view.linked && (
            <button type="button" className={cn(PILL, "text-danger")} disabled={busy} onClick={() => void onClear()}>
              {t("grokBridge.clear")}
            </button>
          )}
        </div>
        {(error || testNote) && (
          <SettingsTextRow tone={error ? "danger" : "neutral"} live>{error ?? testNote}</SettingsTextRow>
        )}
      </SettingsGroup>
    </div>
  );
}

/** The address Grok Bot posts to: copied, never drawn (its link id is opaque). */
function CopyAddress({ path }: { path: string }) {
  const { state, copy } = useCopyFeedback(path);
  return (
    <button type="button" className={PILL} title={path} data-grok-bridge-inbound="" onClick={copy}>
      {state === "copied" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {state === "copied" ? t("providers.copied") : t("grokBridge.copyInbound")}
    </button>
  );
}
