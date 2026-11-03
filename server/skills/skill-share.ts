// Shared skills: one stored copy, bots hold links (issue #1654).
//
// Capacités scopes:
//   Me           principals/<pid>/capability-skills  (person isolation)
//   Organisation skills-library/                     (installation index)
//
// Sharing a private bot skill installs the reviewed SKILL.md once into the
// chosen library and drops the private manifest entry (bytes archived
// write-once). Other bots of the same person read Me through the existing
// PersonalSkills path; Organisation assignments use bot.assignedSkills.
// A person's private skill never reaches another person unless its owner
// shares it into Organisation. Unshare materializes a private copy for
// that bot so it can diverge; other linked bots keep the shared bytes.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  installLibrarySkill,
  libraryArchiveDirectory,
  listLibrarySkills,
  readLibrarySkillFile,
  readSkillLibraryIndex,
  skillLibraryEvents,
  skillsLibraryRoot,
  updateLibrarySkill,
  type LibrarySkillListing,
} from "./skill-library.ts";
import { archiveSkillDirectory, readPendingAssignments, writePendingAssignments } from "./skills-library-migration.ts";
import {
  installSkill,
  listMigratableSkills,
  listSkills,
  removeManifestEntry,
  setSkillEnabled,
} from "./skills.ts";

export type SharedSkillScope = "me" | "organization";

export interface ShareBotRef {
  id: string;
  name: string;
  assignedSkills?: string[];
  /** Person who owns this bot (organization servers). */
  ownerUserId?: string | null;
}

