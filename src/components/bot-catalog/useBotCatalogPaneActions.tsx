// Browse Bots pane actions (#1383 extract from BotCatalogPane).
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { track } from "@/lib/analytics";
import { orgCardAction, type OrgLibraryPackage } from "@/lib/org-library";
import type { Routine } from "@/lib/routines";
import type { PendingTeamImport } from "@/lib/team-import";
import {
  ACTION_LABEL,
  cardActionLabel,
  catalogActions,
  itemName,
  type CatalogAction,
  type CatalogItem,
} from "@/lib/bot-catalog";
import type { BotCatalogListing } from "../../../shared/bot-catalog";
import { XAI_MARKETPLACE_LABEL } from "../../../shared/xai-marketplace";
import type { GrokLeftOut } from "../../../shared/grok-import";
import { botsReadOnlyText } from "@/lib/permissions";
import { readableError } from "@/lib/plain-error";
import { hideFromSidebar, hiddenKey, showInSidebar } from "@/lib/sidebar-hidden";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { api, type Action, type Bot, type ConfigStatus, type Group } from "@/state/store";
import { cardActionClass } from "../category-modal";
import { openBotConversationActions } from "../thread-home";
import { AgentImportSummary } from "../AgentImport";
import { BotZipImportPanel } from "../BotZipImport";
import { GrokLeftOutList } from "../GrokImportBox";
import { TeamImportDetails, type TeamImportResult } from "./TeamImportDetails";
import { TeamImportPreview, type TemplateTool } from "./TemplateTools";

type Feedback = { error: boolean; text: string } | null;
type TeamPreview = { pending: PendingTeamImport | null; loading: boolean; error: string };
type XaiPreview = { made: { file: Blob; pending: PendingTeamImport; leftOut: GrokLeftOut[] } | null; loading: boolean; error: string };

type CatalogCtx = {
  organization: boolean;
  admin: boolean;
  canCreate: boolean;
  feature: boolean;
  inSidebar: (botId: string) => boolean;
};

/** The feedback line after a team, a backup or a package was added. */
export function teamImportedText(result: TeamImportResult): string {
  return (result.members === 0 && result.presets
    ? t("sidebar.presetsImported", { count: result.presets })
    : result.members === 1
    ? t("sidebar.teamImportedOne")
    : t("sidebar.teamImportedMany", { count: result.members })) +
    (result.connections ? ` · ${t("sidebar.connectionsToFinish", { count: result.connections })}` : "");
}

export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p role={feedback.error ? "alert" : "status"} data-catalog-feedback="" className={cn("mx-6 mt-3 rounded-lg px-3 py-2 text-[12.5px] sm:mx-8", feedback.error ? "bg-danger/10 text-danger" : "bg-ink/[0.05] text-ink-secondary")}>
      {feedback.text}
    </p>
  );
}

/** An organization package that cannot be added now: added, needs a newer
 * Sagax, still downloading, or no release yet. */
function OrgPackageState({ entry }: { entry: OrgLibraryPackage }) {
  const state = orgCardAction(entry);
  if (state === "add") return null;
  if (state === "added") {
    return <span className="flex shrink-0 items-center gap-1 rounded-full bg-raised px-3 py-1.5 text-[12px] text-ink-secondary" data-catalog-package-state="added"><Check size={13} className="text-success" />{t("orgLibrary.added")}</span>;
  }
  const key = state === "updateApp" ? "orgLibrary.updateApp" : state === "notReady" ? "orgLibrary.notReady" : "orgLibrary.noRelease";
  return <span className="max-w-[140px] shrink-0 text-right text-[11.5px] text-ink-secondary" data-catalog-package-state={state}>{t(key)}</span>;
}

export interface BotCatalogPaneActionsInput {
  state: { bots: Bot[]; config: ConfigStatus | null | undefined };
  dispatch: Dispatch<Action>;
  showThreads: boolean;
  close: () => void;
  data: { organization: boolean; entries: Array<{ id: string; source: string; archived?: boolean }> } | null | undefined;
  organization: boolean;
  canCreate: boolean;
  ctx: CatalogCtx;
  pending: boolean;
  setPending: Dispatch<SetStateAction<boolean>>;
  feedback: Feedback;
  setFeedback: Dispatch<SetStateAction<Feedback>>;
  selected: CatalogItem | null;
  setSelected: Dispatch<SetStateAction<CatalogItem | null>>;
  setPublishing: Dispatch<SetStateAction<boolean>>;
  setTool: Dispatch<SetStateAction<TemplateTool | null>>;
  setInstallUrl: Dispatch<SetStateAction<string | undefined>>;
  teamPreview: TeamPreview | null;
  xaiPreview: XaiPreview | null;
  loadFailed: boolean;
  reloadSources: () => void;
  remoteClient: boolean;
}

