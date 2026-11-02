import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { t, tFromServer } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { describePart, describeSkip, preparePictures, saveShareFile, type ShareSkip } from "@/lib/team-share";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { api } from "@/state/store";
import { FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, SwitchRow } from "./SettingsPrimitives";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { ShareContentsGroups } from "./ShareTeamDialog";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import type { PackageDocument, PackageSummary } from "../../shared/package-format";
import { TemplateLinkSection } from "./TemplateLinkSection";
import { readableError } from "@/lib/plain-error";

/** POST /api/teams/export with kind "library": a preset file. */
export interface PresetShareResponse {
  document: PackageDocument;
  filename: string;
  redacted: string[];
  skipped: ShareSkip[];
  summary: PackageSummary;
}

export interface PresetShareChoices {
  name: string;
  description?: string;
  release?: string;
  notes?: string;
  includeNotes: boolean;
  picture?: string;
  dryRun?: boolean;
}

/** The request body for a preset file. Pure, for tests. */
export function presetShareBody(choices: PresetShareChoices): Record<string, unknown> {
  const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  return {
    format: "package",
    version: 2,
    kind: "library",
    name: text(choices.name),
    presetName: text(choices.name),
    presetDescription: text(choices.description),
    release: text(choices.release),
    notes: text(choices.notes),
    includeMemory: choices.includeNotes,
    ...(choices.picture ? { presetAvatar: choices.picture } : {}),
    ...(choices.dryRun ? { dryRun: true } : {}),
  };
}

/** What the preset file holds, counted by the server's own dry run. Pure, for tests. */
export function SharePresetContents({ preview, localSkips }: { preview: PresetShareResponse; localSkips: string[] }) {
  const preset = preview.document.package.presets?.[0];
  const notes = Object.keys(preset?.seed?.memory ?? {}).length;
  const rows: Array<[string, string]> = [
    [t("teamShare.part.skills"), preset?.skills?.length ? `${preset.skills.length} · ${preset.skills.join(", ")}` : "0"],
    [t("teamShare.part.notes"), notes ? String(notes) : t("teamShare.none")],
    [t("teamShare.part.pictures"), preset?.bot.appearance?.avatar ? t("teamShare.yes") : t("teamShare.none")],
  ];
  const skipped = [...localSkips, ...preview.skipped.map((skip) => describeSkip(skip, preview.document))];
  return <ShareContentsGroups rows={rows} never={t("presetShare.never")} redacted={preview.redacted.map((part) => describePart(part, preview.document))} skipped={skipped} />;
}

/** Share as preset: New bot defaults as a file of one preset bot and its
 * skills (no team). Anchored popover (lot 4); Save file is the decision. */
