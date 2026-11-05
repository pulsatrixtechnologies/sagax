/**
 * POST /api/bots (#1388 B1). Literal path, ahead of /api/bots/:id patterns.
 * Never imports server/index.ts.
 */
import { validateBotCwd } from "../bots/bot-cwd.ts";
import { parseBotProfilePatch } from "../bots/bot-profile.ts";
import { parseVisibility } from "../bots/bot-visibility.ts";
import { mcpServerNameError, MAX_MCP_SERVERS } from "../mcp/mcp-registry.ts";
import { MEMBER_AUTO_NOT_ALLOWED } from "../approvals/member-auto-approval.ts";
import { journalMemoryWrite } from "../memory/memory-journal.ts";
import { resolveBotCreationDefaults } from "../bots/new-bot-defaults.ts";
import { applyPresetToBot, presetOffered, PRESET_UNAVAILABLE_MESSAGE } from "../presets.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";
import { installOrgSkill, installSkill, setSkillEnabled } from "../skills/skills.ts";
import type { TemporaryAgent } from "../temporary-agents.ts";
import { writeMemoryFile, writeMemoryTopic } from "../workspace/workspace.ts";

import type { ModelSelection } from "../../shared/model-selection.ts";
import { permissionRefusal } from "../../shared/permissions.ts";
import { parseSkillMd } from "../../shared/skill-md.ts";

