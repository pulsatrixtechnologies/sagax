// The page's header (#2313, split from BotProfilePage for #1383): the
// Appearance > Mascot hero card with the bot's name and label, who sees it,
// who owns it, its description edited in place and the unfolded Appearance.
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { ChevronDown, Lock, Palette, Star, Users } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canEditBotField } from "@/lib/bot-capabilities";
import { isViewersPrimaryBot, viewerOwnsBot } from "@/lib/primary-bot";
import { viewerActorId } from "@/lib/viewer";
import { personLabel } from "@/lib/human-label";
import { splitBotNameTitle } from "../../bot-settings/bot-name-title";
import { useOrgPeople } from "@/lib/perspicax-org";
import { personaSharingSummary } from "@/lib/bot-sharing";
import { MAUS_COLORS } from "@/lib/mascot";
import { avatarImageFrom, dragMayCarryImage } from "@/lib/avatar-input";
import { botMascotSkin } from "../../../../shared/mascot-skins";
import { completeMascotLook } from "../../../../shared/mascot-look";
import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { useAvatarSources } from "../../appearance/AvatarSources";
import { MASCOT_HERO_BUTTON, MascotLookPreview } from "../../floating-bots/MascotLookPreview";
import type { MascotHeroSlot } from "../../floating-bots/mascot-hero-slot";
import { InlineEditableText } from "../../bot-settings/InlineEditableText";
import type { useBotSectionContent } from "../../bot-settings/useBotSectionContent";
import { sectionLabel } from "./cards";

type Derived = ReturnType<typeof useBotSectionContent>["derived"];

// The character registry and its labels: fetched with the page's hero card,
// the same chunk the Appearance pane's editor loads.
const MascotLookEditor = lazy(() => import("../../floating-bots/MascotLookEditor"));

/** The header is the Appearance > Mascot hero card (#2313): the open
 * mascot editor draws it into this slot (so a character picked in its
 * grid previews here), the page draws it for the bot's own look while the
 * editor is closed. A picture dropped on it or pasted becomes the bot's. */
