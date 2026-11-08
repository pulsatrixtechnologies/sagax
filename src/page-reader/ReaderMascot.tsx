// The publishing bot's mascot in the reader's bar (2026-10-29): the same
// characters the app draws (Avatar.tsx CharacterAvatar), at rest, small,
// without the app's Avatar module (it carries the app's whole i18n). Loaded
// after the bar is drawn; until then the bar shows a dot in the bot's color.
import { completeMascotLook } from "../../shared/mascot-look";
import type { MausColor } from "@/lib/mascot";
import { BunbuMascot } from "@/components/BunbuMascot";
import { CrabMascot } from "@/components/CrabMascot";
import { FrogMascot } from "@/components/FrogMascot";
import { GrumpMascot } from "@/components/GrumpMascot";
import { OgreMascot } from "@/components/OgreMascot";
import { OwlAvatar } from "@/components/OwlAvatar";
import { ShapeMascot } from "@/components/ShapeMascot";
import { ShibaMascot } from "@/components/ShibaMascot";
import { SkinnedTrombi } from "@/components/skin-fx/SkinnedTrombi";

export function ReaderMascot({ color, look, size }: { color: string; look?: unknown; size: number }) {
  const full = completeMascotLook(look);
  const tint = color as MausColor;
  switch (full.character) {
    case "shape":
      return <ShapeMascot shape={full.shape} skin={full.skins.shape} color={tint} size={size} animated={false} avatarDef={full.avatarDef} label={null} />;
    case "shiba":
      return <ShibaMascot skin={full.skins.shiba} color={tint} size={size} animated={false} label={null} />;
    case "grump":
      return <GrumpMascot skin={full.skins.grump} color={tint} size={size} animated={false} label={null} />;
    case "ogre":
      return <OgreMascot skin={full.skins.ogre} color={tint} size={size} animated={false} label={null} />;
    case "frog":
      return <FrogMascot skin={full.skins.frog} color={tint} size={size} animated={false} label={null} />;
    case "crab":
      return <CrabMascot skin={full.skins.crab} color={tint} size={size} animated={false} label={null} />;
    case "bunbu":
      return <BunbuMascot skin={full.skins.bunbu} color={tint} size={size} animated={false} label={null} />;
    case "trombi":
      return <SkinnedTrombi skin={full.skins.trombi} pose="idle" size={size} width={Math.round(size * 0.78)} animated={false} label={null} />;
    default:
      return <OwlAvatar color={color} size={size} animated={false} trackPointer={false} label={null} />;
  }
}
