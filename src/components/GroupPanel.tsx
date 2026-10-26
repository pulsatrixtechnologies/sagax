// The group's right side panel. It is the bot panel (BotSettingsDialog)
// adapted to a group: the same docked shell, top bar, big avatar, name and
// tab strip, so a group and a bot read as one design. Group-specific bodies
// (members on Details; responder and folder on Advanced, like a bot's own
// folder) come from GroupView, which owns their state. Every group setting
// lives here: there is no separate setup dialog.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight } from "lucide-react";

import { useStore, type Bot, type Group } from "@/state/store";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BotAvatar } from "./Avatar";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { GroupMemoryTab } from "./GroupMemoryTab";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { InlineEditableText } from "./bot-settings/InlineEditableText";
import { DescriptionInfo } from "./bot-settings/DescriptionInfo";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { normalizeState } from "@/lib/mascot";
import { HelpTip } from "./SettingsPrimitives";

export const GROUP_PANEL_TABS = ["details", "instructions", "memory", "advanced"] as const;
export type GroupPanelTab = (typeof GROUP_PANEL_TABS)[number];

const tabLabel = (tab: GroupPanelTab) =>
  tab === "instructions" ? t("groupPanel.tab.instructions") : tab === "memory" ? t("groupPanel.tab.memory") : t(`botPanel.tab.${tab}`);

/** Up to three member faces overlapped in a square, the group's avatar. */
export function GroupAvatarStack({ members, size }: { members: Bot[]; size: number }) {
  const shown = members.slice(0, 3);
  if (shown.length <= 1) {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
        {shown[0] && <BotAvatar bot={shown[0]} state="happy" size={size} animated={false} />}
      </span>
    );
  }
  const face = Math.round(size * (shown.length === 2 ? 0.62 : 0.56));
  const spots = shown.length === 2
    ? ["left-0 top-0", "right-0 bottom-0"]
    : ["left-0 top-0", "right-0 top-[18%]", "left-[22%] bottom-0"];
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      {shown.map((bot, index) => (
        <span key={bot.id} className={cn("absolute rounded-full", spots[index])}>
          <BotAvatar bot={bot} state={normalizeState(bot.mascotExpression) ?? "happy"} size={face} animated={false} />
        </span>
      ))}
    </span>
  );
}

/** A titled block inside the group panel's tabs, with the same heading tone
 * and inner rhythm as the bot panel's Details sections (flex gap-2, a quiet
 * 13px heading). Section bodies (the member roster, the responder select)
 * stay their own components; this only frames them so a group and a bot read
 * as one design. */
export function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h3 className="text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h3>
      {children}
    </section>
  );
}

