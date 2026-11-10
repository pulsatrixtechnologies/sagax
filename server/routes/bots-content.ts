/**
 * Bots content HTTP routes (#1388 wave 3 B2): bot skills, the skills library,
 * and per-bot library assignment. Plugins, zip, persona Rules and Files already
 * live in their own route modules (bot-plugins, bot-zip, bot-rules, bot-workspace).
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 */
import { z } from "zod";

import type { GithubCredential } from "../github/github-access.ts";
import { githubSkillFetch } from "../github/github-access.ts";
import { botSkillTemplateSchema } from "../bots/new-bot-defaults.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { fetchSkillFromSource } from "../skills/skill-fetch.ts";
import { skillImportSummary } from "../skills/skill-folder.ts";
import type { LibrarySkillListing } from "../skills/skill-library.ts";
import {
  acceptBotSkillReview,
  acceptLibrarySkillReview,
  afterBotSkillRemoved,
  afterLibrarySkillPersonSave,
  afterLibrarySkillRemoved,
  botSkillFolder,
  ensureBotReviewedSnapshot,
  librarySkillFolder,
  loadBotSkillEditor,
  loadLibrarySkillEditor,
  readSkillFolderFile,
  revertBotSkillReview,
  revertLibrarySkillReview,
  updateBotSkillByPerson,
} from "../skills/skill-person-edit.ts";
import { botsUsingSharedSkill } from "../skills/skill-share.ts";
import {
  installLibrarySkill,
  listLibrarySkills,
  readLibrarySkillFile,
  readSkillLibraryIndex,
  setLibrarySkillReviewState,
  updateLibrarySkill,
  deleteLibrarySkill,
} from "../skills/skill-library.ts";
import {
  installSkill,
  listBotSkillsWithOrigin,
  listSkillHistory,
  listSkills,
  removeSkill,
  restoreSkillVersion,
  setSkillEnabled,
  type SkillListing,
  type StagedSkillWrite,
} from "../skills/skills.ts";
import type { BotRecord } from "../store.ts";
import { composeSkillMd, parseSkillMd, scanSkillText } from "../../shared/skill-md.ts";
import { permissionRefusal, type PermissionKey } from "../../shared/permissions.ts";
import type { SkillsLibrarySkillWire } from "../../shared/wire.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotsContentStore {
  readonly bots: readonly BotRecord[];
  bot(id: string): BotRecord | null | undefined;
  patchBot(id: string, patch: Record<string, unknown>): BotRecord | null | undefined;
  /** Present when the route merges engine-native skills for a thread's folder. */
  taskByThread?(botId: string, threadId: string): { cwd?: string | null } | undefined;
}

export interface BotsContentRouteDeps {
  store: BotsContentStore;
  identity: { kind: "solo" | "perspicax" };
  /** features.skillsLibrary (and any other cfg the flag needs). */
  skillsLibraryEnabled: () => boolean;
  /** Who may read (change false) or change a bot's skills. */
  botSkillsRefusal: (
    auth: RequestAuth,
    botId: string,
    change: boolean,
  ) => { status: number; body: Record<string, unknown> } | null;
  sessionPrincipal: (auth: RequestAuth) => string | null | undefined;
  effectiveBotOwner: (bot: { ownerUserId?: unknown }) => string;
  localPrincipalId: () => string;
  samePerson: (a: string | null | undefined, b: string | null | undefined) => boolean;
  personalSkillsList: (person: string) => readonly LibrarySkillListing[];
  /** Legacy list when the skills library feature is off. */
  listBotSkills: (bot: BotRecord) => readonly SkillListing[];
  /** Skills the bot's engine loads by itself for turns in this thread's folder. */
  listNativeBotSkills?: (bot: BotRecord, threadId: string) => ReadonlyArray<SkillListing & { origin: "native" }>;
  /** Folder a thread's turns run in; null when pinned to none. */
  threadFolder?: (bot: BotRecord, threadId: string) => string | null;
  listStagedSkillWrites: (botId: string) => readonly StagedSkillWrite[];
  stagedSkillListing: (staged: StagedSkillWrite) => Record<string, unknown>;
  /** #3400: where a staged learning's open card sits in the chat (the
   * Knowledge tab answers that card, or opens the chat at it). */
  stagedSkillCard?: (botId: string, stagedId: string) => { threadId: string; requestId: string; messageId: string } | null;
  githubCredentialsFor: (actor: string | null | undefined) => readonly GithubCredential[];
  computerOwner: (auth: RequestAuth) => boolean;
  callerCan: (auth: RequestAuth, key: PermissionKey) => boolean;
  /** Plugin that owns a library skill name, or null when the skill is private. */
  pluginSkillSource: (name: string) => { name: string; marketplace: string } | null;
}

