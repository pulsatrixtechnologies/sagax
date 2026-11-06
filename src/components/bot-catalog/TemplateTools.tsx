// Browse Bots > Templates, the tools that used to be tabs of the Templates
// library: Import (a backup or team file, a GitHub link, an install link),
// Import from zip (one bot, whole: src/components/BotZipImport.tsx), From a
// folder (the project scout) and Share a team. Each preview shows
// everything an import adds before anything is added, then adds it the way
// the library did (POST /api/teams/import?mode=add, or ?mode=project for a
// scouted folder). TeamImportPreview is also the community template's
// "Use this template" step in the catalogue's detail view.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Loader2, Share2, UploadCloud } from "lucide-react";

import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { scrollTabsWithWheel } from "@/lib/tab-wheel-scroll";
import type { LocaleKey } from "@/locales";
import type { Routine } from "@/lib/routines";
import { teamImportPreview, type PendingTeamImport } from "@/lib/team-import";
import { isGrokExport } from "../../../shared/grok-import";
import { grokPreviewFrom } from "../GrokImportBox";
import { api, useStore, type Bot, type Group } from "@/state/store";
import { MAX_TEAM_BACKUP_BYTES } from "../../../shared/team-backup";
import { takeImportName } from "../../../shared/import-name";
import { Github } from "../brand-icons";
import { ShareTeamDialog } from "../ShareTeamDialog";
import { BotZipImportPanel } from "../BotZipImport";
import { shareableTeamList, TeamGlyph, TeamImportDetails, type TeamImportResult } from "./TeamImportDetails";
import { readableError } from "@/lib/plain-error";
import { TemplateScoutPanel, type DirectoryCandidate, type ScoutResult } from "./TemplateScoutPanel";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { EMPTY_PERSONAL_SECTIONS, personalSectionNames, usePersonalSections } from "@/lib/personal-sections";
import { viewerActorId } from "@/lib/viewer";
import { viewerOwnBots, viewerOwnTeamNames } from "@/lib/viewer-teams";

export type TemplateTool = "import" | "zip" | "scout" | "share";
export const TEMPLATE_TOOLS: readonly TemplateTool[] = ["import", "zip", "scout", "share"];
export const TEMPLATE_TOOL_LABEL: Record<TemplateTool, LocaleKey> = {
  import: "botCatalog.tools.import",
  zip: "botZip.importFromZip",
  scout: "botCatalog.tools.scout",
  share: "botCatalog.tools.share",
};

/** Where an import came from, for analytics (as the library reported it). */
export type ImportSource = "library" | "file" | "github" | "grok";

/** appearance colors for community bots folded into a scouted team */
const DIRECTORY_COLORS = ["cyan", "red", "purple", "green", "orange"] as const;

