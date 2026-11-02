// "About Sagax": the version you are running and where to go next. Centred
// modal over the app (Settings > About under App, the profile menu, and the
// app menu). Same card the gallery and window tests draw.
//
// 2026-10-16: the Pulsatrix mark, "Sagax", the version, then the links as
// rows of one card (release notes first), the copyright in grey at the bottom.
import { useEffect, useRef, useState } from "react";

import {
  APP_NAME,
  APP_REPOSITORY,
  DOCS_URL,
  LICENSE_URL,
  appVersion,
  baseVersion,
  openExternalLink,
  platformLabel,
} from "@/lib/app-links";
import { subscribeAbout } from "@/lib/about-ui";
import { t } from "@/lib/i18n";
import { requestReleaseNotes } from "@/lib/release-notes-ui";
import { useCategoryModalKeyboard } from "./category-modal";
import { PulsatrixOwlMark } from "./PulsatrixOwlMark";
import { DIALOG, DialogCloseButton, DialogLayer, GROUP_CARD, LinkRow } from "./SettingsPrimitives";

/** Body of About: owl, name, version, link rows, footer. */
export function AboutCard({ onOpenReleaseNotes }: { onOpenReleaseNotes?: () => void }) {
  const platform = typeof window !== "undefined" ? platformLabel(window.ogb?.platform) : null;
  return (
    <section aria-labelledby="about-dialog-title" data-about-section="" className="flex flex-col gap-3">
      <div className="flex flex-col items-center text-center">
        <span className="text-ink" data-about-mark="">
          <PulsatrixOwlMark width={56} height={50} />
        </span>
        <h2 id="about-dialog-title" className={`${DIALOG.title} mt-3`}>
          {APP_NAME}
        </h2>
        <p className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">
          {t("about.version", { version: appVersion() })}
          {platform ? ` · ${platform}` : ""}
        </p>
      </div>
      <div className={GROUP_CARD}>
        <LinkRow
          label={t("releaseNotes.menu")}
          onClick={() => {
            onOpenReleaseNotes?.();
            requestReleaseNotes("browse");
          }}
        />
        <AboutLink href={APP_REPOSITORY} label="GitHub" />
        <AboutLink href={DOCS_URL} label={t("about.docs")} />
        <AboutLink href={LICENSE_URL} label={t("about.license")} />
      </div>
      <p className="px-1 text-center text-[12px] leading-4 text-ink-secondary">
        {t("about.copyright")}
        <br />
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
        className={`${DIALOG.frame} ${DIALOG.width.sm}`}
      >
        <DialogCloseButton label={t("common.close")} onClick={onClose} />
        <div className={`${DIALOG.body} pt-7`}>
          <AboutCard onOpenReleaseNotes={onClose} />
        </div>
      </div>
    </DialogLayer>
  );
}

function AboutLink({ href, label }: { href: string; label: string }) {
  return <LinkRow external label={label} onClick={() => void openExternalLink(href)} />;
}
