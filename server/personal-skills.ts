// A person's skills are one library, referenced by every one of their bots.
// Only reviewed SKILL.md files leave it for that person's environment.
import { join } from "node:path";
import { composeSkillMd, parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import { principalDir, type PersonCapabilities } from "./person-connections.ts";
import { deleteLibrarySkill, installLibrarySkill, listLibrarySkills, readLibrarySkillFile, setLibrarySkillReviewState, updateLibrarySkill } from "./skill-library.ts";
import { botsUsingSharedSkill } from "./skill-share.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { RequestAuth } from "./request-auth.ts";

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
    const root = organization ? "/workspace/sagax-capability-skills/me" : this.root(person);
    return "\n\nYour person's skills:\n" + skills.map((skill) =>
      `- ${skill.name}: ${skill.description} Read ${JSON.stringify(join(root, "skills", skill.name, "SKILL.md"))}.`,
    ).join("\n") + "\nRead the exact file when its task matches. Follow the user's instructions.\n";
  }
}

export function createPersonalSkillRoutes(deps: {
  skills: PersonalSkills;
  person: (auth: RequestAuth) => string | null;
  enabled: () => boolean;
  bots: (person: string) => Array<{ id: string; name: string }>;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = path.match(/^\/api\/me\/skills-library(?:\/([a-z0-9-]+))?$/);
    if (!match) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in to manage your own skills." });
    if (!deps.enabled()) return json(res, 404, { error: "skills library is not enabled" });
    const root = deps.skills.root(person);
    const name = match[1];
    const body = async () => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
      return await readBody(req) as Record<string, unknown>;
    };
    try {
      if (!name && method === "GET") {
        const bots = deps.bots(person);
        return json(res, 200, { skills: deps.skills.list(person).map((skill) => ({
          ...skill,
          version: null,
          // Links, not copies: every bot of this person that has not
          // unshared into a private shadow still reads this Me skill.
          assignedBots: botsUsingSharedSkill({ name: skill.name, scope: "me", bots, personId: person }),
        })) });
      }
      if (!name && method === "POST") {
        const input = await body();
        if (typeof input?.text !== "string") return json(res, 400, { error: "text must be the SKILL.md contents" });
        const parsed = parseSkillMd(input.text);
        if ("error" in parsed) return json(res, 400, { error: parsed.error });
        const result = installLibrarySkill({ name: parsed.name, instructions: input.text, source: "local-import", warnings: scanSkillText(input.text), reviewState: "approved", root });
        if ("error" in result) return json(res, 422, { error: result.error });
        deps.skills.reference(person, null, result.name);
        return json(res, 201, { skill: result });
      }
      if (!name) return json(res, 405, { error: "GET or POST only" });
      if (!deps.skills.list(person).some((skill) => skill.name === name)) return json(res, 404, { error: "no such skill" });
      const previous = readLibrarySkillFile(name, root);
      if (method === "GET") return previous === null ? json(res, 409, { error: "The stored file changed; save your reviewed version again." }) : json(res, 200, { text: previous });
      if (method === "DELETE") {
        const result = deleteLibrarySkill(name, root);
        if ("error" in result) return json(res, result.status, { error: result.error });
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
      const text = composeSkillMd(previous, { name: input.name, description: input.description, body: input.instructions });
      const result = updateLibrarySkill(name, { text, warnings: scanSkillText(text) }, root);
      if ("error" in result) return json(res, result.status, { error: result.error });
      deps.skills.reference(person, name, result.skill.name);
      return json(res, 200, { skill: result.skill });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return json(res, status, { error: status < 500 && error instanceof Error ? error.message : "Your skills could not be read or saved." });
    }
  };
}
