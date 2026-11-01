// Capabilities lot 4: the organization's capabilities in Plugins > Installed.
//
// - Me scope (every person of an organization server): what the
//   organization offers and imposes. An offered one is off until the person
//   turns it on for all their bots (their own Me state, no admin); an
//   imposed one is on and says so, with no switch.
// - Organization scope (an admin, Perspicax owns the declarations): the
//   same list with Add, Edit and Remove, and the same form as the Perspicax
//   console (shared/org-capability-form.ts mirrors its field and validation
//   definition). The execution configuration is write-only: never
//   prefilled; an edit sends one only when the admin chooses to replace it.
//
// No new page and no bot panel tab: this section lives where the
// Organization scope is already chosen.
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  loadInventory, loadMine, removeDeclaration, saveDeclaration, setMine,
  type MemberOrgCapability, type OrgInventory,
} from "@/lib/org-capabilities";
import {
  CAPABILITY_FORMS, CAPABILITY_MODES, MCP_TRANSPORTS, draftFromCapability, draftToInput, emptyDraft, validateDraft, visibleFields,
  type Capability as Declaration, type CapabilityDraft, type DraftErrors, type DraftField, type FieldError,
} from "../../../shared/org-capability-form";
import { Switch } from "../SettingsPrimitives";

const CHIP = "rounded-full px-2 py-0.5 text-[11px] font-medium";
const fieldClass = "w-full rounded-lg border border-border bg-raised px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

function errorText(error: FieldError | undefined): string | null {
  return error ? t(error.key as never, error.vars) : null;
}

/** The words of a declaration's mode, for its chip. */
export function modeWords(mode: "offered" | "imposed"): string {
  return t(mode === "imposed" ? "orgCapabilities.mode.imposed" : "orgCapabilities.mode.offered");
}

/** What this server did of it, when it is not simply ready. */
export function installWords(state: MemberOrgCapability["state"], enabled: boolean): string | null {
  if (!enabled || state === "off") return t("orgCapabilities.state.off");
  if (state === "pending") return t("orgCapabilities.state.pending");
  if (state === "failed") return t("orgCapabilities.state.failed");
  return null;
}

function formWords(form: "plugin" | "skill" | "mcp"): string {
  return t(`orgCapabilities.form.${form}` as never);
}

/** Me scope: the organization's capabilities for the person, with their
 * own switch on an offered one. */