export interface SkillShareResult {
  scope: SharedSkillScope;
  library: "installed" | "deduplicated";
  name: string;
  sha256: string;
  /** Bots that hold a link after this share. */
  linked: Array<{ botId: string; name: string }>;
  /** Bots skipped because a same-named private skill still wins. */
  skipped: Array<{ botId: string; name: string; reason: string }>;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const sortedUnique = (names: readonly string[]) => [...new Set(names)].sort();

function readPrivateSkillMd(botId: string, name: string):
  | { instructions: string; sha256: string; description: string; source: string; directory: string }
  | { error: string } {
  const copy = listMigratableSkills(botId).find((skill) => skill.name === name);
  if (!copy) return { error: `no private skill named "${name}"` };
  if (!copy.intact || !copy.directory) return { error: "the stored SKILL.md is missing or changed after review" };
  if (!copy.enabled) return { error: `"${name}" is switched off` };
  try {
    if (readdirSync(copy.directory).some((entry) => entry !== "SKILL.md")) {
      return { error: "the skill has supporting files — only SKILL.md is shared" };
    }
    const instructions = readFileSync(join(copy.directory, "SKILL.md"), "utf8");
    if (sha256Hex(instructions) !== copy.sha256) return { error: "the stored SKILL.md changed after review" };
    return {
      instructions,
      sha256: copy.sha256,
      description: copy.description,
      source: copy.source,
      directory: copy.directory,
    };
  } catch {
    return { error: "could not read the stored SKILL.md" };
  }
}

function installSharedCopy(args: {
  name: string;
  description: string;
  instructions: string;
  source: string;
  root: string;
}): { library: "installed" | "deduplicated"; sha256: string } | { error: string } {
  const existing = readSkillLibraryIndex(args.root)[args.name];
  const sha256 = sha256Hex(args.instructions);
  if (existing && existing.sha256 !== sha256) {
    return { error: `the library already has a different skill named "${args.name}"` };
  }
  if (existing && existing.reviewState !== "approved") {
    return { error: `the library's "${args.name}" is switched off` };
  }
  if (!existing) {
    const installed = installLibrarySkill({
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      source: args.source,
      reviewState: "approved",
      root: args.root,
    });
    if ("error" in installed) return installed;
    return { library: "installed", sha256 };
  }
  return { library: "deduplicated", sha256 };
}

function archiveAndDropPrivate(args: {
  botId: string;
  name: string;
  sha256: string;
  directory: string;
  root: string;
}): { error: string } | null {
  try {
    const pending = readPendingAssignments(args.root);
    writePendingAssignments({
      ...pending,
      [args.botId]: sortedUnique([...(pending[args.botId] ?? []), args.name]),
    }, args.root);
    archiveSkillDirectory(args.directory, libraryArchiveDirectory(args.root, args.botId, args.name), args.sha256);
  } catch (error) {
    return { error: `could not move the private copy into the library: ${error instanceof Error ? error.message : String(error)}` };
  }
  const removed = removeManifestEntry(args.botId, args.name, args.sha256);
  if ("error" in removed) return removed;
  try {
    const pending = readPendingAssignments(args.root);
    const rest = (pending[args.botId] ?? []).filter((entry) => entry !== args.name);
    if (rest.length) pending[args.botId] = rest;
    else delete pending[args.botId];
    writePendingAssignments(pending, args.root);
  } catch {
    // Pending only replays an assignment that already exists.
  }
  return null;
}

/** Promote a private bot skill into the person's Me library. Every bot of
 * that person then reads the same bytes through PersonalSkills; a private
 * skill of the same name on another bot still wins for that bot alone. */
export function sharePrivateSkillToMe(args: {
  author: ShareBotRef;
  bots: readonly ShareBotRef[];
  name: string;
  /** principals/<pid>/capability-skills */
  meRoot: string;
  /** Record the Me reference (PersonCapabilities.assignedSkills). */
  reference: (before: string | null, after: string | null) => void;
}): SkillShareResult | { error: string } {
  const privateCopy = readPrivateSkillMd(args.author.id, args.name);
  if ("error" in privateCopy) return privateCopy;
  const installed = installSharedCopy({
    name: args.name,
    description: privateCopy.description,
    instructions: privateCopy.instructions,
    source: privateCopy.source,
    root: args.meRoot,
  });
  if ("error" in installed) return installed;
  const archived = archiveAndDropPrivate({
    botId: args.author.id,
    name: args.name,
    sha256: privateCopy.sha256,
    directory: privateCopy.directory,
    root: args.meRoot,
  });
  if (archived) return archived;
  args.reference(null, args.name);
  const linked: SkillShareResult["linked"] = [];
  const skipped: SkillShareResult["skipped"] = [];
  for (const bot of args.bots) {
    if (listSkills(bot.id).some((skill) => skill.name === args.name)) {
      skipped.push({ botId: bot.id, name: bot.name, reason: `has its own skill named "${args.name}"` });
      continue;
    }
    linked.push({ botId: bot.id, name: bot.name });
  }
  skillLibraryEvents.emit("invalidate", { kind: "share", scope: "me", name: args.name, botIds: linked.map((bot) => bot.botId) });
  return {
    scope: "me",
    library: installed.library,
    name: args.name,
    sha256: installed.sha256,
    linked,
    skipped,
  };
}

/** Promote a private bot skill into the organization's library and assign
 * links to the chosen bots. Affects the shared installation: callers must
 * already have enforced skills.library (or solo computer owner). */
export function sharePrivateSkillToOrganization(args: {
  author: ShareBotRef;
  bots: readonly ShareBotRef[];
  name: string;
  /** Bots that receive a link. Author is always included. */
  assignBotIds?: readonly string[];
  patchAssigned: (botId: string, assignedSkills: string[]) => void;
  root?: string;
}): SkillShareResult | { error: string } {
  const root = args.root ?? skillsLibraryRoot();
  const privateCopy = readPrivateSkillMd(args.author.id, args.name);
  if ("error" in privateCopy) return privateCopy;
  const installed = installSharedCopy({
    name: args.name,
    description: privateCopy.description,
    instructions: privateCopy.instructions,
    source: privateCopy.source,
    root,
  });
  if ("error" in installed) return installed;
  const archived = archiveAndDropPrivate({
    botId: args.author.id,
    name: args.name,
    sha256: privateCopy.sha256,
    directory: privateCopy.directory,
    root,
  });
  if (archived) return archived;

  const wanted = new Set([args.author.id, ...(args.assignBotIds ?? args.bots.map((bot) => bot.id))]);
  const linked: SkillShareResult["linked"] = [];
  const skipped: SkillShareResult["skipped"] = [];
  for (const bot of args.bots) {
    if (!wanted.has(bot.id)) continue;
    if (listSkills(bot.id).some((skill) => skill.name === args.name)) {
      skipped.push({ botId: bot.id, name: bot.name, reason: `has its own skill named "${args.name}"` });
      continue;
    }
    const next = sortedUnique([...(bot.assignedSkills ?? []), args.name]);
    args.patchAssigned(bot.id, next);
    bot.assignedSkills = next;
    linked.push({ botId: bot.id, name: bot.name });
  }
  skillLibraryEvents.emit("invalidate", { kind: "share", scope: "organization", name: args.name, botIds: linked.map((bot) => bot.botId) });
  return {
    scope: "organization",
    library: installed.library,
    name: args.name,
    sha256: installed.sha256,
    linked,
    skipped,
  };
}

/** Stop sharing for one bot: copy the shared SKILL.md into that bot's
 * private store (enabled) and drop its Organisation assignment when the
 * source was the org library. Me bytes stay for every other bot of the
 * person; a private copy shadows Me for this bot alone. */
export function unshareSkillForBot(args: {
  bot: ShareBotRef;
  name: string;
  scope: SharedSkillScope;
  meRoot?: string;
  orgRoot?: string;
  patchAssigned?: (botId: string, assignedSkills: string[]) => void;
}): { skill: { name: string; origin: "private" }; sha256: string } | { error: string } {
  const root = args.scope === "me"
    ? args.meRoot
    : (args.orgRoot ?? skillsLibraryRoot());
  if (!root) return { error: "shared skill root is missing" };
  if (listSkills(args.bot.id).some((skill) => skill.name === args.name)) {
    return { error: `"${args.name}" is already a private skill on this bot` };
  }
  const text = readLibrarySkillFile(args.name, root);
  if (text === null) return { error: `no shared skill named "${args.name}"` };
  const installed = installSkill(args.bot.id, `shared:${args.scope}`, [{ path: "SKILL.md", content: text }]);
  if ("error" in installed) return installed;
  const enabled = setSkillEnabled(args.bot.id, args.name, true);
  if ("error" in enabled) return enabled;
  if (args.scope === "organization" && args.patchAssigned) {
    const next = (args.bot.assignedSkills ?? []).filter((entry) => entry !== args.name);
    args.patchAssigned(args.bot.id, next);
    args.bot.assignedSkills = next;
  }
  skillLibraryEvents.emit("invalidate", { kind: "unshare", scope: args.scope, name: args.name, botIds: [args.bot.id] });
  return { skill: { name: args.name, origin: "private" }, sha256: sha256Hex(text) };
}

/** Rewrite a shared skill's SKILL.md. Every bot that still links to it reads
 * the new bytes on the next turn; bots that unshared keep their private copy. */
export function updateSharedSkill(args: {
  name: string;
  text: string;
  scope: SharedSkillScope;
  meRoot?: string;
  orgRoot?: string;
  warnings?: string[];
}): { skill: LibrarySkillListing } | { error: string; status: number } {
  const root = args.scope === "me"
    ? args.meRoot
    : (args.orgRoot ?? skillsLibraryRoot());
  if (!root) return { error: "shared skill root is missing", status: 400 };
  return updateLibrarySkill(args.name, { text: args.text, warnings: args.warnings ?? [] }, root);
}

/** Bots that currently read a shared skill (no private shadow). Me: every
 * bot of the person; Organisation: bots with an assignment. */
export function botsUsingSharedSkill(args: {
  name: string;
  scope: SharedSkillScope;
  bots: readonly ShareBotRef[];
  /** For Me, only bots of this person. */
  personId?: string | null;
}): Array<{ id: string; name: string }> {
  return args.bots.filter((bot) => {
    if (listSkills(bot.id).some((skill) => skill.name === args.name)) return false;
    if (args.scope === "me") {
      if (args.personId && bot.ownerUserId && bot.ownerUserId !== args.personId) return false;
      return true;
    }
    return Boolean(bot.assignedSkills?.includes(args.name));
  }).map((bot) => ({ id: bot.id, name: bot.name }));
}

/** Me library listings tagged with the bots that still link to them. */
export function listSharedMeSkills(
  meRoot: string,
  bots: readonly ShareBotRef[],
  personId?: string | null,
): Array<LibrarySkillListing & { scope: "me"; assignedBots: Array<{ id: string; name: string }> }> {
  return listLibrarySkills(meRoot).map((skill) => ({
    ...skill,
    scope: "me" as const,
    assignedBots: botsUsingSharedSkill({ name: skill.name, scope: "me", bots, personId }),
  }));
}
