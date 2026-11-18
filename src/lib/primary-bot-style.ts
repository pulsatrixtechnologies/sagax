// Settings > Appearance > Sidebar: "Primary Bot" (`sagax.primaryBotStyle.v1`,
// "tile" | "row", tile by default: the reference look, a large tile at the
// head of the sidebar). "row" draws it like any other bot row (same avatar
// size, name and status line), pinned first, its star kept on the avatar
// (#4588). It follows the person to every device through the synced
// preferences (shared/user-preferences.ts). The avatars-only rail keeps
// its avatar, which is already the size of every other row there.
import { localChoice } from "./local-choice";

export const primaryBotStyle = localChoice("sagax.primaryBotStyle.v1", ["tile", "row"] as const, "tile");

export function usePrimaryBotAsRow(): boolean {
  return primaryBotStyle.use() === "row";
}
