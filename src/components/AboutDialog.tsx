// "About Sagax": the version you are running and where to go next. It lives
// in Settings > Updates (one place). AboutDialog remains a thin wrapper so
// the gallery and the window tests can still draw the same card.
//
// 2026-10-16 : the Pulsatrix mark, "Sagax", the version, then the links as
// rows of one card (release notes first), the copyright in grey at the bottom.
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
import { t } from "@/lib/i18n";
import { requestReleaseNotes } from "@/lib/release-notes-ui";
import { PulsatrixOwlMark } from "./PulsatrixOwlMark";
import { GROUP_CARD, LinkRow } from "./SettingsPrimitives";

export function AboutCard({ onOpenReleaseNotes }: { onOpenReleaseNotes?: () => void }) {
  const platform = typeof window !== "undefined" ? platformLabel(window.ogb?.platform) : null;
  return (
    <section aria-labelledby="about-dialog-title" data-about-section="" className="flex flex-col gap-3">
      <h3 className="px-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("sidebar.menu.about")}</h3>
      <div className="flex flex-col items-center text-center">
        <span className="text-ink" data-about-mark="">
          <PulsatrixOwlMark width={56} height={50} />
        </span>
        <h2 id="about-dialog-title" className="mt-3 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink">
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

/** Gallery and tests. The running app opens Settings > Updates instead. */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AboutCard onOpenReleaseNotes={onClose} />;
}

function AboutLink({ href, label }: { href: string; label: string }) {
  return <LinkRow external label={label} onClick={() => void openExternalLink(href)} />;
}
