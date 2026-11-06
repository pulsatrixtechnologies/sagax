// Plugins > Manage > a private skill, after the reference's skill page: a
// header (icon, name, "Private skill"), Delete Skill, the description, then
// Name, Description and Instructions with Save. A new skill opens the same
// page empty. A skill a marketplace plugin or the organization brought is
// read here and changed where it came from. #2104 (JC 2026-11-06, identical
// to Grok Bot): filled fields, a red "Delete Skill" pill, "Publish" as an
// outlined pill whose menu hands the SKILL.md out (copy it, save the file:
// there is no organization library a desktop publishes to), Save in a bar
// under the page, on only once something changed.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Download, FileText, Link2, Loader2 } from "lucide-react";

import { useConfirm } from "@/components/ConfirmProvider";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { composeSkillMd, isSkillName, parseSkillMd } from "../../../shared/skill-md";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import type { Crumb } from "../Breadcrumb";
import { PluginPageHeader } from "./PluginParts";
import { PLUGINS } from "./plugins-style";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { enginesLine } from "@/lib/capabilities";
import { readableError } from "@/lib/plain-error";
import { Switch } from "../SettingsPrimitives";

export interface SkillPageProps {
  basePath?: "/api/skills-library" | "/api/me/skills-library";
  /** absent: a new skill */
  skill?: SkillsLibrarySkillWire;
  /** why it cannot be changed here (a plugin or the organization brought
   * it, or the viewer is not the owner); absent: it can */
  readOnlyReason?: string;
  onBack: () => void;
  /** the pages above this one in the panel (the breadcrumb) */
  trail?: readonly Crumb[];
  /** after Save: the skill's name (it may have changed) */
  onSaved: (name: string) => Promise<unknown> | void;
  onDeleted: () => Promise<unknown> | void;
}

const fieldClass = cn(PLUGINS.field, "min-h-[46px] rounded-[14px] px-[17px] py-3 text-[15px] leading-[22px]");
const labelClass = "px-2 text-[13.5px] leading-5 text-ink-secondary";

