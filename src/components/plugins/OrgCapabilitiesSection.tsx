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
import { BookOpen, ChevronRight, LoaderCircle, Pencil, Plug, Plus, Puzzle, Trash2 } from "lucide-react";

import { useConfirm } from "@/components/ConfirmProvider";
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
const fieldClass = "w-full rounded-lg border border-border bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-secondary focus:border-accent";

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

/** The person's view of the organization's capabilities: read once, with
 * their own switch (no administrator). Shared by the console's section of
 * Connect Apps (which needs to know whether there is anything to list) and
 * by the stand-alone list. */
export function useOrgCapabilitiesForMe(active = true) {
  const [items, setItems] = useState<MemberOrgCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setError(null);
    void loadMine().then((answer) => { if (alive) setItems(answer.items); }, (failure) => { if (alive) setError(readableError(failure)); });
    return () => { alive = false; };
  }, [attempt, active]);
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
  return { items, error, busy, toggle, retry: () => setAttempt((n) => n + 1) };
}

export type OrgCapabilitiesForMeState = ReturnType<typeof useOrgCapabilitiesForMe>;

/** #4453: one kind of Connect Apps lists its own forms only */
export function orgCapabilitiesOfForms(state: OrgCapabilitiesForMeState, forms?: readonly string[]): MemberOrgCapability[] {
  return (forms ? state.items?.filter((item) => forms.includes(item.form)) : state.items) ?? [];
}

/** The skills the console offers that go with one vendor (its bundle's Skills
 * tab): only a skill the console names the vendor of; none known, none listed
 * (a name is never matched to a vendor by its words). `vendorKey` is the
 * bundle's key, `vendor:<group id>`. */
export function vendorSkillsOf(state: OrgCapabilitiesForMeState, vendorKey: string): Array<{ name: string; description: string }> {
  const group = vendorKey.replace(/^vendor:/, "");
  return orgCapabilitiesOfForms(state, ["skill"]).filter((item) => item.vendor === group).map((item) => ({ name: item.name, description: item.description }));
}

/** Me scope: the organization's capabilities for the person, with their
 * own switch on an offered one. `bare`: the rows alone, for the console's
 * section of Connect Apps, which has the title. */
