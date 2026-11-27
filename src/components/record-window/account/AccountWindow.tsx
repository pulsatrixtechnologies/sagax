// A company's window and a contact's (M-20261127-101, M-20261127-140): the
// record window's frame (head, foot, RecordCard.tsx) around their tabs across
// the window, out of what scrolls (M-20261127-134), each with its count
// (M-20261127-117), a tab with nothing in it where nothing can be added
// hidden (M-20261127-143), and the tab's body that scrolls on its own
// (M-20261127-124). A contact named anywhere in a company's window opens in
// this window, with the way back above the head (RecordLink.tsx).
//
// The data is the console's: the card, then the detail route's sections for
// this kind (src/lib/record-detail.ts). A console that has no sections for a
// company or a contact yet leaves the Profile drawn from the card and its open
// tickets.
import { useEffect } from "react";
import { RecordWindowTabs, recordShown } from "@/components/record-window/RecordBlocks";
import type { RecordWindowLayout } from "@/components/RecordCard";
import type { RecordDetail } from "@/components/useRecordDetail";
import { activeLocale, t } from "@/lib/i18n";
import type { RecordCard as Card } from "../../../../shared/record-cards";
import { AccountAgreementsTab, AccountDataTab, AccountFinanceTab, AccountOpportunitiesTab, AccountProjectsTab, AccountTicketsTab } from "./AccountBusiness";
import { AccountActivitiesTab, AccountAttachmentsTab, AccountConfigurationsTab, AccountContactsTab, AccountNotesTab, AccountSitesTab, ContactHistoryTab } from "./AccountLists";
import { AccountProfile, type When } from "./AccountProfile";
import { accountTabs, profileView, TAB_SECTION, type AccountKind, type AccountTab } from "./account-model";

export interface AccountWindowProps {
  kind: AccountKind;
  card: Card;
  /** the detail route's reads and writes (absent: a console with no sections for this kind) */
  detail?: RecordDetail;
  /** the window's type: its columns are kept for it */
  type: string;
  now: number;
  /** the tab the person chose for this record (absent: the Profile) */
  tab?: AccountTab;
  onTab: (tab: AccountTab) => void;
  /** the ids of the tabs and their panel */
  idPrefix: string;
}

/** The tab on screen: the one chosen while the window shows it, else the Profile. */
function currentTab({ kind, card, detail, tab }: AccountWindowProps) {
  const tabs = accountTabs(kind, card, detail);
  const shown = tabs.filter((one) => recordShown(one.count, Boolean(one.canAdd)));
  return { tabs: shown, current: tab && shown.some((one) => one.id === tab) ? tab : "sheet" as AccountTab };
}

function AccountTabs(props: AccountWindowProps) {
  const { tabs, current } = currentTab(props);
  // the window's body draws the hairline under the tabs
  return <RecordWindowTabs tabs={tabs} tab={current} onTab={props.onTab} label={t(props.kind === "company" ? "recordWindow.account.tabsCompany" : "recordWindow.account.tabsContact")} idPrefix={props.idPrefix} className="border-b-0" />;
}

function AccountBody(props: AccountWindowProps) {
  const { kind, card, detail, type, now, onTab, idPrefix } = props;
  const { tabs, current } = currentTab(props);
  const want = detail?.want;
  // the Profile is read when the window opens, then each tab when it is shown
  useEffect(() => { want?.(["sheet"]); }, [want]);
  useEffect(() => { if (current !== "sheet") want?.([TAB_SECTION[current]]); }, [want, current]);
  const when: When = { now, ...(card.tz ? { tz: card.tz } : {}) };
  const panel = (() => {
    if (current === "tickets") return <AccountTicketsTab detail={detail} card={card} type={type} when={when} />;
    if (!detail || current === "sheet") {
      const state = detail?.section("sheet");
      const loading = Boolean(detail && !state?.page && !state?.error);
      const view = profileView(kind, card, state?.page?.sheet, activeLocale());
      return (
        <AccountProfile kind={kind} when={when} shown={new Set(tabs.map((one) => one.id))} contacts={detail?.counts.contacts} onTab={onTab}
          view={loading ? { ...view, reach: [], tiles: [], upcoming: [], feed: [], people: [], prefs: [], facts: [] } : view}
          notice={loading ? t("recordCard.loading") : state?.error || undefined} />
      );
    }
    switch (current) {
      case "notes": return <AccountNotesTab detail={detail} when={when} />;
      case "contacts": return <AccountContactsTab detail={detail} />;
      case "activities": return <AccountActivitiesTab detail={detail} when={when} />;
      case "projects": return <AccountProjectsTab detail={detail} />;
      case "opportunities": return <AccountOpportunitiesTab detail={detail} />;
      case "agreements": return <AccountAgreementsTab detail={detail} />;
      case "configurations": return <AccountConfigurationsTab kind={kind} detail={detail} />;
      case "attachments": return <AccountAttachmentsTab detail={detail} />;
      case "sites": return <AccountSitesTab detail={detail} />;
      case "finance": return <AccountFinanceTab detail={detail} />;
      case "data": return <AccountDataTab detail={detail} />;
      case "history": return <ContactHistoryTab detail={detail} when={when} />;
    }
  })();
  return (
    <div className="record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel" id={`${idPrefix}-panel-${current}`} aria-labelledby={`${idPrefix}-tab-${current}`} data-record-account-tab={current}>
      {detail?.countError && <p role="status" className="px-5 pt-3 text-[13px] leading-[18px] text-popover-ink-secondary">{detail.countError}</p>}
      {panel}
    </div>
  );
}

/** The window's tabs and body for a company or a contact (RecordCard's `window`). */
export function accountWindow(props: AccountWindowProps): RecordWindowLayout {
  return { tabs: <AccountTabs {...props} />, body: <AccountBody {...props} /> };
}
