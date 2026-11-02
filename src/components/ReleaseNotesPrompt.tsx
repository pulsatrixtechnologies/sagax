// "What's new" after an update. Once per version, never on a fresh install
// and never in a dev build. A centred window (DialogLayer) over the app.
// About > Release notes, the account menu and the command palette open the
// browser again through requestReleaseNotes, before or after the update.
import { useEffect, useMemo, useRef, useState } from "react";
import { appVersion } from "@/lib/app-links";
import { bundledNotesFor, bundledNotesSince, bundledReleaseCatalog, bundledVersions } from "@/lib/bundled-release-notes";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { activeLocale, t } from "@/lib/i18n";
import {
  RELEASE_NOTES_SEEN_KEY,
  readPreviousRelease,
  readSeenRelease,
  releaseNotesDate,
  releaseNotesPriorInstall,
  seenReleaseRecord,
  whatsNewDecision,
} from "@/lib/release-notes";
import { subscribeReleaseNotes, type ReleaseNotesMode } from "@/lib/release-notes-ui";
import { useStore } from "@/state/store";
import { ReleaseNotesBody, ReleaseNotesMarkdown, ReleaseVersionHeading } from "./ReleaseNotesMarkdown";
import { DialogFrame, DialogLayer, PILL, PillSelect } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";

function readSeen(): string | null {
  try {
    return readSeenRelease(localStorage.getItem(RELEASE_NOTES_SEEN_KEY));
  } catch {
    return null;
  }
}

function readPrevious(): string | null {
  try {
    return readPreviousRelease(localStorage.getItem(RELEASE_NOTES_SEEN_KEY));
  } catch {
    return null;
  }
}

function writeSeen(version: string, previous: string | null): void {
  try {
    localStorage.setItem(RELEASE_NOTES_SEEN_KEY, seenReleaseRecord(version, previous));
  } catch {
    // Private mode can refuse the write. This launch can still show the dialog.
  }
}

export function ReleaseNotesPrompt() {
  const { state, dispatch } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ReleaseNotesMode>("current");
  const [picked, setPicked] = useState(appVersion());
  const [since, setSince] = useState(false);
  const catalog = useMemo(() => bundledReleaseCatalog(), []);
  const openWith = (next: ReleaseNotesMode) => {
    setMode(next);
    setPicked(appVersion());
    setSince(false);
    setOpen(true);
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
  };
  const openWithRef = useRef(openWith);
  openWithRef.current = openWith;
  const decided = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Decide once, after the real config and desktop capabilities are both
  // known. A later write in this same launch (the welcome screen setting
  // launchMode) must not flip a fresh install into What's new.
  useEffect(() => {
    if (decided.current) return;
    if (state.config == null || !ready) return;
    decided.current = true;
    const version = appVersion();
    const seen = readSeen();
    const decision = whatsNewDecision({
      version,
      dev: capabilities.host.packaged !== true,
      seenVersion: seen,
      previouslyInstalled: releaseNotesPriorInstall(state.config.onboarding),
    });
    if (decision.seenVersion && decision.seenVersion !== seen) writeSeen(decision.seenVersion, seen);
    if (decision.show) openWithRef.current("current");
  }, [state.config, ready, capabilities.host.packaged]);

  useEffect(() => subscribeReleaseNotes((next) => openWithRef.current(next)), []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The version menu's open list closes first (it handles its Escape
      // after this capture listener).
      if (event.target instanceof Element && event.target.closest('[role="listbox"]')) return;
      event.preventDefault();
      setOpen(false);
    };
    // Capture so this dialog, painted above the update prompt, takes Escape first.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const version = appVersion();
  const language = activeLocale();
  const browse = mode === "browse";
  const shown = browse ? picked : version;
  const notes = bundledNotesFor(shown, language, catalog);
  const safe = notes?.trim() ?? "";
  const versions = bundledVersions(catalog);
  // Always offer the running version, even when this build has no file for it.
  if (browse && !versions.includes(version)) versions.unshift(version);
  const previous = readPrevious();
  const sinceEntries = previous ? bundledNotesSince(previous, version, catalog) : [];
  // After an update that went over several releases (0.8.6 straight to
  // 0.8.9), "What's new" shows every version since the one installed before,
  // not the newest alone.
  const cumulative = !browse && sinceEntries.length > 1;
  const close = () => setOpen(false);

  // Drawn like Settings: title and close, version menu and "since my last
  // version" as pills, then the version's title and date and its sections
  // under grey headings. Centred window over the app (JC, 2026-11-02).
  return (
    <DialogLayer className="z-[70]" onBackdropMouseDown={close}>
      <DialogFrame
        titleId="release-notes-title"
        title={browse ? t("releaseNotes.browseTitle") : t("releaseNotes.whatsNewTitle")}
        width="xl"
        wide
        closeLabel={t("releaseNotes.close")}
        onClose={close}
        closeRef={closeRef}
        frameProps={{ "data-release-notes": mode }}
        toolbar={browse ? (
          // The menu sits at the right, as in Settings' rows, so its list
          // opens inside the window.
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
            {sinceEntries.length > 0 ? (
              <button
                type="button"
                aria-pressed={since}
                onClick={() => setSince((on) => !on)}
                className={cn(PILL, since && "bg-selected")}
              >
                {t("releaseNotes.sinceLast", { version: previous ?? "" })}
              </button>
            ) : <span />}
            <PillSelect
              ariaLabel={t("releaseNotes.versionPicker")}
              value={picked}
              options={versions.map((entry) => ({
                value: entry,
                label: entry === version ? t("releaseNotes.currentTag", { version: entry }) : entry,
              }))}
              onChange={(next) => {
                setPicked(next);
                setSince(false);
              }}
            />
          </div>
        ) : undefined}
      >
        {(browse && since) || cumulative ? (
          <ReleaseNotesBody notes={sinceEntries} language={language} headings />
        ) : (
          <div className="flex flex-col gap-3">
            <ReleaseVersionHeading version={shown} date={releaseNotesDate(catalog[shown])} language={language} />
            {safe ? (
              <div>
                <ReleaseNotesMarkdown source={safe} />
              </div>
            ) : (
              <p className="px-1 text-[13px] leading-relaxed text-ink-secondary">
                {t("releaseNotes.whatsNewEmpty", { version: shown })}
              </p>
            )}
          </div>
        )}
      </DialogFrame>
    </DialogLayer>
  );
}
