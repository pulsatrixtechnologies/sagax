// Settings > Appearance > Sidebar > Hidden from the sidebar, open: the one
// place that lists what this person hid from their sidebar, each entry with
// Show, then whether a new message brings a hidden entry back. The sidebar
// itself draws nothing for a hidden entry (#3576, 2026-11-10: hidden means
// gone from it completely); search still finds and opens one.
// 0.5.6: compact rows, as the reference design's pages.
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useOrgPeople } from "@/lib/perspicax-org";
import { setUnhideOnMessage, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
import { viewerActorId } from "@/lib/viewer";
import { hiddenSidebarRows } from "@/lib/sidebar-hidden-entries";
import { CompactRow, PILL, SettingsTextRow, Switch } from "./SettingsPrimitives";

export function SidebarHiddenSettings() {
  const { state } = useStore();
  const hidden = useSidebarHidden();
  const people = useOrgPeople();
  const rows = hiddenSidebarRows(hidden.items, { bots: state.bots, groups: state.groups, viewerId: viewerActorId(state.config), people });
  return (
    <>
      {rows.length === 0 && <SettingsTextRow>{t("settings.sidebarHidden.none")}</SettingsTextRow>}
      {rows.map((row) => (
        <div key={row.key} data-settings-hidden-entry={row.key}>
          <CompactRow label={row.name}>
            <span className="text-[13px] text-ink-secondary">{t(`settings.sidebarHidden.kind.${row.kind}`)}</span>
            <button
              type="button"
              className={PILL}
              aria-label={t("sidebar.hidden.showNamed", { name: row.name })}
              onClick={() => showInSidebar(row.key)}
            >
              {t("sidebar.hidden.show")}
            </button>
          </CompactRow>
        </div>
      ))}
      <CompactRow label={t("settings.sidebarHidden.unhidePeople")} rowId="unhidePeople">
        <Switch checked={hidden.unhideOnMessage.people} aria-label={t("settings.sidebarHidden.unhidePeople")} onClick={() => setUnhideOnMessage("people", !hidden.unhideOnMessage.people)} />
      </CompactRow>
      <CompactRow label={t("settings.sidebarHidden.unhideBots")} rowId="unhideBots">
        <Switch checked={hidden.unhideOnMessage.bots} aria-label={t("settings.sidebarHidden.unhideBots")} onClick={() => setUnhideOnMessage("bots", !hidden.unhideOnMessage.bots)} />
      </CompactRow>
    </>
  );
}
