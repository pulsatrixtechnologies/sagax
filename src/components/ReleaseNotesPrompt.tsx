// "What's new" after an update. Once per version, never on a fresh install
// and never in a dev build. A dismissible banner announces it. The notes
// themselves are a content page (Back returns to the chat). About and the
// account menu open that page again through requestReleaseNotes, before or
// after the update.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { appVersion } from "@/lib/app-links";
import { bundledNotesFor, bundledNotesSince, bundledReleaseCatalog, bundledVersions } from "@/lib/bundled-release-notes";
import { useDesktopCapabilities, useCaptionChrome } from "@/components/DesktopCapabilities";
import { activeLocale, t } from "@/lib/i18n";
import { isBackShortcut } from "@/lib/back-shortcut";
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
import { PILL, PillSelect } from "./SettingsPrimitives";
import { BackButton } from "./Breadcrumb";
import { PAGE_COLUMN, PAGE_SCROLL, PageTopStrip } from "./content-page";
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
    // Private mode can refuse the write. This launch can still show the banner.
  }
}

/** undefined: the content frame has not been looked up yet. */
function useContentFrame(): Element | null | undefined {
  const [frame, setFrame] = useState<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    setFrame(document.querySelector(".app-content-frame"));
  }, []);
  return frame;
}

function place(frame: Element | null | undefined, node: ReactNode): ReactNode {
  if (frame) return createPortal(node, frame);
  return node;
}

export function ReleaseNotesPrompt() {
  const { state, dispatch } = useStore();
  const { capabilities, ready } = useDesktopCapabilities();
  const frame = useContentFrame();
  const [banner, setBanner] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [mode, setMode] = useState<ReleaseNotesMode>("current");
  const [picked, setPicked] = useState(appVersion());
  const [since, setSince] = useState(false);
  const catalog = useMemo(() => bundledReleaseCatalog(), []);
  const openPage = (next: ReleaseNotesMode) => {
    setMode(next);
    setPicked(appVersion());
    setSince(false);
    setPageOpen(true);
    setBanner(false);
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
  };
  const openPageRef = useRef(openPage);
  openPageRef.current = openPage;
  const decided = useRef(false);

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
    if (decision.show) setBanner(true);
  }, [state.config, ready, capabilities.host.packaged]);

  useEffect(() => subscribeReleaseNotes((next) => openPageRef.current(next)), []);

  useEffect(() => {
    if (!banner || pageOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setBanner(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [banner, pageOpen]);

  if (frame === undefined) return null;

  const version = appVersion();
  const dismissBanner = () => setBanner(false);

  return (
    <>
      {banner && !pageOpen && place(frame, (
        <div
          role="status"
          aria-labelledby="release-notes-banner-title"
          data-release-notes-banner=""
          className={cn(
            "z-30 flex w-[min(440px,calc(100%-32px))] flex-col gap-3 rounded-2xl border border-hairline bg-elevated p-4 shadow-lg",
            frame ? "absolute inset-x-0 top-3 mx-auto" : "fixed inset-x-0 bottom-6 mx-auto",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="release-notes-banner-title" className="text-[15px] font-medium text-ink">{t("releaseNotes.whatsNewTitle")}</h2>
              <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{t("releaseNotes.bannerBody", { version })}</p>
            </div>
            <button
              type="button"
              onClick={dismissBanner}
              aria-label={t("releaseNotes.close")}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-full px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-hover" onClick={dismissBanner}>
              {t("releaseNotes.notNow")}
            </button>
            <button type="button" className="rounded-full bg-accent px-3 py-1.5 text-[13px] text-white" onClick={() => openPage("current")}>
              {t("releaseNotes.bannerOpen")}
            </button>
          </div>
        </div>
      ))}
      {pageOpen && place(frame, (
        <ReleaseNotesPage
          embedded={Boolean(frame)}
          mode={mode}
          picked={picked}
          since={since}
          catalog={catalog}
          onPick={setPicked}
          onSince={setSince}
          onClose={() => setPageOpen(false)}
        />
      ))}
    </>
  );
}

function ReleaseNotesPage({
  embedded,
  mode,
  picked,
  since,
  catalog,
  onPick,
  onSince,
  onClose,
}: {
  embedded: boolean;
  mode: ReleaseNotesMode;
  picked: string;
  since: boolean;
  catalog: ReturnType<typeof bundledReleaseCatalog>;
  onPick: (version: string) => void;
  onSince: (next: boolean) => void;
  onClose: () => void;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const { dragProps, noDragStyle } = useCaptionChrome();
  const version = appVersion();
  const language = activeLocale();
  const browse = mode === "browse";
  const shown = browse ? picked : version;
  const notes = bundledNotesFor(shown, language, catalog);
  const safe = notes?.trim() ?? "";
  const versions = bundledVersions(catalog);
  if (browse && !versions.includes(version)) versions.unshift(version);
  const previous = readPrevious();
  const sinceEntries = previous ? bundledNotesSince(previous, version, catalog) : [];
  const cumulative = !browse && sinceEntries.length > 1;

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape" && !isBackShortcut(event)) return;
      if (event.target instanceof Element && event.target.closest('[role="listbox"]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const title = browse ? t("releaseNotes.browseTitle") : t("releaseNotes.whatsNewTitle");

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      data-release-notes={mode}
      data-release-notes-page=""
      className={cn("flex flex-col bg-app outline-none", embedded ? "absolute inset-0 z-20 min-h-0" : "min-h-screen")}
    >
      <PageTopStrip />
      <header data-release-notes-header="" data-page-header="" className="content-topbar shrink-0 border-b border-hairline/50 bg-app py-3 pl-5 pr-4" {...dragProps}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={noDragStyle}>
          <div className="flex min-w-0 items-center gap-2" data-page-title="">
            <BackButton onBack={onClose} data={{ "data-release-notes-back": "" }} />
            <h1 className="text-[15px] font-medium leading-6 text-ink">{title}</h1>
          </div>
        </div>
      </header>
      <div className={PAGE_SCROLL}>
        <div className={PAGE_COLUMN}>
          {browse && (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
              {sinceEntries.length > 0 ? (
                <button
                  type="button"
                  aria-pressed={since}
                  onClick={() => onSince(!since)}
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
                  onPick(next);
                  onSince(false);
                }}
              />
            </div>
          )}
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
        </div>
      </div>
    </main>
  );
}
