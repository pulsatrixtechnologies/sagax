// Settings > Appearance > Sidebar: "Show the account menu above my name"
// (`sagax.accountMenuAbove.v1`, "on" | "off", off by default: the reference
// look, where the menu stays behind the name). On, the wide foot keeps the
// account menu open above the name, the same rows and second levels
// (SidebarPopoverMenu `docked`). The choice follows the person to every
// device through the synced preferences (shared/user-preferences.ts).
import { localChoice } from "./local-choice";

export const accountMenuAbove = localChoice("sagax.accountMenuAbove.v1", ["on", "off"] as const, "off");

export function useAccountMenuAbove(): boolean {
  return accountMenuAbove.use() === "on";
}
