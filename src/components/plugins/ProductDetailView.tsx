// Connect Apps > a Perspicax product of the person (#4185), a page in the
// window's own stack, in the layout of a plugin's page: the mark, the name
// and the state; a "Key" card (who the key is from, its kind, its masked
// ending, its expiry and its last test, with the person's own actions); the
// address; the access the person has through their roles (a direct link in
// words, never its hidden role's name). The actions are
// exactly those Perspicax lists for the person: none other is drawn. The
// "..." menu opens the product in Perspicax and copies its id.
import { useState } from "react";
import { Check, ExternalLink, FlaskConical, KeyRound, Loader2, Trash2, X } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { readableError } from "@/lib/plain-error";
import {
  productFieldLabel, productKeySourceLabel, productKeyTargets, productKindLabel, productModeLabel,
  removePersonProductKey, savePersonProductKey, testPersonProduct, type PersonProduct, type ProductKeyTarget,
} from "@/lib/person-products";
import type { Crumb } from "../Breadcrumb";
import { PluginCard, PluginIcon, PluginPageHeader } from "./PluginParts";
import { PluginActionsMenu } from "./PluginDetailView";
import { ProductKeyForm } from "./ProductKeyForm";
import { productIcon, productMenuActions, ProductStateLabel } from "./ProductRows";
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
  const [editing, setEditing] = useState<ProductKeyTarget | null>(null);
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const targets = productKeyTargets(product);
  const key = product.key;
  const lastTest = key?.lastTest;
  const tested = when(lastTest?.at);
  const day = (at: string | undefined) => {
    if (!at) return null;
    const ms = Date.parse(at);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : at;
  };
  const expired = day(key?.expiredAt);
  const expires = expired ? null : day(key?.expiresAt);
  const failingSince = lastTest && !lastTest.ok ? day(lastTest.since) : null;
  // the slot the ending is from, by its label in the form when the form names it
  const endingField = key?.endingSlot ? product.form?.fields.find((field) => field.slot === key.endingSlot) : undefined;
  const endingFrom = endingField ? productFieldLabel(endingField) : key?.endingSlot;

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
  const save = async (target: ProductKeyTarget, values: Record<string, string>) => {
    setError(null);
    try {
      const next = await savePersonProductKey(product.id, target, values);
      onChanged(next);
      // a refused key stays open with the vendor's reason so the person corrects it
      if (next.key?.lastTest?.ok !== false) setEditing(null);
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
              actions={productMenuActions(product, 13, setCopied).map(({ run, ...action }) => ({ ...action, onSelect: run }))}
            />
          </div>
          {copied && <p role="status" className="basis-full text-right text-[12px] text-success">{t("personProducts.idCopied")}</p>}
        </div>

        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}

        <PluginCard title={t("personProducts.key.title")}>
          {key ? (
            <dl className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-4 text-[13px] leading-5" data-person-product-key={key.source}>
              <KeyRow label={t("personProducts.key.from")} value={productKeySourceLabel(key, product)} title={key.name} />
              {key.kind && <KeyRow label={t("personProducts.key.kind")} value={productKindLabel(key.kind)} />}
              {key.ending && <KeyRow label={t("personProducts.key.ending")} value={`•••• ${key.ending}`} title={endingFrom} />}
              {expired && <KeyRow label={t("personProducts.key.expired")} value={expired} />}
              {expires && <KeyRow label={t("personProducts.key.expires")} value={expires} />}
              {testLine && (
                <div className="contents">
                  <dt className="py-[9px] text-ink-tertiary">{t("personProducts.key.lastTest")}</dt>
                  <dd className="min-w-0 py-[9px] text-right" data-person-product-test={lastTest!.ok ? "ok" : "refused"}
                    title={failingSince ? t("personProducts.test.since", { when: failingSince }) : undefined}>{testLine}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="py-[9px] text-[13px] leading-5 text-ink-secondary" data-person-product-key="none">{t("personProducts.key.none")}</p>
          )}
          {editing && product.form && targets.includes(editing) ? (
            <div className="border-t-[0.5px] border-ink/10 py-3">
              <ProductKeyForm
                form={product.form}
                productName={product.name}
                variant="page"
                onSave={(values) => save(editing, values)}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : (targets.length > 0 || product.actions.includes("test") || product.actions.includes("remove_own_key")) ? (
            <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-ink/10 py-2.5" data-person-product-actions>
              {targets.map((target, index) => {
                // own: add the person's key, or replace it when the serving key is theirs; serving: replace the key that serves them
                const action = target === "serving" ? "replace_shared" : key?.own ? "replace_own" : "add_own";
                return (
                  <button key={target} type="button" className={index === 0 ? PLUGINS.primaryPill : PLUGINS.fillPill} disabled={busy !== null} onClick={() => setEditing(target)} data-person-product-action={action}>
                    <KeyRound size={14} aria-hidden="true" />
                    {action === "replace_shared" ? t("personProducts.action.replaceShared")
                      : action === "replace_own" ? t("personProducts.action.replaceOwn") : t("personProducts.action.addOwn")}
                  </button>
                );
              })}
              {product.actions.includes("test") && (
                <button type="button" className={PLUGINS.fillPill} disabled={busy !== null} onClick={() => void run("test", () => testPersonProduct(product.id))} data-person-product-action="test">
                  {busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={14} aria-hidden="true" />}
                  {t("personProducts.action.test")}
                </button>
              )}
              {product.actions.includes("remove_own_key") && (
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
              {product.roles.map((role, index) => {
                const mode = productModeLabel(role.mode);
                return (
                  <li key={`${index}:${role.name}`} className="flex min-h-[38px] items-center gap-3 py-1.5" data-person-product-role={role.personal ? "direct" : "role"}>
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">{role.personal ? t("personProducts.access.direct") : role.name}</span>
                    {mode && <span className="shrink-0 text-[12.5px] text-ink-secondary" data-person-product-mode>{mode}</span>}
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
