// A person's skills are one library, referenced by every one of their bots.
// Only reviewed SKILL.md files leave it for that person's environment.
import { join, posix } from "node:path";
import { composeSkillMd, parseSkillMd, scanSkillText } from "../../shared/skill-md.ts";
import { principalDir, type PersonCapabilities } from "../people/person-connections.ts";
import { deleteLibrarySkill, installLibrarySkill, listLibrarySkills, readLibrarySkillFile, setLibrarySkillReviewState, updateLibrarySkill } from "./skill-library.ts";
import type { FetchedSkill } from "./skill-fetch.ts";
import type { GitHubSkillOrigin } from "../../shared/skill-import.ts";
import { prepareSkillFolder } from "./skill-folder.ts";
import {
  acceptLibrarySkillReview,
  afterLibrarySkillPersonSave,
  afterLibrarySkillRemoved,
  librarySkillFolder,
  loadLibrarySkillEditor,
  readSkillFolderFile,
  revertLibrarySkillReview,
} from "./skill-person-edit.ts";
import { botsUsingSharedSkill } from "./skill-share.ts";
import { notePluginFolderChanged } from "../sandbox/sandbox-plugin-digests.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { RequestAuth } from "../auth/request-auth.ts";

export class PersonalSkills {
  private dataDir: string;
  private capabilities: PersonCapabilities;
  constructor(dataDir: string, capabilities: PersonCapabilities) {
    this.dataDir = dataDir;
    this.capabilities = capabilities;
  }

  root(person: string): string { return join(principalDir(this.dataDir, person), "capability-skills"); }

  list(person: string) {
    const references = new Set(this.capabilities.assignedSkills(person));
    return listLibrarySkills(this.root(person)).map((skill) => ({ ...skill, enabled: skill.enabled && references.has(skill.name) }));
  }

  enabled(person: string) {
    const references = new Set(this.capabilities.assignedSkills(person));
    return this.list(person).filter((skill) => skill.enabled && references.has(skill.name));
  }

  reference(person: string, before: string | null, after: string | null): void {
    const names = this.capabilities.assignedSkills(person).filter((name) => name !== before);
    if (after) names.push(after);
    this.capabilities.setAssignedSkills(person, names);
  }

  /** Verified references for explicit /name turns, read from the same file. */
  commands(person: string, excludeNames?: ReadonlySet<string>) {
    return this.enabled(person).flatMap((skill) => {
      if (excludeNames?.has(skill.name)) return [];
      const text = readLibrarySkillFile(skill.name, this.root(person));
      return text === null ? [] : [{ name: skill.name, file: join(this.root(person), "skills", skill.name, "SKILL.md"), text }];
    });
  }

  /** Index only. A sandbox receives the same library under its own path. */
  prompt(person: string, organization: boolean, excludeNames?: ReadonlySet<string>): string {
    const skills = this.enabled(person).filter((skill) => !excludeNames?.has(skill.name));
    if (!skills.length) return "";
    // Organization sandboxes always see POSIX /workspace/… paths (#4495): path.join
    // on Windows would turn that into backslashes the container never has.
    const fileFor = (name: string) => organization
      ? posix.join("/workspace/sagax-capability-skills/me", "skills", name, "SKILL.md")
      : join(this.root(person), "skills", name, "SKILL.md");
    return "\n\nYour person's skills:\n" + skills.map((skill) =>
      `- ${skill.name}: ${skill.description} Read ${JSON.stringify(fileFor(skill.name))}.`,
    ).join("\n") + "\nRead the exact file when its task matches. Follow the user's instructions.\n";
  }
}

/** #4504: a skill read from GitHub, in the shape the library stores (its
 * SKILL.md, the files beside it, what was left out, where it came from). */
export function libraryInputFromFetched(skill: FetchedSkill) {
  const folder = prepareSkillFolder(skill.files);
  if ("error" in folder) return folder;
  return {
    name: folder.parsed.name,
    instructions: folder.skillMd,
    source: skill.source,
    warnings: folder.warnings,
    files: folder.files,
    skippedFiles: folder.skipped.map((file) => file.path),
    ...(skill.github ? { github: skill.github } : {}),
  };
}

