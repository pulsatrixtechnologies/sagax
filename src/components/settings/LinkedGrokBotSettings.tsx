// Settings > Providers > Advanced > Link with Grok Bot (#2193; in Advanced since #2295): the person's own webhook URL
// and sealed key. Their Sagax bots reach only this link. Never shows the key
// after save. Test sends a signed envelope. Phone opt-ins for owner call/text.
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
import { DescribedRow, FIELD, PILL, SettingsGroup, Switch } from "../SettingsPrimitives";
import { cn } from "@/lib/cn";

const inputClass = cn(FIELD, "w-full max-w-md");

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
      if ("ok" in result && result.ok) setTestNote(t("grokBridge.test.queued", { id: result.jobId }));
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
          <p role={error ? "alert" : "status"} className={cn("px-3.5 py-2.5 text-[12px]", error ? "text-danger" : "text-ink-secondary")}>{error ?? t("grokBridge.loading")}</p>
        </SettingsGroup>
      </div>
    );
  }

  const orgBlocked = view.orgAllowed === false;

  return (
    <div data-settings-card="providers.linkedGrokBot" data-grok-bridge={view.linked ? (view.enabled ? "on" : "off") : "none"}>
      <SettingsGroup title={t("grokBridge.title")} groupId="linkedGrokBot">
        <p className="px-3.5 pt-2.5 pb-1 text-[12px] leading-4 text-ink-secondary">{orgBlocked ? t("grokBridge.orgDisabled") : t("grokBridge.intro")}</p>
        {error && <p role="alert" className="px-3.5 pb-1 text-[12px] text-danger">{error}</p>}
        {testNote && <p role="status" className="px-3.5 pb-1 text-[12px] text-ink-secondary">{testNote}</p>}

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

        <DescribedRow label={t("grokBridge.webhook")} rowId="grokBridgeWebhook" description={t("grokBridge.webhookHelp")}>
          <input
            className={inputClass}
            dir="ltr"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={t("grokBridge.urlPlaceholder")}
            aria-label={t("grokBridge.webhook")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </DescribedRow>

        <DescribedRow
          label={t("grokBridge.key")}
          rowId="grokBridgeKey"
          description={view.keySet ? t("grokBridge.keySet") : t("grokBridge.keyHelp")}
        >
          <input
            className={inputClass}
            dir="ltr"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={view.keySet ? t("grokBridge.keyReplace") : t("grokBridge.keyPlaceholder")}
            aria-label={t("grokBridge.key")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </DescribedRow>

        <DescribedRow label={t("grokBridge.bots")} rowId="grokBridgeBots" description={t("grokBridge.botsHelp")}>
          <input
            className={inputClass}
            value={botsText}
            onChange={(e) => setBotsText(e.target.value)}
            placeholder={t("grokBridge.botsPlaceholder")}
            aria-label={t("grokBridge.bots")}
            autoComplete="off"
            disabled={busy || orgBlocked}
          />
        </DescribedRow>

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

        {view.stats && (
          <p className="px-3.5 pt-1 text-[12px] text-ink-secondary" data-grok-bridge-stats="">
            {t("grokBridge.stats", {
              sent: String(view.stats.sentToday),
              dead: String(view.stats.deadLetters),
              circuit: view.stats.circuitOpen ? t("grokBridge.circuitOpen") : t("grokBridge.circuitClosed"),
            })}
          </p>
        )}

        <div className="flex flex-wrap gap-2 px-3.5 py-2.5">
          <button type="button" className={PILL} disabled={busy || orgBlocked || !webhookUrl.trim()} onClick={onSaveLink}>
            {t("grokBridge.save")}
          </button>
          <button type="button" className={PILL} disabled={busy || orgBlocked || !view.linked || !view.keySet || !view.enabled} onClick={() => void onTest()}>
            {t("grokBridge.test")}
          </button>
          {view.linked && (
            <button type="button" className={PILL} disabled={busy} onClick={() => void onClear()}>
              {t("grokBridge.clear")}
            </button>
          )}
        </div>
        {view.linkId && (
          <p className="px-3.5 pb-2 text-[12px] text-ink-secondary" data-grok-bridge-link-id="">
            {t("grokBridge.inboundHint", { path: `/api/bridge/grok/${view.linkId}` })}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}
