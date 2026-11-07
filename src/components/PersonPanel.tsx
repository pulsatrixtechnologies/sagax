// The right panel for a person of the organization, the counterpart of the
// bot panel: who they are (from the Perspicax directory only), the groups
// you share, their bots shared with you, and what you can do (write to
// them). Nothing from a private thread shows here, and neither do their
// connected accounts nor a console link (#2117, JC 2026-11-05).
// Profile is the default tab (email, teams, groups). "In common" shows only
// what there is: no groups in common and no bots of theirs shared with you,
// no section at all. The Library tab (#2117) is the bot panel's Library for
// the files you and this person have together. The Achievements tab
// (AchievementsPanel.tsx, 2026-10-26) is drawn for the narrow column: a
// compact summary (level, chosen title, points and a bar to the next level),
// the last unlocks, then every achievement as a grid of icons; title and
// points only when the public card carried them ("Show my title", "Show my
// points"). It never repeats the avatar and name of the header. Title and
// points never sit on the name line. A private card stays a private note:
// nobody reads another person's record, and the tab says they keep
// achievements private. Message hides while the viewer is already in their
// conversation with this person (2026-10-26); from a group or elsewhere it
// stays.
import { useState } from "react";
import { Mail, MessageSquare, PanelRight, Users } from "lucide-react";

import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { usePerspicaxOrg, type OrgDirectory } from "@/lib/perspicax-org";
import { personAvatarSrc } from "@/lib/profile-management";
import { personInitials } from "@/lib/people-dm";
import { viewerActorId } from "@/lib/viewer";
import {
  canMessagePerson,
  findPanelPerson,
  personDmGroup,
  personSharedBots,
  personTeams,
  sharedGroups,
} from "@/lib/person-panel";
import { hiddenKey, showInSidebar, useSidebarHidden } from "@/lib/sidebar-hidden";
import { BotAvatar } from "./Avatar";
import { PersonLibraryTab } from "./bot-settings/LibraryTab";
import { PersonAvatar } from "./MessageAuthor";
import { achievementTitleName } from "./achievements/MemberCard";
import { AchievementsPanel } from "./achievements/AchievementsPanel";
import { usePublicAchievement } from "@/lib/public-achievements";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { useOrgDirectory } from "./GroupPeoplePicker";
import { InlineEditableText } from "./bot-settings/InlineEditableText";
import { canEditPersonLabel, savePersonLabel, usePersonLabel } from "@/lib/person-labels";
import { PERSON_LABEL_MAX } from "../../shared/person-label";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { FoldRow, PILL, SettingsGroup } from "./SettingsPrimitives";
import { personLabel } from "@/lib/human-label";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[36px] items-start justify-between gap-4 px-3.5 py-2 text-[13px] leading-[18px]">
      <span className="shrink-0 text-ink-secondary">{label}</span>
      <span className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

/** A list of what the viewer shares with this person, folded under a count
 * pill as Settings folds its long lists. Drawn only when there is one. */
function SharedList({ cardId, label, count, children }: { cardId: string; label: string; count: number; children: React.ReactNode }) {
  return (
    <FoldRow cardId={cardId} defaultOpen={count <= 5} label={label} count={count}>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </FoldRow>
  );
}