export function createPersonalSkillRoutes(deps: {
  skills: PersonalSkills;
  person: (auth: RequestAuth) => string | null;
  enabled: () => boolean;
  bots: (person: string) => Array<{ id: string; name: string }>;
  /** #4504: read a skill from GitHub with this person's own access (POST
   * {source}: a link or owner/repo, as a bot's Import takes it). */
  fetchSource?: (person: string, source: string) => Promise<{ skills: FetchedSkill[] } | { error: string }>;
  /** #4504: an installed skill's update fields (updateKey, versions, notes). */
  updateFields?: (skill: { name: string; importedAt: string; github?: GitHubSkillOrigin }) => Record<string, unknown>;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody, url }) => {
    const match = path.match(/^\/api\/me\/skills-library(?:\/([a-z0-9-]+)(?:\/(review|files))?)?$/);
    if (!match) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in to manage your own skills." });
    if (!deps.enabled()) return json(res, 404, { error: "skills library is not enabled" });
    const root = deps.skills.root(person);
    const name = match[1];
    const sub = match[2];
    const body = async () => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
      return await readBody(req) as Record<string, unknown>;
    };
    try {
      if (!name && method === "GET") {
        const bots = deps.bots(person);
        return json(res, 200, { skills: deps.skills.list(person).map((skill) => ({
          ...skill,
          ...deps.updateFields?.(skill),
          version: null,
          // Links, not copies: every bot of this person that has not
          // unshared into a private shadow still reads this Me skill.
          assignedBots: botsUsingSharedSkill({ name: skill.name, scope: "me", bots, personId: person }),
        })) });
      }
      if (!name && method === "POST") {
        const input = await body();
        // #4504: a skill of the person's own from GitHub: it reaches all of their bots
        if (typeof input?.source === "string" && deps.fetchSource) {
          if (!input.source.trim() || input.source.length > 2000) return json(res, 400, { error: "source must be a GitHub or skills.sh link, or owner/repo" });
          const fetched = await deps.fetchSource(person, input.source.trim());
          if ("error" in fetched) return json(res, 422, { error: fetched.error });
          const installed: unknown[] = [];
          const errors: string[] = [];
          for (const skill of fetched.skills) {
            const prepared = libraryInputFromFetched(skill);
            if ("error" in prepared) { errors.push(prepared.error); continue; }
            const result = installLibrarySkill({ ...prepared, reviewState: "approved", root });
            if ("error" in result) { errors.push(result.error); continue; }
            deps.skills.reference(person, null, result.name);
            afterLibrarySkillPersonSave(result.name, prepared.instructions, root);
            installed.push(result);
          }
          if (!installed.length) return json(res, 422, { error: errors.join("; ") || "nothing importable found" });
          return json(res, 201, { installed, errors });
        }
        if (typeof input?.text !== "string") return json(res, 400, { error: "text must be the SKILL.md contents, or source a GitHub link" });
        const parsed = parseSkillMd(input.text);
        if ("error" in parsed) return json(res, 400, { error: parsed.error });
        const result = installLibrarySkill({ name: parsed.name, instructions: input.text, source: "local-import", warnings: scanSkillText(input.text), reviewState: "approved", root });
        if ("error" in result) return json(res, 422, { error: result.error });
        deps.skills.reference(person, null, result.name);
        afterLibrarySkillPersonSave(result.name, input.text, root);
        return json(res, 201, { skill: result });
      }
      if (!name) return json(res, 405, { error: "GET or POST only" });
      if (!deps.skills.list(person).some((skill) => skill.name === name)) return json(res, 404, { error: "no such skill" });
      if (sub === "review" && method === "POST") {
        const input = await body();
        if (input?.action !== "accept" && input?.action !== "revert") return json(res, 400, { error: "action must be accept or revert" });
        const result = input.action === "accept"
          ? acceptLibrarySkillReview(name, root)
          : revertLibrarySkillReview(name, root);
        if ("error" in result) return json(res, result.status, { error: result.error });
        return json(res, 200, { skill: result });
      }
      if (sub === "files" && method === "GET") {
        const filePath = url.searchParams.get("path");
        const folder = librarySkillFolder(name, root);
        if (!filePath) {
          const payload = loadLibrarySkillEditor(name, "me", root);
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
      if (sub) return json(res, 405, { error: "unsupported skill path" });
      if (method === "GET") {
        const payload = loadLibrarySkillEditor(name, "me", root);
        if ("error" in payload) return json(res, payload.status, { error: payload.error });
        return json(res, 200, payload);
      }
      if (method === "DELETE") {
        const result = deleteLibrarySkill(name, root);
        if ("error" in result) return json(res, result.status, { error: result.error });
        afterLibrarySkillRemoved(name, root);
        deps.skills.reference(person, name, null);
        return json(res, 200, { ok: true });
      }
      const input = await body();
      if (method === "PATCH") {
        if (typeof input?.enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
        const result = setLibrarySkillReviewState(name, input.enabled ? "approved" : "disabled", root);
        if (!("error" in result)) deps.skills.reference(person, name, name);
        return "error" in result ? json(res, 422, result) : json(res, 200, { skill: result });
      }
      if (method !== "PUT") return json(res, 405, { error: "GET, PUT, PATCH or DELETE only" });
      if (typeof input?.name !== "string" || typeof input.description !== "string" || typeof input.instructions !== "string") return json(res, 400, { error: "name, description and instructions are required" });
      const previous = readLibrarySkillFile(name, root);
      const text = composeSkillMd(previous, { name: input.name, description: input.description, body: input.instructions });
      const result = updateLibrarySkill(name, { text, warnings: scanSkillText(text) }, root);
      if ("error" in result) return json(res, result.status, { error: result.error });
      afterLibrarySkillPersonSave(result.skill.name, text, root, result.renamedFrom);
      deps.skills.reference(person, name, result.skill.name);
      return json(res, 200, { skill: result.skill });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return json(res, status, { error: status < 500 && error instanceof Error ? error.message : "Your skills could not be read or saved." });
    } finally {
      // #3619: a personal skill saved, renamed, switched or removed: the
      // turn's copy computes this folder's digest again
      if (method !== "GET") notePluginFolderChanged(root);
    }
  };
}
