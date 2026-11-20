// The V6 bot page's rows and sub-pages (#2612, the "Épuré Grok Bot"
// canvas): a row under a grey label opens its own sub-page (a title, one line
// of intro, then the section bodies), for a setting too long for a card
// (#3398: the channels and the accounts are cards in place). A sub-page is a
// modal over the bot page, as the reference app's (#4470).
import type { ReactNode } from "react";
import {
  AudioLines,
  ChevronRight,
  Cpu,
  History,
  Palette,
  Repeat,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Zap,
} from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { BotProfileSubPage } from "@/lib/persona-sections";
import { BotPageModal, type BotPageModalSize } from "../BotPageModal";

type Meta = { icon: ReactNode; title: LocaleKey; desc: LocaleKey; intro: LocaleKey };

// Literal keys, so the catalog check sees each one read.
const meta = (icon: ReactNode, title: LocaleKey, desc: LocaleKey, intro: LocaleKey): Meta => ({ icon, title, desc, intro });

/** Each sub-page's icon, name, row description and intro. */
export const SUBPAGE_META: Record<BotProfileSubPage, Meta> = {
  personality: meta(<UserRound />, "botProfile.v6.page.personality.title", "botProfile.v6.page.personality.desc", "botProfile.v6.page.personality.intro"),
  model: meta(<Cpu />, "botProfile.v6.page.model.title", "botProfile.v6.page.model.desc", "botProfile.v6.page.model.intro"),
  beforeActing: meta(<ShieldCheck />, "botProfile.v6.page.beforeActing.title", "botProfile.v6.page.beforeActing.desc", "botProfile.v6.page.beforeActing.intro"),
  rules: meta(<ScrollText />, "botProfile.v6.page.rules.title", "botProfile.v6.page.rules.desc", "botProfile.v6.page.rules.intro"),
  actsAlone: meta(<Zap />, "botProfile.v6.page.actsAlone.title", "botProfile.v6.page.actsAlone.desc", "botProfile.v6.page.actsAlone.intro"),
  voice: meta(<AudioLines />, "botProfile.v6.page.voice.title", "botProfile.v6.page.voice.desc", "botProfile.v6.page.voice.intro"),
  advanced: meta(<SlidersHorizontal />, "botProfile.v6.page.advanced.title", "botProfile.v6.page.advanced.desc", "botProfile.v6.page.advanced.intro"),
  versions: meta(<History />, "botProfile.v6.page.versions.title", "botProfile.v6.page.versions.desc", "botProfile.v6.page.versions.intro"),
  routines: meta(<Repeat />, "botProfile.v6.page.routines.title", "botProfile.v6.page.routines.desc", "botProfile.v6.page.routines.intro"),
};

/** Each sub-page's modal size: an editor, a list or a table gets the large
 * one (a short list the wide one: as tall as its content), a few fields the medium one (BOT_PAGE_MODAL.size). */
export const SUBPAGE_SIZE: Record<BotProfileSubPage, BotPageModalSize> = {
  personality: "large",
  model: "medium",
  beforeActing: "wide",
  rules: "large",
  actsAlone: "large",
  voice: "medium",
  advanced: "large",
  versions: "large",
  routines: "wide",
};

/** The grey label over each group of rows (the channels and accounts
 * cards carry their own). */
export const GROUP_LABEL: Record<string, LocaleKey> = {
  settings: "botProfile.v6.group.settings",
  more: "botProfile.v6.group.more",
};

/** One row of a tab that opens a modal: icon, name, description under it,
 * a value and a chevron on the right. The whole row opens it: a sub-page
 * (SubPageRow) or the Appearance modal (M-20261119-081). */
export function ModalRow({ icon, title, desc, value, onOpen, hit = false, ...data }: {
  icon: ReactNode;
  title: string;
  desc: string;
  value?: string | null;
  onOpen: () => void;
  /** the search's hit is on this row: marked as Settings marks a hit; Enter opens it (#4470) */
  hit?: boolean;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      {...data}
      aria-haspopup="dialog"
      data-settings-search-hit={hit ? "" : undefined}
      onClick={onOpen}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-hover"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5 [&>svg]:stroke-[1.5]" aria-hidden="true">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-5 text-ink">{title}</span>
        <span data-bot-profile-state="" className="truncate text-[12px] leading-4 text-ink-secondary">{desc}</span>
      </span>
      {value ? <span data-bot-profile-value="" className="max-w-[40%] shrink-0 truncate text-[13px] leading-5 text-ink-secondary">{value}</span> : null}
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
    </button>
  );
}

/** A row that opens its sub-page's modal. */
export function SubPageRow({ page, value, onOpen, title, hit = false }: {
  page: BotProfileSubPage;
  value?: string | null;
  onOpen: () => void;
  title?: LocaleKey;
  hit?: boolean;
}) {
  const entry = { ...SUBPAGE_META[page], ...(title ? { title } : {}) };
  return (
    <ModalRow
      icon={entry.icon}
      title={t(entry.title)}
      desc={t(entry.desc)}
      value={value}
      onOpen={onOpen}
      hit={hit}
      data-bot-profile-row={`page-${page}`}
      data-bot-profile-subpage-open={page}
    />
  );
}

/** General > Settings' Appearance row (M-20261119-081, back after #4188):
 * the mascot editor's modal, the one the header's mascot opens too. */
export function AppearanceRow({ value, onOpen }: { value: string; onOpen: () => void }) {
  return (
    <ModalRow
      icon={<Palette />}
      title={t("botProfile.tab.appearance")}
      desc={t("botProfile.v6.page.appearance.desc")}
      value={value}
      onOpen={onOpen}
      data-bot-profile-row="appearance"
      data-bot-profile-appearance-row=""
    />
  );
}

/** A sub-page, opened as a modal over the bot page (#4470, as the
 * reference): its title and one line of intro in the modal's header, then
 * its cards. Escape or the close button returns to the row that opened it. */
export function SubPageModal({ page, children, title, onClose }: { page: BotProfileSubPage; children: ReactNode; title?: LocaleKey; onClose: () => void }) {
  const entry = { ...SUBPAGE_META[page], ...(title ? { title } : {}) };
  return (
    <BotPageModal id={`page-${page}`} title={t(entry.title)} description={t(entry.intro)} size={SUBPAGE_SIZE[page]} onClose={onClose}>
      <div data-bot-profile-subpage={page} className="flex min-w-0 flex-col gap-6">{children}</div>
    </BotPageModal>
  );
}
