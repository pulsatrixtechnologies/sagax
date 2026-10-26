// "Plugin configuration" on a bot's plugin (2026-10-21, parity with Grok
// Bot): the fields the plugin declares (server/plugin-config.ts), saved for
// this bot and written into its skills. A secret field has no input here:
// it belongs in Settings > Credentials, never in the plugin's files.
import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import type { PluginConfigView } from "@/lib/my-connections";
import { Switch } from "../SettingsPrimitives";

type Draft = Record<string, string | boolean>;

/** The form's starting text: the saved value, else empty (the default shows
 * as a placeholder). Pure. */
export function configDraft(config: PluginConfigView): Draft {
  const draft: Draft = {};
  for (const field of config.fields) {
    if (field.sensitive) continue;
    const value = config.values[field.key];
    draft[field.key] = field.type === "boolean" ? Boolean(value ?? field.default ?? false) : value === undefined ? "" : String(value);
  }
  return draft;
}

/** What Save sends: the typed-in values; an empty field clears it. Pure. */
export function configValues(config: PluginConfigView, draft: Draft): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const field of config.fields) {
    if (field.sensitive || !(field.key in draft)) continue;
    const value = draft[field.key]!;
    if (typeof value === "boolean") values[field.key] = value;
    else if (value.trim()) values[field.key] = field.type === "number" ? Number(value) : value.trim();
    else values[field.key] = "";
  }
  return values;
}

export function PluginConfigForm({ config, canChange, onSave }: {
  config: PluginConfigView;
  canChange: boolean;
  onSave: (values: Record<string, string | number | boolean>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => configDraft(config));
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  useEffect(() => setDraft(configDraft(config)), [config]);
  const save = async () => {
    setState("saving");
    setError("");
    try {
      await onSave(configValues(config, draft));
      setState("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("idle");
    }
  };
  const field = "mt-1 w-full rounded-lg border border-hairline/60 bg-inset px-3 py-1.5 text-[12.5px] text-ink disabled:opacity-60";
  return (
    <section data-plugin-config className="mt-3 rounded-xl border border-hairline/50 px-3.5 py-3">
      <h4 className="text-[12.5px] font-semibold text-ink">{t("plugins.config.title")}</h4>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("plugins.config.intro")}</p>
      <div className="mt-2 space-y-2.5">
        {config.fields.map((entry) => entry.sensitive ? (
          <div key={entry.key} data-plugin-config-secret={entry.key} className="flex items-start gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">
            <KeyRound size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span><span className="font-medium text-ink">{entry.title}</span> · {t("plugins.config.secret")}</span>
          </div>
        ) : entry.type === "boolean" ? (
          <div key={entry.key} className="flex items-center justify-between gap-3 text-[12.5px] text-ink">
            <span className="min-w-0">
              <span className="block">{entry.title}</span>
              {entry.description && <span className="block text-[11.5px] text-ink-secondary">{entry.description}</span>}
            </span>
            <Switch checked={Boolean(draft[entry.key])} disabled={!canChange} aria-label={entry.title}
              onClick={() => setDraft({ ...draft, [entry.key]: !draft[entry.key] })} />
          </div>
        ) : (
          <label key={entry.key} className="block text-[12.5px] text-ink">
            {entry.title}{entry.required && <span aria-hidden="true" className="text-danger"> *</span>}
            {entry.description && <span className="block text-[11.5px] text-ink-secondary">{entry.description}</span>}
            <input
              type={entry.type === "number" ? "number" : "text"}
              data-plugin-config-field={entry.key}
              value={String(draft[entry.key] ?? "")}
              placeholder={entry.default === undefined ? "" : String(entry.default)}
              required={entry.required}
              disabled={!canChange}
              onChange={(event) => { setDraft({ ...draft, [entry.key]: event.target.value }); setState("idle"); }}
              className={field}
            />
          </label>
        ))}
      </div>
      {canChange && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" data-plugin-config-save disabled={state === "saving"} onClick={() => void save()} className="ui-button ui-button-primary flex items-center gap-1.5 text-[12px]">
            {state === "saving" && <Loader2 size={13} className="animate-spin" />}{t("plugins.config.save")}
          </button>
          {state === "saved" && <span role="status" className="text-[12px] text-success">{t("plugins.config.saved")}</span>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