export function PersonPanel({ personId, directory: given, initialTab = "profile" }: { personId: string; directory?: OrgDirectory | null; initialTab?: "profile" | "library" | "achievements" }) {
  const { state, dispatch } = useStore();
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const org = usePerspicaxOrg();
  const loaded = useOrgDirectory(given === undefined);
  const directory = given === undefined ? loaded : given;
  const hidden = useSidebarHidden();
  const viewerId = viewerActorId(state.config);
  const person = findPanelPerson(directory, personId);
  const name = personLabel(person?.name, person?.login, personId);
  const avatarUrl = personAvatarSrc(person?.avatarUrl);
  const teams = personTeams(person, directory);
  const groups = sharedGroups(state.groups, personId);
  const bots = personSharedBots(state.bots, personId);
  const dm = personDmGroup(state.groups, personId);
  // already in the conversation with them: Message would only reopen it
  const inTheirDm = Boolean(dm && state.activeView === "chat" && state.selectedId === dm.id);
  const canMessage = canMessagePerson(person, viewerId) && !inTheirDm;
  const isHidden = hidden.items.some((item) => hiddenKey(item.kind, item.id) === hiddenKey("person", personId));
  const label = usePersonLabel(personId);
  const mayEditLabel = canEditPersonLabel({
    personId,
    viewerId,
    viewerAdmin: org?.viewerRole === "admin",
    managedTeamIds: directory?.viewer?.managedTeamIds,
    personTeamIds: (person?.teams ?? []).map((team) => team.id),
  });
  const publicCard = usePublicAchievement(personId);
  const titleName = publicCard ? achievementTitleName(publicCard.title) : null;
  // the person's own "Show my points" / "Show my title": the server leaves
  // what they hid off the card, for everyone, the viewer included
  const ownPanel = personId.trim().toLowerCase() === viewerId;
  const [tab, setTab] = useState<"profile" | "library" | "achievements">(initialTab);
  const tabs = ["profile", "library", "achievements"] as const;
  const dockedPanel = useDockedPanelWidth();
  const close = () => dispatch({ type: "openPersonPanel", personId: null });

  return (
    <aside
      role="dialog"
      aria-labelledby="person-panel-title"
      data-person-panel={personId}
      style={{ width: dockedPanel.width }}
      className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto!"
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
    >
      <DockedPanelResizeHandle label={t("computer.resizeAria")} panel={dockedPanel} />
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <div className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-end px-3", padClass)}>
        <button type="button" onClick={close} aria-label={t("personPanel.close")} title={t("personPanel.close")} className={CIRCLE_BUTTON}>
          <PanelRight size={18} strokeWidth={1.75} />
        </button>
      </div>
      <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0">
        <div className="flex shrink-0 flex-col items-center px-4 pb-3">
          <PersonAvatar avatarUrl={avatarUrl} initials={personInitials(name)} size={88} presenceId={personId} presenceRing="border-panel" />
          <h2 id="person-panel-title" className="mt-3 max-w-full truncate text-[17px] font-medium leading-6 text-ink">{name}</h2>
          {/* The label, as under a bot's name in its panel: editable by the
              person, an admin and their team manager; plain text otherwise. */}
          <InlineEditableText
            value={label}
            maxLength={PERSON_LABEL_MAX}
            placeholder={t("personLabel.add")}
            ariaLabel={t("personLabel.edit")}
            onSave={mayEditLabel ? (next) => { void savePersonLabel(personId, next).catch(() => dispatch({ type: "error", message: t("personLabel.saveError") })); } : undefined}
            muted
            className="mt-0.5 text-[12.5px] leading-4"
          />
          {person && (person.role === "admin" || person.disabled) && (
            <span className="mt-0.5 text-[12.5px] leading-4 text-ink-secondary">
              {person.role === "admin" ? t("personPanel.role.admin") : ""}
              {person.role === "admin" && person.disabled ? " · " : ""}
              {person.disabled ? t("personPanel.disabled") : ""}
            </span>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {canMessage && (
              <button
                type="button"
                data-person-action="message"
                onClick={() => {
                  if (isHidden) showInSidebar(hiddenKey("person", personId));
                  if (dm) dispatch({ type: "select", id: dm.id });
                  else dispatch({ type: "openPeopleDm", principalId: person!.principalId });
                }}
                className={PILL}
              >
                <MessageSquare size={14} aria-hidden />
                {t("personPanel.message")}
              </button>
            )}
          </div>
          <div
            role="tablist"
            aria-label={t("personPanel.tabsAria")}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
              setTab(next);
              event.currentTarget.querySelector<HTMLElement>(`[data-person-tab="${next}"]`)?.focus();
            }}
            className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5"
          >
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`person-tab-${id}`}
                data-person-tab={id}
                aria-selected={tab === id}
                aria-controls={`person-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                className={cn(
                  "rounded-md px-1.5 py-1 text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  tab === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {id === "profile" ? t("personPanel.tab.profile") : id === "library" ? t("personPanel.tab.library") : t("personPanel.tab.achievements")}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" id="person-panel-profile" aria-labelledby="person-tab-profile" hidden={tab !== "profile"} className="flex flex-col gap-5 px-4 pb-6 pt-2">
          {!person && directory && (
            <p role="note" className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-2.5 text-[12.5px] text-ink-secondary">{t("personPanel.notInDirectory")}</p>
          )}
          {person && (
            <SettingsGroup groupId="person-about" title={t("personPanel.about")}>
              {person.email && (
                <Field label={t("personPanel.email")}>
                  <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Mail size={12} aria-hidden />{person.email}</a>
                </Field>
              )}
              {person.login && person.login !== person.email && <Field label={t("personPanel.login")}>{person.login}</Field>}
              <Field label={t("personPanel.teams")}>
                {teams.length
                  ? teams.map((team) => (team.manager ? t("personPanel.teamManager", { name: team.name }) : team.name)).join(", ")
                  : <span className="text-ink-secondary">{t("personPanel.noTeams")}</span>}
              </Field>
            </SettingsGroup>
          )}

          {(groups.length > 0 || bots.length > 0) && (
            <SettingsGroup groupId="person-shared" title={t("personPanel.inCommon")}>
              {groups.length > 0 && (
                <div data-person-section="groups">
                  <SharedList cardId="person-panel.groups" label={t("personPanel.sharedGroups")} count={groups.length}>
                    {groups.map((group) => (
                      <li key={group.id}>
                        <button type="button" onClick={() => dispatch({ type: "select", id: group.id })} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover md:min-h-0">
                          <Users size={14} className="shrink-0 text-ink-secondary" aria-hidden />
                          <span className="truncate">{group.name}</span>
                        </button>
                      </li>
                    ))}
                  </SharedList>
                </div>
              )}
              {bots.length > 0 && (
                <div data-person-section="bots">
                  <SharedList cardId="person-panel.bots" label={t("personPanel.sharedBots")} count={bots.length}>
                    {bots.map((bot) => (
                      <li key={bot.id}>
                        <button type="button" onClick={() => dispatch({ type: "select", id: bot.id })} className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-hover md:min-h-0">
                          <BotAvatar bot={bot} state="idle" size={24} animated={false} />
                          {/* name, then the title under it (JC: never side by side) */}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span data-person-bot-name="" className="truncate">{bot.name}</span>
                            {bot.title && <span data-person-bot-title="" className="truncate text-[12px] leading-4 text-ink-secondary">{bot.title}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </SharedList>
                </div>
              )}
            </SettingsGroup>
          )}
        </div>
        <div
          role="tabpanel"
          id="person-panel-library"
          aria-labelledby="person-tab-library"
          data-person-tabpanel="library"
          hidden={tab !== "library"}
        >
          {tab === "library" && <PersonLibraryTab personId={personId} />}
        </div>
        <div
          role="tabpanel"
          id="person-panel-achievements"
          aria-labelledby="person-tab-achievements"
          data-person-tabpanel="achievements"
          hidden={tab !== "achievements"}
          className="px-4 pb-6 pt-2"
        >
          {publicCard ? (
            <AchievementsPanel
              card={publicCard}
              title={titleName}
              emptyText={publicCard.unlocked.length === 0 ? t("personPanel.achievements.empty") : undefined}
              onOpenPage={ownPanel ? () => dispatch({ type: "showAchievements" }) : undefined}
            />
          ) : <p className="text-[12.5px] text-ink-secondary">{t("personPanel.achievements.private")}</p>}
        </div>
      </div>
    </aside>
  );
}
