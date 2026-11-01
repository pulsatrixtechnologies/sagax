// The Mascot view of the persona editor's Appearance category
// (appearance/AppearancePane.tsx): the bot's character and its look, stored
// with the bot (bot.mascotLook, bot.color, bot.mascotSkin), so the change
// shows everywhere the bot appears and on its desktop mascot.
//
// Laid out as one preview and one grid at a time (track A, 2026-10-28):
//
//   The preview band, full width: the character shown (the real avatar,
//   which plays the moves and the equip animation) large on a ground tinted
//   with the bot's color, its name, the line "family · shape · color · skin",
//   the action (In use, Use <name>, or the unlock hint), its move count
//   (opening every move as a chip that plays on the stage), Play a move
//   (the next move) and Randomize (an owned character, shape, color and
//   skin, saved at once).
//   Then four tabs, each with its current value under its label, the open
//   one underlined in the bot's color:
//     Mascot: a search, the filter chips (All, Owned, Premium while one is
//       sold, then one per family) and the shelves (Yours with its "n of m",
//       To unlock, Premium; wardrobe.ts), one tile per character of the
//       registry (mascots.tsx) in the bot's color. A locked character sits
//       greyed with its padlock and achievement (Trombi excepted: an easter
//       egg, out until found). The arrow keys move across the tiles.
//     Shape: the catalog shapes plus object silhouettes (Shapes only), with
//       import / export / generate for portable definitions.
//     Color: the palettes as chips (Vivid, Pastel, Deep, Neon, Neutral, Clay
//       for the characters that take it), then that palette's colors (not
//       for Trombi, who has none).
//     Skin: the rarities as chips with their counts (Common, Rare, Epic,
//       Legendary), then that rarity's skin cards.
//   Each chip row opens on the current choice (editor-tabs.ts).
//
// An unlocked character saves at once when picked (as the avatar popover
// did). A locked character previews only. Every skin of a character shows
// (2026-10-14): a locked one greyed with its padlock, not selectable,
// its tooltip naming the achievement that unlocks it. Each character keeps
// its own skin, so switching and back finds it again. Loaded lazily with
// the pane.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Lock, Play, Search, Shuffle } from "lucide-react";
import { characterLock, lockHint, reportAchievement, skinLock, useUnlocks, type LockInfo } from "@/lib/achievements";
import "@/components/achievements/achievements.css";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLORS, mausInk, swatchStyle, type MausColor, type MausMotion } from "@/lib/mascot";
import { BotAvatar, MausAvatar } from "@/components/Avatar";
import { MASCOT_SKIN_IDS, OWL_SKIN_TIER, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import type { MascotColorGroup } from "../../../shared/mascot-colors";
import { BUNBU_SKIN_TIER, BUNBU_SKINS, completeMascotLook, CRAB_SKIN_TIER, CRAB_SKINS, FROG_SKIN_TIER, FROG_SKINS, GRUMP_SKIN_TIER, GRUMP_SKINS, OGRE_SKIN_TIER, OGRE_SKINS, SHIBA_SKIN_TIER, SHIBA_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS, PUMPKIN_COLOR, SHAPE_SKINS_IN_BOT_COLOR, type MascotCharacter, type MascotLook, type MascotShape, type ShapeSkin, type SkinTier } from "../../../shared/mascot-look";
import { ShapeMascot } from "@/components/ShapeMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";
import { BunbuMascot } from "@/components/BunbuMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { GrumpMascot } from "@/components/GrumpMascot";
import { OgreMascot } from "@/components/OgreMascot";
import { FrogMascot } from "@/components/FrogMascot";
import { CrabMascot } from "@/components/CrabMascot";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import "@/components/skin-fx/skin-fx.css";
import { colorGroupsFor, colorTabFor, colorTabs, nextTab, skinTabFor, skinTierTabs } from "./editor-tabs";
import { MASCOTS, SHAPE_CHOICES, type CompleteLook, type MascotDefinition } from "./mascots";
import { characterMoves, type OwlMove } from "./moves";
import { filterWardrobe, MASCOT_FAMILY_LABEL, wardrobeFilters, wardrobeShelves, wardrobeStep, type WardrobeFilter, type WardrobeShelf } from "./wardrobe";
import { ShapeAvatarPanel } from "./ShapeAvatarPanel";

export interface MascotLookPatch {
  color?: MausColor;
  mascotSkin?: MascotSkinId;
  mascotLook?: MascotLook;
}

export interface MascotLookEditorProps {
  bot: { id?: string; name?: string; color: MausColor; mascotSkin?: MascotSkinId | null; mascotLook?: MascotLook | null };
  disabled?: boolean;
  onPatch: (patch: MascotLookPatch) => void;
  /** The owl's wing moves also play on the bot's avatars across the app. */
  onOwlMove?: (move: Exclude<MausMotion, "none">) => void;
  /** The tab it opens on (Mascot unless told; a gallery or a test opens another). */
  initialTab?: EditorTab;
}

export const CHARACTER_LABEL = {
  owl: "floatingBots.mascot.owl",
  shape: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
  bunbu: "floatingBots.mascot.bunbu",
  shiba: "floatingBots.mascot.shiba",
  grump: "floatingBots.mascot.grump",
  ogre: "floatingBots.mascot.ogre",
  frog: "floatingBots.mascot.frog",
  crab: "floatingBots.mascot.crab",
} satisfies Record<MascotCharacter, LocaleKey>;

export const SHAPE_LABEL = {
  circle: "mascot.shape.circle",
  bean: "mascot.shape.pebble",
  squircle: "mascot.shape.squircle",
  pill: "mascot.shape.capsule",
  pick: "mascot.shape.triangle",
  hexagon: "mascot.shape.hexagon",
  cloud: "mascot.shape.cloud",
  drop: "mascot.shape.droplet",
  pumpkin: "mascot.shape.pumpkin",
  egg: "mascot.shape.egg",
  gem: "mascot.shape.gem",
  wedge: "mascot.shape.wedge",
  diamond: "mascot.shape.diamond",
  star: "mascot.shape.star",
  clover: "mascot.shape.clover",
  flower: "mascot.shape.flower",
  blossom: "mascot.shape.blossom",
  cat: "mascot.shape.cat",
  ghost: "mascot.shape.ghost",
  jellyfish: "mascot.shape.jellyfish",
  axolotl: "mascot.shape.axolotl",
  puff: "mascot.shape.puff",
  pin: "mascot.shape.pin",
  marker: "mascot.shape.marker",
  sprite: "mascot.shape.sprite",
  flask: "mascot.shape.flask",
  tube: "mascot.shape.tube",
  potion: "mascot.shape.potion",
  chomp: "mascot.shape.chomp",
  nibble: "mascot.shape.nibble",
  shield: "mascot.shape.shield",
  bubble: "mascot.shape.bubble",
  pad: "mascot.shape.pad",
  cup: "mascot.shape.cup",
  bulb: "mascot.shape.bulb",
  say: "mascot.shape.say",
  sprout: "mascot.shape.sprout",
  tin: "mascot.shape.tin",
  tome: "mascot.shape.tome",
  ship: "mascot.shape.ship",
} satisfies Record<MascotShape, LocaleKey>;

export { SHAPE_MOVE_LABEL } from "./moves";

export const SHAPE_SKIN_LABEL = {
  plain: "mascot.shapeSkin.clay",
  pastel: "mascot.shapeSkin.pastel",
  glossy: "mascot.shapeSkin.glossy",
  night: "mascot.shapeSkin.night",
  outline: "mascot.shapeSkin.outline",
  gold: "mascot.shapeSkin.gold",
  neon: "mascot.shapeSkin.neon",
  chrome: "mascot.shapeSkin.chrome",
  crystal: "mascot.shapeSkin.crystal",
  circuit: "mascot.shapeSkin.circuit",
  holo: "mascot.shapeSkin.holo",
  molten: "mascot.shapeSkin.molten",
  galaxy: "mascot.shapeSkin.galaxy",
} satisfies Record<(typeof SHAPE_SKINS)[number], LocaleKey>;

export const TROMBI_SKIN_LABEL = {
  classic: "mascot.trombiSkin.classic",
  retro98: "mascot.trombiSkin.retro98",
  gold: "mascot.trombiSkin.gold",
  neon: "mascot.trombiSkin.neon",
  chrome: "mascot.trombiSkin.chrome",
  glitch: "mascot.trombiSkin.glitch",
  holo: "mascot.trombiSkin.holo",
  molten: "mascot.trombiSkin.molten",
} satisfies Record<(typeof TROMBI_SKINS)[number], LocaleKey>;

export const BUNBU_SKIN_LABEL = {
  plain: "mascot.bunbuSkin.plain",
  pastel: "mascot.bunbuSkin.pastel",
  night: "mascot.bunbuSkin.night",
  plush: "mascot.bunbuSkin.plush",
  velvet: "mascot.bunbuSkin.velvet",
  gold: "mascot.bunbuSkin.gold",
  neon: "mascot.bunbuSkin.neon",
  chrome: "mascot.bunbuSkin.chrome",
  crystal: "mascot.bunbuSkin.crystal",
  holo: "mascot.bunbuSkin.holo",
  galaxy: "mascot.bunbuSkin.galaxy",
  molten: "mascot.bunbuSkin.molten",
} satisfies Record<(typeof BUNBU_SKINS)[number], LocaleKey>;

export const SHIBA_SKIN_LABEL = {
  plain: "mascot.shibaSkin.plain",
  cream: "mascot.shibaSkin.cream",
  blacktan: "mascot.shibaSkin.blacktan",
  red: "mascot.shibaSkin.red",
  sesame: "mascot.shibaSkin.sesame",
  white: "mascot.shibaSkin.white",
  retro98: "mascot.shibaSkin.retro98",
  gold: "mascot.shibaSkin.gold",
  neon: "mascot.shibaSkin.neon",
  chrome: "mascot.shibaSkin.chrome",
  glitch: "mascot.shibaSkin.glitch",
  holo: "mascot.shibaSkin.holo",
  molten: "mascot.shibaSkin.molten",
} satisfies Record<(typeof SHIBA_SKINS)[number], LocaleKey>;

export const GRUMP_SKIN_LABEL = {
  plain: "mascot.grumpSkin.plain",
  tuxedo: "mascot.grumpSkin.tuxedo",
  calico: "mascot.grumpSkin.calico",
  tabby: "mascot.grumpSkin.tabby",
  siamese: "mascot.grumpSkin.siamese",
  retro98: "mascot.grumpSkin.retro98",
  gold: "mascot.grumpSkin.gold",
  void: "mascot.grumpSkin.void",
  neon: "mascot.grumpSkin.neon",
  chrome: "mascot.grumpSkin.chrome",
  glitch: "mascot.grumpSkin.glitch",
  holo: "mascot.grumpSkin.holo",
  molten: "mascot.grumpSkin.molten",
} satisfies Record<(typeof GRUMP_SKINS)[number], LocaleKey>;

export const OGRE_SKIN_LABEL = {
  plain: "mascot.ogreSkin.plain",
  swamp: "mascot.ogreSkin.swamp",
  moss: "mascot.ogreSkin.moss",
  stone: "mascot.ogreSkin.stone",
  lava: "mascot.ogreSkin.lava",
  armor: "mascot.ogreSkin.armor",
  retro98: "mascot.ogreSkin.retro98",
  gold: "mascot.ogreSkin.gold",
  neon: "mascot.ogreSkin.neon",
  chrome: "mascot.ogreSkin.chrome",
  glitch: "mascot.ogreSkin.glitch",
  holo: "mascot.ogreSkin.holo",
  molten: "mascot.ogreSkin.molten",
} satisfies Record<(typeof OGRE_SKINS)[number], LocaleKey>;

export const FROG_SKIN_LABEL = {
  plain: "mascot.frogSkin.plain",
  leaf: "mascot.frogSkin.leaf",
  tree: "mascot.frogSkin.tree",
  poison: "mascot.frogSkin.poison",
  bullfrog: "mascot.frogSkin.bullfrog",
  ghost: "mascot.frogSkin.ghost",
  retro98: "mascot.frogSkin.retro98",
  gold: "mascot.frogSkin.gold",
  neon: "mascot.frogSkin.neon",
  chrome: "mascot.frogSkin.chrome",
  glitch: "mascot.frogSkin.glitch",
  holo: "mascot.frogSkin.holo",
  molten: "mascot.frogSkin.molten",
} satisfies Record<(typeof FROG_SKINS)[number], LocaleKey>;

export const CRAB_SKIN_LABEL = {
  plain: "mascot.crabSkin.plain",
  coral: "mascot.crabSkin.coral",
  sand: "mascot.crabSkin.sand",
  ink: "mascot.crabSkin.ink",
  mint: "mascot.crabSkin.mint",
  gold: "mascot.crabSkin.gold",
  pearl: "mascot.crabSkin.pearl",
  neon: "mascot.crabSkin.neon",
  chrome: "mascot.crabSkin.chrome",
  crystal: "mascot.crabSkin.crystal",
  circuit: "mascot.crabSkin.circuit",
  holo: "mascot.crabSkin.holo",
  molten: "mascot.crabSkin.molten",
  galaxy: "mascot.crabSkin.galaxy",
} satisfies Record<(typeof CRAB_SKINS)[number], LocaleKey>;

export const SKIN_TIER_LABEL = {
  common: "mascot.tier.common",
  rare: "mascot.tier.rare",
  epic: "mascot.tier.epic",
  legendary: "mascot.tier.legendary",
} satisfies Record<SkinTier, LocaleKey>;

export const OWL_SKIN_LABEL = {
  none: "mascot.skin.classic",
  snowy: "mascot.skin.snowy",
  barn: "mascot.skin.barn",
  carbon: "mascot.skin.carbon",
  gold: "mascot.skin.gold",
  frost: "mascot.skin.frost",
  neon: "mascot.skin.neon",
  lightning: "mascot.skin.lightning",
  chrome: "mascot.skin.chrome",
  inferno: "mascot.skin.inferno",
  holo: "mascot.skin.holo",
  galaxy: "mascot.skin.galaxy",
  spirit: "mascot.skin.spirit",
} satisfies Record<MascotSkinId, LocaleKey>;

export const COLOR_GROUP_LABEL = {
  vivid: "mascot.color.group.vivid",
  pastel: "mascot.color.group.pastel",
  deep: "mascot.color.group.deep",
  neon: "mascot.color.group.neon",
  neutral: "mascot.color.group.neutral",
  clay: "mascot.color.group.clay",
} satisfies Record<MascotColorGroup, LocaleKey>;



const heading = "text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
const card = "flex flex-col items-center justify-center gap-0.5 rounded-lg bg-inset p-1 transition-colors hover:bg-control disabled:opacity-50";
const on = "ring-2 ring-accent-border";
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-accent";
const chip = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] leading-4 transition-colors";
const chipOn = "border-accent-border bg-selected text-ink";
const chipOff = "border-hairline-weak text-ink-secondary hover:text-ink";

