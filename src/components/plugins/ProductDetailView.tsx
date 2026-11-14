// Connect Apps > a Perspicax product of the person (#4185), a page in the
// window's own stack, in the layout of a plugin's page: the mark, the name
// and the state; a "Key" card (who the key is from, its kind, its masked
// ending, its expiry and its last test, with the person's own actions); the
// address; the access the person has through their roles. The actions are
// exactly those Perspicax lists for the person: none other is drawn. The
// "..." menu opens the product in Perspicax and copies its id.
import { useState } from "react";
import { Check, Copy, ExternalLink, FlaskConical, KeyRound, Loader2, Trash2, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { readableError } from "@/lib/plain-error";
import {
  productKeyAction, productKeySourceLabel, productKindLabel, productModeLabel,
  removePersonProductKey, savePersonProductKey, testPersonProduct, type PersonProduct,
} from "@/lib/person-products";
import type { Crumb } from "../Breadcrumb";
import { PluginCard, PluginIcon, PluginPageHeader } from "./PluginParts";
import { PluginActionsMenu } from "./PluginDetailView";
import { ProductKeyForm } from "./ProductKeyForm";
import { productIcon, ProductStateLabel } from "./ProductRows";
import { PLUGINS } from "./plugins-style";

function KeyRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="contents">
      <dt className="py-[9px] text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 break-words py-[9px] text-right text-ink-secondary" title={title}>{value}</dd>
    </div>
  );
}

function when(at: string | undefined): string | null {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? relativeTime(ms) : null;
}

