import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t, tFromServer } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  describePart,
  describeSkip,
  notesLine,
  preparePictures,
  requestedSkills,
  saveShareFile,
  SHARE_DIALOG_DEFAULTS,
  SHARE_VIEW_START,
  shareAnswered,
  shareRefused,
  shareRequestBody,
  tickedSkills,
  type ShareChoices,
  type ShareResponse,
  type ShareView,
} from "@/lib/team-share";
import { api, useStore } from "@/state/store";
import { FIELD, FieldRow, FoldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, SwitchRow, DIALOG } from "./SettingsPrimitives";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import { botLabel } from "@/lib/human-label";

/** What the file will hold, counted from the server's own dry run, so the
 * numbers are exactly what Save file writes. Pure, for tests. */
export function ShareTeamContents({ preview, includeMemory, localSkips }: {
  preview: ShareResponse;
  includeMemory: boolean;
  /** Pictures the dialog could not prepare, already worded. */
  localSkips: string[];
}) {
  const pkg = preview.document.package;
  const counts = preview.summary.counts;
  const leader = pkg.team?.leader ? pkg.agents.find((agent) => agent.key === pkg.team?.leader)?.name : undefined;
  const pictures = pkg.agents.filter((agent) => agent.appearance.avatar).length;
  const notes = pkg.agents.reduce((total, agent) => total + Object.keys(agent.seed?.memory ?? {}).length, 0);
  const rows: Array<[string, string]> = [
    [t("teamShare.part.bots"), `${counts.bots} · ${preview.summary.botNames.join(", ")}`],
    [t("teamShare.part.skills"), String(counts.skills)],
    [t("teamShare.part.playbooks"), String(counts.playbooks)],
    [t("teamShare.part.rooms"), String(counts.rooms)],
    [t("teamShare.part.routines"), String(counts.routines)],
    [t("teamShare.part.brief"), pkg.team?.brief ? t("teamShare.yes") : t("teamShare.none")],
    [t("teamShare.part.leader"), leader ?? t("teamShare.none")],
    [t("teamShare.part.connections"), String(counts.connections)],
    [t("teamShare.part.pictures"), String(pictures)],
    [t("teamShare.part.notes"), includeMemory ? String(notes) : t("teamShare.none")],
    ...(counts.presets ? [[t("teamShare.part.presets"), `${counts.presets} · ${preview.summary.presetNames.join(", ")}`] as [string, string]] : []),
  ];
  const skipped = [...localSkips, ...preview.skipped.map((skip) => describeSkip(skip, preview.document))];
  return <ShareContentsGroups rows={rows} never={t("teamShare.never")} redacted={preview.redacted.map((part) => describePart(part, preview.document))} skipped={skipped}
    addresses={pkg.connections?.length ? (
      // The whole address, before Save: hosted servers often carry a key
      // in it, and this is where the person can see what goes out.
      <SettingsGroup groupId="share-addresses" title={t("teamShare.addresses")}>
        {pkg.connections.map((connection) => (
          <p key={connection.key} className="break-all px-3.5 py-1.5 text-[12.5px] text-ink-secondary"><span className="text-ink">{connection.label}</span> · {connection.mcp.url}</p>
        ))}
      </SettingsGroup>
    ) : null} />;
}

/** What a share file holds, as Settings draws it: a grey heading, one card
 * of label and value rows, then the lines about what never travels and what
 * was removed or left out. Shared by Share team and Share preset. */
export function ShareContentsGroups({ rows, never, redacted, skipped, addresses }: {
  rows: Array<[string, string]>;
  never: string;
  redacted: string[];
  skipped: string[];
  addresses?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup groupId="share-included" title={t("teamShare.included")}>
        <dl className="contents">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-center justify-between gap-4 px-3.5 py-1.5 text-[13px]">
              <dt className="shrink-0 text-ink-secondary">{label}</dt>
              <dd className="min-w-0 truncate text-right text-ink" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>
      {addresses}
      <p className="-mt-3 flex items-start gap-2 px-1 text-[12px] leading-4 text-ink-secondary">
        <ShieldCheck size={14} aria-hidden="true" className="shrink-0 text-success" />
        <span>{never}</span>
      </p>
      {redacted.length > 0 && (
        <SettingsGroup groupId="share-redacted" title={t("teamShare.redacted")}>
          {redacted.map((line) => <p key={line} className="px-3.5 py-1.5 text-[12.5px] text-ink">{line}</p>)}
        </SettingsGroup>
      )}
      {skipped.length > 0 && (
        <SettingsGroup groupId="share-skipped" title={t("teamShare.skipped")}>
          {skipped.map((line, index) => <p key={`${line}-${index}`} className="px-3.5 py-1.5 text-[12.5px] text-ink">{line}</p>)}
        </SettingsGroup>
      )}
    </div>
  );
}

/** The skill boxes. They are drawn from the team's skill names, which come
 * back on a refused export too, so they never vanish behind an error. Pure,
 * for tests. */
