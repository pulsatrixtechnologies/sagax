// The bot page's hero mascot (#2313): the bot's own look, large over the
// page's banner, with the bot's name and label under it (the page's slot,
// mascot-hero-slot.ts). Hover plays the character's first move; a click
// opens the mascot picker under it (MascotPickerPopover, #5369), where the
// look is chosen: this file was the Appearance window's editor (a preview
// band over seven tabs) until the picker replaced it. Loaded lazily with the
// page's header, with the character registry.
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { MausColor, MausMotion } from "@/lib/mascot";
import { botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import { completeMascotLook, type MascotLook } from "../../../shared/mascot-look";
import type { FxMoveRequest } from "@/components/skin-fx/skin-fx";
import "@/components/skin-fx/skin-fx.css";
import { CHARACTER_LABEL } from "./mascot-look-labels";
import { characterMoves, type OwlMove } from "./moves";
import { MascotLookPreview } from "./MascotLookPreview";
import { useMascotHeroSlot } from "./mascot-hero-slot";


export interface MascotHeroProps {
  bot: { id?: string; name?: string; color: MausColor; mascotSkin?: MascotSkinId | null; mascotLook?: MascotLook | null };
  /** The owl's wing moves also play on the bot's avatars across the app. */
  onOwlMove?: (move: Exclude<MausMotion, "none">) => void;
}

export default function MascotHero({ bot, onOwlMove }: MascotHeroProps) {
  const slot = useMascotHeroSlot();
  const look = completeMascotLook(bot.mascotLook);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  const shown = look.character;
  const shownName = t(CHARACTER_LABEL[shown]);

  // the stage plays a move: the owl's wing motion, and every character's clip with its skin's effect
  const [owlMotion, setOwlMotion] = useState<{ kind: Exclude<MausMotion, "none">; nonce: number } | null>(null);
  const [fxMove, setFxMove] = useState<FxMoveRequest | null>(null);
  const moves: { clip: string; owl?: OwlMove }[] = characterMoves(look);
  const [next, setNext] = useState(0);
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
    play(moves[next % moves.length]!);
    setNext((at) => at + 1);
  };

  return (
    <MascotLookPreview
      bot={bot}
      shown={shown}
      shownName={shownName}
      shownLook={look}
      owlSkin={owlSkin}
      moves={moves}
      owlMotion={owlMotion}
      fxMove={fxMove}
      onPlay={play}
      onPlayNext={playNext}
      heading={slot?.heading}
      subheading={slot?.subheading}
      profile={slot?.profile}
      onActivate={slot?.onOpen}
      activateLabel={slot?.openLabel}
      liveState={slot?.state}
      liveMotion={slot?.motion}
    />
  );
}
