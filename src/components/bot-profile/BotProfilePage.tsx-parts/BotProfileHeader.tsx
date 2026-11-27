// The page's header (#2313, split from BotProfilePage for #1383): the
// mascot on the left of the column over the banner's lower edge, the bot's name and
// label on ONE line "Name · Label", then who sees it and who owns it, all
// aligned left and tight. No description line: the bot changes its own
// description when asked (update_agent_settings). The mascot editor
// itself is the Appearance modal, opened by a click on the mascot.
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Lock, Star, UserRound, Users } from "lucide-react";

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
import { avatarImageFrom, dragMayCarryImage } from "@/lib/avatar-input";
import { botMascotSkin } from "../../../../shared/mascot-skins";
import { completeMascotLook, withEngineLook, type MascotLook } from "../../../../shared/mascot-look";
import { BOT_PROFILE_LIMITS } from "../../../../shared/bot-profile";
import { useAvatarSources } from "../../appearance/AvatarSources";
import { useCaptionChrome } from "../../DesktopCapabilities";
import { MascotLookPreview } from "../../floating-bots/MascotLookPreview";
import type { MascotHeroSlot } from "../../floating-bots/mascot-hero-slot";
import { InlineEditableText } from "../../bot-settings/InlineEditableText";
import type { useBotSectionContent } from "../../bot-settings/useBotSectionContent";
import { sectionLabel } from "./cards";

type Derived = ReturnType<typeof useBotSectionContent>["derived"];

// The character registry and its labels: fetched with the page's hero card,
// the same chunk the Appearance modal's editor loads.
const MascotHero = lazy(() => import("../../floating-bots/MascotHero"));

/** The header's hero: the mascot, large and bare over the banner, with the
 * name and label stacked under it. A click on the mascot calls
 * `onOpenAppearance` (the Appearance modal, the owner 2026-11-19); the page draws
 * the hero for the bot's own look. A picture dropped on it
 * or pasted becomes the bot's. */