/** A bot template's public link (…/share/template/<token>). Pure. */
export function isTemplateLink(value: string): boolean {
  return /^https?:\/\/[^\s]+\/share\/template\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{32}(?:\.json)?(?:[?#]\S*)?$/.test(value.trim());
}

export async function openExternal(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (opened) opened.opener = null;
}

const fieldCls = "min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";
const primaryCls = "flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-60";

function ErrorLine({ error }: { error: string }) {
  if (!error) return null;
  return <div role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>;
}

/** The line under a preview's name: what kind of file it is. */
export function previewSubtitle(pending: PendingTeamImport): string {
  if (pending.kind === "backup") {
    const bots = pending.members.length === 1 ? t("teamImport.botsOne") : t("teamImport.botsMany", { count: pending.members.length });
    const conversations = pending.conversations === 1 ? t("teamImport.conversationsOne") : t("teamImport.conversationsMany", { count: pending.conversations ?? 0 });
    return t("teamImport.backupSubtitleOne", { bots, conversations });
  }
  if (pending.kind === "package") {
    if (pending.library) return t("teamImport.library");
    if (pending.version === 2) return t("teamImport.sharedTeam", { count: pending.members.length });
    return t("teamImport.playbookSubtitle", { count: pending.members.length });
  }
  return t("teamImport.readySubtitle", { count: pending.members.length });
}

/** The preview of a team, a backup or a library package, and its Add
 * button: the old library's Load > Add team step. */
export function TeamImportPreview({ pending, source, onImported }: {
  pending: PendingTeamImport;
  source: ImportSource;
  onImported: (result: TeamImportResult) => void;
}) {
  const { state, dispatch } = useStore();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const currentBotCount = state.bots.filter((bot) => !bot.hidden).length;
  const takenNames = new Set(state.bots.map((bot) => bot.name.trim().toLowerCase()));
  const importedNames = pending.members.map((member) => takeImportName(member.name, takenNames));

  const importTeam = async () => {
    setImporting(true);
    setError("");
    try {
      // SAFETY: this endpoint is owned by the app and returns imported bots.
      const response = (await api("/api/teams/import?mode=add", {
        method: "POST",
        body: JSON.stringify(pending.manifest),
      })) as { bots: Bot[]; groups?: Group[]; routines?: Routine[]; connections?: unknown[]; presets?: unknown[] };
      for (const bot of response.bots) dispatch({ type: "botAdded", bot });
      for (const group of response.groups ?? []) dispatch({ type: "groupPatched", group });
      for (const routine of response.routines ?? []) dispatch({ type: "routinePatched", routine });
      const first = response.bots.find((bot) => !bot.hidden);
      if (first) dispatch({ type: "select", id: first.id });
      track("team_imported", { members: response.bots.length, source, mode: "add", format: pending.kind });
      onImported({
        name: pending.name,
        members: response.bots.length,
        ...(response.connections?.length ? { connections: response.connections.length } : {}),
        ...(response.presets?.length ? { presets: response.presets.length } : {}),
      });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div data-template-preview="">
      <TeamImportDetails pending={pending} importedNames={importedNames} />
      <ErrorLine error={error} />
      <div className="mt-5 flex flex-col gap-3 border-t border-hairline/35 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[12.5px] text-ink-secondary">
          {currentBotCount > 0 ? t("botCatalog.preview.existing", { count: currentBotCount }) : t("botCatalog.preview.existingNone")}
          {" "}{pending.kind === "backup"
            ? t("teamImport.backupCopies")
            : pending.library
            ? t("teamImport.libraryAdds")
            : pending.members.length === 0
            ? ""
            : t("teamImport.newSection", { name: pending.teamName ?? pending.name })}
        </div>
        <button type="button" onClick={() => void importTeam()} disabled={importing} data-template-add="" className={primaryCls}>
          {importing && <Loader2 size={15} className="animate-spin" />}
          {importing
            ? t("botCatalog.preview.adding")
            : pending.kind === "backup" ? t("botCatalog.preview.addBackup") : pending.library ? t("teamImport.addPresets") : t("botCatalog.preview.addTeam")}
        </button>
      </div>
    </div>
  );
}

export interface TemplateToolsProps {
  tool: TemplateTool;
  onTool: (tool: TemplateTool) => void;
  /** An install link to load into Import at once. */
  installUrl?: string;
  onImported: (result: TeamImportResult) => void;
  /** The modal's Escape and Back ask here first: true when a preview closed. */
  backRef: MutableRefObject<(() => boolean) | null>;
}

export function TemplateTools({ tool, onTool, installUrl, onImported, backRef }: TemplateToolsProps) {
  const { state, dispatch } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingTeamImport | null>(null);
  const [source, setSource] = useState<ImportSource>("file");
  const [githubUrl, setGithubUrl] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [scoutFolder, setScoutFolder] = useState("");
  const [scouting, setScouting] = useState(false);
  const [scouted, setScouted] = useState<ScoutResult | null>(null);
  // the folder the current `scouted` result was actually read from: the
  // import must pin the room to THIS, not to whatever the input says now
  const [scoutedFolder, setScoutedFolder] = useState("");
  // null = not asked yet or still loading; [] = asked, nothing (or offline)
  const [directory, setDirectory] = useState<DirectoryCandidate[] | null>(null);
  const [pickedDirectory, setPickedDirectory] = useState<Set<string>>(new Set());
  const [roomName, setRoomName] = useState("");
  const [creating, setCreating] = useState(false);
  // The team being shared. The popover anchors to that row's Share button.
  const [sharing, setSharing] = useState<string | null>(null);
  const shareAnchor = useRef<HTMLElement | null>(null);
  // monotonically increasing scout token: a late response from an older
  // scout (including its lazy directory call) must never overwrite state
  // that belongs to a newer one
  const scoutRequest = useRef(0);

  backRef.current = () => {
    if (!pending) return false;
    setPending(null);
    setError("");
    return true;
  };

  // #2045: Share a team lists only this person's teams and own bots.
  const orgMode = usePerspicaxOrg() !== null;
  const personal = usePersonalSections();
  const viewerId = viewerActorId(state.config);
  const ownTeamNames = viewerOwnTeamNames({
    orgMode,
    viewerId,
    personalNames: orgMode ? personalSectionNames(personal ?? EMPTY_PERSONAL_SECTIONS) : undefined,
    serverSections: state.sections ?? [],
    bots: state.bots,
    groups: state.groups,
  });
  const shareableTeams = shareableTeamList(ownTeamNames, viewerOwnBots(state.bots, viewerId));

  const preview = (next: PendingTeamImport, nextSource: ImportSource) => {
    setPending(next);
    setSource(nextSource);
    setError("");
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_TEAM_BACKUP_BYTES) throw new Error(t("templateTools.fileTooBig"));
    const raw = await file.text();
    let manifest: unknown = raw;
    // A shared the reference design's export (port of OpenMausBot #3073) becomes a package.
    if (isGrokExport(raw)) {
      preview(grokPreviewFrom(raw).pending, "grok");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".md")) {
      try {
        manifest = JSON.parse(raw);
      } catch (cause) {
        if (cause instanceof SyntaxError) throw new Error(t("templateTools.badJson"));
        throw cause;
      }
    }
    preview(teamImportPreview(manifest), "file");
  };

  const loadGithubUrl = useCallback(async (requestedUrl: string) => {
    if (!requestedUrl.trim()) return;
    setGithubLoading(true);
    setError("");
    try {
      // A bot template's public link (server/template-links.ts) is read
      // through its own route; anything else is a GitHub or install link.
      const manifest = isTemplateLink(requestedUrl)
        ? (await api<{ document: unknown }>("/api/template-links/import", { method: "POST", body: JSON.stringify({ url: requestedUrl.trim() }) })).document
        : await api("/api/team-library/github", {
          method: "POST",
          body: JSON.stringify({ url: requestedUrl.trim() }),
        });
      setPending(teamImportPreview(manifest));
      setSource("github");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setGithubLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!installUrl) return;
    setGithubUrl(installUrl);
    void loadGithubUrl(installUrl);
  }, [installUrl, loadGithubUrl]);

  const scoutTarget = scoutFolder.trim();

  const runScout = async (folder: string) => {
    const request = ++scoutRequest.current;
    setScouting(true);
    setError("");
    setScouted(null);
    setDirectory(null);
    setPickedDirectory(new Set());
    try {
      // SAFETY: this endpoint is owned by the app and returns ScoutResult.
      const result = (await api(`/api/teams/scout?cwd=${encodeURIComponent(folder)}`)) as ScoutResult;
      if (request !== scoutRequest.current) return;
      setScouted(result);
      setScoutedFolder(folder);
      setRoomName(result.suggestion.roomName);
      track("team_scouted", { signals: result.suggestion.manifest.team.members.length - 1 });
      // community candidates arrive lazily; an unreachable directory just
      // leaves this section empty
      void api(`/api/teams/scout/directory?cwd=${encodeURIComponent(folder)}`)
        // SAFETY: this endpoint is owned by the app and returns candidates.
        .then((extra) => {
          if (request === scoutRequest.current) setDirectory((extra as { directory: DirectoryCandidate[] }).directory);
        })
        .catch(() => {
          if (request === scoutRequest.current) setDirectory([]);
        });
    } catch (cause) {
      if (request !== scoutRequest.current) return;
      setError(readableError(cause));
    } finally {
      if (request === scoutRequest.current) setScouting(false);
    }
  };

  const pickScoutFolder = async () => {
    const chosen = await window.ogb?.pickFolder?.(scoutTarget || undefined);
    if (!chosen) return;
    setScoutFolder(chosen);
    await runScout(chosen);
  };

  const createProject = async () => {
    if (!scouted || creating) return;
    setCreating(true);
    setError("");
    try {
      // the confirmed suggestion, plus any community bots the user ticked,
      // folded in as ordinary manifest members so the import boundary
      // (persona only, no grants) applies to them like to everything else
      const extras = (directory ?? [])
        .filter((candidate) => pickedDirectory.has(candidate.slug))
        .map((candidate, index) => ({
          key: `dir-${candidate.slug}`,
          name: candidate.name,
          title: candidate.category || t("templateTools.communityBot"),
          description: candidate.prompt,
          appearance: { color: DIRECTORY_COLORS[index % DIRECTORY_COLORS.length] },
        }));
      const manifest = {
        ...scouted.suggestion.manifest,
        team: { ...scouted.suggestion.manifest.team, members: [...scouted.suggestion.manifest.team.members, ...extras] },
      };
      const room = roomName.trim() || scouted.suggestion.roomName;
      // SAFETY: this endpoint is owned by the app and returns imported bots.
      const response = (await api(
        `/api/teams/import?mode=project&cwd=${encodeURIComponent(scoutedFolder)}&room=${encodeURIComponent(room)}`,
        { method: "POST", body: JSON.stringify(manifest) },
      )) as { bots: Bot[]; group?: Group };
      for (const bot of response.bots) dispatch({ type: "botAdded", bot });
      if (response.group) {
        // upsert now instead of waiting for the SSE frame, then land in the room
        dispatch({ type: "groupPatched", group: { ...response.group, messages: [] } });
        dispatch({ type: "select", id: response.group.id });
      }
      track("team_imported", { members: response.bots.length, source: "scout", mode: "project" });
      onImported({ name: room, members: response.bots.length });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-template-tools={tool}>
      <div className="shrink-0 px-6 pt-2 sm:px-8">
        <div className="flex h-7 w-fit max-w-full items-center overflow-x-auto rounded-full bg-hover p-0.5" role="tablist" aria-label={t("botCatalog.tools.aria")} onWheel={scrollTabsWithWheel}>
          {TEMPLATE_TOOLS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tool === id}
              data-template-tool-tab={id}
              onClick={() => { setPending(null); setError(""); onTool(id); }}
              className={cn("h-full shrink-0 rounded-full px-3 text-[13px] text-ink-secondary transition-colors", tool === id ? "bg-app text-ink" : "hover:text-ink")}
            >
              {t(TEMPLATE_TOOL_LABEL[id])}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-7 pt-5 sm:px-8">
        {pending ? (
          <>
            <h3 className="text-[15px] font-semibold text-ink">{pending.name}</h3>
            <p className="mb-4 mt-0.5 text-[13px] text-ink-secondary">{previewSubtitle(pending)}</p>
            <TeamImportPreview pending={pending} source={source} onImported={onImported} />
          </>
        ) : null}

        {!pending && tool === "zip" && (
          <div data-template-tool-zip="">
            <p className="mb-3 text-[13px] text-ink-secondary">{t("botZip.templatesHint")}</p>
            <BotZipImportPanel onImported={(result) => onImported({ name: result.name, members: 1 })} />
          </div>
        )}

        {!pending && tool === "import" && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.json,.mausbackup.json,.mausteam.json,text/markdown,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (!file) return;
                void readFile(file).catch((cause) => setError(readableError(cause)));
              }}
            />
            <div className="mb-3 text-[12px] font-medium text-ink-secondary">{t("templateTools.byoTeam")}</div>
            <div className="grid gap-5 md:grid-cols-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void readFile(file).catch((cause) => setError(readableError(cause)));
                }}
                className={cn(
                  "flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center transition-colors",
                  dragging ? "border-accent bg-accent/5" : "border-hairline/60 bg-raised/20 hover:bg-raised/35",
                )}
              >
                <UploadCloud size={27} className="text-accent" />
                <span className="mt-3 text-[14px] font-medium text-ink">{t("templateTools.chooseFile")}</span>
                <span className="mt-1 text-[12.5px] text-ink-secondary">{t("templateTools.dropHelp")}</span>
              </button>

              <div className="flex min-h-56 flex-col justify-center rounded-2xl bg-raised/25 px-6">
                <Github size={25} className="text-ink-secondary" />
                <h3 className="mt-3 text-[14px] font-medium text-ink">{t("templateTools.loadGit")}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("templateTools.loadGitHelp")}</p>
                <p data-template-link-hint className="mt-1 text-[12px] leading-relaxed text-ink-tertiary">{t("templateLink.importHint")}</p>
                <div className="mt-4 flex gap-2">
                  <input
                    value={githubUrl}
                    onChange={(event) => setGithubUrl(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && void loadGithubUrl(githubUrl)}
                    placeholder="github.com/owner/repo"
                    aria-label={t("templateTools.gitUrl")}
                    className={fieldCls}
                  />
                  <button
                    type="button"
                    onClick={() => void loadGithubUrl(githubUrl)}
                    disabled={!githubUrl.trim() || githubLoading}
                    className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
                  >
                    {githubLoading && <Loader2 size={13} className="animate-spin" />}
                    Load
                  </button>
                </div>
              </div>
            </div>
            <ErrorLine error={error} />
          </div>
        )}

        {!pending && tool === "share" && (
          <div>
            <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-secondary">{t("teamLibrary.shareIntro")}</p>
            {shareableTeams.length === 0 ? (
              <p className="mt-6 text-[13px] text-ink-secondary">{t("teamLibrary.shareEmpty")}</p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-x-10 md:grid-cols-2">
                {shareableTeams.map((team, index) => (
                  <article key={team.name || "general"} className="flex min-h-[84px] items-center gap-3 border-b border-hairline/35 px-1 py-4">
                    <TeamGlyph index={index} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[14px] font-medium text-ink">{team.name || t("teamLibrary.general")}</h3>
                      <p className="mt-0.5 text-[12.5px] text-ink-secondary">{t("teamLibrary.shareBots", { count: team.bots })}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        shareAnchor.current = event.currentTarget;
                        setSharing(team.name);
                      }}
                      aria-label={t("teamLibrary.shareTeamAria", { name: team.name || t("teamLibrary.general") })}
                      className="ui-button"
                    >
                      <Share2 size={13} />
                      {t("teamLibrary.shareTeam")}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {!pending && tool === "scout" && (
          <TemplateScoutPanel
            scoutFolder={scoutFolder}
            setScoutFolder={setScoutFolder}
            scoutTarget={scoutTarget}
            scouting={scouting}
            scouted={scouted}
            directory={directory}
            pickedDirectory={pickedDirectory}
            setPickedDirectory={setPickedDirectory}
            roomName={roomName}
            setRoomName={setRoomName}
            creating={creating}
            error={error}
            pickScoutFolder={pickScoutFolder}
            runScout={runScout}
            createProject={createProject}
          />
        )}
      </div>
      <ShareTeamDialog
        key={sharing === null ? "share-team-closed" : `share-team:${sharing}`}
        open={sharing !== null}
        team={sharing ?? ""}
        anchorRef={shareAnchor}
        onClose={() => setSharing(null)}
      />
    </div>
  );
}
