// Person-UI skill edit: owner save unblocks, external change blocks,
// Accept re-signs, Revert restores the reviewed snapshot.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";

process.env.SAGAX_DATA_DIR = mkdtempSync(join(tmpdir(), "sagax-skill-person-"));

const skills = await import("./skills.ts");
const library = await import("./skill-library.ts");
const edit = await import("./skill-person-edit.ts");

const SKILL = (name: string, body = "List the changes.\n") =>
  `---\nname: ${name}\ndescription: Writes the release notes.\n---\n\n# ${name}\n\n${body}`;

let botId: string;
let libraryRoot: string;

beforeEach(() => {
  botId = `bot-skill-edit-${Math.random().toString(36).slice(2, 10)}`;
  libraryRoot = mkdtempSync(join(tmpdir(), "sagax-lib-skill-"));
});

afterEach(async () => {
  await removeTempDir(libraryRoot);
});

describe("bot skill person edit and review-hash", () => {
  it("owner save updates the reviewed hash so enablement is no longer blocked", () => {
    const installed = skills.installSkill(botId, "local-import", [{ path: "SKILL.md", content: SKILL("notes") }]);
    expect("error" in installed).toBe(false);
    if ("error" in installed) return;
    expect(skills.setSkillEnabled(botId, "notes", true)).toMatchObject({ enabled: true });

    // External change: rewrite SKILL.md without updating the hash.
    const folder = edit.botSkillFolder(botId, "notes")!;
    writeFileSync(join(folder, "SKILL.md"), SKILL("notes", "Changed outside.\n"));
    expect(skills.listSkills(botId)[0]).toMatchObject({
      enabled: false,
      warnings: [expect.stringContaining("changed after review")],
    });
    expect(skills.setSkillEnabled(botId, "notes", true)).toMatchObject({
      error: expect.stringContaining("changed after review"),
    });

    // Open editor (seeds nothing new while drifted), then person Save.
    const payload = edit.loadBotSkillEditor(botId, "notes");
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    expect(payload.changedAfterReview).toBe(true);

    const saved = edit.updateBotSkillByPerson(botId, "notes", {
      name: "notes",
      description: "Writes the release notes.",
      instructions: "Person reviewed body.",
    });
    expect("error" in saved).toBe(false);
    if ("error" in saved) return;
    expect(saved.skill).toMatchObject({ name: "notes", enabled: true });
    expect(saved.skill.warnings.some((warning) => warning.includes("changed after review"))).toBe(false);
    expect(skills.setSkillEnabled(botId, "notes", true)).toMatchObject({ enabled: true });
  });

  it("Accept re-signs the current file; Revert restores the reviewed snapshot", () => {
    skills.installSkill(botId, "local-import", [{ path: "SKILL.md", content: SKILL("audit") }]);
    skills.setSkillEnabled(botId, "audit", true);
    // Seed the reviewed snapshot by opening while intact.
    const opened = edit.loadBotSkillEditor(botId, "audit");
    expect("error" in opened).toBe(false);

    const folder = edit.botSkillFolder(botId, "audit")!;
    const drifted = SKILL("audit", "External rewrite.\n");
    writeFileSync(join(folder, "SKILL.md"), drifted);
    expect(skills.listSkills(botId)[0]?.warnings.join(" ")).toContain("changed after review");

    const accepted = edit.acceptBotSkillReview(botId, "audit");
    expect("error" in accepted).toBe(false);
    if ("error" in accepted) return;
    expect(accepted.warnings.some((warning) => warning.includes("changed after review"))).toBe(false);
    expect(readFileSync(join(folder, "SKILL.md"), "utf8")).toBe(drifted);

    // Drift again, then Revert to the Accept snapshot (the drifted text).
    writeFileSync(join(folder, "SKILL.md"), SKILL("audit", "Even newer.\n"));
    const reverted = edit.revertBotSkillReview(botId, "audit");
    expect("error" in reverted).toBe(false);
    if ("error" in reverted) return;
    expect(readFileSync(join(folder, "SKILL.md"), "utf8")).toBe(drifted);
    expect(reverted.warnings.some((warning) => warning.includes("changed after review"))).toBe(false);
  });

  it("lists supporting files beside SKILL.md", () => {
    skills.installSkill(botId, "local-import", [{ path: "SKILL.md", content: SKILL("pack") }]);
    const folder = edit.botSkillFolder(botId, "pack")!;
    writeFileSync(join(folder, "README.md"), "# Pack\n");
    mkdirSync(join(folder, "refs"), { recursive: true });
    writeFileSync(join(folder, "refs", "example.txt"), "example");
    const files = edit.listSkillSupportingFiles(folder);
    expect(files.map((file) => file.path).sort()).toEqual(["README.md", "refs/example.txt"]);
    const readme = edit.readSkillFolderFile(folder, "README.md");
    expect(readme).toMatchObject({ kind: "text", text: "# Pack\n" });
  });
});

describe("library skill person edit and review-hash", () => {
  it("owner save unblocks; Accept re-signs; Revert restores", () => {
    library.installLibrarySkill({
      name: "notes",
      instructions: SKILL("notes"),
      source: "local-import",
      reviewState: "approved",
      root: libraryRoot,
    });
    edit.ensureLibraryReviewedSnapshot("notes", libraryRoot);

    const folder = edit.librarySkillFolder("notes", libraryRoot)!;
    writeFileSync(join(folder, "SKILL.md"), SKILL("notes", "Drifted.\n"));
    expect(library.listLibrarySkills(libraryRoot)[0]?.warnings.join(" ")).toContain("changed after review");
    expect(library.setLibrarySkillReviewState("notes", "approved", libraryRoot)).toMatchObject({
      error: expect.stringContaining("changed after review"),
    });

    const accepted = edit.acceptLibrarySkillReview("notes", libraryRoot);
    expect("error" in accepted).toBe(false);
    if ("error" in accepted) return;
    expect(accepted.enabled).toBe(true);
    expect(accepted.warnings.some((warning) => warning.includes("changed after review"))).toBe(false);

    writeFileSync(join(folder, "SKILL.md"), SKILL("notes", "Newer drift.\n"));
    const reverted = edit.revertLibrarySkillReview("notes", libraryRoot);
    expect("error" in reverted).toBe(false);
    if ("error" in reverted) return;
    expect(readFileSync(join(folder, "SKILL.md"), "utf8")).toContain("Drifted.");
  });

  it("library Save by the person updates the reviewed hash", () => {
    library.installLibrarySkill({
      name: "triage",
      instructions: SKILL("triage"),
      source: "local-import",
      reviewState: "approved",
      root: libraryRoot,
    });
    const text = SKILL("triage", "Person edit.\n");
    const updated = library.updateLibrarySkill("triage", { text, warnings: [] }, libraryRoot);
    expect("error" in updated).toBe(false);
    edit.afterLibrarySkillPersonSave("triage", text, libraryRoot);
    expect(library.listLibrarySkills(libraryRoot)[0]).toMatchObject({ enabled: true, warnings: [] });
  });
});

describe("skillSourceLabel", () => {
  it("folds raw learn:inbox paths into a human label", () => {
    expect(edit.skillSourceLabel("learn:inbox/alex/order-audit.SKILL.md")).toBe("Learned from inbox");
    expect(edit.skillSourceLabel("local-import")).toBe("Imported");
    expect(edit.skillSourceLabel("org:pack@1.0.0")).toBe("Organization library");
  });
});