export function useBotProfileHero({ bot, derived, appearanceShown, appearanceLocked, appearanceOpen, onToggleAppearance }: {
  bot: Bot;
  derived: Derived;
  appearanceShown: boolean;
  appearanceLocked: boolean;
  appearanceOpen: boolean;
  onToggleAppearance: () => void;
}): { heroSlot: MascotHeroSlot; hero: ReactNode } {
  const { state, dispatch } = useStore();
  const canName = canEditBotField(state.config, bot, "name");
  const canLabel = canEditBotField(state.config, bot, "title");
  const [heroTarget, setHeroTarget] = useState<HTMLElement | null>(null);
  const [heroClaimed, setHeroClaimed] = useState(false);
  const claimHero = useCallback((claimed: boolean) => setHeroClaimed(claimed), []);
  const heroSources = useAvatarSources(bot, derived.patch);
  const [heroDropping, setHeroDropping] = useState(false);
  // a name stored with its title glued on ("Heron · Chief of Staff")
  // shows as two lines too; saving either line writes both fields apart
  const shown = splitBotNameTitle(bot.name, bot.title);
  const gluedTitle = shown.merged && !bot.title?.trim() ? { title: shown.title } : {};
  const heroTitle = (
    // The name alone on its line at 28px, the label under it, smaller and
    // secondary (JC: never "Name · Label" on one line).
    <h2 id="bot-profile-title" data-bot-profile-title="" className="flex min-w-0 max-w-full text-[28px] font-normal leading-9 text-ink">
      <InlineEditableText
        value={shown.name}
        required
        maxLength={BOT_PROFILE_LIMITS.name}
        ariaLabel={t("botPanel.name.edit")}
        onSave={canName ? (name) => derived.patch({ name, ...gluedTitle }) : undefined}
        className="min-w-0 text-[28px] font-normal leading-9 text-ink"
      />
    </h2>
  );
  const heroLabel = (shown.title || canLabel) ? (
    <div data-bot-profile-label="" className="flex min-w-0 max-w-full text-[15px] leading-5 text-ink-secondary">
      <InlineEditableText
        value={shown.title}
        maxLength={BOT_PROFILE_LIMITS.title}
        placeholder={t("botPanel.label.add")}
        ariaLabel={t("botPanel.label.edit")}
        onSave={canLabel ? (title) => derived.patch(shown.merged ? { title, name: shown.name } : { title }) : undefined}
        className="min-w-0 text-[15px] leading-5 text-ink-secondary"
      />
    </div>
  ) : undefined;
  // Where the hero's Randomize was: Appearance unfolds its four tabs under
  // the header (the sources in the Mascot tab, Reset and Randomize in the tab row).
  const appearanceButton = appearanceShown ? (
    <button
      type="button"
      data-bot-profile-appearance-toggle=""
      aria-expanded={appearanceOpen}
      aria-controls="bot-profile-appearance"
      onClick={onToggleAppearance}
      className={cn(MASCOT_HERO_BUTTON, appearanceOpen && "bg-raised-hover")}
    >
      <Palette size={13} aria-hidden="true" />
      {t("botProfile.appearanceButton")}
      {appearanceLocked && <Lock size={11} aria-label={t("persona.lockedBadge")} className="shrink-0 text-ink-tertiary" />}
      <ChevronDown size={13} aria-hidden="true" className={cn("transition-transform", appearanceOpen && "rotate-180")} />
    </button>
  ) : undefined;
  const heroSlot: MascotHeroSlot = {
    target: heroTarget,
    claim: claimHero,
    heading: heroTitle,
    subheading: heroLabel,
    action: appearanceButton,
    state: derived.activeState,
    motion: derived.mascotMotion,
  };
  const heroLook = completeMascotLook(bot.mascotLook);
  const heroPicture = (bot.avatarCrop ?? "mascot") !== "mascot" && bot.avatarUrl ? bot : undefined;
  // The hero before the editor's chunk arrives (and for a picture): the same
  // card, without the character's summary and moves.
  const staticHero = (
    <MascotLookPreview
      bot={bot}
      shown={heroLook.character}
      shownName=""
      shownLook={heroLook}
      shownLock={{ locked: false }}
      summary={heroPicture ? t("appearance.pictureInUse") : ""}
      tint={MAUS_COLORS[bot.color] ?? MAUS_COLORS.green}
      owlSkin={botMascotSkin(bot.mascotSkin)}
      previewSkin={null}
      inUse
      moves={[]}
      owlMotion={null}
      fxMove={null}
      onUse={() => {}}
      onPlay={() => {}}
      onPlayNext={() => {}}
      heading={heroTitle}
      subheading={heroLabel}
      action={appearanceButton}
      picture={heroPicture}
      liveState={derived.activeState}
      liveMotion={derived.mascotMotion}
    />
  );

  const hero = (
    <>
      <div
        data-bot-profile-hero=""
        onDragOver={(event) => {
          if (heroSources.busy || !dragMayCarryImage(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setHeroDropping(true);
        }}
        onDragLeave={() => setHeroDropping(false)}
        onDrop={(event) => {
          setHeroDropping(false);
          const file = avatarImageFrom(event.dataTransfer);
          if (!file) return;
          // preventDefault tells the chat's window drop target (ComposerAttachments) it is taken
          event.preventDefault();
          void heroSources.upload(file);
        }}
        onPaste={(event) => {
          const file = avatarImageFrom(event.clipboardData);
          if (!file) return;
          // the chat's own drop and paste targets must not also take it
          event.preventDefault();
          event.stopPropagation();
          void heroSources.upload(file);
        }}
        title={t("botPanel.avatar.dropOrPaste")}
        data-avatar-dropping={heroDropping ? "" : undefined}
        className={cn("@container relative -mt-[40px] rounded-[18px]", heroDropping && "ring-2 ring-accent")}
      >
        <div ref={setHeroTarget} data-bot-profile-hero-slot="" className={heroClaimed ? undefined : "hidden"} />
        {!heroClaimed && (
          heroPicture ? staticHero : (
            <Suspense fallback={staticHero}>
              <MascotLookEditor
                heroOnly
                bot={bot}
                onPatch={derived.patch}
                onOwlMove={(kind) => dispatch({ type: "playMascotMotion", botId: bot.id, kind })}
              />
            </Suspense>
          )
        )}
      </div>
      {heroSources.error && <p role="alert" className="mt-1 text-[11.5px] text-danger">{heroSources.error}</p>}
    </>
  );

  return { heroSlot, hero };
}

/** The header: the mascot hero card with the bot's name and label, then who
 * sees it and its description, edited in place, and the Appearance pane
 * while it is unfolded. */
export function BotProfileHeader({ bot, derived, hero, appearance }: {
  bot: Bot;
  derived: Derived;
  hero: ReactNode;
  /** The Appearance pane's body, or null while it is folded. */
  appearance: ReactNode | null;
}) {
  const { state } = useStore();
  const viewerId = viewerActorId(state.config);
  const people = useOrgPeople();
  // Who sees it, who owns it, what this viewer may change.
  const sharing = personaSharingSummary(bot);
  const notShared = sharing === t("botSettings.sharing.empty");
  const audience = notShared && viewerOwnsBot(bot, viewerId) ? t("botProfile.privateToYou") : sharing;
  const isPrimary = isViewersPrimaryBot(bot, viewerId);
  const ownerId = bot.ownerUserId?.trim() ?? "";
  const ownerPerson = people.get(ownerId.toLowerCase());
  const owner = ownerId && !viewerOwnsBot(bot, viewerId) ? personLabel(ownerPerson?.name, ownerPerson?.login, ownerId) : "";
  const canDescribe = canEditBotField(state.config, bot, "description");

  return (
    <header data-bot-profile-header="" data-bot-profile-section="overview" data-persona-section="overview" data-open="" aria-label={sectionLabel("overview")} className="flex min-w-0 flex-col">
      {hero}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] leading-5 text-ink-secondary">
        <span data-bot-profile-audience="" className="inline-flex items-center gap-1.5">
          <Lock size={13} aria-hidden="true" /> {audience}
        </span>
        {owner && (
          <span data-bot-profile-owner="" className="inline-flex items-center gap-1.5">
            <Users size={13} aria-hidden="true" /> {t("persona.overview.owner")}: {owner}
          </span>
        )}
        {isPrimary && (
          <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px]">
            <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
          </span>
        )}
      </div>
      {/* The description, typed in place; grows with its text. */}
      {canDescribe ? (
        <textarea
          data-bot-profile-description=""
          rows={2}
          maxLength={BOT_PROFILE_LIMITS.description}
          placeholder={t("botPanel.identity.blurbPlaceholder")}
          aria-label={t("persona.overview.description")}
          value={bot.description}
          onChange={(event) => derived.patch({ description: event.target.value })}
          className="mt-3 max-h-[12lh] w-full resize-none rounded-lg bg-transparent px-0 py-0 text-[14px] leading-6 text-ink field-sizing-content placeholder:text-ink-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
      ) : (
        <p data-bot-profile-description="" className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-ink">
          {bot.description.trim() || <span className="text-ink-secondary">{t("persona.overview.noDescription")}</span>}
        </p>
      )}
      {/* Nothing of the Appearance shows here while it is folded: the colour
          dots live in its Color tab only (JC 2026-11-06). */}
      {appearance !== null && (
        <section
          id="bot-profile-appearance"
          aria-label={sectionLabel("appearance")}
          data-bot-profile-section="appearance"
          data-persona-section="appearance"
          data-open=""
          className="mt-4 flex flex-col gap-3"
        >
          {appearance}
        </section>
      )}
    </header>
  );
}