type SkinnedCharacter = Exclude<MascotCharacter, "owl">;

/** Each character's skins (but the owl's, which live on bot.mascotSkin): the list, the rarities and the names. */
const CHARACTER_SKINS: Record<SkinnedCharacter, { skins: readonly string[]; tierOf: Readonly<Record<string, SkinTier>>; label: Readonly<Record<string, LocaleKey>> }> = {
  shape: { skins: SHAPE_SKINS, tierOf: SHAPE_SKIN_TIER, label: SHAPE_SKIN_LABEL },
  trombi: { skins: TROMBI_SKINS, tierOf: TROMBI_SKIN_TIER, label: TROMBI_SKIN_LABEL },
  bunbu: { skins: BUNBU_SKINS, tierOf: BUNBU_SKIN_TIER, label: BUNBU_SKIN_LABEL },
  shiba: { skins: SHIBA_SKINS, tierOf: SHIBA_SKIN_TIER, label: SHIBA_SKIN_LABEL },
  grump: { skins: GRUMP_SKINS, tierOf: GRUMP_SKIN_TIER, label: GRUMP_SKIN_LABEL },
  ogre: { skins: OGRE_SKINS, tierOf: OGRE_SKIN_TIER, label: OGRE_SKIN_LABEL },
  frog: { skins: FROG_SKINS, tierOf: FROG_SKIN_TIER, label: FROG_SKIN_LABEL },
  crab: { skins: CRAB_SKINS, tierOf: CRAB_SKIN_TIER, label: CRAB_SKIN_LABEL },
};