export function ProductDetailView({ product, onChanged, onBack, trail }: {
  product: PersonProduct;
  /** the refreshed product Perspicax answered after a write */
  onChanged: (product: PersonProduct) => void;
  onBack: () => void;
  trail?: readonly Crumb[];
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const keyAction = productKeyAction(product);
  const key = product.key;
  const lastTest = key?.lastTest;
  const tested = when(lastTest?.at);
  const expires = key?.expiresAt ? (() => {
    const ms = Date.parse(key.expiresAt!);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : key.expiresAt!;
  })() : null;

  const run = async (kind: "test" | "remove", work: () => Promise<PersonProduct>) => {
    setBusy(kind);
    setError(null);
    try {
      onChanged(await work());
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(null);
    }
  };
  const save = async (values: Record<string, string>) => {
    setError(null);
    try {
      const next = await savePersonProductKey(product.id, values);
      onChanged(next);
      // a refused key stays open with the vendor's reason so the person corrects it
      if (next.key?.lastTest?.ok !== false) setEditing(false);
    } catch (failure) {
      setError(readableError(failure));
      throw failure;
    }
  };

  const testLine = lastTest ? (
    <span className={cn("inline-flex items-center gap-1", lastTest.ok ? "text-ink-secondary" : "text-danger")}>
      {lastTest.ok ? <Check size={12} strokeWidth={2.5} className="text-success" aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
      {lastTest.ok
        ? t("personProducts.test.ok", { when: tested ?? lastTest.at })
        : t("personProducts.test.refused", { when: tested ?? lastTest.at, reason: [lastTest.status, lastTest.code].filter((part) => part !== undefined && part !== "").join(", ") || "?" })}
    </span>
  ) : null;

  return (
    <>
      <PluginPageHeader title={product.name} trail={trail} onBack={onBack} named />
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pb-8 pt-[34px] sm:px-[34px]" data-person-product-page={product.id}>
        <div className="flex flex-wrap items-center gap-3" data-plugins-detail-head>
          <PluginIcon item={productIcon(product)} className="size-14 rounded-[14px]" />
          <div className="min-w-0 flex-[1_1_220px] pl-0.5">
            <h2 className="truncate text-[16px] font-normal leading-6 tracking-[-0.008em] text-ink" data-plugins-detail-name>{product.name}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ProductStateLabel product={product} />
            <PluginActionsMenu
              name={product.name}
              busy={busy !== null}
              actions={[
                product.consoleUrl ? { id: "open-console", icon: <ExternalLink size={13} />, label: t("personProducts.openInPerspicax"), onSelect: () => void openExternalLink(product.consoleUrl!) } : undefined,
                { id: "copy-id", icon: <Copy size={13} />, label: t("personProducts.copyId"), onSelect: () => { void copyText(product.id).then((result) => setCopied(result === "copied")); } },
              ]}
            />
          </div>
          {copied && <p role="status" className="basis-full text-right text-[12px] text-success">{t("personProducts.idCopied")}</p>}
        </div>

        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

        <PluginCard title={t("personProducts.key.title")}>
          {key ? (
            <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 text-[13px] leading-5" data-person-product-key={key.source}>
              <KeyRow label={t("personProducts.key.from")} value={productKeySourceLabel(key, product.roles)} title={key.name} />
              {key.kind && <KeyRow label={t("personProducts.key.kind")} value={productKindLabel(key.kind)} />}
              {key.ending && <KeyRow label={t("personProducts.key.ending")} value={`•••• ${key.ending}`} />}
              {expires && <KeyRow label={t("personProducts.key.expires")} value={expires} />}
              {testLine && (
                <div className="contents">
                  <dt className="py-[9px] text-ink-tertiary">{t("personProducts.key.lastTest")}</dt>
                  <dd className="min-w-0 py-[9px] text-right" data-person-product-test={lastTest!.ok ? "ok" : "refused"}>{testLine}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="py-[9px] text-[13px] leading-5 text-ink-secondary" data-person-product-key="none">{t("personProducts.key.none")}</p>
          )}
          {editing && product.form && keyAction ? (
            <div className="border-t-[0.5px] border-ink/10 py-3">
              <ProductKeyForm
                form={product.form}
                productName={product.name}
                variant="page"
                onSave={save}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (keyAction || product.actions.includes("test") || product.actions.includes("remove_own_key")) ? (
            <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-ink/10 py-2.5" data-person-product-actions>
              {keyAction && (
                <button type="button" className={PLUGINS.primaryPill} disabled={busy !== null} onClick={() => setEditing(true)} data-person-product-action={keyAction === "replace_key" && key?.source !== "own" ? "replace_shared" : key?.source === "own" ? "replace_own" : "add_own"}>
                  <KeyRound size={14} aria-hidden="true" />
                  {keyAction === "replace_key" && key?.source !== "own"
                    ? t("personProducts.action.replaceShared")
                    : key?.source === "own" ? t("personProducts.action.replaceOwn") : t("personProducts.action.addOwn")}
                </button>
              )}
              {product.actions.includes("test") && key && (
                <button type="button" className={PLUGINS.fillPill} disabled={busy !== null} onClick={() => void run("test", () => testPersonProduct(product.id))} data-person-product-action="test">
                  {busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={14} aria-hidden="true" />}
                  {t("personProducts.action.test")}
                </button>
              )}
              {product.actions.includes("remove_own_key") && key?.source === "own" && (
                <button type="button" className={PLUGINS.fillPill} disabled={busy !== null} onClick={() => void run("remove", () => removePersonProductKey(product.id))} data-person-product-action="remove">
                  {busy === "remove" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                  {t("personProducts.action.remove")}
                </button>
              )}
            </div>
          ) : product.actions.length === 0 && product.consoleUrl ? (
            <div className="border-t-[0.5px] border-ink/10 py-2.5">
              <button type="button" className={PLUGINS.fillPill} onClick={() => void openExternalLink(product.consoleUrl!)} data-person-product-action="console">
                <ExternalLink size={14} aria-hidden="true" /> {t("personProducts.openInPerspicax")}
              </button>
            </div>
          ) : null}
        </PluginCard>

        {product.address && (
          <PluginCard title={t("personProducts.address")}>
            <p className="break-all py-[9px] text-[13px] leading-5 text-ink-secondary" data-person-product-address>{product.address}</p>
          </PluginCard>
        )}

        {product.roles.length > 0 && (
          <PluginCard title={t("personProducts.access")}>
            <ul data-person-product-roles>
              {product.roles.map((role) => {
                const mode = productModeLabel(role.mode);
                return (
                  <li key={role.slug} className="flex min-h-[38px] items-center gap-3 py-1.5" title={role.slug}>
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">{role.name}</span>
                    {mode && <span className="shrink-0 text-[12.5px] text-ink-secondary">{mode}</span>}
                  </li>
                );
              })}
            </ul>
          </PluginCard>
        )}
      </div>
    </>
  );
}
