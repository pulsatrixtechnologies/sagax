// "About Sagax": the version you are running and where to go next. Centred
// modal over the app (Settings > About under App, the profile menu, and the
// app menu). Same card the gallery and window tests draw.
//
// #4097 (the reference's About, measured on the reference app: a 320px
// dialog, 32px over the content, 12px between its lines): the mark at 64px,
// the name at 22px, "Version x.y.z" and "Built <date>" in 12px grey, the
// copyright, one pill "Copy version info"; this app's links stay under it as
// quiet text links (release notes first), then the upstream line in grey.
import { useEffect, useRef, useState } from "react";

import {
  APP_NAME,
  APP_REPOSITORY,
  DOCS_URL,
  LICENSE_URL,
  appVersion,
  baseVersion,
  buildDate,
  openExternalLink,
  platformLabel,
} from "@/lib/app-links";
import { subscribeAbout } from "@/lib/about-ui";
import { useCopyFeedback } from "@/lib/copy-text";
import { activeLocale, t } from "@/lib/i18n";
import { requestReleaseNotes } from "@/lib/release-notes-ui";
import { useCategoryModalKeyboard } from "./category-modal";
import { PulsatrixOwlMark } from "./PulsatrixOwlMark";
import { DIALOG, DialogCloseButton, DialogLayer, PILL } from "./SettingsPrimitives";

/** "Nov 12, 2026" in the app language, or null when the build has no date. */
function builtLabel(date: string | null): string | null {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

/** What "Copy version info" puts on the clipboard: version, build date,
 * platform and the upstream base, one per line. */
export function versionInfoText(platform: string | null): string {
  const built = builtLabel(buildDate());
  return [
    t("about.version", { version: appVersion() }),
    built ? t("about.built", { date: built }) : null,
    platform,
    t("about.basedOn", { version: baseVersion() }),
  ].filter(Boolean).join("\n");
}

const QUIET_LINK = "rounded px-1 text-[12px] leading-4 text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none";

/** Body of About: mark, name, version and build lines, copyright, Copy
 * version info, the links, the upstream line. */
export function AboutCard({ onOpenReleaseNotes }: { onOpenReleaseNotes?: () => void }) {
  const platform = typeof window !== "undefined" ? platformLabel(window.ogb?.platform) : null;
  const built = builtLabel(buildDate());
  const { state, copy } = useCopyFeedback(versionInfoText(platform));
  return (
    <section aria-labelledby="about-dialog-title" data-about-section="" className="flex flex-col items-center gap-3 text-center">
      <span className="text-ink" data-about-mark="">
        <PulsatrixOwlMark width={72} height={64} />
      </span>
      <h2 id="about-dialog-title" className="text-[22px] font-semibold leading-7 tracking-[-0.012em] text-ink">
        {APP_NAME}
      </h2>
      <div className="flex min-w-0 flex-col items-center gap-0.5 text-[12px] leading-4 text-ink-secondary" data-about-lines="">
        <p dir="ltr" data-about-version="">{t("about.version", { version: appVersion() })}</p>
        {built && <p data-about-built="">{t("about.built", { date: built })}</p>}
      </div>
      <p className="text-[12px] leading-4 text-ink-tertiary" data-about-copyright="">{t("about.copyright")}</p>
      <div className="flex justify-center pt-2">
        <button type="button" onClick={copy} className={PILL} data-about-copy="">
          {state === "copied" ? t("about.copied") : state === "failed" ? t("common.copyFailed") : t("about.copyInfo")}
        </button>
      </div>
      <nav aria-label={APP_NAME} className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1" data-about-links="">
        <button
          type="button"
          className={QUIET_LINK}
          onClick={() => {
            onOpenReleaseNotes?.();
            requestReleaseNotes("browse");
          }}
        >
          {t("releaseNotes.menu")}
        </button>
        <AboutLink href={APP_REPOSITORY} label="GitHub" />
        <AboutLink href={DOCS_URL} label={t("about.docs")} />
        <AboutLink href={LICENSE_URL} label={t("about.license")} />
      </nav>
      <p className="text-[11px] leading-4 text-ink-tertiary" data-about-based-on="">
        {t("about.basedOn", { version: baseVersion() })}
      </p>
    </section>
  );
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AboutWindow onClose={onClose} />;
}

/** Listens for requestAbout and the desktop app menu; mounts the modal. */
export function AboutPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeAbout(() => setOpen(true)), []);
  useEffect(() => window.ogb?.onOpenAbout?.(() => setOpen(true)), []);
  return <AboutDialog open={open} onClose={() => setOpen(false)} />;
}

function AboutWindow({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus starts on the close button; Escape closes; Tab stays inside.
  useCategoryModalKeyboard(dialogRef, "[data-dialog-close]", onClose);

  return (
    <DialogLayer onBackdropMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        tabIndex={-1}
        data-about-dialog=""
        className={`${DIALOG.frame} ${DIALOG.width.xs}`}
      >
        <DialogCloseButton label={t("common.close")} onClick={onClose} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-8">
          <AboutCard onOpenReleaseNotes={onClose} />
        </div>
      </div>
    </DialogLayer>
  );
}

function AboutLink({ href, label }: { href: string; label: string }) {
  return (
    <button type="button" className={QUIET_LINK} onClick={() => void openExternalLink(href)}>
      {label}
    </button>
  );
}
