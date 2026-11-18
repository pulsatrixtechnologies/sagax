/** Isolated gallery for headless captures of the workspace switcher menu
 * rows (check at the right edge, edit only on hover or focus). Not shipped.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Building2, Laptop } from "lucide-react";
import { SubmenuEntryRow } from "../components/SidebarPopoverMenu";
import { MENU_FIT_ROW, MENU_SURFACE } from "../components/menu-look";
import { cn } from "../lib/cn";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const noop = () => {};
const entries = [
  { key: "personal", label: "Personal", icon: <Laptop size={16} />, checked: false, onSelect: noop },
  { key: "org", label: "Acme MSP", icon: <Building2 size={16} />, checked: true, subtitle: "sagax.acme.example", rename: { label: t("sidebar.account.rename"), onRename: noop } },
  { key: "org2", label: "Globex", icon: <Building2 size={16} />, checked: false, subtitle: "sagax.globex.example", rename: { label: t("sidebar.account.rename"), onRename: noop }, onSelect: noop },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex min-h-dvh bg-app p-6 text-ink">
      <div role="menu" className={cn(MENU_SURFACE, MENU_FIT_ROW, "h-fit")}>
        <div className="flex flex-col gap-0.5">
          {entries.map((entry) => <SubmenuEntryRow key={entry.key} entry={entry} starSlot={false} onClose={noop} />)}
        </div>
      </div>
    </div>
  </StrictMode>,
);
