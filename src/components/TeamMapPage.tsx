import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, Loader2, Puzzle, Monitor, MonitorSmartphone, Network, Plus, Save, Users, X } from "lucide-react";

import { api, formatTime, openBot, openThread, useStore, type Bot } from "@/state/store";
import {
  EMPTY_TEAM_MAP_SNAPSHOT,
  buildTeamMapEdges,
  buildTeamMapSections,
  teamMapBotCount,
  type TeamMapEdge,
  type TeamMapSnapshot,
} from "@/lib/team-map";
import { canManageTeamMap, teamMapMutationError } from "@/lib/team-map-access";
import { cn } from "@/lib/cn";
import { useShowThreads } from "@/lib/thread-preferences";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { placeOffered } from "@/lib/place";
import { isOwnerOrAdmin, readSessionState } from "@/lib/session";
import { TeamCanvas } from "./TeamCanvas";
import { TeamDialog } from "./TeamDialog";
import { PluginTeamImportDialog } from "./PluginTeamImportDialog";
import { TeamMemoryDialog } from "./TeamMemoryDialog";
import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { ConfirmDialog } from "./ConfirmDialog";
import { DetailPanel } from "./DetailPanel";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";
import { t, activeLocale } from "@/lib/i18n";
import { CanvasComputers } from "./CanvasComputers";
import { PAGE_ACTION_BUTTON, PAGE_HEADER_BUTTON, PageHeader } from "./content-page";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import type { TeamComputer } from "../../shared/team-computer";
import { useMacInsetChrome } from "./DesktopCapabilities";
import { readableError } from "@/lib/plain-error";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { EMPTY_PERSONAL_SECTIONS, personalSectionNames, usePersonalSections, withPersonalSections } from "@/lib/personal-sections";
import { orderSectionTree, useSectionParents } from "@/lib/section-tree";
import { deleteTeam, moveBotToTeam, type TeamWriteContext } from "@/lib/team-writes";
import { viewerActorId } from "@/lib/viewer";

/** One hand-off between two bots. It opens the thread doing the work, the
 * room it ran in, or else the bot it went to, as its own row would. */
export function EdgeRow({ edge, bots }: { edge: TeamMapEdge; bots: Bot[] }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const source = bots.find((bot) => bot.id === edge.sourceBotId);
  const target = bots.find((bot) => bot.id === edge.targetBotId);
  if (!source || !target) return null;
  const live = edge.state !== "connected";
  return (
    <button
      onClick={() => {
        if (!edge.groupId && edge.threadId) openThread(dispatch, { botId: target.id, threadId: edge.threadId }, state, showThreads);
        else if (edge.groupId) dispatch({ type: "select", id: edge.groupId });
        else openBot(dispatch, target, showThreads);
      }}
      className="flex w-full items-center gap-3 rounded-xl border border-hairline/40 bg-card px-3 py-2.5 text-left transition hover:bg-raised/50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-ink">{source.name}</span>
        <ArrowRight size={13} className={cn("shrink-0", live ? "text-accent" : "text-ink-secondary")} />
        <span className="truncate text-[13px] font-medium text-ink">{target.name}</span>
      </div>
      {edge.reason && <span className="max-w-[220px] truncate text-[11.5px] text-ink-secondary">{edge.reason}</span>}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
          edge.state === "running"
            ? "bg-accent/15 text-accent-text"
            : edge.state === "queued"
              ? "bg-accent/15 text-accent-text"
              : "bg-control text-ink-secondary",
        )}
      >
        {edge.state === "running" ? "Running" : edge.state === "queued" ? "Queued" : edge.lastAt ? formatTime(edge.lastAt) : "Connected"}
      </span>
    </button>
  );
}

interface SectionContextResponse {
  section: string;
  label: string;
  text: string;
  updatedAt: number | null;
  maxBytes: number;
}

