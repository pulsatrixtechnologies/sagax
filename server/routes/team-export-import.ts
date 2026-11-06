// Team export, scout and import (#1388 slice P1).
// Import is additive-only. Scout creates nothing. Export builds a shareable
// package, backup or legacy manifest from the caller's team.
import { MAX_TEAM_BACKUP_BYTES } from "../../shared/team-backup.ts";
import { validateBotCwd } from "../bots/bot-cwd.ts";
import {
  fetchBotDirectory,
  matchDirectoryBots,
  type MatchedDirectoryBot,
} from "../bots/bot-directory.ts";
import {
  isBotPackage,
  packageSummary,
  parsePackageDocument,
  renderBotPackageMarkdown,
  type PackageDocument,
} from "../bots/bot-package.ts";
import { parseVisibility, type BotVisibility } from "../bots/bot-visibility.ts";
import {
  createBotPackageExport,
  createLibraryPackageExport,
  createTeamPackageExport,
  TeamExportError,
  type TeamExportSkip,
} from "../packages/package-export.ts";
import {
  importPackageDocument,
  importTeamManifest,
  PackageImportError,
  type PackageImportDeps,
  type PackageImportResult,
} from "../packages/package-import.ts";
import { scoutProject, suggestTeam } from "../project-scout.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, GroupRecord } from "../store.ts";
import { createTeamManifest, parseTeamManifest } from "../team/team-manifest.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamExportImportRouteDeps {
  profileName(): string | undefined;
  bots(): readonly BotRecord[];
  groups(): readonly GroupRecord[];
  sections(): readonly string[];
  /** #2045: teams this caller may export (their own on an organization server). */
  sectionsFor?(auth: RequestAuth): readonly string[];
  sectionKey(section: string | undefined): string;
  listRoutines(): readonly unknown[];
  mcpServers(): Record<string, unknown>;
  readSectionContext(section: string): { text: string } | null | undefined;
  /** #2045: team brief for this caller's own section (owner/id key). */
  readSectionContextFor?(auth: RequestAuth, section: string): { text: string } | null | undefined;
  /** #2045: whether this bot belongs to the caller (org export packs only theirs). */
  ownsBot?(bot: BotRecord, auth: RequestAuth): boolean;
  readPublishedLibrary(): unknown;
  writePublishedLibrary(published: unknown): void;
  readPublishedTeam(team: string): unknown;
  writePublishedTeam(team: string, published: unknown): void;
  defaultsPresetFor(body: Record<string, unknown>, includeNotes: boolean): {
    preset: unknown;
    skipped: TeamExportSkip[];
  };
  collectTeamSkills(
    bots: readonly BotRecord[],
    selection: unknown,
  ): { ok: true; all: boolean; skillsByBot: Map<string, unknown[]>; skipped: TeamExportSkip[]; available: string[] }
    | { ok: false; error: string; available: string[] };
  starterNotes(botId: string): unknown;
  checkedExportSkillNames(
    value: unknown,
    bots: readonly BotRecord[],
  ): { ok: true; names: string[] } | { ok: false; error: string };
  collectExportSkills(
    bots: readonly BotRecord[],
    names: readonly string[],
  ): ReadonlyMap<string, readonly unknown[]>;
  createBackup(name: string): unknown;
  /** Scout directory fetch; override in tests. */
  fetchDirectory?: typeof fetchBotDirectory;
  scoutProject?: typeof scoutProject;
  /** Import path */
  isPerspicax(): boolean;
  creatingBotOwnerId(auth: RequestAuth): string;
  botCreationAllowed(auth: RequestAuth): boolean;
  personBotsReadOnly(principalId: string | undefined | null): boolean;
  botsReadOnlyRefusal(principalId: string | undefined | null): Record<string, unknown>;
  ownerChosenVisibility(auth: RequestAuth, visibility: BotVisibility): BotVisibility;
  memberImportReset(): Record<string, unknown>;
  defaultSelection(): Promise<unknown>;
  packageImportDeps(selection: unknown): PackageImportDeps;
  store: {
    bot(id: string): BotRecord | null | undefined;
    patchBot(id: string, patch: Record<string, unknown>): BotRecord | null | undefined;
    patchGroup(id: string, patch: Record<string, unknown>): GroupRecord | null | undefined;
  };
  importBackup(
    body: unknown,
    selection: unknown,
    options: { visibility?: BotVisibility; ownerUserId?: string; sectionChannels?: unknown },
  ): {
    bots: BotRecord[];
    groups: GroupRecord[];
    [key: string]: unknown;
  };
  sectionChannels: unknown;
  publicBot(bot: BotRecord): unknown;
  groupWithThread(group: GroupRecord): unknown;
  broadcast(frame: unknown): void;
  viewerForApproval(auth: RequestAuth): unknown;
  projectBotTranscript(bot: unknown, viewer: unknown): unknown;
  projectGroupTranscript(group: unknown, viewer: unknown): unknown;
}

