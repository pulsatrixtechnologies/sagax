// The one form of a Perspicax product key (#4185), drawn from the fields
// Perspicax serves for that product (`form.fields`): a product's page and
// its key card in the chat both use it. A secret field is masked and never
// remembered by the browser; the required fields gate Save; Save sends every
// value in one request, then the values are dropped from the form.
import { useState, type FormEvent } from "react";
import { Loader2, LockKeyhole } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { productFieldLabel } from "@/lib/person-products";
import type { ProductForm } from "../../../shared/person-products";
import { ASK_FIELD, ASK_PRIMARY_BUTTON, ASK_QUIET_BUTTON } from "../AskCard";
import { PLUGINS } from "./plugins-style";

export function ProductKeyForm({ form, productName, variant, onSave, onCancel, submitLabel }: {
  form: ProductForm;
  productName: string;
  /** page: a product's page in Connect Apps; card: the key card in the chat */
  variant: "page" | "card";
  /** resolves when saved; a rejection keeps the values for a correction */
  onSave: (values: Record<string, string>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const ready = form.fields.every((field) => !field.required || Boolean(values[field.slot]?.trim()))
    && form.fields.some((field) => Boolean(values[field.slot]?.trim()));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      const sent: Record<string, string> = {};
      for (const field of form.fields) {
        const value = values[field.slot]?.trim();
        if (value) sent[field.slot] = value;
      }
      await onSave(sent);
      setValues({});
    } catch {
      // the caller shows why; the values stay to be corrected
    } finally {
      setSaving(false);
    }
  };
  const card = variant === "card";
  return (
    <form onSubmit={(event) => void submit(event)} data-product-key-form={form.kind} className={card ? "space-y-2" : "space-y-3"}>
      {form.fields.map((field) => {
        const label = productFieldLabel(field);
        return (
          <label key={field.slot} className="block" data-product-key-field={field.slot}>
            <span className={card ? "mb-1 block text-[12px] leading-4 text-ink-secondary" : PLUGINS.fieldLabel}>
              {label}{!field.required && <span className="text-ink-tertiary"> {t("personProducts.form.optional")}</span>}
            </span>
            <input
              type={field.secret ? "password" : "text"}
              autoComplete={field.secret ? "new-password" : "off"}
              spellCheck={false}
              dir="ltr"
              value={values[field.slot] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.slot]: event.target.value }))}
              placeholder={field.placeholder}
              required={field.required}
              disabled={saving}
              aria-label={`${productName}: ${label}`}
              className={card ? cn(ASK_FIELD, "w-full") : PLUGINS.outlineField}
            />
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={!ready || saving} data-product-key-save className={card ? ASK_PRIMARY_BUTTON : PLUGINS.primaryPill}>
          {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
          {submitLabel ?? t("personProducts.form.save")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={card ? ASK_QUIET_BUTTON : PLUGINS.fillPill}>
            {t("personProducts.form.cancel")}
          </button>
        )}
        <span className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">
          <LockKeyhole size={11} aria-hidden="true" /> {t("personProducts.form.private")}
        </span>
      </div>
    </form>
  );
}