export function SharePresetDialog({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [release, setRelease] = useState("");
  const [notes, setNotes] = useState("");
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includePicture, setIncludePicture] = useState(true);
  // null while the defaults' picture is being prepared.
  const [picture, setPicture] = useState<{ dataUrl?: string; skipped: string[] } | null>(null);
  const [preview, setPreview] = useState<PresetShareResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PresetShareResponse | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);

  // The dismiss root covers the Share button and the portalled popover.
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(open && !saving, dismissRoot, onClose);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<{ defaults: NewBotDefaults }>("/api/bot-defaults")
      .then(async ({ defaults }) => {
        if (!cancelled && defaults.profile.name?.trim()) setName((current) => current || defaults.profile.name!.trim());
        const prepared = await preparePictures([{ id: "defaults", avatarUrl: defaults.profile.avatarUrl, avatarCrop: defaults.profile.avatarCrop }]);
        if (cancelled) return;
        setPicture({
          dataUrl: prepared.avatars.defaults,
          skipped: prepared.skipped.map((skip) => `${t("teamShare.field.picture")} — ${tFromServer(`teamShare.skip.${skip.reason}`, skip.reason)}`),
        });
      })
      .catch(() => { if (!cancelled) setPicture({ skipped: [] }); });
    return () => { cancelled = true; };
  }, [open]);

  const choices = (dryRun: boolean): PresetShareChoices => ({
    name, description, release, notes, includeNotes, dryRun,
    ...(includePicture && picture?.dataUrl ? { picture: picture.dataUrl } : {}),
  });

  // Live counts from the server's dry run whenever what goes in changes.
  useEffect(() => {
    if (!open || !picture) return;
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody({ ...choices(true), release: undefined })) })
        .then((result) => {
          if (id !== request.current) return;
          setPreview(result);
          setError("");
          setRelease((current) => current || result.document.package.release);
        })
        .catch((cause) => {
          if (id !== request.current) return;
          setPreview(null);
          setError(readableError(cause));
        });
    }, 250);
    return () => window.clearTimeout(timer);
    // Only what goes in changes the counts; names and notes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picture, includeNotes, includePicture]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<PresetShareResponse>("/api/teams/export", { method: "POST", body: JSON.stringify(presetShareBody(choices(false))) });
      saveShareFile(result.filename, result.document);
      setSaved(result);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusSoon = () => popoverRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusSoon);
    else focusSoon();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);

  if (!open) return null;

  const localSkips = includePicture ? picture?.skipped ?? [] : [];
  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      align="end"
      gap={8}
      maxHeight={480}
      data-share-preset-popover=""
      role="dialog"
      aria-labelledby="share-preset-title"
      className="popover-surface flex w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated shadow-2xl shadow-black/40"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline/40 px-3.5 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h2 id="share-preset-title" className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("presetShare.title")}</h2>
          <HelpTip label={t("settings.moreAbout", { title: t("presetShare.title") })}>{t("presetShare.intro")}</HelpTip>
        </div>
        <button type="button" aria-label={t("presetShare.close")} disabled={saving} onClick={onClose} className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover disabled:opacity-40">
          <X size={16} className="pointer-events-none" />
        </button>
      </header>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (saved) onClose();
        else if (!saving && preview) void save();
      }}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
          {saved ? (
            <>
              <div>
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><Check size={15} aria-hidden="true" className="text-success" />{t("teamShare.saved", { filename: saved.filename })}</p>
                <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("presetShare.savedHint")}</p>
              </div>
              <SharePresetContents preview={saved} localSkips={localSkips} />
            </>
          ) : (
            <>
              <fieldset disabled={saving} className="min-w-0">
                <SettingsGroup groupId="share-preset-choices" title={t("teamShare.choices")}>
                  <SwitchRow className="px-3.5 py-2.5" label={t("presetShare.includePicture")} checked={includePicture} onChange={setIncludePicture} />
                  <SwitchRow className="px-3.5 py-2.5" label={t("presetShare.includeNotes")} checked={includeNotes} onChange={setIncludeNotes} />
                </SettingsGroup>
              </fieldset>
              {preview
                ? <SharePresetContents preview={preview} localSkips={localSkips} />
                : !error && <div role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("presetShare.preparing")}</div>}
              <SettingsGroup groupId="share-preset-file" title={t("teamShare.file")}>
                <FieldRow label={t("presetShare.name")}>
                  <input value={name} maxLength={100} disabled={saving} onChange={(event) => setName(event.target.value)} className={FIELD} />
                </FieldRow>
                <FieldRow label={t("teamShare.release")}>
                  <input value={release} maxLength={20} disabled={saving} placeholder="1.0.0" onChange={(event) => setRelease(event.target.value)} className={FIELD} />
                </FieldRow>
                <FieldRow label={t("presetShare.description")}>
                  <input value={description} maxLength={300} disabled={saving} onChange={(event) => setDescription(event.target.value)} className={FIELD} />
                </FieldRow>
                <FieldRow label={t("teamShare.notes")}>
                  <textarea value={notes} maxLength={4000} rows={2} disabled={saving} onChange={(event) => setNotes(event.target.value)} className={FIELD} />
                </FieldRow>
              </SettingsGroup>
              <TemplateLinkSection name={name} description={description} picture={includePicture ? picture?.dataUrl : undefined} />
            </>
          )}
        </div>

        {error && <p role="alert" className="mx-3.5 mb-2 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        <footer className="flex shrink-0 justify-end gap-2 border-t border-hairline/40 px-3.5 py-2.5">
          {saved ? (
            <button type="submit" className={PRIMARY_PILL}>{t("teamShare.done")}</button>
          ) : (
            <>
              <button type="button" disabled={saving} onClick={onClose} className={PILL}>{t("common.cancel")}</button>
              <button type="submit" disabled={saving || !preview} className={cn(PRIMARY_PILL, "gap-1.5")}>
                {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {saving ? t("teamShare.saving") : t("teamShare.save")}
              </button>
            </>
          )}
        </footer>
      </form>
    </AnchoredPopover>
  );
}