export function useBotCatalogPaneActions(input: BotCatalogPaneActionsInput) {
  const {
    state, dispatch, showThreads, close, data, organization, canCreate, ctx,
    pending, setPending, feedback, setFeedback, selected, setSelected, setPublishing,
    setTool, setInstallUrl, teamPreview, xaiPreview, loadFailed, reloadSources, remoteClient,
  } = input;

  const fail = (error: unknown) => {
    const body = (error as { body?: { message?: unknown } })?.body;
    const text = typeof body?.message === "string" ? body.message : readableError(error);
    setFeedback({ error: true, text });
  };

  const setListing = async (item: Extract<CatalogItem, { kind: "bot" }>, listing: { published: boolean; category?: string; featured?: boolean }, done: string) => {
    setPending(true);
    setFeedback(null);
    try {
      await api<{ catalog: BotCatalogListing | null }>(`/api/bot-catalog/${encodeURIComponent(item.entry.id)}/listing`, { method: "PUT", body: JSON.stringify(listing) });
      setPublishing(false);
      setFeedback({ error: false, text: done });
      reloadSources();
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  };

  /** A team, a backup or a package was added (a preview, a tool). */
  const teamImported = (result: TeamImportResult) => {
    setSelected(null);
    setTool(null);
    setInstallUrl(undefined);
    setFeedback({ error: false, text: teamImportedText(result) });
    reloadSources();
  };

  /** An organization package: one click adds it, no confirmation (as the
   * library's From {Organization} shelf did). */
  const addOrgPackage = async (entry: OrgLibraryPackage) => {
    setPending(true);
    setFeedback(null);
    try {
      // SAFETY: this endpoint is owned by the app and returns the added records.
      const response = (await api("/api/org-library/add", {
        method: "POST",
        body: JSON.stringify({ packageId: entry.packageId }),
      })) as { alreadyAdded: boolean; bots?: Bot[]; groups?: Group[]; routines?: Routine[]; connections?: unknown[] };
      for (const bot of response.bots ?? []) dispatch({ type: "botAdded", bot });
      for (const group of response.groups ?? []) dispatch({ type: "groupPatched", group });
      for (const routine of response.routines ?? []) dispatch({ type: "routinePatched", routine });
      track("team_imported", { members: response.bots?.length ?? 0, source: "organization", mode: "add", format: "package" });
      const first = response.bots?.find((bot) => !bot.hidden);
      if (first) {
        dispatch({ type: "select", id: first.id });
        teamImported({ name: entry.name, members: response.bots!.length, ...(response.connections?.length ? { connections: response.connections.length } : {}) });
        return;
      }
      setSelected(null);
      if (!response.alreadyAdded) setFeedback({ error: false, text: t("orgLibrary.addedSkills", { name: entry.name }) });
      reloadSources();
    } catch (error) {
      fail(error);
      reloadSources();
    } finally {
      setPending(false);
    }
  };

  const importItem = async (item: CatalogItem) => {
    const name = itemName(item);
    const done = () => { setFeedback({ error: false, text: t("botCatalog.feedback.imported", { name }) }); reloadSources(); };
    setFeedback(null);
    if (item.kind === "template" && item.template.orgPackage) { await addOrgPackage(item.template.orgPackage); return; }
    // A community team, or a marketplace bot, previews what it adds first: its detail view.
    if (item.kind === "template" && (item.template.community || item.template.xai)) { setSelected(item); return; }
    if (item.kind === "template" && item.template.role) {
      dispatch({ type: "newBot", role: item.template.role, preserveSelection: true, onCreated: done, onError: (message) => setFeedback({ error: true, text: message }) });
      return;
    }
    setPending(true);
    try {
      if (item.kind === "template" && item.template.preset) {
        const preset = item.template.preset;
        const look = preset.bot.appearance;
        await api("/api/bots", {
          method: "POST",
          body: JSON.stringify({
            name, title: item.template.title, description: item.template.description, soul: item.template.soul, preset: preset.id,
            ...(look ? { color: look.color, ...(look.mascotBody ? { mascotBody: look.mascotBody } : {}) } : {}),
          }),
        });
      } else if (item.kind === "bot") {
        await api(`/api/bot-catalog/${encodeURIComponent(item.entry.id)}/import`, { method: "POST", body: "{}" });
      }
      done();
    } catch (error) {
      fail(error);
    } finally {
      setPending(false);
    }
  };

  const run = (item: CatalogItem, action: CatalogAction) => {
    if (action === "import" || action === "useTemplate") { void importItem(item); return; }
    if (item.kind !== "bot") return;
    const { entry } = item;
    if (action === "open") {
      const bot = state.bots.find((candidate) => candidate.id === entry.id);
      if (!bot) return;
      showInSidebar(hiddenKey("bot", bot.id));
      for (const step of openBotConversationActions(bot, showThreads)) dispatch(step);
      close();
      return;
    }
    if (action === "addToSidebar") {
      showInSidebar(hiddenKey("bot", entry.id));
      setFeedback({ error: false, text: t("botCatalog.feedback.addedToSidebar", { name: entry.name }) });
      return;
    }
    if (action === "removeFromSidebar") {
      hideFromSidebar("bot", entry.id);
      setFeedback({ error: false, text: t("botCatalog.feedback.removedFromSidebar", { name: entry.name }) });
      return;
    }
    if (action === "publish") {
      if (selected?.key !== item.key) setSelected(item);
      setPublishing(true);
      return;
    }
    if (action === "unpublish") { void setListing(item, { published: false }, t("botCatalog.feedback.unpublished")); return; }
    if (action === "feature" || action === "unfeature") {
      void setListing(item, { published: true, featured: action === "feature" }, t(action === "feature" ? "botCatalog.feedback.featured" : "botCatalog.feedback.unfeatured"));
    }
  };

  const renderCardAction = (item: CatalogItem): ReactNode => {
    const pkg = item.kind === "template" ? item.template.orgPackage : undefined;
    if (pkg && orgCardAction(pkg) !== "add") return <OrgPackageState entry={pkg} />;
    const primary = catalogActions(item, ctx)[0];
    if (!primary || primary === "publish" || primary === "unpublish" || primary === "feature" || primary === "unfeature") return null;
    if (primary === "open" && item.kind === "bot" && !state.bots.some((bot) => bot.id === item.entry.id)) return null;
    return (
      <button
        type="button"
        disabled={pending}
        data-catalog-card-action={primary}
        onClick={() => run(item, primary)}
        className={cardActionClass(primary === "removeFromSidebar" || primary === "open" ? "secondary" : "primary")}
      >
        {cardActionLabel(primary)}
      </button>
    );
  };

  // A community team's Add is in its preview, under what it adds.
  const renderDetailActions = (item: CatalogItem): ReactNode => item.kind === "template" && (item.template.community || item.template.xai) ? null
    : item.kind === "template" && item.template.orgPackage && orgCardAction(item.template.orgPackage) !== "add" ? <OrgPackageState entry={item.template.orgPackage} />
    : catalogActions(item, ctx).map((action, index) => (
    <button
      key={action}
      type="button"
      disabled={pending || (action === "open" && item.kind === "bot" && !state.bots.some((bot) => bot.id === item.entry.id))}
      data-catalog-action={action}
      onClick={() => run(item, action)}
      className={cn(
        "rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50",
        index === 0 ? "bg-ink text-app hover:opacity-90" : "border border-border text-ink hover:bg-hover",
        action === "unpublish" && index > 0 && "text-danger",
      )}
    >
      {t(ACTION_LABEL[action])}
    </button>
  ));

  const notice = (
    <>
      {loadFailed && (
        <p role="alert" className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger sm:mx-8">
          {t("botCatalog.loadError")}
          <button type="button" onClick={() => reloadSources()} className="underline">{t("botCatalog.retry")}</button>
        </p>
      )}
      {!canCreate && data && organization && viewerBotsReadOnly(state.config) && (
        <p role="note" className="mx-6 mt-3 text-[12.5px] text-ink-secondary sm:mx-8">{botsReadOnlyText(state.config)}</p>
      )}
      <FeedbackLine feedback={feedback} />
    </>
  );

  const templatePreview = (item: CatalogItem): ReactNode | undefined => {
    if (item.kind === "template" && item.template.xai && xaiPreview) {
      if (xaiPreview.loading) return <p className="text-[13px] text-ink-secondary" role="status">{t("botCatalog.loading")}</p>;
      if (!xaiPreview.made) return <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger" data-catalog-xai-error="">{xaiPreview.error}</p>;
      const { made } = xaiPreview;
      if (!canCreate) return <TeamImportDetails pending={made.pending} importedNames={made.pending.members.map((member) => member.name)} />;
      return (
        <div data-catalog-xai-preview="">
          <BotZipImportPanel
            key={item.key}
            file={made.file}
            sourceLabel={t("agentImport.from", { source: XAI_MARKETPLACE_LABEL })}
            summary={<AgentImportSummary pending={made.pending} />}
            extra={<GrokLeftOutList leftOut={made.leftOut} />}
            onCancel={() => { setSelected(null); setFeedback(null); }}
            onImported={(result) => teamImported({ name: result.name, members: 1 })}
          />
        </div>
      );
    }
    if (item.kind !== "template" || !teamPreview) return undefined;
    if (teamPreview.loading) return <p className="text-[13px] text-ink-secondary" role="status">{t("botCatalog.loading")}</p>;
    if (!teamPreview.pending) return <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{teamPreview.error || t("botCatalog.loadError")}</p>;
    if (item.template.orgPackage) {
      return <TeamImportDetails pending={teamPreview.pending} importedNames={teamPreview.pending.members.map((member) => member.name)} org />;
    }
    if (!canCreate) return <TeamImportDetails pending={teamPreview.pending} importedNames={teamPreview.pending.members.map((member) => member.name)} />;
    return <TeamImportPreview pending={teamPreview.pending} source="library" onImported={teamImported} />;
  };

  const templateToolsOn = !remoteClient && canCreate;

  return {
    setListing,
    teamImported,
    renderCardAction,
    renderDetailActions,
    notice,
    templatePreview,
    templateToolsOn,
  };
}