export function ShareSkillChoices({ available, ticked, counted, onToggle }: {
  available: readonly string[];
  ticked: ReadonlySet<string>;
  /** The server has answered at least once. */
  counted: boolean;
  onToggle: (skill: string) => void;
}) {
  return (
    <div>
      {counted && available.length === 0 && <p className="text-[12px] text-ink-secondary">{t("teamShare.noSkills")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {available.map((skill) => (
          <label key={skill} className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full bg-hover px-2.5 text-[12.5px] text-ink has-[:checked]:bg-selected md:min-h-7">
            <input type="checkbox" className="size-3.5 accent-accent" checked={ticked.has(skill)} onChange={() => onToggle(skill)} />
            {skill}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Share team…: choose what goes in, see exactly what that is, save the
 * file. No confirm step; the person's click on Save file is the decision. */
export function ShareTeamDialog({ team, onClose }: { team: string; onClose: () => void }) {
  const { state } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const teamBots = useMemo(
    () => state.bots.filter((bot) => !bot.hidden && (bot.section?.trim() ?? "") === team),
    [state.bots, team],
  );
  const botNames = useMemo(() => new Map(teamBots.map((bot) => [bot.id, bot.name])), [teamBots]);
  const [name, setName] = useState(team || t("teamLibrary.general"));
  const [tagline, setTagline] = useState("");
  const [summary, setSummary] = useState("");
  const [release, setRelease] = useState("");
  const [notes, setNotes] = useState("");
  // Pictures and starter notes start ticked (SHARE_DIALOG_DEFAULTS).
  const [includePictures, setIncludePictures] = useState<boolean>(SHARE_DIALOG_DEFAULTS.includePictures);
  const [includeMemory, setIncludeMemory] = useState<boolean>(SHARE_DIALOG_DEFAULTS.includeMemory);
  // New bot defaults are personal until shared: off unless ticked.
  const [includePreset, setIncludePreset] = useState(false);
  // The defaults' picture, prepared the first time the box is ticked.
  const [presetPicture, setPresetPicture] = useState<{ dataUrl?: string } | null>(null);
  // null = "all": whatever fits, as the server decides; a Set = exactly these.
  const [skillChoice, setSkillChoice] = useState<Set<string> | null>(null);
  const [pictures, setPictures] = useState<{ avatars: Record<string, string>; skipped: string[] } | null>(null);
  // The server's answers: counts, skill boxes and refusals (shareAnswered / shareRefused).
  const [view, setView] = useState<ShareView>(SHARE_VIEW_START);
  const { preview, available, included, error } = view;
  const setError = (message: string) => setView((current) => ({ ...current, error: message }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ShareResponse | null>(null);
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void preparePictures(teamBots).then((result) => {
      if (cancelled) return;
      setPictures({
        avatars: result.avatars,
        skipped: result.skipped.map((skip) =>
          `${botLabel(botNames.get(skip.botId), skip.botId)} · ${t("teamShare.field.picture")} — ${tFromServer(`teamShare.skip.${skip.reason}`, skip.reason)}`),
      });
    }).catch(() => {
      if (!cancelled) setPictures({ avatars: {}, skipped: [] });
    });
    return () => { cancelled = true; };
    // Pictures are prepared once per dialog; the bot list is stable meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!includePreset || presetPicture) return;
    let cancelled = false;
    void api<{ defaults: NewBotDefaults }>("/api/bot-defaults")
      .then(({ defaults }) => preparePictures([{ id: "defaults", avatarUrl: defaults.profile.avatarUrl, avatarCrop: defaults.profile.avatarCrop }]))
      .then((prepared) => { if (!cancelled) setPresetPicture({ dataUrl: prepared.avatars.defaults }); })
      .catch(() => { if (!cancelled) setPresetPicture({}); });
    return () => { cancelled = true; };
  }, [includePreset, presetPicture]);

  const choices = useCallback((dryRun: boolean): ShareChoices => ({
    team,
    name,
    tagline,
    summary,
    release,
    notes,
    skills: requestedSkills(skillChoice, available),
    includeMemory,
    ...(includePictures && pictures ? { avatars: pictures.avatars } : {}),
    ...(includePreset ? { includeDefaultsPreset: true, ...(includePictures && presetPicture?.dataUrl ? { presetAvatar: presetPicture.dataUrl } : {}) } : {}),
    dryRun,
  }), [team, name, tagline, summary, release, notes, skillChoice, available, includeMemory, includePictures, pictures, includePreset, presetPicture]);

  // Live counts: re-run the server's dry run whenever what goes in changes.
  useEffect(() => {
    if (!pictures) return;
    // No counts (and no Save) until the preset's picture is ready to go in.
    if (includePreset && !presetPicture) { setView((current) => ({ ...current, preview: null })); return; }
    const id = ++request.current;
    const all = skillChoice === null;
    const timer = window.setTimeout(() => {
      api<ShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(shareRequestBody({ ...choices(true), release: undefined })) })
        .then((result) => {
          if (id !== request.current) return;
          setView((current) => shareAnswered(current, result, all));
          setRelease((current) => current || result.document.package.release);
        })
        .catch((cause) => {
          if (id !== request.current) return;
          setView((current) => shareRefused(current, cause));
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // Text fields do not change the counts; only what goes in does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictures, skillChoice, includeMemory, includePictures, includePreset, presetPicture]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<ShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(shareRequestBody(choices(false))) });
      saveShareFile(result.filename, result.document);
      setSaved(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const ticked = tickedSkills(skillChoice, included, available);
  const toggleSkill = (skill: string) => {
    const next = new Set(ticked);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    setSkillChoice(next);
  };
  const localSkips = includePictures ? pictures?.skipped ?? [] : [];

  return createPortal(
    <div className={cn(DIALOG.backdrop, "z-[60]")} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-team-title" tabIndex={-1}
        className={`${DIALOG.frame} max-w-[600px]`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>("input:enabled, textarea:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0]!, last = controls[controls.length - 1]!;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className={DIALOG.header}>
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id="share-team-title" className={`${DIALOG.title} min-w-0`}>{t("teamShare.title", { name: team || t("teamLibrary.general") })}</h2>
            <HelpTip label={t("settings.moreAbout", { title: t("teamShare.title", { name: team || t("teamLibrary.general") }) })}>{t("teamShare.intro")}</HelpTip>
          </div>
          <button aria-label={t("teamShare.close")} disabled={saving} onClick={onClose} className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
        </header>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
          event.preventDefault();
          if (saved) onClose();
          else if (!saving && preview && name.trim()) void save();
        }}>
        {saved ? (
          <div className={DIALOG.body}>
            <div className="px-1">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><Check size={15} aria-hidden="true" className="text-success" />{t("teamShare.saved", { filename: saved.filename })}</p>
              <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("teamShare.savedHint")}</p>
            </div>
            <ShareTeamContents preview={saved} includeMemory={includeMemory} localSkips={localSkips} />
          </div>
        ) : (
          <div className={DIALOG.body}>
            <fieldset disabled={saving} className="min-w-0">
              <SettingsGroup groupId="share-team-choices" title={t("teamShare.choices")}>
                <SwitchRow className="px-3.5 py-2.5" label={t("teamShare.includePictures")} checked={includePictures} onChange={setIncludePictures} />
                <SwitchRow className="px-3.5 py-2.5" label={t("teamShare.includeNotes")} help={notesLine(includeMemory)} checked={includeMemory} onChange={setIncludeMemory} />
                <FoldRow cardId="share-team.skills" label={t("teamShare.includeSkills")} count={available?.length}>
                  <ShareSkillChoices available={available ?? []} ticked={ticked} counted={available !== null} onToggle={toggleSkill} />
                </FoldRow>
                <SwitchRow className="px-3.5 py-2.5" label={t("teamShare.includePreset")} help={t("teamShare.presetHint")} checked={includePreset} onChange={setIncludePreset} />
              </SettingsGroup>
            </fieldset>

            {preview
              ? <ShareTeamContents preview={preview} includeMemory={includeMemory} localSkips={localSkips} />
              : !error && <div role="status" className="flex items-center gap-2 px-1 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("teamShare.preparing")}</div>}

            <SettingsGroup groupId="share-team-file" title={t("teamShare.file")}>
              <div className="grid sm:grid-cols-2">
                <FieldRow label={t("teamShare.name")}>
                  <input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} className={FIELD} />
                </FieldRow>
                <FieldRow label={t("teamShare.release")} hint={t("teamShare.releaseHint")}>
                  <input value={release} maxLength={20} disabled={saving} placeholder="1.0.0" onChange={(event) => setRelease(event.target.value)} className={FIELD} />
                </FieldRow>
              </div>
              <FieldRow label={t("teamShare.tagline")}>
                <input value={tagline} maxLength={160} disabled={saving} onChange={(event) => setTagline(event.target.value)} className={FIELD} />
              </FieldRow>
              <FieldRow label={t("teamShare.summary")}>
                <textarea value={summary} maxLength={2000} rows={2} disabled={saving} onChange={(event) => setSummary(event.target.value)} className={FIELD} />
              </FieldRow>
              <FieldRow label={t("teamShare.notes")}>
                <textarea value={notes} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setNotes(event.target.value)} className={FIELD} />
              </FieldRow>
            </SettingsGroup>
          </div>
        )}

        {error && <p role="alert" className="mx-5 mb-2 rounded-xl bg-danger/10 px-3.5 py-2 text-[12.5px] text-danger">{error}</p>}
        <footer className={DIALOG.footer}>
          {saved ? (
            <button type="submit" className={PRIMARY_PILL}>{t("teamShare.done")}</button>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={onClose} className={PILL}>{t("common.cancel")}</button>
              <button type="submit" disabled={saving || !preview || !name.trim()} className={PRIMARY_PILL}>
                {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {saving ? t("teamShare.saving") : t("teamShare.save")}
              </button>
            </>
          )}
        </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