export function createBotsContentRoutes(deps: BotsContentRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const botSkillGate = /^\/api\/bots\/([\w-]+)\/(?:skill-template|skills(?:\/[a-z0-9-]+(?:\/(?:review|files|history(?:\/restore)?))?)?|skills-library)$/.exec(path);
    const libraryGate = path === "/api/skills-library" || /^\/api\/skills-library\/[a-z0-9-]+(?:\/(?:review|files))?$/.test(path);
    if (!botSkillGate && !libraryGate) return PASS;

    const {
      store,
      identity,
      skillsLibraryEnabled,
      botSkillsRefusal,
      sessionPrincipal,
      effectiveBotOwner,
      localPrincipalId,
      samePerson,
      personalSkillsList,
      listBotSkills,
      listNativeBotSkills,
      listStagedSkillWrites: listStaged,
      stagedSkillListing: listingOfStaged,
      stagedSkillCard,
      githubCredentialsFor,
      computerOwner,
      callerCan,
      pluginSkillSource,
    } = deps;

    // #3400: each staged learning with the card the person answers.
    const stagedSkillListing = (staged: StagedSkillWrite): Record<string, unknown> => {
      const listing = listingOfStaged(staged);
      const card = stagedSkillCard?.(botSkillGate?.[1] ?? "", staged.id);
      return card ? { ...listing, card: { threadId: card.threadId, requestId: card.requestId, messageId: card.messageId } } : listing;
    };

    // A per-bot skill the library sweep moved (a restored workspace, a skill
    // added while the app was closed) stays this bot's by assignment: its
    // GET and files read the library copy, like readBotSkillFile does for
    // turns. A private skill of the same name still wins.
    const assignedLibrarySkill = (botId: string, name: string): boolean => {
      if (!skillsLibraryEnabled()) return false;
      if (!(store.bot(botId)?.assignedSkills ?? []).includes(name)) return false;
      return !listSkills(botId).some((skill) => skill.name === name);
    };

    // Bot skills, skill-template and library skill assignment: owner /
    // manage / admin for changes (#3091: the assignment is open to a member
    // for their own bot, so it takes the same refusal).
    {
      const skillRoute = /^\/api\/bots\/([\w-]+)\/(?:skill-template|skills(?:\/[a-z0-9-]+(?:\/(?:review|files|history(?:\/restore)?))?)?|skills-library)$/.exec(path);
      if (skillRoute) {
        const refused = botSkillsRefusal(auth, skillRoute[1]!, method !== "GET");
        if (refused) return json(res, refused.status, refused.body);
      }
    }

    let m: RegExpMatchArray | null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/skill-template$/);
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const checked = botSkillTemplateSchema.safeParse(await readBody(req));
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const input = checked.data;
      const parsed = parseSkillMd(input.text);
      if ("error" in parsed || parsed.name !== input.name) return json(res, 400, { error: "Skill name does not match its contents" });
      const installed = installSkill(m[1], input.source, [{ path: "SKILL.md", content: input.text }]);
      if ("error" in installed) return json(res, 422, { error: installed.error });
      if (input.enabled) {
        const enabled = setSkillEnabled(m[1], input.name, true);
        if ("error" in enabled) return json(res, 422, { error: enabled.error });
      }
      return json(res, 201, { installed });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/skills$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // The thread names a folder on disk: only one of this bot's own threads may pick it.
      const asked = url.searchParams.get("threadId");
      const threadId = asked && store.taskByThread?.(bot.id, asked) ? asked : bot.threadId;
      const natives = listNativeBotSkills?.(bot, threadId) ?? [];
      if (skillsLibraryEnabled()) {
        const person = identity.kind === "perspicax"
          ? sessionPrincipal(auth) ?? effectiveBotOwner(bot)
          : localPrincipalId();
        const personBots = person
          ? store.bots.filter((entry) => identity.kind !== "perspicax" || samePerson(effectiveBotOwner(entry), person))
            .map((entry) => ({ id: entry.id, name: entry.name, ownerUserId: effectiveBotOwner(entry), assignedSkills: entry.assignedSkills }))
          : [];
        const meSkills = person ? personalSkillsList(person) : [];
        const { skills, library } = listBotSkillsWithOrigin(
          m[1]!,
          bot.assignedSkills,
          meSkills,
          (name, origin) => origin === "me"
            ? botsUsingSharedSkill({ name, scope: "me", bots: personBots, personId: person })
            : store.bots.filter((entry) => entry.assignedSkills?.includes(name)).map((entry) => ({ id: entry.id, name: entry.name })),
          natives,
        );
        return json(res, 200, {
          skills,
          library,
          assignedSkills: bot.assignedSkills,
          staged: listStaged(m[1]).map(stagedSkillListing),
        });
      }
      const own = listBotSkills(bot);
      const names = new Set(own.map((skill) => skill.name));
      return json(res, 200, {
        skills: [...own, ...natives.filter((skill) => !names.has(skill.name))],
        staged: listStaged(m[1]).map(stagedSkillListing),
      });
    }
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ source: z.string().min(1).max(2000) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "source must be a GitHub or skills.sh URL, or owner/repo" });
      const fetched = await fetchSkillFromSource(parsed.data.source, githubSkillFetch(githubCredentialsFor(sessionPrincipal(auth))));
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const results = fetched.skills.map((skill) => ({ skill, result: installSkill(m![1]!, skill.source, skill.files, skill.github) }));
      const errors = results.flatMap(({ result }) => ("error" in result ? [result.error] : []));
      const done = results.flatMap(({ skill, result }) => ("error" in result ? [] : [{ skill, installed: result }]));
      if (!done.length) return json(res, 422, { error: errors.join("; ") || "nothing importable found" });
      const imported = done.map(({ skill, installed }) => skillImportSummary(installed.name, skill.files, skill.skipped));
      return json(res, 201, { installed: done.map(({ installed }) => installed), imported, errors });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/review$/);
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ action: z.enum(["accept", "revert"]) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "action must be accept or revert" });
      const result = parsed.data.action === "accept"
        ? acceptBotSkillReview(m[1]!, m[2]!)
        : revertBotSkillReview(m[1]!, m[2]!);
      if ("error" in result) return json(res, result.status, { error: result.error });
      return json(res, 200, { skill: result });
    }

    // Versions of one skill (#2610): every change by the bot or the person,
    // with the text before and after, and Restore of any of them.
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/history$/);
    if (m && method === "GET") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { versions: listSkillHistory(m[1]!, m[2]!) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/history\/restore$/);
    if (m && method === "POST") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ id: z.string().min(1).max(64), side: z.enum(["before", "after"]).optional() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "id is required" });
      const result = restoreSkillVersion(m[1]!, m[2]!, parsed.data.id, parsed.data.side);
      if ("error" in result) return json(res, result.status, { error: result.error });
      ensureBotReviewedSnapshot(m[1]!, m[2]!);
      return json(res, 200, { skill: result.skill });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)\/files$/);
    if (m && method === "GET") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const filePath = url.searchParams.get("path");
      const library = assignedLibrarySkill(m[1]!, m[2]!);
      const folder = library ? librarySkillFolder(m[2]!) : botSkillFolder(m[1]!, m[2]!);
      if (!filePath) {
        const payload = library ? loadLibrarySkillEditor(m[2]!, "library") : loadBotSkillEditor(m[1]!, m[2]!);
        if ("error" in payload) return json(res, payload.status, { error: payload.error });
        return json(res, 200, { files: payload.files });
      }
      const file = readSkillFolderFile(folder, filePath);
      if ("error" in file) return json(res, file.status, { error: file.error });
      if (file.kind === "text") return json(res, 200, { path: filePath, kind: file.kind, text: file.text, bytes: file.bytes });
      res.statusCode = 200;
      res.setHeader("content-type", file.contentType);
      res.setHeader("cache-control", "private, no-store");
      res.end(file.buffer);
      return;
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/skills\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const payload = assignedLibrarySkill(m[1]!, m[2]!) ? loadLibrarySkillEditor(m[2]!, "library") : loadBotSkillEditor(m[1]!, m[2]!);
      if ("error" in payload) return json(res, payload.status, { error: payload.error });
      return json(res, 200, payload);
    }
    if (m && method === "PUT") {
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(1024),
        instructions: z.string().max(256 * 1024),
      }).strict().safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "name, description and instructions are required" });
      const result = updateBotSkillByPerson(m[1]!, m[2]!, parsed.data);
      if ("error" in result) return json(res, result.status, { error: result.error });
      return json(res, 200, { skill: result.skill, ...(result.renamedFrom ? { renamedFrom: result.renamedFrom } : {}) });
    }
    if (m && method === "PATCH") {
      const parsed = z.object({ enabled: z.boolean() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "enabled must be true or false" });
      const result = setSkillEnabled(m[1]!, m[2]!, parsed.data.enabled);
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: result });
    }
    if (m && method === "DELETE") {
      const result = removeSkill(m[1]!, m[2]!);
      if ("error" in result) return json(res, 404, { error: result.error });
      afterBotSkillRemoved(m[1]!, m[2]!);
      return json(res, 200, { ok: true });
    }

    // Skills library (features.skillsLibrary): local browse surface.
    m = path.match(/^\/api\/skills-library$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      const index = readSkillLibraryIndex();
      const skills: SkillsLibrarySkillWire[] = listLibrarySkills()
        .map((listing): SkillsLibrarySkillWire => ({
          name: listing.name,
          description: listing.description,
          source: listing.source,
          enabled: listing.enabled,
          tags: listing.tags ?? [],
          version: index[listing.name]?.package?.release ?? null,
          importedAt: listing.importedAt,
          ...(listing.license ? { license: listing.license } : {}),
          ...(listing.compatibility ? { compatibility: listing.compatibility } : {}),
          warnings: listing.warnings,
          assignedBots: store.bots
            .filter((entry) => entry.assignedSkills?.includes(listing.name))
            .map((entry) => ({ id: entry.id, name: entry.name })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { skills });
    }
    if (m && method === "POST") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ text: z.string().min(1) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "text must be the SKILL.md contents to import" });
      const skill = parseSkillMd(parsed.data.text);
      if ("error" in skill) return json(res, 400, { error: skill.error });
      const installed = installLibrarySkill({
        name: skill.name,
        instructions: parsed.data.text,
        source: "local-import",
        license: skill.license,
        compatibility: skill.compatibility,
        tags: skill.tags,
        warnings: scanSkillText(parsed.data.text),
        reviewState: "disabled",
      });
      if ("error" in installed) return json(res, 422, { error: installed.error });
      return json(res, 201, { skill: installed });
    }

    m = path.match(/^\/api\/skills-library\/([a-z0-9-]+)\/review$/);
    if (m && method === "POST") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      if (!computerOwner(auth) && !(identity.kind === "perspicax" && callerCan(auth, "skills.library"))) {
        return json(res, 403, identity.kind === "perspicax" ? permissionRefusal("skills.library") : { error: "forbidden: only this computer's owner or an admin can change the skills library", code: "skills_library_owner_only" });
      }
      const parsed = z.object({ action: z.enum(["accept", "revert"]) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "action must be accept or revert" });
      const result = parsed.data.action === "accept"
        ? acceptLibrarySkillReview(m[1]!)
        : revertLibrarySkillReview(m[1]!);
      if ("error" in result) return json(res, result.status, { error: result.error });
      return json(res, 200, { skill: result });
    }

    m = path.match(/^\/api\/skills-library\/([a-z0-9-]+)\/files$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      const filePath = url.searchParams.get("path");
      const folder = librarySkillFolder(m[1]!);
      if (!filePath) {
        const payload = loadLibrarySkillEditor(m[1]!, "library");
        if ("error" in payload) return json(res, payload.status, { error: payload.error });
        return json(res, 200, { files: payload.files });
      }
      const file = readSkillFolderFile(folder, filePath);
      if ("error" in file) return json(res, file.status, { error: file.error });
      if (file.kind === "text") return json(res, 200, { path: filePath, kind: file.kind, text: file.text, bytes: file.bytes });
      res.statusCode = 200;
      res.setHeader("content-type", file.contentType);
      res.setHeader("cache-control", "private, no-store");
      res.end(file.buffer);
      return;
    }

    m = path.match(/^\/api\/skills-library\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      const payload = loadLibrarySkillEditor(m[1]!, "library");
      if ("error" in payload) return json(res, payload.status, { error: payload.error });
      return json(res, 200, payload);
    }
    if (m && method === "PATCH") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      const parsed = z.object({ enabled: z.boolean() }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "enabled must be true or false" });
      const result = setLibrarySkillReviewState(m[1]!, parsed.data.enabled ? "approved" : "disabled");
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, { skill: result });
    }
    if (m && (method === "PUT" || method === "DELETE")) {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      if (!computerOwner(auth) && !(identity.kind === "perspicax" && callerCan(auth, "skills.library"))) {
        return json(res, 403, identity.kind === "perspicax" ? permissionRefusal("skills.library") : { error: "forbidden: only this computer's owner or an admin can change the skills library", code: "skills_library_owner_only" });
      }
      const name = m[1]!;
      const plugin = pluginSkillSource(name);
      if (plugin) {
        return json(res, 409, { error: `this skill comes with the plugin ${plugin.name} (${plugin.marketplace}): uninstall the plugin to remove it`, code: "plugin_skill" });
      }
      if (method === "DELETE") {
        const removed = deleteLibrarySkill(name);
        if ("error" in removed) return json(res, removed.status, { error: removed.error });
        afterLibrarySkillRemoved(name);
        for (const entry of store.bots) {
          if (entry.assignedSkills?.includes(name)) store.patchBot(entry.id, { assignedSkills: entry.assignedSkills.filter((skill) => skill !== name) });
        }
        return json(res, 200, { ok: true });
      }
      const parsed = z.object({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(1024),
        instructions: z.string().max(256 * 1024),
      }).strict().safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "name, description and instructions are required" });
      const previous = readLibrarySkillFile(name);
      const text = composeSkillMd(previous, { name: parsed.data.name, description: parsed.data.description, body: parsed.data.instructions });
      const updated = updateLibrarySkill(name, { text, warnings: scanSkillText(text) });
      if ("error" in updated) return json(res, updated.status, { error: updated.error });
      afterLibrarySkillPersonSave(updated.skill.name, text, undefined, updated.renamedFrom);
      if (updated.renamedFrom) {
        for (const entry of store.bots) {
          if (entry.assignedSkills?.includes(name)) {
            store.patchBot(entry.id, { assignedSkills: entry.assignedSkills.map((skill) => skill === name ? updated.skill.name : skill) });
          }
        }
      }
      return json(res, 200, { skill: updated.skill });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/skills-library$/);
    if (m && method === "PUT") {
      if (!skillsLibraryEnabled()) return json(res, 404, { error: "skills library is not enabled" });
      if (!store.bot(m[1])) return json(res, 404, { error: "no such bot" });
      const parsed = z.object({ skills: z.array(z.string().min(1).max(64)).max(200) }).safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "skills must be a list of skill names" });
      const index = readSkillLibraryIndex();
      const names = [...new Set(parsed.data.skills)];
      const unknown = names.filter((name) => !index[name]);
      if (unknown.length) return json(res, 422, { error: "not in the library: " + unknown.join(", ") });
      store.patchBot(m[1]!, { assignedSkills: names });
      return json(res, 200, { assignedSkills: names });
    }

    return PASS;
  };
}