export function OrgCapabilitiesForMe({ forms, state: given, bare = false }: { forms?: readonly string[]; state?: OrgCapabilitiesForMeState; bare?: boolean } = {}) {
  const own = useOrgCapabilitiesForMe(given === undefined);
  const { items, error, busy, toggle, retry } = given ?? own;
  // #2104: a failure says what did not load and offers to try again (a bare
  // error code stood alone in red before)
  if (error) {
    return (
      <p role="alert" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-inset px-4 py-3 text-[13px] text-ink-secondary" data-org-capabilities-failed>
        <span>{t("orgCapabilities.member.loadFailed", { error })}</span>
        <button type="button" onClick={retry} className="text-[13px] font-medium text-accent-text hover:underline">{t("orgCapabilities.member.retry")}</button>
      </p>
    );
  }
  const shown = orgCapabilitiesOfForms({ items } as OrgCapabilitiesForMeState, forms);
  if (shown.length === 0) return null;
  const rows = (
    <ul className={bare ? "flex flex-col divide-y divide-hairline-weak" : "divide-y divide-hairline/60 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015]"}>
      {shown.map((item) => {
        const state = installWords(item.state, item.enabled);
        return (
          <li key={item.id} data-org-capability={item.form} data-org-capability-mode={item.mode} data-item-row="" className={cn("flex items-center gap-3", bare ? "px-3 py-3" : "px-3 py-2")}>
            {bare && (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary" aria-hidden="true">
                {item.form === "plugin" ? <Puzzle size={18} /> : item.form === "skill" ? <BookOpen size={18} /> : <Plug size={18} />}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[13px] font-medium leading-[18px] text-ink">{item.name}</span>
              <span className="block text-[12px] leading-4 text-ink-secondary" data-org-capability-origin="">{[bare ? t(item.mode === "imposed" ? "connectApps.origin.required" : "connectApps.origin.offered") : "", formWords(item.form), item.version ? t("orgCapabilities.version", { version: item.version }) : "", state ?? ""].filter(Boolean).join(" \u00b7 ")}</span>
            </span>
            {!bare && <span className="shrink-0 whitespace-nowrap text-[12px] leading-4 text-ink-secondary" data-org-capability-mode-chip="">{modeWords(item.mode)}</span>}
            {/* the same columns as every row's right side (state, switch, "..."), so the switches line up */}
            <span className={cn("flex shrink-0 items-center", bare && "gap-2")}>
              {bare && <span className="size-7 shrink-0" aria-hidden="true" />}
              {item.canToggle ? (
                busy === item.id
                  ? <LoaderCircle size={14} className="mx-3 animate-spin text-ink-secondary motion-reduce:animate-none" aria-hidden="true" />
                  : <Switch checked={item.on} onClick={() => void toggle(item)} aria-label={t(item.on ? "orgCapabilities.me.offAria" : "orgCapabilities.me.onAria", { name: item.name })} />
              ) : bare ? <span className="w-8 shrink-0" aria-hidden="true" /> : null}
              {bare && <span className="size-7 shrink-0" aria-hidden="true" />}
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className={bare ? undefined : "mb-4"} data-org-capabilities="me">
      {!bare && <h3 className="mb-1.5 text-[13px] font-semibold text-ink">{t("orgCapabilities.me.title")}</h3>}
      {rows}
      <p className={cn("text-[12px] leading-4 text-ink-secondary", bare ? "mt-1.5 px-3" : "mt-1.5")}>{t("orgCapabilities.me.hint")}</p>
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
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
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
    <form data-org-capability-form={creating ? "new" : "edit"} className="mb-4 flex flex-col gap-3 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015] p-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h4 className="text-[13px] font-semibold text-ink">{t(creating ? "orgCapabilities.admin.addTitle" : "orgCapabilities.admin.editTitle")}</h4>
      {fields.filter((field) => !field.configuration).map((field) => <DraftFieldView key={field.key} field={field.key} draft={draft} set={set} errors={errors} creating={creating} />)}
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        {t("orgCapabilities.field.enabled")}
      </label>
      {!creating && (
        <label className="flex items-center gap-2 text-[13px] text-ink" data-org-capability-replace="">
          <input type="checkbox" checked={draft.replaceConfiguration} onChange={(event) => set({ replaceConfiguration: event.target.checked })} />
          {t("orgCapabilities.field.replaceConfiguration")}
        </label>
      )}
      {!creating && !draft.replaceConfiguration && <p className="text-[12px] text-ink-secondary">{t("orgCapabilities.field.sealed")}</p>}
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
export function OrgCapabilitiesAdmin({ forms }: { forms?: readonly string[] } = {}) {
  const confirm = useConfirm();
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
    if (!(await confirm({ title: t("orgCapabilities.admin.removeConfirm", { name: row.name }), confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
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
  // #4453: one kind of Connect Apps lists its own forms only
  const rows = (inventory?.capabilities ?? []).filter((row) => !forms || forms.includes(row.form));
  return (
    <details className="group" data-org-capabilities="admin">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[13px] text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        <h3 className="font-normal">{t("orgCapabilities.admin.title")}</h3>
      </summary>
      <div className="mt-2 mb-1.5 flex items-center justify-end gap-2">
        {inventory && editing === null && (
          <button type="button" onClick={() => setEditing("new")} data-org-capability-add="" className="flex items-center gap-1.5 rounded-lg bg-control px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-raised-hover">
            <Plus size={14} aria-hidden="true" /> {t("orgCapabilities.admin.add")}
          </button>
        )}
      </div>
      <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">{t("orgCapabilities.admin.intro")}</p>
      {error && <p role="alert" className="mb-2 text-[12px] text-danger">{error}</p>}
      {editing !== null && (
        <OrgCapabilityForm initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />
      )}
      {inventory && rows.length === 0 && editing === null && <p className="rounded-xl bg-inset px-4 py-3 text-[13px] text-ink-secondary">{t("orgCapabilities.admin.empty")}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-hairline/60 rounded-[14px] border-[0.5px] border-ink/10 bg-ink/[0.015]">
          {rows.map((row) => {
            const installed = inventory?.installed?.[row.id];
            const state = installed ? installWords(installed.state, row.enabled) : row.enabled ? null : t("orgCapabilities.state.off");
            return (
              <li key={row.id} data-org-capability={row.form} data-org-capability-mode={row.mode} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px] text-ink">{row.name}</span>
                  <span className="block text-[12px] text-ink-secondary" title={installed?.error}>{[formWords(row.form), row.mount_name, state ?? ""].filter(Boolean).join(" · ")}</span>
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
    </details>
  );
}
