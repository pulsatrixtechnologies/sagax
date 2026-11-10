// Write a command: a name, a one-line description, and the instructions the
// bot follows when someone types `/name` in a chat. Saved as an ordinary
// skill through the bot-creation template route, so it is listed, switched
// off, and removed with the bot's other skills above.
import { cn } from "@/lib/cn";
import { HelpTip, PILL, PLAIN_CARD, PLAIN_FIELD, PRIMARY_PILL, useSettingsSurface } from "../SettingsPrimitives";
import { SquareSlash } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  WRITTEN_SKILL_SOURCE, writtenSkillMd, writtenSkillProblem, type WrittenSkillProblem,
} from "../../../shared/written-skill";
import { useBotEditor } from "./BotEditorContext";
import { inputCls } from "./field";
import { PaneSection } from "./PaneSection";

const PROBLEM_KEY = {
  name: "skills.write.problem.name",
  reserved: "skills.write.problem.reserved",
  taken: "skills.write.problem.taken",
  description: "skills.write.problem.description",
  instructions: "skills.write.problem.instructions",
} as const satisfies Record<WrittenSkillProblem, string>;

export function WriteCommandCard({ bot, taken, onSaved }: { bot: Bot; taken: readonly string[]; onSaved: () => void }) {
  const { request: api } = useBotEditor();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const plain = useSettingsSurface() === "plain";

  const draft = { name: name.trim(), description, instructions };
  const problem = writtenSkillProblem(draft, taken);
  const touched = Boolean(name.trim() || description.trim() || instructions.trim());

  const save = async () => {
    if (problem || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/bots/${bot.id}/skill-template`, {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          description: "",
          warnings: [],
          source: WRITTEN_SKILL_SOURCE,
          text: writtenSkillMd(draft),
          enabled: true,
        }),
      });
      setMessage(t("skills.write.saved", { name: draft.name }));
      setName("");
      setDescription("");
      setInstructions("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("skills.write.failed"));
    } finally {
      setSaving(false);
    }
  };

  // The bot's profile page (plain surface, #2313): the grey label above one
  // filled card, its fields rows of it, "Save command" a pill.
  const field = plain ? PLAIN_FIELD : inputCls;
  const nameRow = (
    <div className={cn("flex items-center gap-2", plain && "px-4 py-2.5")}>
      <div className="relative w-44 shrink-0">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[14px] text-ink-secondary">/</span>
        <input
          className={field + " pl-6 font-mono"}
          placeholder={t("skills.write.namePlaceholder")}
          aria-label={t("skills.write.name")}
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
        />
      </div>
      <input
        className={field}
        placeholder={t("skills.write.descriptionPlaceholder")}
        aria-label={t("skills.write.description")}
        value={description}
        maxLength={1024}
        onChange={(e) => setDescription(e.target.value)}
      />
    </div>
  );
  const instructionsField = (
    <textarea
      className={field + " min-h-24 resize-y leading-relaxed"}
      placeholder={t("skills.write.instructionsPlaceholder")}
      aria-label={t("skills.write.instructions")}
      value={instructions}
      onChange={(e) => setInstructions(e.target.value)}
    />
  );
  const footer = (
    <div className={cn("flex items-center justify-between gap-3", plain && "px-4 py-2.5")}>
      <div className="min-w-0 text-[12px] text-ink-secondary">
        {touched && problem ? t(PROBLEM_KEY[problem]) : message}
      </div>
      <button
        type="submit"
        disabled={saving || Boolean(problem)}
        className={cn(plain ? PILL : PRIMARY_PILL, "shrink-0")}
      >
        {saving ? t("skills.write.saving") : t("skills.write.save")}
      </button>
    </div>
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  if (plain) {
    return (
      <PaneSection title={t("skills.write.title")} help={t("skills.write.hint")} plain data-write-command="">
        <form className={PLAIN_CARD} data-settings-surface="" onSubmit={onSubmit}>
          {nameRow}
          <div className="px-4 py-2.5">{instructionsField}</div>
          {footer}
          {error && <p role="alert" className="px-4 py-2.5 text-[12px] text-danger">{error}</p>}
        </form>
      </PaneSection>
    );
  }

  return (
    // 2026-10-16 : a grey heading over a Settings card; the hint is
    // behind the info button.
    <section className="flex flex-col gap-2" data-write-command="">
      <div className="flex items-center gap-1.5 px-1">
        <SquareSlash size={14} aria-hidden="true" className="text-ink-secondary" />
        <h3 className="text-[13px] font-normal leading-[18px] text-ink-secondary">{t("skills.write.title")}</h3>
        <HelpTip label={t("settings.moreAbout", { title: t("skills.write.title") })}>{t("skills.write.hint")}</HelpTip>
      </div>
      <form className="flex flex-col gap-2 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3" onSubmit={onSubmit}>
        {nameRow}
        {instructionsField}
        {footer}
        {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      </form>
    </section>
  );
}