export function createTeamExportImportRoutes(deps: TeamExportImportRouteDeps): RouteHandler {
  const fetchDirectory = deps.fetchDirectory ?? fetchBotDirectory;
  const scout = deps.scoutProject ?? scoutProject;

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (method === "POST" && path === "/api/teams/export") {
      // Pictures the Share dialog prepared ride this body, so it is larger
      // than the default JSON limit (the document itself is capped at 4 MB).
      const body = await readBody(req, 8 * 1024 * 1024) as Record<string, unknown>;
      const profileName = deps.profileName()?.trim();
      if (body.format === "package" && body.version === 2 && body.kind === "library") {
        // Preset bots and their skills, no team: my New bot defaults as a
        // preset someone else picks in New bot (presets.ts has the allowlist).
        const optional = (value: unknown) => (typeof value === "string" ? value : undefined);
        const built = deps.defaultsPresetFor(body, body.includeMemory === true);
        try {
          const exported = createLibraryPackageExport({
            name: optional(body.name),
            tagline: optional(body.tagline),
            summary: optional(body.summary),
            release: optional(body.release),
            notes: optional(body.notes),
            authorName: profileName,
            published: deps.readPublishedLibrary() as never,
            preset: built.preset as never,
            skipped: built.skipped,
          });
          if (body.dryRun !== true) deps.writePublishedLibrary(exported.published);
          return json(res, 200, {
            document: exported.document,
            filename: exported.filename,
            redacted: exported.redacted,
            skipped: exported.skipped,
            summary: packageSummary(exported.document),
          });
        } catch (error) {
          if (error instanceof TeamExportError) return json(res, error.status, { error: error.message });
          throw error;
        }
      }
      if (body.format === "package" && body.version === 2) {
        // One team, whole, except its chat history (package format v2).
        if (typeof body.team !== "string") return json(res, 400, { error: "Choose a team to share." });
        const team = body.team.trim();
        // #2045: only this person's teams and bots. Another person's same
        // display name is invisible here (404), never packed into the file.
        const listed = deps.sectionsFor?.(auth) ?? deps.sections();
        const own = (bot: BotRecord) => !deps.ownsBot || deps.ownsBot(bot, auth);
        const ownBots = deps.bots().filter((bot) => own(bot));
        if (team && !listed.includes(team) && !ownBots.some((bot) => deps.sectionKey(bot.section) === team)) {
          return json(res, 404, { error: "That team no longer exists." });
        }
        const optional = (value: unknown) => (typeof value === "string" ? value : undefined);
        const teamBots = ownBots.filter((bot) => !bot.hidden && deps.sectionKey(bot.section) === team);
        const skills = deps.collectTeamSkills(teamBots, body.skills);
        if (!skills.ok) return json(res, 400, { error: skills.error, choices: { skills: skills.available } });
        const avatars = body.avatars && typeof body.avatars === "object" && !Array.isArray(body.avatars)
          ? body.avatars as Record<string, unknown>
          : undefined;
        // Off unless asked: New bot defaults are personal until shared.
        const defaults = body.includeDefaultsPreset === true ? deps.defaultsPresetFor(body, body.includeMemory === true) : null;
        const ownBotIds = new Set(ownBots.map((bot) => bot.id));
        const ownGroups = deps.groups().filter((group) =>
          !group.dm && !group.peopleDm
          && deps.sectionKey(group.section) === team
          && (group.memberIds ?? []).every((id) => ownBotIds.has(id)));
        const ownRoutines = deps.listRoutines().filter((routine) => {
          const botId = (routine as { botId?: unknown }).botId;
          return typeof botId === "string" && ownBotIds.has(botId);
        });
        try {
          const exported = createTeamPackageExport({
            team,
            name: optional(body.name),
            tagline: optional(body.tagline),
            summary: optional(body.summary),
            release: optional(body.release),
            notes: optional(body.notes),
            authorName: profileName,
            bots: ownBots as never,
            groups: ownGroups as never,
            routines: ownRoutines as never,
            brief: (deps.readSectionContextFor?.(auth, team) ?? deps.readSectionContext(team))?.text,
            published: deps.readPublishedTeam(team) as never,
            skillsByBot: skills.skillsByBot as never,
            skillSelection: skills.all ? "all" : "chosen",
            memoryByBot: body.includeMemory === true
              ? new Map(teamBots.map((bot) => [bot.id, deps.starterNotes(bot.id)])) as never
              : undefined,
            avatars,
            mcpServers: deps.mcpServers() as never,
            skipped: [...skills.skipped, ...(defaults?.skipped ?? [])],
            preset: (defaults?.preset ?? null) as never,
          });
          // A preview (the dialog's live counts) never records keys; saving
          // the file does, so renaming anything later keeps its identity.
          if (body.dryRun !== true) deps.writePublishedTeam(team, exported.published);
          return json(res, 200, {
            document: exported.document,
            filename: exported.filename,
            redacted: exported.redacted,
            skipped: exported.skipped,
            summary: packageSummary(exported.document),
            choices: { skills: skills.available },
          });
        } catch (error) {
          if (error instanceof TeamExportError) {
            return json(res, error.status, { error: error.message, choices: { skills: skills.available } });
          }
          throw error;
        }
      }
      const name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : profileName
            ? `${profileName}'s Team`
            : "My Sagax Team";
      const memberIds = deps.bots().filter((bot) => !bot.hidden).map((bot) => bot.id);
      if ((body.format === "backup" ? deps.bots().length : memberIds.length) === 0) {
        return json(res, 400, { error: "Create a bot before exporting your team" });
      }
      try {
        if (body.format === "backup") {
          return json(res, 200, deps.createBackup(name));
        }
        if (body.format === "package") {
          const selectedBots = deps.bots().filter((bot) => !bot.hidden);
          const skillNames = deps.checkedExportSkillNames(body.skillIds, selectedBots);
          if (!skillNames.ok) return json(res, 400, { error: skillNames.error });
          const document = createBotPackageExport({
            name,
            authorName: profileName,
            bots: selectedBots as never,
            groups: deps.groups() as never,
            routines: deps.listRoutines() as never,
            skillsByBot: deps.collectExportSkills(selectedBots, skillNames.names) as never,
          });
          return json(res, 200, {
            name: document.package.name,
            members: document.package.agents.length,
            markdown: renderBotPackageMarkdown(document),
          });
        }
        return json(
          res,
          200,
          createTeamManifest(
            {
              name,
              memberIds,
            },
            deps.bots() as never,
          ),
        );
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "Team could not be exported" });
      }
    }

    if (method === "GET" && path === "/api/teams/scout") {
      // The scout reads a folder and answers with a suggestion — it creates
      // nothing. Bots and the room come into being only when the human sends
      // the suggested manifest through /api/teams/import, so "the agent
      // proposes, the person imports" is enforced by the route split itself.
      // The folder is whatever validateBotCwd accepts: the same local-user
      // trust boundary as pointing any bot's working folder at a path.
      // Deliberately offline — the community directory lives on its own
      // route below, so a slow network can never delay the suggestion.
      const validated = validateBotCwd(url.searchParams.get("cwd"));
      if (!validated.ok) return json(res, 400, { error: validated.error });
      if (!validated.cwd) return json(res, 400, { error: "scout needs a folder to read" });
      const profile = scout(validated.cwd);
      return json(res, 200, { profile, suggestion: suggestTeam(profile) });
    }
    if (method === "GET" && path === "/api/teams/scout/directory") {
      // Community bots that fit the scouted folder — a separate, lazy call
      // so an unreachable directory degrades to "no extra candidates", never
      // to a broken scout.
      const validated = validateBotCwd(url.searchParams.get("cwd"));
      if (!validated.ok) return json(res, 400, { error: validated.error });
      if (!validated.cwd) return json(res, 400, { error: "scout needs a folder to read" });
      let directory: MatchedDirectoryBot[] = [];
      try {
        directory = matchDirectoryBots(scout(validated.cwd), await fetchDirectory());
      } catch (error) {
        // an unreachable directory is a fact of life, not an error — but an
        // empty section should still be diagnosable from the server log
        console.warn("bot directory lookup failed:", error instanceof Error ? error.message : String(error));
      }
      return json(res, 200, { directory });
    }

    if (method === "POST" && path === "/api/teams/import") {
      // Import is additive-only. A manifest is untrusted input (catalog,
      // GitHub, a shared file), so it must be structurally unable to reach
      // records the user already has: every member becomes a NEW bot with a
      // fresh id — a manifest cannot name, update, or merge into an existing
      // bot or room. Repeated imports create freshly numbered copies.
      const importMode = url.searchParams.get("mode") ?? "add";
      if (importMode === "replace") {
        return json(res, 400, { error: "Replacing your team is no longer supported. Reopen Import in the updated app to add bots alongside your existing conversations." });
      }
      if (importMode !== "add" && importMode !== "project") {
        return json(res, 400, { error: "Team import mode must be add or project" });
      }
      // 2026-10-26: a person who may create bots imports a team file for
      // themselves (request-auth.ts lets a member's session in). Like a zip
      // import, every bot is theirs and starts from a member's defaults
      // (memberImportReset); who sees them is the member's to choose
      // (#1098, 2026-10-27); a folder of the server, a backup restore and
      // the server's MCP list stay an admin's.
      const memberImport = auth.kind === "session" && !auth.scopes.includes("admin");
      const memberOwner = memberImport ? deps.creatingBotOwnerId(auth) : "";
      if (memberImport) {
        if (!deps.botCreationAllowed(auth) || !memberOwner) {
          if (deps.personBotsReadOnly(auth.session.principalId)) {
            return json(res, 403, deps.botsReadOnlyRefusal(auth.session.principalId));
          }
          return json(res, 403, { error: "forbidden: only a member of the organization can import bots", code: "import_bots_members_only" });
        }
        if (url.searchParams.get("cwd") !== null) {
          return json(res, 403, { error: "Choosing a folder of the server for imported bots stays an admin's.", code: "admin_only" });
        }
      }
      // `project` adds the team AND opens a caller-owned room on a folder.
      // Legacy team manifests remain people-only. Full bot packages may add
      // their own new rooms, but neither format can point at an existing room
      // or choose a local folder; workspace access always comes from this
      // explicit caller parameter.
      let projectCwd: string | null = null;
      if (importMode === "project") {
        const requested = url.searchParams.get("cwd");
        if (requested !== null) {
          const validated = validateBotCwd(requested);
          if (!validated.ok) return json(res, 400, { error: validated.error });
          projectCwd = validated.cwd;
        }
      }
      // Who may see the imported bots, from their first moment: the choice
      // of the admin or of the member importing their own bots (#1098;
      // ?visibility=admins, or a JSON value), never the file's.
      const rawVisibility = url.searchParams.get("visibility");
      let importVisibility: BotVisibility | undefined;
      if (rawVisibility !== null) {
        let value: unknown = rawVisibility;
        if (rawVisibility.trim().startsWith("{")) {
          try {
            value = JSON.parse(rawVisibility);
          } catch {
            /* parseVisibility refuses the raw text with a plain sentence */
          }
        }
        const parsed = parseVisibility(value);
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        importVisibility = deps.ownerChosenVisibility(auth, parsed.visibility);
      }
      const body = await readBody(req, MAX_TEAM_BACKUP_BYTES);
      if ((body as { format?: unknown } | null)?.format === "openmaus.backup") {
        if (memberImport) {
          return json(res, 403, { error: "Restoring a backup stays an admin's. Import a bot or a team file instead.", code: "admin_only" });
        }
        if (importMode !== "add") {
          return json(res, 400, { error: "Import backups alongside your existing bots; project mode is only for templates" });
        }
        try {
          // Organization server (slice 8, D7): no ownerless bots. The
          // caller owns every bot, and the sections the import creates are
          // their private sections.
          const orgOwner = deps.isPerspicax() ? deps.creatingBotOwnerId(auth) : "";
          const imported = deps.importBackup(body, await deps.defaultSelection(), {
            visibility: importVisibility,
            ...(orgOwner ? { ownerUserId: orgOwner, ...(deps.sectionChannels ? { sectionChannels: deps.sectionChannels } : {}) } : {}),
          });
          // A restore writes its transcripts without store events, after the
          // store's own frames announced each bot and room, so these frames
          // are what carries the restored pages to other clients.
          const bots = imported.bots.map((bot) => deps.publicBot(bot));
          const groups = imported.groups.map((group) => deps.groupWithThread(group));
          for (const bot of bots) deps.broadcast({ kind: "bot", bot });
          for (const group of groups) deps.broadcast({ kind: "group", group });
          const approvalViewer = deps.viewerForApproval(auth);
          return json(res, 201, {
            ...imported,
            bots: bots.map((bot) => deps.projectBotTranscript(bot, approvalViewer)),
            groups: groups.map((group) => deps.projectGroupTranscript(group, approvalViewer)),
          });
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "Backup could not be imported" });
        }
      }
      // Every package (v1 JSON, BotMRR Markdown, v2) is read by the one shared
      // parser as a FILE: it cannot claim a publisher, and its skills and
      // routines arrive off. A body field such as `trust` is just an unknown
      // field of the document and is stripped; only the organization library
      // module ever imports with trust "org".
      let packageDocument: PackageDocument | null = null;
      let manifest: ReturnType<typeof parseTeamManifest> | null = null;
      try {
        if (isBotPackage(body)) packageDocument = parsePackageDocument(body, { trust: "file" });
        else manifest = parseTeamManifest(body);
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "Invalid bot package" });
      }
      const baseDeps = deps.packageImportDeps(await deps.defaultSelection());
      // a member's file adds no server to the server's MCP list
      const importDeps: PackageImportDeps = memberImport
        ? { ...baseDeps, mcp: { ...baseDeps.mcp, refusal: () => "A member's import adds no server to the server's MCP list" } }
        : baseDeps;
      const options = {
        mode: importMode as "add" | "project",
        cwd: projectCwd,
        room: url.searchParams.get("room") ?? undefined,
        ...(importVisibility ? { visibility: importVisibility } : {}),
      };
      let imported: PackageImportResult;
      try {
        const result = packageDocument
          ? importPackageDocument(packageDocument, { ...options, trust: "file" }, importDeps)
          : importTeamManifest(manifest!, options, importDeps);
        // A file import always gets a fresh install id, so it never reports
        // "already added"; that answer belongs to the organization library.
        if (result.alreadyAdded) return json(res, 200, result);
        imported = result;
      } catch (error) {
        if (error instanceof PackageImportError) return json(res, error.status, { error: error.message, code: error.code });
        throw error;
      }
      if (memberImport) {
        for (const bot of imported.bots) {
          const patched = deps.store.patchBot(bot.id, { ownerUserId: memberOwner, ...deps.memberImportReset() });
          if (patched) deps.broadcast({ kind: "bot", bot: deps.publicBot(patched) });
        }
        for (const created of [...imported.groups, ...(imported.group ? [imported.group] : [])]) {
          deps.store.patchGroup(created.id, { createdBy: memberOwner });
        }
      }
      return json(res, 201, {
        name: imported.name,
        section: imported.section,
        bots: imported.bots.map((bot) => deps.projectBotTranscript(deps.publicBot(deps.store.bot(bot.id) ?? bot), deps.viewerForApproval(auth))),
        group: imported.group,
        groups: imported.groups.map((created) => ({ ...created, messages: [] })),
        routines: imported.routines,
        offeredSkills: imported.offeredSkills,
        connections: imported.connections,
        skipped: imported.skipped,
        brief: imported.brief,
        notes: imported.notes,
        presets: imported.presets ?? [],
      });
    }

    return PASS;
  };
}