export function SkillPage({ skill, readOnlyReason, onBack, trail, onSaved, onDeleted, basePath = "/api/skills-library" }: SkillPageProps) {
  const confirm = useConfirm();
  const creating = !skill;
  const [loaded, setLoaded] = useState(creating);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(skill?.enabled ?? false);
  const [busy, setBusy] = useState<"save" | "delete" | "toggle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // what was loaded: Save stays off until the text differs from it
  const [baseline, setBaseline] = useState({ name: skill?.name ?? "", description: skill?.description ?? "", instructions: "" });

  useEffect(() => {
    if (!skill) return;
    let cancelled = false;
    setLoaded(false);
    api(`${basePath}/${encodeURIComponent(skill.name)}`)
      .then((result) => {
        if (cancelled) return;
        const parsed = parseSkillMd(typeof result.text === "string" ? result.text : "");
        if ("error" in parsed) {
          const text = typeof result.text === "string" ? result.text : "";
          setInstructions(text);
          setBaseline({ name: skill.name, description: skill.description ?? "", instructions: text });
        } else {
          setName(parsed.name);
          setDescription(parsed.description);
          setInstructions(parsed.body.trim());
          setBaseline({ name: parsed.name, description: parsed.description, instructions: parsed.body.trim() });
        }
        setLoaded(true);
      })
      .catch((cause) => !cancelled && setError(readableError(cause)));
    return () => {
      cancelled = true;
    };
  }, [skill, basePath]);
  useEffect(() => setEnabled(skill?.enabled ?? false), [skill?.enabled]);

  const readOnly = Boolean(readOnlyReason);
  const nameOk = isSkillName(name.trim());
  const dirty = creating || name !== baseline.name || description !== baseline.description || instructions !== baseline.instructions;
  const canSave = !readOnly && loaded && dirty && nameOk && description.trim() !== "" && busy === null;
  const skillMd = () => composeSkillMd(null, { name: name.trim(), description, body: instructions });

  const save = async () => {
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      if (creating) {
        await api(basePath, { method: "POST", body: JSON.stringify({ text: composeSkillMd(null, { name: name.trim(), description, body: instructions }) }) });
      } else {
        await api(`${basePath}/${encodeURIComponent(skill.name)}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), description: description.trim(), instructions }),
        });
      }
      setSaved(true);
      setBaseline({ name, description, instructions });
      await onSaved(name.trim());
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!skill || !(await confirm({ title: t("connectApps.skill.deleteConfirm", { name: skill.name }), confirmLabel: t("common.delete"), tone: "danger" }))) return;
    setBusy("delete");
    setError(null);
    try {
      await api(`${basePath}/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
      await onDeleted();
    } catch (cause) {
      setError(readableError(cause));
      setBusy(null);
    }
  };

  // Turning it on is the review: bots it is assigned to follow it then.
  const toggle = async () => {
    if (!skill) return;
    setBusy("toggle");
    setError(null);
    try {
      await api(`${basePath}/${encodeURIComponent(skill.name)}`, { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) });
      setEnabled(!enabled);
      await onSaved(skill.name);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PluginPageHeader title={creating ? t("connectApps.skill.new") : skill.name} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-8 pt-[22px] sm:px-[34px]" data-plugins-skill={skill?.name ?? "new"}>
        <div className="flex flex-wrap items-center gap-3" data-skill-head>
          <div className="flex size-14 shrink-0 items-center justify-center rounded-[14px] border border-border bg-card text-ink-secondary"><FileText size={20} aria-hidden="true" /></div>
          <div className="min-w-0 flex-[1_1_200px] pl-0.5">
            <div className="truncate text-[17px] leading-6 text-ink">{creating ? t("connectApps.skill.new") : skill.name}</div>
            <div className="truncate text-[14px] leading-5 text-ink-secondary">{t("connectApps.skill.private")}</div>
          </div>
          {skill && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13.5px] text-ink-secondary" data-skill-enabled>
                {busy === "toggle" ? <Loader2 size={13} className="animate-spin" /> : t(enabled ? "connectApps.skill.on" : "connectApps.skill.off")}
                <Switch checked={enabled} disabled={busy !== null || !loaded} onClick={() => void toggle()} aria-label={t(enabled ? "connectApps.skill.turnOff" : "connectApps.skill.turnOn")} />
              </label>
              <PublishMenu disabled={!loaded} fileName={`${name.trim() || skill.name}.md`} text={skillMd} />
              {!readOnly && (
                <button
                  type="button"
                  data-skill-delete
                  disabled={busy !== null}
                  onClick={() => void remove()}
                  className={PLUGINS.dangerPill}
                >
                  {busy === "delete" && <Loader2 size={13} className="animate-spin" />} {t("connectApps.skill.delete")}
                </button>
              )}
            </div>
          )}
        </div>

        {skill?.description && <p className="text-[15px] leading-[20px] text-ink-secondary" data-skill-summary>{skill.description}</p>}
        {skill && !enabled && <p className="text-[13px] text-ink-secondary">{t("connectApps.skill.reviewHint")}</p>}
        {readOnlyReason && <p role="note" className="rounded-[12px] bg-card px-3.5 py-2.5 text-[13.5px] text-ink-secondary">{readOnlyReason}</p>}
        {skill && skill.warnings.length > 0 && <ul className="list-disc pl-5 text-[13px] text-warning">{skill.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}

        <form
          id="skill-form"
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          <label className="flex flex-col gap-2.5">
            <span className={labelClass}>{t("connectApps.skill.name")}</span>
            <input value={name} disabled={readOnly || !loaded} maxLength={64} onChange={(event) => setName(event.target.value)} className={fieldClass} data-skill-field="name" />
            {name.trim() !== "" && !nameOk && <span className="px-2 text-[13px] text-danger">{t("connectApps.skill.nameRule")}</span>}
          </label>
          <label className="flex flex-col gap-2.5">
            <span className={labelClass}>{t("connectApps.skill.description")}</span>
            <input value={description} disabled={readOnly || !loaded} maxLength={1024} onChange={(event) => setDescription(event.target.value)} className={fieldClass} data-skill-field="description" title={description} />
          </label>
          <div className="flex flex-col gap-2.5" data-skill-field="instructions">
            <span id="skill-instructions-label" className={labelClass}>{t("connectApps.skill.instructions")}</span>
            <MarkdownEditor
              value={instructions}
              disabled={!loaded}
              readOnly={readOnly}
              minHeight={260}
              ariaLabelledBy="skill-instructions-label"
              onChange={setInstructions}
              dataField="skill-instructions"
              toolbarOnFocus
              showCount={false}
              className="rounded-[14px] border-transparent bg-card px-1.5 py-2 text-[15px]"
            />
          </div>
          {/* what each engine gets of a library skill (lot 1b): the prompt index */}
          <p className="px-2 text-[13px] text-ink-secondary" data-skill-engines>
            <span className="text-ink">{t("capabilities.detail.engines")}</span>{t("capabilities.engines.colon")}{enginesLine("skill", { skills: true, indexOnly: true })}
          </p>
          {error && <p role="alert" className="rounded-[12px] bg-danger/10 px-3.5 py-2.5 text-[13.5px] text-danger">{error}</p>}
        </form>
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-hairline-weak px-4 py-3" data-skill-savebar>
          {saved && !error && !dirty && <span role="status" className="text-[13.5px] text-success">{t("connectApps.skill.saved")}</span>}
          <button type="submit" form="skill-form" disabled={!canSave} className={cn(PLUGINS.primaryPill, "h-9 px-6 text-[15px] disabled:bg-card disabled:text-ink-tertiary disabled:opacity-100")}>{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : t("connectApps.skill.save")}</button>
        </div>
      )}
    </>
  );
}

/** "Publish": hands the skill out as a SKILL.md, copied or saved as a file
 * (Grok Bot's outlined pill with its menu). */
function PublishMenu({ text, fileName, disabled }: { text: () => string; fileName: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, ref, () => setOpen(false));
  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" data-skill-publish aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)} className={cn(PLUGINS.outlinePill, "h-[26px] px-3 text-[15px]")}>
        <Link2 size={14} aria-hidden="true" /> {copied ? t("connectApps.skill.copied") : t("connectApps.skill.publish")} <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-10 min-w-[220px] rounded-xl border border-border bg-raised p-1 shadow-lg">
          <button type="button" role="menuitem" data-skill-publish-copy className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-ink hover:bg-hover" onClick={() => { setOpen(false); void copyText(text()).then((result) => setCopied(result === "copied")); }}>
            <Copy size={14} /> {t("connectApps.skill.copyMd")}
          </button>
          <button type="button" role="menuitem" data-skill-publish-file className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-ink hover:bg-hover" onClick={() => { setOpen(false); download(); }}>
            <Download size={14} /> {t("connectApps.skill.saveMd")}
          </button>
        </div>
      )}
    </div>
  );
}
