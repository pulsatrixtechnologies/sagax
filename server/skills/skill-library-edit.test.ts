// Plugins > Manage > a private skill: Save (edit, rename) and Delete Skill
// on the skills library store (server/skills/skill-library.ts).
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.SAGAX_DATA_DIR = mkdtempSync(join(tmpdir(), "sagax-skill-edit-"));

const library = await import("./skill-library.ts");
const { composeSkillMd, parseSkillMd } = await import("../../shared/skill-md.ts");

const SKILL = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: Writes the release notes.\n${extra}---\n\n# ${name}\n\nList the changes.\n`;
const fresh = () => mkdtempSync(join(tmpdir(), "sagax-skill-edit-root-"));

describe("composeSkillMd", () => {
  it("writes the three fields and keeps the other frontmatter lines", () => {
    const text = composeSkillMd(SKILL("notes", "license: MIT\ntags: release, docs\n"), { name: "notes-v2", description: "Writes  the\nnotes", body: "Do it.\n" });
    expect(text).toBe("---\nname: notes-v2\ndescription: Writes the notes\nlicense: MIT\ntags: release, docs\n---\n\nDo it.\n");
    expect(parseSkillMd(text)).toMatchObject({ name: "notes-v2", description: "Writes the notes", license: "MIT", tags: ["release", "docs"] });
  });

  it("starts a new skill with the required keys only", () => {
    expect(composeSkillMd(null, { name: "triage", description: "Sorts tickets", body: "Read the queue." }))
      .toBe("---\nname: triage\ndescription: Sorts tickets\n---\n\nRead the queue.\n");
  });
});

describe("editing a library skill", () => {
  it("saves new text, keeps the review state and the source", () => {
    const root = fresh();
    library.installLibrarySkill({ name: "notes", instructions: SKILL("notes"), source: "local-import", reviewState: "approved", root });
    const text = composeSkillMd(SKILL("notes"), { name: "notes", description: "Writes better notes", body: "New body." });
    const result = library.updateLibrarySkill("notes", { text, warnings: [] }, root);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.skill).toMatchObject({ name: "notes", description: "Writes better notes", enabled: true, source: "local-import" });
    expect(result.renamedFrom).toBeUndefined();
    expect(library.readLibrarySkillFile("notes", root)).toBe(text);
  });

  it("renames: the old folder and entry go, a name already taken is refused", () => {
    const root = fresh();
    library.installLibrarySkill({ name: "notes", instructions: SKILL("notes"), source: "local-import", root });
    library.installLibrarySkill({ name: "taken", instructions: SKILL("taken"), source: "local-import", root });
    const clash = library.updateLibrarySkill("notes", { text: SKILL("taken").replace("List", "Make"), warnings: [] }, root);
    expect(clash).toMatchObject({ status: 409 });
    const result = library.updateLibrarySkill("notes", { text: SKILL("release-notes"), warnings: [] }, root);
    expect(result).toMatchObject({ renamedFrom: "notes", skill: { name: "release-notes" } });
    expect(Object.keys(library.readSkillLibraryIndex(root)).sort()).toEqual(["release-notes", "taken"]);
    expect(existsSync(join(root, "skills", "notes"))).toBe(false);
    expect(library.readLibrarySkillFile("release-notes", root)).toBe(SKILL("release-notes"));
  });

  it("refuses a skill an organization package put in the library, and unknown names", () => {
    const root = fresh();
    library.installLibrarySkill({
      name: "org-skill", instructions: SKILL("org-skill"), source: "org", root,
      package: { installId: "a".repeat(32), key: "pack", release: "1.0.0", r: "b".repeat(64), w: "c".repeat(64) },
    });
    expect(library.librarySkillManagedByOrganization("org-skill", root)).toBe(true);
    expect(library.updateLibrarySkill("org-skill", { text: SKILL("org-skill", "license: MIT\n"), warnings: [] }, root)).toMatchObject({ status: 409 });
    expect(library.deleteLibrarySkill("org-skill", root)).toMatchObject({ status: 409 });
    expect(library.deleteLibrarySkill("missing", root)).toMatchObject({ status: 404 });
    expect(library.deleteLibrarySkill("../etc", root)).toMatchObject({ status: 400 });
  });
});

describe("deleting a library skill", () => {
  it("removes the entry and the folder and says where it came from", () => {
    const root = fresh();
    const events: Array<{ kind: string; name: string }> = [];
    library.skillLibraryEvents.on("invalidate", (event) => events.push(event));
    library.installLibrarySkill({ name: "notes", instructions: SKILL("notes"), source: "local-import", root });
    expect(library.deleteLibrarySkill("notes", root)).toEqual({ removed: true, source: "local-import" });
    expect(library.readSkillLibraryIndex(root)).toEqual({});
    expect(existsSync(join(root, "skills", "notes"))).toBe(false);
    expect(events).toContainEqual({ kind: "remove", name: "notes" });
  });
});