export function useBotProfileHero({ bot, derived, onOpenAppearance }: {
  bot: Bot;
  derived: Derived;
  /** Opens the Appearance modal; absent where this viewer is not offered it (the mascot is then not a button of its own). */
  onOpenAppearance?: (() => void) | undefined;
}): { heroSlot: MascotHeroSlot; hero: ReactNode } {
  const { state, dispatch } = useStore();
  const canName = canEditBotField(state.config, bot, "name");
  const canLabel = canEditBotField(state.config, bot, "title");
  const heroSources = useAvatarSources(bot, derived.patch);
  const [heroDropping, setHeroDropping] = useState(false);
  const { noDragStyle } = useCaptionChrome();
  // a name stored with its title glued on ("Heron · Chief of Staff")
  // shows as two lines too; saving either line writes both fields apart
  const shown = splitBotNameTitle(bot.name, (bot.title ?? ""));
  const gluedTitle = shown.merged && !bot.title?.trim() ? { title: shown.title } : {};
  const heroTitle = (
    // One line "Name · Label" as the reference (owner 2026-11-17): the name in
    // the heading style (26px over 32, medium, -0.015em, #4420), the label
    // after the separator, secondary and regular. The label shrinks and
    // truncates first, never a second line at desktop widths; under 640px
    // the line may wrap. Both are edited in place.
    <h2 id="bot-profile-title" data-bot-profile-title="" className="-ml-1.5 flex min-w-0 max-w-[calc(100%+0.375rem)] flex-wrap items-baseline justify-start text-left text-[26px] font-medium leading-8 tracking-[-0.015em] text-ink sm:flex-nowrap">
      {/* the separator travels with the name: when the label wraps (a phone) the dot ends the first line */}
      <span className="flex min-w-0 shrink-0 items-baseline max-sm:shrink">
        <InlineEditableText
          value={shown.name}
          required
          maxLength={BOT_PROFILE_LIMITS.name}
          ariaLabel={t("botPanel.name.edit")}
          onSave={canName ? (name) => derived.patch({ name, ...gluedTitle }) : undefined}
          className="min-w-0 justify-start text-left text-[26px] font-medium leading-8 tracking-[-0.015em] text-ink"
        />
        {(shown.title || canLabel) && (
          <span data-bot-profile-separator="" aria-hidden="true" className="shrink-0 px-1 font-normal text-ink-secondary">·</span>
        )}
      </span>
      {(shown.title || canLabel) && (
        <span data-bot-profile-label="" className="flex min-w-0 shrink justify-start font-normal text-ink-secondary">
          <InlineEditableText
            value={shown.title}
            maxLength={BOT_PROFILE_LIMITS.title}
            placeholder={t("botPanel.label.add")}
            ariaLabel={t("botPanel.label.edit")}
            onSave={canLabel ? (title) => derived.patch(shown.merged ? { title, name: shown.name } : { title }) : undefined}
            className="min-w-0 justify-start text-left text-[26px] font-normal leading-8 tracking-[-0.015em] text-ink-secondary"
          />
        </span>
      )}
    </h2>
  );
  const heroSlot: MascotHeroSlot = {
    heading: heroTitle,
    profile: true,
    ...(onOpenAppearance ? { onOpen: onOpenAppearance, openLabel: t("botProfile.tab.appearance") } : {}),
    state: derived.activeState,
    motion: derived.mascotMotion,
    // the M key on the hero's shape mascot (#5384): the mood the picker's pill sets
    onMood: (mood) => derived.patch({ mascotLook: withEngineLook(completeMascotLook(bot.mascotLook), { mood }) as MascotLook }),
  };
  const heroLook = completeMascotLook(bot.mascotLook);
  const heroPicture = (bot.avatarCrop ?? "mascot") !== "mascot" && bot.avatarUrl ? bot : undefined;
  // The hero before the editor's chunk arrives (and for a picture): the
  // same bare mascot, name and label.
  const staticHero = (
    <MascotLookPreview
      bot={bot}
      shown={heroLook.character}
      shownName=""
      shownLook={heroLook}
      owlSkin={botMascotSkin(bot.mascotSkin)}
      moves={[]}
      owlMotion={null}
      fxMove={null}
      onPlay={() => {}}
      onPlayNext={() => {}}
      heading={heroTitle}
      profile
      picture={heroPicture}
      onActivate={onOpenAppearance}
      activateLabel={onOpenAppearance ? t("botProfile.tab.appearance") : undefined}
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
        // The mascot overlaps the banner, which is the window's drag handle
        // (#5371): cut out of it, or the mascot's upper half would move the
        // window instead of opening Appearance.
        style={noDragStyle}
        // the mascot's middle (168px frame) on the banner's lower edge (#4420)
        className={cn("relative -mt-[84px] flex flex-col items-start rounded-[18px]", heroDropping && "ring-2 ring-accent")}
      >
        {(
          heroPicture ? staticHero : (
            <Suspense fallback={staticHero}>
              <MascotHero
                bot={bot}
                onOwlMove={(kind) => dispatch({ type: "playMascotMotion", botId: bot.id, kind })}
              />
            </Suspense>
          )
        )}
      </div>
      {heroSources.error && <p role="alert" className="mt-1 text-[11px] text-danger">{heroSources.error}</p>}
    </>
  );

  return { heroSlot, hero };
}

/** The header: the mascot with the bot's name and label on one line,
 * then who sees it, all aligned left on the column. */
export function BotProfileHeader({ bot, hero }: {
  bot: Bot;
  hero: ReactNode;
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

  return (
    // #4420: the mascot, the name, the lines under it and the description
    // share the reference's left edge, 12px into the column, with the tab
    // labels and the cards' grey labels.
    <header data-bot-profile-header="" data-bot-profile-section="overview" data-persona-section="overview" data-open="" aria-label={sectionLabel("overview")} className="flex min-w-0 flex-col px-3">
      {hero}
      <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1 text-[13px] leading-5 text-ink-secondary">
        {/* The mark says what the words say (#3402): people when someone
            else sees the bot, the lock only when it is private. */}
        <span data-bot-profile-audience={notShared ? "private" : "shared"} className="inline-flex items-center gap-1.5">
          {notShared ? <Lock size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />} {audience}
        </span>
        {owner && (
          <span data-bot-profile-owner="" className="inline-flex items-center gap-1.5">
            <UserRound size={13} aria-hidden="true" /> {t("persona.overview.owner")}: {owner}
          </span>
        )}
        {isPrimary && (
          <span className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px]">
            <Star size={11} aria-hidden="true" className="text-accent" /> {t("primaryBot.badge")}
          </span>
        )}
      </div>
      {/* No description line here (owner, 2026-11-17): the bot keeps its own description, changed by asking it. */}
    </header>
  );
}