export function GroupPanel({
  group,
  members,
  details,
  advanced,
  canEdit,
  readOnlyNote = false,
}: {
  group: Group;
  members: Bot[];
  /** People and bots, rendered by GroupView. */
  details: ReactNode;
  /** Default responder and working folder, rendered by GroupView; null for a remote client. */
  advanced: ReactNode;
  /** Rename and instructions: the group's owner, never a remote client. */
  canEdit: boolean;
  /** Organization server: someone else owns the group; say why it is read-only. */
  readOnlyNote?: boolean;
}) {
  const { dispatch } = useStore();
  const { padClass, dragProps } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<GroupPanelTab>("details");
  // A remote client edits neither the responder nor the folder: no Advanced tab.
  const tabs: readonly GroupPanelTab[] = advanced == null ? GROUP_PANEL_TABS.filter((id) => id !== "advanced") : GROUP_PANEL_TABS;
  // The one app-wide docked-panel width: the group opens at the width the bot
  // panel was left at, and its resize handle is the shared one.
  const dockedPanel = useDockedPanelWidth();
  const [bulletin, setBulletin] = useState(group.bulletin);
  useEffect(() => setBulletin(group.bulletin), [group.bulletin]);

  const closePanel = () => dispatch({ type: "toggleSettings", open: false });
  const saveName = (next: string) => dispatch({ type: "patchGroup", groupId: group.id, patch: { name: next } });
  const saveBulletin = () => {
    if (bulletin !== group.bulletin) dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin } });
  };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside this one owns Escape while it is up.
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <aside
      ref={dialogRef}
      role="dialog"
      aria-labelledby="group-panel-title"
      tabIndex={-1}
      data-testid="group-panel"
      style={{ width: dockedPanel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto"
    >
      <DockedPanelResizeHandle label={t("computer.resizeAria")} panel={dockedPanel} />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <div {...dragProps} className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
        <span />
        <div className="flex items-center gap-2">
          <ExportTranscriptMenu title={group.name} messages={group.messages} isGroup />
          <button type="button" onClick={closePanel} aria-label={t("common.close")} title={t("common.close")} className={CIRCLE_BUTTON}>
            <PanelRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0">
        <div className="flex shrink-0 flex-col items-center px-4 pb-3">
          {/* The group's avatar sits where the bot's mascot does (#977): the
              same top padding and box size, so the two headers line up. */}
          <div className="flex justify-center pt-5 pb-0">
            <GroupAvatarStack members={members} size={144} />
          </div>
          {/* As on a bot: the name is edited where it shows (its owner),
              and the (i) beside it reveals the group instructions. */}
          <div className="-mt-1 flex max-w-full items-center justify-center gap-0.5">
            <InlineEditableText
              id="group-panel-title"
              value={group.name}
              required
              maxLength={100}
              ariaLabel={t("botPanel.name.edit")}
              onSave={canEdit ? saveName : undefined}
              className="text-[17px] font-medium leading-6 text-ink"
            />
            <DescriptionInfo
              value={group.bulletin}
              label={t("groupPanel.instructions")}
              emptyText={t("groupPanel.instructionsEmpty")}
              placeholder={t("groupPanel.instructionsPlaceholder")}
              onSave={canEdit ? (next) => dispatch({ type: "patchGroup", groupId: group.id, patch: { bulletin: next } }) : undefined}
            />
          </div>
          <span className="mt-0.5 max-w-full truncate text-[12.5px] leading-4 text-ink-secondary">
            {members.length === 1 ? t("groupPanel.botOne") : t("groupPanel.botMany", { count: members.length })}
          </span>
          <div
            role="tablist"
            aria-label={t("groupPanel.tabsAria")}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
              setTab(next);
              event.currentTarget.querySelector<HTMLElement>(`[data-panel-tab="${next}"]`)?.focus();
            }}
            className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5"
          >
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                data-panel-tab={id}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-md px-1.5 py-1 text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  tab === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {tabLabel(id)}
              </button>
            ))}
          </div>
        </div>

        {readOnlyNote && (
          <p role="note" className="mx-4 mb-3 rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2.5 text-[12.5px] text-ink-secondary">{t("groupPanel.ownerOnly")}</p>
        )}

        {tab === "details" && (
          <div className="flex flex-col gap-6 px-4 pb-6 pt-2">
            {details}
          </div>
        )}

        {tab === "instructions" && (
          <div className="flex flex-col gap-2 px-4 pb-6 pt-2">
            {/* As a Settings group: the grey heading outside the editor, the
                longer explanation behind its (?) */}
            <div className="flex min-w-0 items-center gap-1.5 px-1">
              <label id={`group-bulletin-label-${group.id}`} htmlFor={`group-bulletin-${group.id}`} className="text-[13px] leading-[18px] text-ink-secondary">{t("groupPanel.instructions")}</label>
              <HelpTip label={t("settings.moreAbout", { title: t("groupPanel.instructions") })}>{t("groupPanel.instructionsDetail")}</HelpTip>
            </div>
            <MarkdownEditor
              id={`group-bulletin-${group.id}`}
              ariaLabelledBy={`group-bulletin-label-${group.id}`}
              value={bulletin}
              readOnly={!canEdit}
              onChange={setBulletin}
              onBlur={saveBulletin}
              minHeight={220}
              dataField="group-instructions"
              placeholder={t("groupPanel.instructionsPlaceholder")}
            />
          </div>
        )}

        {tab === "memory" && <GroupMemoryTab groupId={group.id} />}

        {tab === "advanced" && advanced != null && (
          <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
            {advanced}
          </div>
        )}
      </div>
    </aside>
  );
}