/** A skin card's live preview: the real character in that skin. */
function skinPreview(character: MascotCharacter, skin: string, look: CompleteLook, color: MausColor, size: number): ReactNode {
  switch (character) {
    case "owl": return <MausAvatar color={color} skin={skin as MascotSkinId} state="idle" size={size} animated={false} skinAnimated trackPointer={false} />;
    case "shape": return <ShapeMascot shape={look.shape} skin={skin as ShapeSkin} color={color} size={size} detail="full" label={null} />;
    case "trombi": return <SkinnedTrombi skin={skin} pose="idle" size={size + 2} width={Math.round(size * 0.8)} detail="full" label={null} />;
    case "bunbu": return <BunbuMascot skin={skin as (typeof BUNBU_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "shiba": return <ShibaMascot skin={skin as (typeof SHIBA_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "grump": return <GrumpMascot skin={skin as (typeof GRUMP_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "ogre": return <OgreMascot skin={skin as (typeof OGRE_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "frog": return <FrogMascot skin={skin as (typeof FROG_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
    case "crab": return <CrabMascot skin={skin as (typeof CRAB_SKINS)[number]} color={color} size={size} detail="full" label={null} />;
  }
}

interface SegmentItem<T extends string> {
  id: T;
  label: string;
  /** A count badge (skins in a rarity). */
  count?: number;
  /** A small dot in a color (the palette holding the current color). */
  dot?: string;
  tier?: SkinTier;
}

/**
 * A row of chips, one per group (palettes, rarities); the arrow keys move
 * between them. The panel it controls follows it (role tabpanel, aria-labelledby).
 */
function SegmentedTabs<T extends string>({ label, items, value, onChange, idPrefix, data }: { label: string; items: SegmentItem<T>[]; value: T; onChange: (id: T) => void; idPrefix: string; data: string }) {
  const ids = items.map((item) => item.id);
  return (
    <div role="tablist" aria-label={label} className="mb-3 flex flex-wrap gap-1.5" {...{ [data]: "" }}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            aria-label={item.count != null ? t("mascot.tier.tab", { tier: item.label, count: item.count }) : undefined}
            tabIndex={selected ? 0 : -1}
            data-tab={item.id}
            data-tier={item.tier}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const next = nextTab(ids, value, event.key);
              if (next == null) return;
              event.preventDefault();
              onChange(next);
              const sibling = event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-tab="${next}"]`);
              sibling?.focus();
            }}
            className={cn("segment-tab", chip, focusRing, selected ? chipOn : chipOff)}
          >
            {item.dot && <span className="size-2 rounded-full ring-1 ring-white/40" style={{ backgroundColor: item.dot }} aria-hidden="true" />}
            <span>{item.label}</span>
            {item.count != null && (
              <span className="segment-count tabular-nums text-ink-tertiary" aria-hidden="true">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A locked look's lock on its card or tile: the padlock, and how far its achievement went. */
function LockBadge({ lock }: { lock: LockInfo }) {
  const item = lock.item;
  return (
    <>
      <span className="unlock-lock" aria-hidden="true"><Lock size={10} strokeWidth={2.6} /></span>
      {item && item.target > 0 && (
        <span className="unlock-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((item.current / item.target) * 100)}%` }} />
        </span>
      )}
    </>
  );
}

/**
 * A skin's card: its animated preview and its name, on its rarity's ground,
 * shimmering above Common. A locked skin shows greyed with its padlock and
 * the achievement that unlocks it (tooltip and label); it stays focusable so
 * the tooltip reads, but a click does nothing.
 */
function SkinCard({ tier, label, checked, disabled, onSelect, onPreview, previewOnly, data, lock, children }: { tier: SkinTier; label: string; checked: boolean; disabled?: boolean; onSelect: () => void; onPreview?: () => void; previewOnly?: boolean; data: Record<string, string>; lock?: LockInfo; children: ReactNode }) {
  const tierLabel = t(SKIN_TIER_LABEL[tier]);
  const locked = Boolean(lock?.locked);
  const hint = locked && lock ? lockHint(lock) : "";
  return (
    <button
      type="button"
      role="radio"
      disabled={disabled}
      aria-disabled={locked || undefined}
      aria-checked={checked}
      aria-label={locked ? t("mascot.skinCard.locked", { name: label, tier: tierLabel, hint }) : `${label}, ${tierLabel}`}
      title={locked ? `${label} (${tierLabel}). ${hint}` : `${label} (${tierLabel})`}
      data-tier={tier}
      data-locked={locked ? "" : undefined}
      data-unlock-achievement={locked ? lock?.achievement?.id : undefined}
      {...data}
      onClick={() => {
        // a locked skin (or any skin of a locked character) previews on the stage, never saves
        if (locked || previewOnly) { onPreview?.(); return; }
        onSelect();
      }}
      className={cn(card, "skin-card relative h-[96px] gap-1.5 rounded-xl pt-1.5", focusRing, checked && on, locked && "hover:bg-control")}
    >
      <span className="grid size-[56px] place-items-center" aria-hidden="true">
        {children}
      </span>
      <span className="w-full truncate text-center text-[12px] leading-4 text-ink">{label}</span>
      {locked && lock && <LockBadge lock={lock} />}
    </button>
  );
}

/**
 * The skins of one character, one rarity at a time. Opens on the current
 * skin's rarity and follows it when it changes elsewhere (Reset); only the
 * open rarity's cards are drawn, so the pane animates a handful at most.
 */
function SkinPicker<S extends string>({ skins, tierOf, selected, labelOf, idPrefix, dataKey, disabled, onSelect, preview, lockOf, previewOnly, onPreview }: { skins: readonly S[]; tierOf: Readonly<Record<S, SkinTier>>; selected: S; labelOf: (skin: S) => string; idPrefix: string; dataKey: string; disabled?: boolean; onSelect: (skin: S) => void; preview: (skin: S) => ReactNode; lockOf?: (skin: S) => LockInfo; previewOnly?: boolean; onPreview?: (skin: S) => void }) {
  // Every skin shows, a locked one greyed with its padlock (the goal is to want it).
  const tabs = skinTierTabs(skins, tierOf);
  const [tab, setTab] = useState<SkinTier>(() => skinTabFor(selected, skins, tierOf));
  const followed = useRef(selected);
  useEffect(() => {
    if (followed.current === selected) return;
    followed.current = selected;
    setTab(skinTabFor(selected, skins, tierOf));
  }, [selected, skins, tierOf]);
  const open = tabs.find((item) => item.tier === tab) ?? tabs[0];
  return (
    <div>
      <SegmentedTabs
        label={t("mascot.tier.tabs")}
        idPrefix={idPrefix}
        data="data-skin-tabs"
        value={open.tier}
        onChange={setTab}
        items={tabs.map((item) => ({ id: item.tier, label: t(SKIN_TIER_LABEL[item.tier]), count: item.count, tier: item.tier }))}
      />
      <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${open.tier}`} data-skin-panel={open.tier}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2" role="radiogroup" aria-label={t("mascot.skin.title")}>
          {open.skins.map((skin) => (
            <SkinCard key={skin} tier={tierOf[skin]} label={labelOf(skin)} checked={selected === skin} disabled={disabled} data={{ [dataKey]: skin }} lock={skin === selected ? undefined : lockOf?.(skin)} onSelect={() => onSelect(skin)} previewOnly={previewOnly} onPreview={() => onPreview?.(skin)}>
              {preview(skin)}
            </SkinCard>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The bot colors, one palette at a time; opens on the current color's palette. */
function ColorPicker({ color, groups, disabled, onSelect }: { color: MausColor; groups: readonly MascotColorGroup[]; disabled?: boolean; onSelect: (color: MausColor) => void }) {
  const tabs = colorTabs(groups);
  const [tab, setTab] = useState<MascotColorGroup>(() => colorTabFor(color));
  const followed = useRef(color);
  useEffect(() => {
    if (followed.current === color) return;
    followed.current = color;
    setTab(colorTabFor(color));
  }, [color]);
  const current = colorTabFor(color);
  const open = tabs.find((item) => item.group === tab) ?? tabs[0];
  return (
    <div>
      <SegmentedTabs
        label={t("mascot.color.groups")}
        idPrefix="mascot-color"
        data="data-color-tabs"
        value={open.group}
        onChange={setTab}
        items={tabs.map((item) => ({ id: item.group, label: t(COLOR_GROUP_LABEL[item.group]), dot: item.group === current ? MAUS_COLORS[color] : undefined }))}
      />
      <div id="mascot-color-panel" role="tabpanel" aria-labelledby={`mascot-color-tab-${open.group}`} data-color-panel={open.group}>
        <div className="flex flex-wrap gap-3 px-1 py-1" role="radiogroup" aria-label={t("mascot.color.title")}>
          {open.colors.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={color === name}
              data-mascot-color={name}
              onClick={() => onSelect(name)}
              className={cn("size-9 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50", color === name && "ring-2 ring-ink/80 ring-offset-[3px] ring-offset-panel")}
              style={swatchStyle(name)}
              title={name}
              aria-label={t("mascot.color.use", { color: name })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SHELF_LABEL = {
  yours: "appearance.shelf.yours",
  locked: "appearance.filter.locked",
  premium: "appearance.filter.premium",
} satisfies Record<WardrobeShelf, LocaleKey>;

function filterLabel(filter: WardrobeFilter): string {
  if (filter === "all") return t("appearance.filter.all");
  if (filter === "owned") return t("appearance.filter.owned");
  if (filter === "locked") return t("appearance.filter.locked");
  if (filter === "premium") return t("appearance.filter.premium");
  return t(MASCOT_FAMILY_LABEL[filter.slice("family:".length) as keyof typeof MASCOT_FAMILY_LABEL]);
}

/**
 * A character's tile in the gallery: a still preview in the bot's color and
 * the character's own skin, its name and family. The tile shown in the
 * preview is outlined with the accent; the one the bot wears carries a
 * check. A locked tile is greyed with its padlock and achievement progress;
 * a paid edition shows its price, a new one a NEW badge.
 */
function MascotTile({ option, look, color, owlSkin, selected, inUse, lock, disabled, onSelect, onKeyDown }: {
  option: MascotDefinition;
  look: CompleteLook;
  color: MausColor;
  owlSkin: MascotSkinId;
  selected: boolean;
  inUse: boolean;
  lock: LockInfo;
  disabled?: boolean;
  onSelect: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const name = t(CHARACTER_LABEL[option.id]);
  const family = t(MASCOT_FAMILY_LABEL[option.family]);
  const locked = lock.locked;
  const hint = locked ? lockHint(lock) : "";
  const label = locked
    ? t("appearance.tile.locked", { name, hint })
    : option.premium ? `${name}, ${option.premium.price}`
      : inUse ? t("appearance.tile.inUse", { name }) : name;
  return (
    <button
      type="button"
      data-character-option={option.id}
      data-locked={locked ? "" : undefined}
      data-unlock-achievement={locked ? lock.achievement?.id : undefined}
      data-in-use={inUse ? "" : undefined}
      aria-pressed={selected}
      aria-label={label}
      title={locked ? hint : undefined}
      disabled={disabled}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex h-[112px] min-w-0 flex-col items-center justify-start gap-1 rounded-xl bg-inset px-1 pb-2 pt-3 transition-colors hover:bg-control disabled:opacity-50",
        focusRing,
        selected && on,
      )}
    >
      <span className={cn("grid size-14 shrink-0 place-items-center overflow-hidden", locked && "opacity-60 grayscale")} aria-hidden="true">
        <option.Thumb color={color} skin={owlSkin} look={{ ...look, character: option.id }} size={52} />
      </span>
      <span className="w-full truncate text-center text-[12.5px] leading-4 text-ink">{name}</span>
      <span className={cn("h-3 w-full truncate text-center text-[10.5px] leading-3 text-ink-tertiary", locked && "invisible")}>{option.premium && option.isNew ? option.premium.price : family}</span>
      {inUse && (
        <span className="absolute left-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-accent text-accent-ink" aria-hidden="true">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {locked ? (
        <LockBadge lock={lock} />
      ) : option.isNew ? (
        <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[9px] font-semibold uppercase leading-[14px] text-accent-ink" aria-hidden="true">{t("appearance.badge.new")}</span>
      ) : option.premium ? (
        <span className="absolute right-1 top-1 rounded-full bg-control px-1.5 text-[9px] font-semibold leading-[14px] text-ink" aria-hidden="true">{option.premium.price}</span>
      ) : null}
    </button>
  );
}

/** The editor's tabs, in order: one grid shows at a time. */
export const EDITOR_TABS = ["mascot", "shape", "color", "skin"] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];

const EDITOR_TAB_LABEL = {
  mascot: "appearance.mode.mascot",
  shape: "floatingBots.mascot.shape",
  color: "mascot.color.title",
  skin: "mascot.skin.title",
} satisfies Record<EditorTab, LocaleKey>;

/** The tabs a character offers: Shape only for Shapes, Color for a character that takes the bot's color. */
export function editorTabsFor(option: Pick<MascotDefinition, "id" | "paint">): EditorTab[] {
  return EDITOR_TABS.filter((tab) => (tab !== "shape" || option.id === "shape") && (tab !== "color" || option.paint.colors));
}

/** One of a list, at random (Randomize). */
function pickAny<T>(items: readonly T[], random: () => number): T | undefined {
  return items.length ? items[Math.floor(random() * items.length) % items.length] : undefined;
}

/**
 * Randomize: an owned character, and for it an owned skin, a color it takes
 * and (for Shapes) a shape, as one patch saved at once. Nothing locked is
 * ever drawn, and the other characters keep their skins.
 */
export function randomLook({ listed, look, color, owlSkin, characterLocked, skinLocked, random = Math.random }: {
  listed: readonly MascotDefinition[];
  look: CompleteLook;
  color: MausColor;
  owlSkin: MascotSkinId;
  characterLocked: (id: MascotCharacter) => boolean;
  skinLocked: (id: MascotCharacter, skin: string) => boolean;
  random?: () => number;
}): MascotLookPatch {
  const option = pickAny(listed.filter((entry) => !characterLocked(entry.id)), random) ?? MASCOTS[0];
  const character = option.id;
  const patch: MascotLookPatch = {};
  if (option.paint.colors) {
    const colors = colorTabs(colorGroupsFor(character, color)).flatMap((tab) => tab.colors);
    patch.color = pickAny(colors, random) ?? color;
  }
  const skins = character === "owl" ? MASCOT_SKIN_IDS : CHARACTER_SKINS[character].skins;
  const skin = pickAny(skins.filter((id) => !skinLocked(character, id)), random);
  if (character === "owl") patch.mascotSkin = (skin as MascotSkinId | undefined) ?? owlSkin;
  patch.mascotLook = {
    ...look,
    character,
    ...(character === "shape" ? { shape: pickAny(SHAPE_CHOICES, random) ?? look.shape } : {}),
    skins: { ...look.skins, ...(character !== "owl" && skin ? { [character]: skin } : {}) },
  } as MascotLook;
  return patch;
}

export default function MascotLookEditor({ bot, disabled, onPatch: savePatch, onOwlMove, initialTab = "mascot" }: MascotLookEditorProps) {
  const look = completeMascotLook(bot.mascotLook);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  // what this person unlocked (src/lib/achievements.ts); what the bot wears now always stays.
  const unlocks = useUnlocks();
  const lockOf = (id: MascotCharacter): LockInfo => (id === look.character ? { locked: false } : characterLock(unlocks, id));
  // Every character shows, a locked one on the To unlock shelf; Trombi only once found (an easter egg).
  const listed = MASCOTS.filter((option) => option.id !== "trombi" || option.id === look.character || !characterLock(unlocks, option.id).locked);
  const onPatch = (patch: MascotLookPatch) => {
    savePatch(patch);
    reportAchievement("bot.customized", { key: patch.mascotLook?.character ?? look.character });
  };
  const setLook = (next: Partial<MascotLook>) => onPatch({ mascotLook: { ...look, ...next, skins: { ...look.skins, ...next.skins } } });
  // a pumpkin is orange by default: picking it takes the orange where the skin paints the bot's color
  const pickShape = (shape: MascotShape) =>
    onPatch({
      // Drop a custom avatarDef when the person picks a catalog body, so the
      // chosen silhouette is what they see (object presets keep their own def).
      mascotLook: { ...look, shape, avatarDef: undefined },
      ...(shape === "pumpkin" && shape !== look.shape && SHAPE_SKINS_IN_BOT_COLOR.has(look.skins.shape) ? { color: PUMPKIN_COLOR } : {}),
    });

  // The character in the preview: the one the bot wears, or one picked to look at. It follows the bot's (Reset, another window).
  const [shown, setShown] = useState<MascotCharacter>(look.character);
  const followed = useRef(look.character);
  useEffect(() => {
    if (followed.current === look.character) return;
    followed.current = look.character;
    setShown(look.character);
  }, [look.character]);
  const shownOption = MASCOTS.find((option) => option.id === shown) ?? MASCOTS[0];
  const shownLock = lockOf(shown);
  // a locked skin, or a skin of a locked character, picked to look at: the stage wears it, nothing saves (2026-10-14)
  const [previewSkin, setPreviewSkin] = useState<string | null>(null);
  useEffect(() => setPreviewSkin(null), [shown]);
  const shownLook: MascotLook = previewSkin && shown !== "owl"
    ? { ...look, character: shown, skins: { ...look.skins, [shown]: previewSkin } as MascotLook["skins"] }
    : { ...look, character: shown };
  const shownName = t(CHARACTER_LABEL[shown]);
  const inUse = shown === look.character;
  // A locked character previews only: its options show, disabled.
  const optionsOff = disabled || shownLock.locked;

  const pick = (id: MascotCharacter) => {
    setShown(id);
    if (disabled || id === look.character || lockOf(id).locked) return;
    setLook({ character: id });
  };

  // the tabs: one grid at a time; a tab the character does not offer falls back to Mascot
  const tabs = editorTabsFor(shownOption);
  const [tabChoice, setTab] = useState<EditorTab>(initialTab);
  const tab: EditorTab = tabs.includes(tabChoice) ? tabChoice : "mascot";
  const tint = MAUS_COLORS[bot.color] ?? MAUS_COLORS.green;
  const ink = mausInk(bot.color) ?? tint;

  // the gallery: a search and a chip narrow it, the shelves split what is left
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WardrobeFilter>("all");
  const filters = wardrobeFilters(listed, (entry) => characterLock(unlocks, entry.id as MascotCharacter).locked && entry.id !== look.character);
  const kept = filterWardrobe(listed, {
    filter,
    query,
    nameOf: (option) => t(CHARACTER_LABEL[option.id]),
    familyNameOf: (family) => t(MASCOT_FAMILY_LABEL[family]),
    lockedOf: (option) => lockOf(option.id).locked,
  });
  const shelves = wardrobeShelves(kept, (option) => lockOf(option.id).locked);
  const owned = listed.filter((option) => !lockOf(option.id).locked).length;
  const browser = useRef<HTMLDivElement>(null);
  const onTileKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const tiles = Array.from(browser.current?.querySelectorAll<HTMLButtonElement>("[data-character-option]") ?? []);
    const index = tiles.indexOf(event.currentTarget);
    const grid = event.currentTarget.parentElement;
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 1;
    const next = wardrobeStep(index, tiles.length, columns, event.key);
    if (next === null || index < 0) return;
    event.preventDefault();
    tiles[next]?.focus();
  };

  // the stage plays a move: the owl's wing motion, and every character's clip with its skin's effect
  const [owlMotion, setOwlMotion] = useState<{ kind: Exclude<MausMotion, "none">; nonce: number } | null>(null);
  const [fxMove, setFxMove] = useState<FxMoveRequest | null>(null);
  const moves: { id: string; label: string; clip: string; owl?: OwlMove }[] = characterMoves(shownLook).map((move) => ({ ...move, label: t(move.label) }));
  const stagePick = useRef(0);
  const play = (move: { clip: string; owl?: OwlMove }) => {
    if (move.owl) {
      const kind = move.owl;
      setOwlMotion((last) => ({ kind, nonce: (last?.nonce ?? 0) + 1 }));
      onOwlMove?.(kind);
    }
    setFxMove((last) => ({ clip: move.clip, key: (last?.key ?? 0) + 1 }));
  };
  const playNext = () => {
    if (!moves.length) return;
    play(moves[(stagePick.current++) % moves.length]);
  };
  // every move as a chip, behind the move count
  const [movesOpen, setMovesOpen] = useState(false);

  const randomize = () => {
    const patch = randomLook({
      listed,
      look,
      color: bot.color,
      owlSkin,
      characterLocked: (id) => lockOf(id).locked,
      skinLocked: (id, skin) => skinLock(unlocks, id, skin).locked,
    });
    const character = patch.mascotLook?.character ?? look.character;
    setShown(character);
    followed.current = character;
    onPatch(patch);
  };

  // what the shown character wears: its skin (or the one previewed), its palette and shape
  const shownSkin = previewSkin ?? (shown === "owl" ? owlSkin : look.skins[shown]);
  const skinName = shown === "owl" ? t(OWL_SKIN_LABEL[shownSkin as MascotSkinId] ?? OWL_SKIN_LABEL.none) : t(CHARACTER_SKINS[shown].label[shownSkin] ?? CHARACTER_SKINS[shown].label[CHARACTER_SKINS[shown].skins[0]]);
  const paletteName = t(COLOR_GROUP_LABEL[colorTabFor(bot.color)]);
  const shapeName = t(SHAPE_LABEL[look.shape]);
  const tabValue: Record<EditorTab, ReactNode> = {
    mascot: shownName,
    shape: shapeName,
    color: (
      <span className="inline-flex items-center gap-1">
        <span className="size-2 rounded-full ring-1 ring-white/40" style={{ backgroundColor: tint }} aria-hidden="true" />
        {paletteName}
      </span>
    ),
    skin: skinName,
  };
  const summary = [
    t(MASCOT_FAMILY_LABEL[shownOption.family]),
    shown === "shape" ? shapeName : null,
    shownOption.paint.colors ? paletteName : null,
    skinName,
  ].filter(Boolean).join(" · ");

  const skinPicker = shown === "owl" ? (
    <SkinPicker
      key="owl"
      skins={MASCOT_SKIN_IDS}
      tierOf={OWL_SKIN_TIER}
      selected={owlSkin}
      labelOf={(skin) => t(OWL_SKIN_LABEL[skin])}
      idPrefix="owl-skin"
      dataKey="data-mascot-skin-option"
      disabled={disabled}
      previewOnly={shownLock.locked}
      onPreview={(skin) => setPreviewSkin(String(skin))}
      onSelect={(skin) => onPatch({ mascotSkin: skin })}
      lockOf={(skin) => (skin === owlSkin ? { locked: false } : skinLock(unlocks, "owl", skin))}
      preview={(skin) => skinPreview("owl", skin, look, bot.color, 52)}
    />
  ) : (
    <SkinPicker
      key={shown}
      skins={CHARACTER_SKINS[shown].skins}
      tierOf={CHARACTER_SKINS[shown].tierOf}
      selected={look.skins[shown]}
      labelOf={(skin) => t(CHARACTER_SKINS[shown].label[skin])}
      idPrefix={`${shown}-skin`}
      dataKey={`data-${shown}-skin-option`}
      disabled={disabled}
      previewOnly={shownLock.locked}
      onPreview={(skin) => setPreviewSkin(String(skin))}
      onSelect={(skin) => setLook({ skins: { ...look.skins, [shown]: skin } })}
      lockOf={(skin) => skinLock(unlocks, shown, skin)}
      preview={(skin) => skinPreview(shown, skin, look, bot.color, 52)}
    />
  );

  return (
    <div data-mascot-look-editor="" className="flex flex-col gap-4">
      {/* the preview band: the character shown, large on a ground tinted with the bot's color, and what it wears */}
      <section
        data-mascot-detail={shown}
        aria-label={t("appearance.preview", { name: shownName })}
        className="relative flex flex-col items-center gap-4 rounded-2xl border border-hairline-weak p-4 @[34rem]:h-[210px] @[34rem]:flex-row @[34rem]:gap-7 @[34rem]:px-7 @[34rem]:py-5"
        style={{ background: `radial-gradient(120% 140% at 20% 50%, color-mix(in srgb, ${tint} 26%, var(--color-panel)) 0%, var(--color-panel) 58%)` }}
      >
        {/* the stage: the real avatar; hovering or clicking it previews a move */}
        <button
          type="button"
          data-mascot-stage=""
          aria-label={t("appearance.preview", { name: shownName })}
          onMouseEnter={() => { if (moves[0]) play(moves[0]); }}
          onClick={playNext}
          className={cn("relative grid size-[170px] shrink-0 place-items-center rounded-2xl", focusRing)}
        >
          <span aria-hidden="true" className={cn("pointer-events-none", shownLock.locked && "opacity-60 grayscale")}>
            <BotAvatar
              bot={{ name: bot.name, color: bot.color, mascotSkin: (previewSkin && shown === "owl" ? previewSkin : owlSkin) as typeof owlSkin, mascotLook: shownLook, avatarCrop: "mascot" }}
              size={150}
              state="idle"
              motion={owlMotion?.kind ?? "none"}
              motionKey={owlMotion?.nonce ?? 0}
              characterMove={fxMove}
              label={t("appearance.preview", { name: shownName })}
            />
          </span>
          {previewSkin && (
            <span data-mascot-skin-preview="" className="absolute inset-x-1 bottom-1 truncate rounded-md bg-control/90 px-2 py-1 text-[11px] leading-4 text-ink-secondary">
              {t("mascot.skinPreview")}
            </span>
          )}
          {shownLock.locked && (
            <span className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-control text-ink-secondary" aria-hidden="true"><Lock size={12} strokeWidth={2.4} /></span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center @[34rem]:items-start @[34rem]:text-left">
          <div className="max-w-full truncate text-[24px] font-semibold leading-8 text-ink" data-mascot-name="">{shownName}</div>
          <div className="max-w-full truncate text-[13.5px] leading-5 text-ink-secondary" data-mascot-summary="">{summary}</div>
          <div className="relative mt-2.5 flex flex-wrap items-center justify-center gap-2 @[34rem]:justify-start">
            {/* the action: what the bot wears, the character to wear, or what unlocks it */}
            <button
              type="button"
              data-mascot-action={shownLock.locked ? "locked" : inUse ? "in-use" : "use"}
              disabled={disabled || inUse || shownLock.locked}
              onClick={() => setLook({ character: shown })}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] leading-4",
                focusRing,
                !inUse && !shownLock.locked ? "bg-accent font-medium text-accent-ink hover:brightness-110" : inUse ? "bg-success/15 text-success" : "bg-control text-ink-secondary",
              )}
            >
              {shownLock.locked ? <Lock size={12} className="shrink-0" aria-hidden="true" /> : inUse ? <Check size={13} strokeWidth={3} className="shrink-0" aria-hidden="true" /> : null}
              <span>{shownLock.locked ? lockHint(shownLock) : inUse ? t("appearance.inUse") : t("appearance.use", { name: shownName })}</span>
            </button>
            {/* the move count opens every move, each a chip that plays on the stage */}
            <button
              type="button"
              data-mascot-moves=""
              aria-expanded={movesOpen}
              aria-controls="mascot-moves"
              onClick={() => setMovesOpen((open) => !open)}
              className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] leading-4 text-ink-tertiary hover:bg-control hover:text-ink", focusRing)}
            >
              {t("appearance.moveCount", { count: moves.length })}
              <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", movesOpen && "rotate-180")} />
            </button>
            {/* drawn closed too (hidden), so every move stays one click away and readable by a screen reader once open */}
            <div
                id="mascot-moves"
                data-mascot-move-list=""
                hidden={!movesOpen}
                className="absolute left-0 top-full z-20 mt-1.5 w-[min(22rem,80vw)] rounded-xl border border-hairline-weak bg-elevated p-2.5 shadow-lg"
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMovesOpen(false); } }}
              >
                <div className={cn(heading, "mb-1.5")}>{t("mascot.moves.title")}</div>
                <div className="flex flex-wrap gap-1">
                  {moves.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-character-move={item.id}
                      aria-label={t("mascot.moves.play", { move: item.label })}
                      onClick={() => play(item)}
                      onMouseEnter={() => play(item)}
                      className={cn("rounded-md bg-control px-2 py-0.5 text-[11.5px] leading-4 text-ink hover:bg-raised-hover", focusRing)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-row gap-2 @[34rem]:flex-col">
          <button
            type="button"
            data-mascot-play=""
            disabled={!moves.length}
            onClick={playNext}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-weak bg-control/70 px-3.5 py-2 text-[13px] leading-4 text-ink hover:bg-raised-hover disabled:opacity-50", focusRing)}
          >
            <Play size={13} aria-hidden="true" />
            {t("appearance.playMove")}
          </button>
          <button
            type="button"
            data-mascot-randomize=""
            disabled={disabled}
            onClick={randomize}
            className={cn("inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline-weak bg-control/70 px-3.5 py-2 text-[13px] leading-4 text-ink hover:bg-raised-hover disabled:opacity-50", focusRing)}
          >
            <Shuffle size={13} aria-hidden="true" />
            {t("appearance.randomize")}
          </button>
        </div>
      </section>

      {/* the tabs: each its current value under its label, the open one underlined in the bot's color */}
      <div role="tablist" aria-label={t("appearance.tabs")} className="flex gap-1 overflow-x-auto border-b border-hairline-weak" data-appearance-tabs="">
        {tabs.map((id) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`appearance-tab-${id}`}
              aria-selected={selected}
              aria-controls="appearance-tab-panel"
              tabIndex={selected ? 0 : -1}
              data-appearance-tab={id}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                const next = nextTab(tabs, tab, event.key);
                if (next == null) return;
                event.preventDefault();
                setTab(next);
                event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-appearance-tab="${next}"]`)?.focus();
              }}
              style={{ borderBottomColor: selected ? ink : "transparent" }}
              className={cn(
                "-mb-px flex min-w-0 shrink-0 flex-col items-start gap-0.5 border-b-2 px-4 pb-2.5 pt-2 text-left transition-colors",
                focusRing,
                selected ? "text-ink" : "text-ink-secondary hover:text-ink",
              )}
            >
              <span className="text-[13.5px] font-medium leading-5">{t(EDITOR_TAB_LABEL[id])}</span>
              <span className="max-w-[10rem] truncate text-[11.5px] leading-4 text-ink-tertiary" data-appearance-tab-value="">{tabValue[id]}</span>
            </button>
          );
        })}
      </div>

      <div id="appearance-tab-panel" role="tabpanel" aria-labelledby={`appearance-tab-${tab}`} data-appearance-tab-panel={tab} data-character-options={shown}>
        {tab === "mascot" && (
          <div ref={browser} data-mascot-browser="" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-1.5 rounded-lg border border-hairline-weak bg-elevated px-2.5 @[34rem]:max-w-[18rem]">
                <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Escape clears a search first; an empty one leaves Escape to the modal
                    if (event.key === "Escape" && query) {
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery("");
                    }
                  }}
                  placeholder={t("appearance.search", { count: listed.length })}
                  aria-label={t("appearance.searchLabel")}
                  data-mascot-search=""
                  className="w-full min-w-0 bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
                />
              </label>
              <div role="group" aria-label={t("appearance.filters")} className="flex flex-wrap gap-1.5" data-mascot-filters="">
                {filters.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    data-mascot-filter={id}
                    onClick={() => setFilter(id)}
                    className={cn(chip, focusRing, filter === id ? chipOn : chipOff)}
                  >
                    {filterLabel(id)}
                  </button>
                ))}
              </div>
            </div>
            {shelves.map(({ shelf, entries }) => (
              <section key={shelf} data-mascot-shelf={shelf} aria-labelledby={`mascot-shelf-${shelf}`}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h3 id={`mascot-shelf-${shelf}`} className={heading}>{t(SHELF_LABEL[shelf])}</h3>
                  <span className="text-[10.5px] tabular-nums text-ink-tertiary">
                    {shelf === "yours" ? t("appearance.shelf.count", { count: owned, total: listed.length }) : entries.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2" data-character-row="">
                  {entries.map((option) => (
                    <MascotTile
                      key={option.id}
                      option={option}
                      look={look}
                      color={bot.color}
                      owlSkin={owlSkin}
                      selected={shown === option.id}
                      inUse={look.character === option.id}
                      lock={lockOf(option.id)}
                      disabled={disabled}
                      onSelect={() => pick(option.id)}
                      onKeyDown={onTileKey}
                    />
                  ))}
                </div>
              </section>
            ))}
            {shelves.length === 0 && (
              <p className="py-4 text-center text-[12px] text-ink-secondary" data-mascot-empty="">
                {query.trim() ? t("appearance.noMatch", { query: query.trim() }) : t("appearance.empty")}
              </p>
            )}
          </div>
        )}
        {tab === "shape" && (
          // every shape, with its name; each previews the current color and skin, still and cheap
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2" role="radiogroup" aria-label={t("floatingBots.mascot.shape")}>
            {SHAPE_CHOICES.map((shape) => (
              <button
                key={shape}
                type="button"
                role="radio"
                disabled={optionsOff}
                aria-checked={look.shape === shape}
                data-character-shape={shape}
                aria-label={t(SHAPE_LABEL[shape])}
                title={t(SHAPE_LABEL[shape])}
                onClick={() => pickShape(shape)}
                className={cn(card, "h-[78px] gap-1 rounded-xl p-1.5", focusRing, look.shape === shape && on)}
              >
                <ShapeThumbnail shape={shape} skin={look.skins.shape} color={bot.color} size={40} />
                <span className="w-full truncate text-center text-[11px] leading-4 text-ink-secondary" aria-hidden="true">{t(SHAPE_LABEL[shape])}</span>
              </button>
            ))}
            <div className="col-span-full">
              <ShapeAvatarPanel
                look={look}
                color={bot.color}
                botId={bot.id}
                disabled={optionsOff}
                onApply={(next) => onPatch({ mascotLook: next })}
                onColor={(next) => onPatch({ color: next })}
              />
            </div>
          </div>
        )}
        {tab === "color" && (
          <ColorPicker color={bot.color} groups={colorGroupsFor(shown, bot.color)} disabled={optionsOff} onSelect={(color) => onPatch({ color })} />
        )}
        {tab === "skin" && skinPicker}
      </div>
    </div>
  );
}

/**
 * A shape's thumbnail in the Shape grid: that shape in the bot's current
 * color and skin, in the skin's still look (no filter, nothing animated), so
 * every thumbnail matches the stage and costs nothing.
 */
function ShapeThumbnail({ shape, skin, color, size }: { shape: MascotShape; skin: ShapeSkin; color: string; size: number }) {
  return <ShapeMascot shape={shape} skin={skin} color={color} size={size} animated={false} detail="static" label={null} />;
}