import { MAX_WORKSPACE_BOTS, type BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreCreateRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      cfg,
      wireBot,
      viewerForApproval,
      newBotApprovalMode,
      memberDefaultSelection,
      defaultSelection,
      takeTemporaryCreateToken,
      botCreationAllowed,
      personBotsReadOnly,
      botsReadOnlyRefusal,
      memberBotFieldRefusal,
      presetStore,
      orgInstallStatuses,
      requestedWorksOn,
      memberAutoRefused,
      creatingBotOwnerId,
      storedAvatarExists,
      personalProfileOf,
      memberFolderRefusal,
      memberFolderPrincipal,
      checkedModelSelection,
      hostedModels,
      ownerChosenVisibility,
      routines,
      projectBotTranscript,
    } = deps;
    const DESKTOP_MANAGED = deps.desktopManaged;

    if (method === "POST" && path === "/api/bots") {
      let body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "bot must be a JSON object" });
      }
      // create_agent for a person's AI client (Perspicax #321): a one-use
      // token from the agent API marks the new bot temporary.
      let temporary: TemporaryAgent | undefined;
      if (body.temporaryToken !== undefined) {
        const taken = takeTemporaryCreateToken(body.temporaryToken, auth);
        if (!taken) return json(res, 400, { error: "temporaryToken is not valid" });
        temporary = taken;
        const { temporaryToken: _token, ...rest } = body;
        body = rest;
      }
      // An organization member's bot starts from nothing the admin saved
      // (New bot defaults can set a folder, a computer or skills): only the
      // fields memberBotFieldViolation allows, and it is theirs.
      const memberCreate = auth.kind === "session" && !auth.scopes.includes("admin");
      if (memberCreate && !botCreationAllowed(auth)) {
        if (personBotsReadOnly(auth.session.principalId)) return json(res, 403, botsReadOnlyRefusal(auth.session.principalId));
        return json(res, 403, { error: "forbidden: only a member of the organization can create bots", code: "create_bots_members_only" });
      }
      const template = memberCreate
        ? resolveBotCreationDefaults(undefined, { ...body, useDefaults: false })
        : resolveBotCreationDefaults(cfg.newBotDefaults, body);
      const settings = template.profile;
      if (memberCreate) {
        // 2026-10-09: a field beyond MEMBER_BOT_FIELDS needs its permission
        // (BOT_FIELD_PERMISSIONS). 2026-10-26: a preset the server
        // offers only fills the member's own new bot, so it is theirs to pick.
        const extra = ["visibility", "section", "cwd"].filter((key) => body[key] !== undefined);
        const refused = memberBotFieldRefusal(auth, { ...settings, ...Object.fromEntries(extra.map((key) => [key, body[key]])) });
        if (refused) {
          if (refused.permission) return json(res, 403, { ...permissionRefusal(refused.permission), field: refused.field });
          return json(res, 403, { error: `forbidden: a member's new bot may set its name, look, instructions and model, not "${refused.field}"` });
        }
      }
      // A preset (presets.ts) supplies content: playbooks, skills and
      // starter notes. Name, look and instructions stay the request's own.
      if (body.preset !== undefined && (typeof body.preset !== "string" || !/^[\w-]{1,64}$/.test(body.preset))) {
        return json(res, 400, { error: "preset must be a preset id from New bot" });
      }
      const resolvedPreset = typeof body.preset === "string" ? presetStore.resolve(body.preset) : null;
      const preset = resolvedPreset && presetOffered(resolvedPreset.row, orgInstallStatuses()) ? resolvedPreset : null;
      if (body.preset !== undefined && !preset) return json(res, 404, { error: PRESET_UNAVAILABLE_MESSAGE });
      // This computer and the cloud computer are kept. A Local VM or the
      // browser still creates an Auto bot. Off stays.
      // A request that named This computer keeps its guards: the Approve
      // for me warning, and Ask as the starting level.
      const namedThisComputer = settings.computer === "local";
      if (Object.hasOwn(settings, "computer")) settings.computer = requestedWorksOn(settings.computer) ?? undefined;
      body = { ...body, ...settings, name: settings.name };
      if (settings.approvalMode === "full" || settings.approvalMode === "custom") {
        return json(res, 403, { error: "This approval level requires the desktop permission flow. Use the bot creation dialog or explicitly choose Ask/Auto for API creation.", code: "approval_desktop_required" });
      }
      if (namedThisComputer && settings.approvalMode === "auto" && body.acknowledgeLocalAuto !== true) {
        return json(res, 400, { error: "Auto mode on this computer requires confirming the warning first (acknowledgeLocalAuto)" });
      }
      // 2026-10-17 (re-review of #688): a member's new bot is never saved on
      // an automatic level the organization refuses for members' bots.
      if (settings.approvalMode && memberAutoRefused({ ownerUserId: creatingBotOwnerId(auth) }, ["ask"], settings.approvalMode)) {
        return json(res, 403, MEMBER_AUTO_NOT_ALLOWED);
      }
      if (settings.avatarUrl && !storedAvatarExists(settings.avatarUrl)) {
        return json(res, 400, { error: "avatarUrl must reference an existing stored image" });
      }
      if (settings.browserProfile && settings.browserProfile !== "guest" && !(cfg.browserProfiles ?? []).some(profile => profile.id === settings.browserProfile)
        && !personalProfileOf(creatingBotOwnerId(auth), settings.browserProfile)) {
        return json(res, 400, { error: "browserProfile must name an existing browser profile" });
      }
      if (settings.mcpServers?.some(name => mcpServerNameError(name) !== null) || (settings.mcpServers?.length ?? 0) > MAX_MCP_SERVERS) {
        return json(res, 400, { error: "Invalid MCP server selection" });
      }
      if (settings.managedSections?.length) {
        if (!settings.chiefOfStaff || settings.managedSections.some(name => name !== "" && !store.sections.includes(name))) {
          return json(res, 400, { error: "Only a Primary Bot may manage existing additional teams" });
        }
        if (body.acknowledgePeerScope !== true) return json(res, 400, { error: "Confirm additional team access (acknowledgePeerScope)" });
        if (auth.kind === "loopback" && !DESKTOP_MANAGED && store.bots.some(bot => bot.busy)) {
          return json(res, 409, { error: "Stop running bots before granting access to another team" });
        }
      }
      const checkedCwd = validateBotCwd(settings.cwd ?? null);
      if (!checkedCwd.ok) return json(res, 400, { error: checkedCwd.error });
      // #1098 (isolation): a member's new bot works in their own roots
      const outsideCwd = memberCreate ? memberFolderRefusal(memberFolderPrincipal(auth), checkedCwd.cwd) : null;
      if (outsideCwd) return json(res, 403, { ...outsideCwd, field: "cwd" });
      if (body.requireAvailableModel !== undefined && typeof body.requireAvailableModel !== "boolean") {
        return json(res, 400, { error: "requireAvailableModel must be true or false" });
      }
      if (body.requireAvailableModel === true && body.modelSelection === undefined) {
        return json(res, 400, { error: "requireAvailableModel requires modelSelection" });
      }
      const profileInput = Object.fromEntries(
        ["name", "title", "description"]
          .filter((key) => body[key] !== undefined)
          .map((key) => [key, body[key]]),
      );
      const profile = parseBotProfilePatch(profileInput, true);
      if (!profile.ok) return json(res, 400, { error: profile.error });
      let section: string | undefined;
      if (body.section !== undefined && body.section !== null) {
        if (typeof body.section !== "string") return json(res, 400, { error: "section must be a string" });
        section = body.section.trim() || undefined;
        if (section && section.length > 60) {
          return json(res, 400, { error: "section must be at most 60 characters" });
        }
      }
      let selection: ModelSelection;
      if (body.modelSelection === undefined) {
        // A member's bot is not built from the admin's template: the
        // person's own model first, then the organization's (#1074, #1060).
        selection = memberCreate ? await memberDefaultSelection(sessionPrincipal(auth)) : await defaultSelection();
      } else {
        const checked = checkedModelSelection(body.modelSelection, undefined, body.requireAvailableModel === true, sessionPrincipal(auth));
        if (!checked.ok) return json(res, checked.status, { error: checked.error });
        selection = checked.selection;
      }
      if (hostedModels && !hostedModels.allows(selection)) return json(res, 400, { error: hostedModels.error() });
      // Keep the capacity check immediately beside the synchronous write.
      // Awaiting provider discovery before this point cannot race the cap.
      if (store.bots.length >= MAX_WORKSPACE_BOTS) {
        return json(res, 409, { error: `this workspace is limited to ${MAX_WORKSPACE_BOTS} bots` });
      }
      // Apply the audience before creation can announce the bot to members.
      const created = body.visibility === undefined ? null : parseVisibility(body.visibility);
      if (created && !created.ok) return json(res, 400, { error: created.error });
      if (created?.ok) created.visibility = ownerChosenVisibility(auth, created.visibility);
      const bot = store.createBot({ ...profile.patch, soul: settings.soul, section, modelSelection: selection,
        ownerUserId: creatingBotOwnerId(auth),
        toolScope: settings.toolScope ?? undefined,
        ...(temporary ? { temporary } : {}),
        ...(created?.ok ? { visibility: created.visibility } : {}) });
      const createdRoutines: Array<{ id: string; enabled: boolean }> = [];
      try {
        const { chiefOfStaff: _chief, managedSections: _managed, toolScope: _toolScope, ...ordinary } = settings;
        // The server's new bot level (Approve for me, or the organization's
        // policy) unless the request chose another level, or the bot works
        // on this computer (that warning is its own confirmation).
        const defaultMode = namedThisComputer ? "ask" : newBotApprovalMode();
        const approvalMode = ordinary.approvalMode ?? (memberAutoRefused(bot, ["ask"], defaultMode) ? "ask" : defaultMode);
        store.patchBot(bot.id, {
          // Store creation completes workspace defaults (including effort).
          // Applying the rest of the template must not undo that selection.
          ...ordinary, name: bot.name, section, modelSelection: bot.modelSelection,
          mascotExpression: ordinary.mascotExpression ?? undefined,
          avatarUrl: ordinary.avatarUrl || undefined,
          computer: ordinary.computer ?? undefined, cwd: checkedCwd.cwd ?? undefined,
          peers: ordinary.peers ?? undefined, mcpServers: ordinary.mcpServers ?? undefined,
          browserProfile: ordinary.browserProfile || undefined,
          approvalMode,
          autoApprove: approvalMode === "auto",
        });
        store.patchTask(bot.id, bot.threadId, { approvalMode, autoApprove: approvalMode === "auto" });
        // What the preset brings wins over the saved defaults for the same
        // skill name or note file.
        const presetSkills = new Set(preset?.preset.skills ?? []);
        const presetNotes = new Set(Object.keys(preset?.preset.seed?.memory ?? {}));
        for (const [file, text] of Object.entries(template.memory)) {
          if (presetNotes.has(file)) continue;
          journalMemoryWrite(bot.id, file, text, { actor: "person", via: "api" });
        }
        if (preset) {
          applyPresetToBot(bot.id, preset, {
            store: store as never,
            skills: { install: installSkill, setEnabled: setSkillEnabled, installOrg: installOrgSkill },
            memory: { writeIndex: writeMemoryFile, writeTopic: writeMemoryTopic },
          });
        }
        for (const skill of template.skills) {
          if (presetSkills.has(skill.name)) continue;
          const parsed = parseSkillMd(skill.text);
          if ("error" in parsed || parsed.name !== skill.name) throw Object.assign(new Error("Skill name does not match its contents"), { status: 400 });
          const installed = installSkill(bot.id, skill.source, [{ path: "SKILL.md", content: skill.text }]);
          if ("error" in installed) throw Object.assign(new Error(installed.error), { status: 422 });
          if (skill.enabled) {
            const enabled = setSkillEnabled(bot.id, skill.name, true);
            if ("error" in enabled) throw Object.assign(new Error(enabled.error), { status: 422 });
          }
        }
        for (const routine of template.routines) {
          const created = routines.create({ ...routine, botId: bot.id, enabled: false });
          createdRoutines.push({ id: created.id, enabled: routine.enabled !== false });
        }
      } catch (error) {
        for (const routine of createdRoutines) routines.remove(routine.id);
        store.deleteBot(bot.id);
        throw error;
      }
      // Creation is complete. Activation errors must not invite a duplicate
      // creation retry or delete a bot whose routine may already have run.
      const warnings: string[] = [];
      if (settings.chiefOfStaff) {
        try {
          store.patchBot(bot.id, { managedSections: settings.managedSections ?? [] });
          store.setPrimaryBot(bot.id);
        } catch {
          warnings.push("Bot created; review its Primary Bot setting before delegating work.");
        }
      }
      for (const routine of createdRoutines) if (routine.enabled) {
        try { routines.update(routine.id, { enabled: true }); }
        catch { warnings.push(`Bot created; routine ${routine.id} could not be activated.`); }
      }
      return json(res, 201, {
        ...(warnings.length ? { warnings } : {}),
        bot: projectBotTranscript({
          ...wireBot(bot),
          messages: [...store.messagesFor(bot.threadId)],
          activeLeafId: store.activeLeaf(bot.threadId),
        }, viewerForApproval(auth)),
      });
    }
    return PASS;
  };
}
