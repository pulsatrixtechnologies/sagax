// The V6 bot page's rows and sub-pages (#2612, the "Épuré Grok Bot"
// canvas): a tab is a list of rows under grey labels, each row opens its own
// sub-page (Back, a title, one line of intro, then the section bodies).
import type { ReactNode } from "react";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderOpen,
  History,
  MessageCircle,
  Plug,
  Puzzle,
  Repeat,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  Zap,
} from "lucide-react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { BotProfileSubPage } from "@/lib/persona-sections";

type Meta = { icon: ReactNode; title: LocaleKey; desc: LocaleKey; intro: LocaleKey };

// Literal keys, so the catalog check sees each one read.
const meta = (icon: ReactNode, title: LocaleKey, desc: LocaleKey, intro: LocaleKey): Meta => ({ icon, title, desc, intro });

/** Each sub-page's icon, name, row description and intro. */
export const SUBPAGE_META: Record<BotProfileSubPage, Meta> = {
  personality: meta(<UserRound />, "botProfile.v6.page.personality.title", "botProfile.v6.page.personality.desc", "botProfile.v6.page.personality.intro"),
  model: meta(<Cpu />, "botProfile.v6.page.model.title", "botProfile.v6.page.model.desc", "botProfile.v6.page.model.intro"),
  beforeActing: meta(<ShieldCheck />, "botProfile.v6.page.beforeActing.title", "botProfile.v6.page.beforeActing.desc", "botProfile.v6.page.beforeActing.intro"),
  channels: meta(<MessageCircle />, "botProfile.v6.page.channels.title", "botProfile.v6.page.channels.desc", "botProfile.v6.page.channels.intro"),
  sharing: meta(<Users />, "botProfile.v6.page.sharing.title", "botProfile.v6.page.sharing.desc", "botProfile.v6.page.sharing.intro"),
  accounts: meta(<Plug />, "botProfile.v6.page.accounts.title", "botProfile.v6.page.accounts.desc", "botProfile.v6.page.accounts.intro"),
  rules: meta(<ScrollText />, "botProfile.v6.page.rules.title", "botProfile.v6.page.rules.desc", "botProfile.v6.page.rules.intro"),
  actsAlone: meta(<Zap />, "botProfile.v6.page.actsAlone.title", "botProfile.v6.page.actsAlone.desc", "botProfile.v6.page.actsAlone.intro"),
  voice: meta(<AudioLines />, "botProfile.v6.page.voice.title", "botProfile.v6.page.voice.desc", "botProfile.v6.page.voice.intro"),
  advanced: meta(<SlidersHorizontal />, "botProfile.v6.page.advanced.title", "botProfile.v6.page.advanced.desc", "botProfile.v6.page.advanced.intro"),
  versions: meta(<History />, "botProfile.v6.page.versions.title", "botProfile.v6.page.versions.desc", "botProfile.v6.page.versions.intro"),
  routines: meta(<Repeat />, "botProfile.v6.page.routines.title", "botProfile.v6.page.routines.desc", "botProfile.v6.page.routines.intro"),
  skills: meta(<Puzzle />, "botProfile.v6.page.skills.title", "botProfile.v6.page.skills.desc", "botProfile.v6.page.skills.intro"),
  folder: meta(<FolderOpen />, "botProfile.v6.page.folder.title", "botProfile.v6.page.folder.desc", "botProfile.v6.page.folder.intro"),
};

/** The grey label over each group of rows. */
export const GROUP_LABEL: Record<string, LocaleKey> = {
  settings: "botProfile.v6.group.settings",
  channels: "botProfile.v6.group.channels",
  accounts: "botProfile.v6.group.accounts",
  more: "botProfile.v6.group.more",
  work: "botProfile.v6.group.work",
};

/** One row of a tab: icon, name, description under it, a value and a
 * chevron on the right. The whole row opens its sub-page. */
export function SubPageRow({ page, value, onOpen }: { page: BotProfileSubPage; value?: string | null; onOpen: () => void }) {
  const entry = SUBPAGE_META[page];
  return (
    <button
      type="button"
      data-bot-profile-row={`page-${page}`}
      data-bot-profile-subpage-open={page}
      onClick={onOpen}
      className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-hover"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5 [&>svg]:stroke-[1.5]" aria-hidden="true">{entry.icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] leading-5 text-ink">{t(entry.title)}</span>
        <span data-bot-profile-state="" className="truncate text-[12px] leading-4 text-ink-secondary">{t(entry.desc)}</span>
      </span>
      {value ? <span data-bot-profile-value="" className="max-w-[40%] shrink-0 truncate text-[13px] leading-5 text-ink-secondary">{value}</span> : null}
      <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
    </button>
  );
}

/** A sub-page: Back, its title, one line of intro, then its cards. */
export function SubPage({ page, onBack, children }: { page: BotProfileSubPage; onBack: () => void; children: ReactNode }) {
  const entry = SUBPAGE_META[page];
  return (
    <div data-bot-profile-subpage={page} className="mt-4 flex min-w-0 flex-col">
      <button
        type="button"
        data-bot-profile-back=""
        onClick={onBack}
        className="-ml-1 flex min-h-[32px] w-fit items-center gap-1 rounded-lg px-1 text-[13px] leading-5 text-ink-secondary transition-colors hover:text-ink"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        {t("botProfile.v6.back")}
      </button>
      <h2 data-bot-profile-subpage-title="" className="mt-2 text-[18px] font-semibold leading-6 text-ink">{t(entry.title)}</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{t(entry.intro)}</p>
      <div className="mt-5 flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  );
}