/** Exported for tests. */
export function SectionContextDialog({ section, label, onClose }: { section: string; label: string; onClose: () => void }) {
  const confirm = useConfirm();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [maxBytes, setMaxBytes] = useState(24_000);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = text !== savedText;
  const bytes = useMemo(() => new TextEncoder().encode(text).byteLength, [text]);
  onCloseRef.current = onClose;
  savingRef.current = saving;
  dirtyRef.current = dirty;

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (!dirtyRef.current) {
      onCloseRef.current();
      return;
    }
    void confirm(discardConfirmRequest(t("team.instructionsDiscard"))).then((ok) => {
      if (ok) onCloseRef.current();
    });
  }, [confirm]);


  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api(`/api/section-context?section=${encodeURIComponent(section)}`)
      .then((result: SectionContextResponse) => {
        if (cancelled) return;
        setText(result.text);
        setSavedText(result.text);
        setUpdatedAt(result.updatedAt);
        setMaxBytes(result.maxBytes);
      })
      .catch((cause) => {
        if (!cancelled) setError(readableError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  const save = async () => {
    if (bytes > maxBytes) return;
    setSaving(true);
    setError(null);
    try {
      const result: SectionContextResponse = await api(
        `/api/section-context?section=${encodeURIComponent(section)}`,
        { method: "PUT", body: JSON.stringify({ text }) },
      );
      setSavedText(result.text);
      setText(result.text);
      setUpdatedAt(result.updatedAt);
      setMaxBytes(result.maxBytes);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setSaving(false);
    }
  };

  const title = t("team.instructionsTitle", { name: label });
  return (
    <DetailPanel
      label={title}
      title={
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <BookOpen size={16} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 truncate">{title}</span>
          </span>
          <span className="text-[12px] font-normal leading-relaxed text-ink-secondary">{t("team.instructionsHint")}</span>
        </span>
      }
      onClose={requestClose}
      closeLabel={t("team.instructionsClose")}
      data-section-context-panel=""
      footer={
        <>
          <button type="button" onClick={requestClose} disabled={saving} className={PILL}>{t("common.cancel")}</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !dirty || bytes > maxBytes}
            className={cn(PRIMARY_PILL, "gap-2")}
          >
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {t("team.instructionsSave")}
          </button>
        </>
      }
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="outline-none"
        onKeyDown={(event) => {
          // DetailPanel closes on Escape; claim it first when unsaved so we can ask.
          if (event.key !== "Escape" || event.defaultPrevented || savingRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }}
      >
        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-ink-secondary">
            <Loader2 size={20} className="animate-spin" aria-label={t("team.instructionsLoading")} />
          </div>
        ) : (
          <MarkdownEditor
            value={text}
            onChange={setText}
            autoFocus
            minHeight={280}
            dataField="team-instructions"
            placeholder={"Goals\n- Ship the Windows onboarding refresh\n\nDecisions\n- Keep customer data local\n\nPreferences\n- Use concise weekly updates"}
            ariaLabel={title}
            invalid={bytes > maxBytes}
            footer={
              <span>
                {t("teamMap.memoryFooter")}
                {updatedAt ? ` ${t("teamMap.lastSaved", { when: new Date(updatedAt).toLocaleString(activeLocale()) })}` : ""}{" "}
                <span className={cn("tabular-nums", bytes > maxBytes && "text-danger")}>
                  {bytes.toLocaleString()} / {maxBytes.toLocaleString()} bytes
                </span>
              </span>
            }
          />
        )}
        {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
      </div>
    </DetailPanel>
  );
}

export function TeamMapPage() {
  const { state, dispatch } = useStore();
  const { dragProps, controlsShiftStyle } = useCaptionChrome();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  // Pulsatrix Light's navy top band mirrors the sidebar's own macOS-inset
  // strip, so the two stay vertically aligned; every other skin ignores it.
  const { macInset, browser } = useMacInsetChrome();
  const [snapshot, setSnapshot] = useState<TeamMapSnapshot>(EMPTY_TEAM_MAP_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [contextEditor, setContextEditor] = useState<{ section: string; label: string } | null>(null);
  const [memoryEditor, setMemoryEditor] = useState<{ section: string; label: string } | null>(null);
  const [teamEditor, setTeamEditor] = useState<{ section?: string; rename?: boolean } | null>(null);
  const [pluginImport, setPluginImport] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState<string | null>(null);
  const [computersOpen, setComputersOpen] = useState(false);
  const [createComputerRequest, setCreateComputerRequest] = useState(0);
  const [computers, setComputers] = useState<TeamComputer[]>([]);
  const [computerDrop, setComputerDrop] = useState<{ id: string; section: string } | null>(null);
  const clearComputerDrop = useCallback(() => setComputerDrop(null), []);
  const [pendingMove, setPendingMove] = useState<{ bot: Bot; destination: string; resolve: (moved: boolean) => void } | null>(null);
  // null until the session answers: never flash Create team at a member on solo.
  const [manageTeams, setManageTeams] = useState<boolean | null>(null);
  const [adminTeams, setAdminTeams] = useState(false);
  // Computers panel: the person's own enrolled hosts and teams, no admin.
  const [ownComputers, setOwnComputers] = useState(false);
  const pendingMoveRef = useRef(pendingMove);
  pendingMoveRef.current = pendingMove;
  useEffect(() => () => pendingMoveRef.current?.resolve(false), []);
  // #2045: on an organization server the teams are the person's own sidebar
  // sections. They create, fill, nest and delete them without any admin
  // right. The Computers panel is theirs too (their own Unattended Remote
  // Control hosts, /api/remote-hosts, scoped to the person); only the
  // server-wide cloud team computers and the Local VM stay with the admins.
  const orgMode = usePerspicaxOrg() !== null;
  useEffect(() => {
    if (remoteClient) {
      setManageTeams(false);
      setAdminTeams(false);
      setOwnComputers(false);
      return;
    }
    let alive = true;
    void readSessionState()
      .then((session) => {
        if (!alive) return;
        setManageTeams(canManageTeamMap(session, false, orgMode));
        setAdminTeams(isOwnerOrAdmin(session));
        setOwnComputers(session.kind === "session" || (session.kind === "loopback" && session.trust !== "service"));
      })
      .catch(() => {
        if (!alive) return;
        setManageTeams(false);
        setAdminTeams(false);
        setOwnComputers(false);
      });
    return () => { alive = false; };
  }, [remoteClient, orgMode]);
  const personalStored = usePersonalSections();
  const personal = orgMode ? personalStored ?? EMPTY_PERSONAL_SECTIONS : null;
  const sectionParents = useSectionParents();
  const viewerId = viewerActorId(state.config);
  const canEditTeams = manageTeams === true;
  const laidOut = useMemo(() => personal ? withPersonalSections(state.bots, state.groups, personal) : { bots: state.bots, groups: state.groups }, [personal, state.bots, state.groups]);
  const bots = useMemo(() => laidOut.bots.filter((bot) => !bot.hidden), [laidOut.bots]);
  const sections = useMemo(() => {
    const names = personal
      ? personalSectionNames(personal)
      // #2045: an organization room (it carries ownerId) never adds a team
      // name; the server's list is already the viewer's own teams.
      : [...new Set([...(state.sections ?? []), ...state.groups.flatMap((group) => group.section && group.ownerId === undefined ? [group.section] : [])])];
    const rows = orderSectionTree(names, sectionParents);
    const place = new Map(rows.map((row, index) => [row.name, { index, row }]));
    // Nest and sort by the displayed team name. A collision split may use a
    // sectionId as `key` (#2083); the parent tree still names teams by label.
    const order = (section: { key: string; name: string }) => {
      if (!section.key) return -1;
      return place.get(section.name)?.index ?? place.get(section.key)?.index ?? rows.length;
    };
    return buildTeamMapSections(bots, names, { viewerId: orgMode ? viewerId : undefined })
      .map((section) => {
        const row = place.get(section.name)?.row ?? place.get(section.key)?.row;
        return row && row.depth > 0 ? { ...section, depth: row.depth, parent: row.parent } : section;
      })
      .sort((a, b) => order(a) - order(b));
  }, [bots, personal, sectionParents, state.sections, state.groups, viewerId, orgMode]);
  const writeContext: TeamWriteContext = { orgMode, dispatch, viewerId, bots: state.bots, serverSections: state.sections ?? [] };
  const edges = useMemo(() => buildTeamMapEdges(bots, snapshot), [bots, snapshot]);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await api("/api/team-map"));
      setRefreshError(null);
    } catch (requestError) {
      setRefreshError(teamMapMutationError(requestError));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const moveBot = async (bot: Bot, destination: string) => {
    setError(null);
    try {
      const refused = await moveBotToTeam(writeContext, bot.id, destination);
      if (refused) throw new Error(refused);
    } catch (cause) {
      setError(teamMapMutationError(cause));
      throw cause;
    }
  };

  const requestMove = (bot: Bot, destination: string) => new Promise<boolean>((resolve) => {
    pendingMoveRef.current?.resolve(false);
    setPendingMove({ bot, destination, resolve });
  });
  const cancelMove = useCallback(() => {
    pendingMoveRef.current?.resolve(false);
    setPendingMove(null);
  }, []);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      {(macInset || browser) && <div className="content-topbar-strip" />}
      <PageHeader
        name="team-map"
        icon={Network}
        title={t("sidebar.nav.teamMap")}
        count={teamMapBotCount(bots.length)}
        subtitle={t("canvas.description")}
        {...dragProps}
        topbar
        actionsStyle={controlsShiftStyle}
        actions={!remoteClient && <>
          {ownComputers && <button onClick={() => setComputersOpen((value) => !value)} aria-label={t("settings.group.computers")} aria-expanded={computersOpen} className={PAGE_HEADER_BUTTON}><Monitor size={16} /></button>}
          {(canEditTeams || ownComputers) && <details className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => {
            if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); }
          }}>
            <summary aria-label={t("teamMap.addAria")} className={PAGE_ACTION_BUTTON}><Plus size={15} /> {t("common.add")}</summary>
            <div className="absolute right-0 top-full z-40 mt-2 flex w-52 min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]" onClick={(event) => {
              const details = event.currentTarget.closest("details"); details?.querySelector("summary")?.focus(); details?.removeAttribute("open");
            }}>
              {canEditTeams && <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover" onClick={() => setTeamEditor({})}><Users size={16} />{t("team.create")}</button>}
              {canEditTeams && <button data-team-map-import-plugin="" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover" onClick={() => { setTeamEditor(null); setPluginImport(true); }}><Puzzle size={16} />{t("pluginTeam.menu")}</button>}
              {ownComputers && <button data-team-map-unattended="" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover" onClick={() => { setComputersOpen(true); setCreateComputerRequest((value) => value + 1); }}><MonitorSmartphone size={16} />{t("teamMap.unattendedComputer")}</button>}
              {/* An OMB Cloud home has no Local VM (shared/cloud-home.ts). */}
              {adminTeams && placeOffered("vm", state.config) && <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover" onClick={() => dispatch({ type: "toggleAppSettings", section: "computer", open: true })}><Monitor size={16} />{t("teamMap.localVm")}</button>}
            </div>
          </details>}
        </>}
      />
      <div className="content-card-body flex min-h-0 flex-1 flex-col">
      {manageTeams === false && !orgMode && !remoteClient && <p data-team-map-admin-only className="shrink-0 border-b border-hairline/40 bg-panel px-6 py-2 text-[12px] text-ink-secondary">{t("team.adminOnly")}</p>}
      {(error || refreshError) && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/20 bg-danger/10 px-6 py-2 text-[12px] text-danger">
        {error || refreshError}
        <button aria-label={t("common.close")} className="rounded p-1 hover:bg-danger/10" onClick={() => { setError(null); setRefreshError(null); }}><X size={14} /></button>
      </div>}
      <div className="relative flex min-h-0 flex-1">
      <TeamCanvas sections={sections} canManage={canEditTeams} onMove={requestMove}
        connectedBotIds={state.settingsOpen ? edges.flatMap((edge) => edge.sourceBotId === state.selectedId ? [edge.targetBotId] : edge.targetBotId === state.selectedId ? [edge.sourceBotId] : []) : []}
        onComputer={(bot) => dispatch({ type: "toggleSettings", botId: bot.id, section: "access", open: true })}
        teamComputers={Object.fromEntries(computers.filter((computer) => computer.section !== null).map((computer) => [computer.section!, { name: computer.name, state: computer.state }]))}
        onTeamComputer={() => setComputersOpen(true)}
        onComputerDrop={(id, section) => { if (ownComputers) { setComputersOpen(true); setComputerDrop({ id, section }); } }}
        onInstructions={(section, label) => setContextEditor({ section, label })}
        onMemory={(section, label) => setMemoryEditor({ section, label })}
        onEditTeam={(section, rename) => setTeamEditor({ section, rename })}
        onDeleteTeam={setDeletingTeam}
        isEmpty={(key) => ![...laidOut.bots, ...laidOut.groups].some((record) => record.section?.trim() === key)} />
      {ownComputers && <CanvasComputers cloud={adminTeams} open={computersOpen} createRequest={createComputerRequest} drop={computerDrop} sections={sections}
        onClose={() => setComputersOpen(false)} onDropHandled={clearComputerDrop} onChange={setComputers} />}
      </div>
      {edges.length > 0 && <details className="shrink-0 border-t border-hairline/40 bg-panel px-6 py-3">
        <summary className="cursor-pointer text-[12px] text-ink-secondary">{t("canvas.handoffs")} · {edges.length}</summary>
        <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">{edges.slice(0, 12).map((edge) => <EdgeRow key={`${edge.sourceBotId}:${edge.targetBotId}`} edge={edge} bots={bots} />)}</div>
      </details>}
      </div>
      {contextEditor && (
        <SectionContextDialog
          section={contextEditor.section}
          label={contextEditor.label}
          onClose={() => setContextEditor(null)}
        />
      )}
      {teamEditor && <TeamDialog {...teamEditor} onClose={() => setTeamEditor(null)} />}
      {pluginImport && !teamEditor && <PluginTeamImportDialog onClose={() => setPluginImport(false)} />}
      {memoryEditor && <TeamMemoryDialog key={memoryEditor.section} {...memoryEditor} onClose={() => setMemoryEditor(null)} />}
      <ConfirmDialog open={pendingMove !== null} tone="neutral" title={`Move ${pendingMove?.bot.name ?? "bot"} to ${pendingMove?.destination || t("sidebar.section.general")}?`}
        body="This changes the bot's home team and shared instructions, not just its position. Its conversations and model stay with it. To arrange visually, drag within the same team."
        confirmLabel="Move bot" onCancel={cancelMove} onConfirm={() => {
          const move = pendingMoveRef.current;
          if (!move) return;
          setPendingMove(null);
          void moveBot(move.bot, move.destination).then(() => move.resolve(true), () => move.resolve(false));
        }} />
      <ConfirmDialog open={deletingTeam !== null} title={t("team.deleteTitle", { name: deletingTeam ?? "" })}
        body={t("team.deleteKeepBotsDescription")}
        confirmLabel={t("team.delete")} onCancel={() => setDeletingTeam(null)} onConfirm={() => {
          const name = deletingTeam;
          setDeletingTeam(null);
          if (!name) return;
          void deleteTeam(writeContext, name).catch((cause) => setError(teamMapMutationError(cause)));
        }} />
    </main>
  );
}