export function OrgCapabilitiesForMe() {
  const [items, setItems] = useState<MemberOrgCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadMine().then((answer) => { if (alive) setItems(answer.items); }, (failure) => { if (alive) setError(readableError(failure)); });
    return () => { alive = false; };
  }, []);
  if (error) return <p role="alert" className="mb-3 text-[12px] text-danger">{error}</p>;
  if (!items || items.length === 0) return null;
  const toggle = async (item: MemberOrgCapability) => {
    setBusy(item.id);
    setError(null);
    try {
      const answer = await setMine(item.id, !item.on);
      setItems((current) => current?.map((row) => row.id === item.id ? answer.item : row) ?? null);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mb-4" data-org-capabilities="me">
      <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{t("orgCapabilities.me.title")}</h3>
      <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
        {items.map((item) => {
          const state = installWords(item.state, item.enabled);
          return (
            <li key={item.id} data-org-capability={item.form} data-org-capability-mode={item.mode} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13px] text-ink">{item.name}</span>
                <span className="block text-[11.5px] text-ink-secondary">{[formWords(item.form), item.version ? t("orgCapabilities.version", { version: item.version }) : "", state ?? ""].filter(Boolean).join(" · ")}</span>
              </span>
              <span className={cn(CHIP, item.mode === "imposed" ? "bg-accent/15 text-accent-text" : "bg-ink/10 text-ink-secondary")} data-org-capability-mode-chip="">{modeWords(item.mode)}</span>
              {item.canToggle ? (
                busy === item.id
                  ? <LoaderCircle size={14} className="mx-3 animate-spin text-ink-secondary motion-reduce:animate-none" aria-hidden="true" />
                  : <Switch checked={item.on} onClick={() => void toggle(item)} aria-label={t(item.on ? "orgCapabilities.me.offAria" : "orgCapabilities.me.onAria", { name: item.name })} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("orgCapabilities.me.hint")}</p>
    </section>
  );
}

function DraftFieldView({ field, draft, set, errors, creating }: { field: DraftField; draft: CapabilityDraft; set: (patch: Partial<CapabilityDraft>) => void; errors: DraftErrors; creating: boolean }) {
  const label = t(`orgCapabilities.field.${field}` as never);
  const error = errorText(errors[field]);
  const id = `org-capability-${field}`;
  const wrap = (control: React.ReactNode) => (
    <div className="flex flex-col gap-1" data-org-capability-field={field}>
      <label htmlFor={id} className="text-[12px] font-medium text-ink">{label}</label>
      {control}
      {error && <p role="alert" className="text-[11.5px] text-danger">{error}</p>}
    </div>
  );
  switch (field) {
    case "form":
      return wrap(
        <select id={id} className={fieldClass} value={draft.form} disabled={!creating} onChange={(event) => set({ ...emptyDraft(event.target.value as CapabilityDraft["form"]), mountName: draft.mountName, name: draft.name, description: draft.description, mode: draft.mode, enabled: draft.enabled })}>
          {CAPABILITY_FORMS.map((form) => <option key={form} value={form}>{formWords(form)}</option>)}
        </select>,
      );
    case "mode":
      return wrap(
        <select id={id} className={fieldClass} value={draft.mode} onChange={(event) => set({ mode: event.target.value as CapabilityDraft["mode"] })}>
          {CAPABILITY_MODES.map((mode) => <option key={mode} value={mode}>{modeWords(mode)}</option>)}
        </select>,
      );
    case "transport":
      return wrap(
        <select id={id} className={fieldClass} value={draft.transport} onChange={(event) => set({ transport: event.target.value as CapabilityDraft["transport"] })}>
          {MCP_TRANSPORTS.map((transport) => <option key={transport} value={transport}>{t(`orgCapabilities.transport.${transport}` as never)}</option>)}
        </select>,
      );
    case "description":
    case "pluginValues":
    case "args":
    case "env":
    case "headers":
      return wrap(<textarea id={id} rows={3} className={cn(fieldClass, field !== "description" && "font-mono")} value={draft[field]} autoComplete="off"
        placeholder={t(`orgCapabilities.field.${field}Hint` as never)} onChange={(event) => set({ [field]: event.target.value })} />);
    case "skillFiles":
      return wrap(
        <div className="flex flex-col gap-2" id={id}>
          {draft.skillFiles.map((file, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-lg border border-border p-2">
              <div className="flex items-center gap-2">
                <input aria-label={t("orgCapabilities.field.skillPath")} className={cn(fieldClass, "font-mono")} value={file.path}
                  onChange={(event) => set({ skillFiles: draft.skillFiles.map((row, at) => at === index ? { ...row, path: event.target.value } : row) })} />
                {index > 0 && (
                  <button type="button" className="ui-icon-button" aria-label={t("orgCapabilities.field.skillRemove", { path: file.path })}
                    onClick={() => set({ skillFiles: draft.skillFiles.filter((_, at) => at !== index) })}><Trash2 size={13} aria-hidden="true" /></button>
                )}
              </div>
              <textarea aria-label={t("orgCapabilities.field.skillContent", { path: file.path })} rows={5} className={cn(fieldClass, "font-mono")} value={file.content}
                onChange={(event) => set({ skillFiles: draft.skillFiles.map((row, at) => at === index ? { ...row, content: event.target.value } : row) })} />
            </div>
          ))}
          <div><button type="button" className="ui-button" onClick={() => set({ skillFiles: [...draft.skillFiles, { path: "", content: "" }] })}>{t("orgCapabilities.field.skillAdd")}</button></div>
        </div>,
      );
    default: {
      const key = field as "mountName" | "name" | "marketplaceUrl" | "version" | "command" | "url";
      return wrap(<input id={id} className={cn(fieldClass, key !== "name" && "font-mono")} value={draft[key]} autoComplete="off"
        placeholder={t(`orgCapabilities.field.${key}Hint` as never)} onChange={(event) => set({ [key]: event.target.value })} />);
    }
  }
}

/** The same form as the Perspicax console: one declaration to add or edit. */
export function OrgCapabilityForm({ initial, onDone, onCancel }: { initial?: Declaration; onDone: () => void; onCancel: () => void }) {
  const creating = !initial;
  const [draft, setDraft] = useState<CapabilityDraft>(() => initial ? draftFromCapability(initial) : emptyDraft());
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (patch: Partial<CapabilityDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const fields = visibleFields(draft);
  const showConfiguration = creating || draft.replaceConfiguration;
  const submit = async () => {
    const found = validateDraft(draft, creating);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await saveDeclaration(draftToInput(draft, creating), initial?.id);
      onDone();
    } catch (error) {
      setFailure(readableError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form data-org-capability-form={creating ? "new" : "edit"} className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h4 className="text-[13px] font-semibold text-ink">{t(creating ? "orgCapabilities.admin.addTitle" : "orgCapabilities.admin.editTitle")}</h4>
      {fields.filter((field) => !field.configuration).map((field) => <DraftFieldView key={field.key} field={field.key} draft={draft} set={set} errors={errors} creating={creating} />)}
      <label className="flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        {t("orgCapabilities.field.enabled")}
      </label>
      {!creating && (
        <label className="flex items-center gap-2 text-[12.5px] text-ink" data-org-capability-replace="">
          <input type="checkbox" checked={draft.replaceConfiguration} onChange={(event) => set({ replaceConfiguration: event.target.checked })} />
          {t("orgCapabilities.field.replaceConfiguration")}
        </label>
      )}
      {!creating && !draft.replaceConfiguration && <p className="text-[11.5px] text-ink-secondary">{t("orgCapabilities.field.sealed")}</p>}
      {showConfiguration && fields.filter((field) => field.configuration).map((field) => <DraftFieldView key={field.key} field={field.key} draft={draft} set={set} errors={errors} creating={creating} />)}
      {failure && <p role="alert" className="text-[12px] text-danger">{failure}</p>}
      <div className="flex gap-2">
        <button type="submit" className="ui-button" disabled={busy}>{t(creating ? "orgCapabilities.admin.add" : "orgCapabilities.admin.save")}</button>
        <button type="button" className="ui-button" onClick={onCancel} disabled={busy}>{t("orgCapabilities.admin.cancel")}</button>
      </div>
    </form>
  );
}

/** Organization scope, for an admin, on a server whose Perspicax owns the
 * declarations: the list, Add, Edit and Remove. Unlinked: nothing (the
 * Organization scope keeps its local behaviour). */
export function OrgCapabilitiesAdmin() {
  const [inventory, setInventory] = useState<OrgInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Declaration | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setInventory(await loadInventory());
      setError(null);
    } catch (failure) {
      setError(readableError(failure));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  if (inventory?.owner === "local") return null;
  const remove = async (row: Declaration) => {
    if (!window.confirm(t("orgCapabilities.admin.removeConfirm", { name: row.name }))) return;
    setBusy(row.id);
    try {
      await removeDeclaration(row.id);
      await reload();
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(null);
    }
  };
  const rows = inventory?.capabilities ?? [];
  return (
    <section className="mb-4" data-org-capabilities="admin">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{t("orgCapabilities.admin.title")}</h3>
        {inventory && editing === null && (
          <button type="button" onClick={() => setEditing("new")} data-org-capability-add="" className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover">
            <Plus size={14} aria-hidden="true" /> {t("orgCapabilities.admin.add")}
          </button>
        )}
      </div>
      <p className="mb-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("orgCapabilities.admin.intro")}</p>
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}
      {editing !== null && (
        <OrgCapabilityForm initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />
      )}
      {inventory && rows.length === 0 && editing === null && <p className="rounded-xl bg-inset px-4 py-3 text-[12.5px] text-ink-secondary">{t("orgCapabilities.admin.empty")}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
          {rows.map((row) => {
            const installed = inventory?.installed?.[row.id];
            const state = installed ? installWords(installed.state, row.enabled) : row.enabled ? null : t("orgCapabilities.state.off");
            return (
              <li key={row.id} data-org-capability={row.form} data-org-capability-mode={row.mode} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] text-ink">{row.name}</span>
                  <span className="block text-[11.5px] text-ink-secondary" title={installed?.error}>{[formWords(row.form), row.mount_name, state ?? ""].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={cn(CHIP, row.mode === "imposed" ? "bg-accent/15 text-accent-text" : "bg-ink/10 text-ink-secondary")}>{modeWords(row.mode)}</span>
                <button type="button" className="ui-icon-button" aria-label={t("orgCapabilities.admin.editAria", { name: row.name })} onClick={() => setEditing(row)} disabled={busy !== null}>
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button type="button" className="ui-icon-button" aria-label={t("orgCapabilities.admin.removeAria", { name: row.name })} onClick={() => void remove(row)} disabled={busy !== null}>
                  {busy === row.id ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
