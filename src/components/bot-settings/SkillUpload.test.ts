// Skills > Upload: the button, the preview of what each file holds, a clear
// sentence per refusal in the person's language, and the size checks made
// before anything is read.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import * as server from "../../../server/skills/skill-upload.ts";
import { SKILL_FILE_MAX_BYTES } from "../../../shared/skill-md.ts";
import {
  SKILL_MD_MAX_BYTES,
  SKILL_UPLOAD_MAX_FILES,
  SKILL_UPLOAD_TOTAL_MAX_BYTES,
  SKILL_ZIP_MAX_BYTES,
  SkillUpload,
  SkillUploadPreview,
  uploadErrorText,
  uploadSizeProblem,
  type UploadPreviewItem,
} from "./SkillUpload";

const clean = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const item = (patch: Partial<UploadPreviewItem>): UploadPreviewItem => ({ file: "pack.zip", kind: "zip", errors: [], ignored: [], ignoredCount: 0, skills: [], ...patch });

beforeEach(() => setLocale("en"));

describe("SkillUpload", () => {
  it("keeps its limits equal to the server's", () => {
    expect(SKILL_UPLOAD_MAX_FILES).toBe(server.SKILL_UPLOAD_MAX_FILES);
    expect(SKILL_ZIP_MAX_BYTES).toBe(server.SKILL_UPLOAD_ZIP_MAX_BYTES);
    expect(SKILL_UPLOAD_TOTAL_MAX_BYTES).toBe(server.SKILL_UPLOAD_TOTAL_MAX_BYTES);
    expect(SKILL_MD_MAX_BYTES).toBe(SKILL_FILE_MAX_BYTES);
  });

  it("shows an Upload button that takes SKILL.md files and zips, several at once", () => {
    const html = clean(renderToStaticMarkup(createElement(SkillUpload, { botId: "pepper", onAdded: () => {} })));
    expect(html).toContain('type="file" multiple=""');
    expect(html).toContain('accept=".md,.markdown,.zip,text/markdown,application/zip"');
    expect(html).toContain(">Upload<");
    expect(html).toContain("Skills arrive switched off");
  });

  it("previews each skill with the files that are not imported", () => {
    const html = clean(renderToStaticMarkup(createElement(SkillUploadPreview, {
      items: [item({ skills: [{ name: "triage", description: "Sorts tickets.", path: "triage/SKILL.md", bytes: 120, warnings: [], skippedFiles: ["scripts/run.sh"], skippedCount: 1 }], ignored: ["README.md"], ignoredCount: 1 })],
      onRemove: () => {},
    })));
    expect(html).toContain("triage");
    expect(html).toContain("Sorts tickets.");
    expect(html).toContain("Not imported (only SKILL.md is): scripts/run.sh");
    expect(html).toContain("Outside any skill folder, not imported: README.md");
    expect(html).toContain('aria-label="Remove pack.zip from the upload"');
  });

  it("says why a file is refused, in the person's language", () => {
    const unsafe = { code: "unsafe-path", subject: "../SKILL.md", detail: "x" };
    expect(uploadErrorText(item({}), unsafe)).toBe("../SKILL.md: a path leaves the skill folder, or is a link. Nothing was extracted.");
    expect(uploadErrorText(item({ file: "a.md" }), { code: "frontmatter", detail: "frontmatter description is required" })).toContain("a.md: the front matter needs a name");
    setLocale("fr");
    expect(uploadErrorText(item({}), { code: "exists", subject: "triage", detail: "x" })).toBe("triage : ce bot a déjà une compétence de ce nom. Retire-la d'abord ou renomme la compétence.");
    const html = clean(renderToStaticMarkup(createElement(SkillUploadPreview, { items: [item({ errors: [unsafe] })] })));
    expect(html).toContain('data-skill-upload-error="unsafe-path"');
  });

  it("refuses a file too large before reading it", () => {
    expect(uploadSizeProblem({ name: "SKILL.md", size: 1000 })).toBeNull();
    expect(uploadSizeProblem({ name: "SKILL.md", size: SKILL_MD_MAX_BYTES + 1 })).toContain("SKILL.md is too large");
    expect(uploadSizeProblem({ name: "pack.zip", size: SKILL_MD_MAX_BYTES + 1 })).toBeNull();
    expect(uploadSizeProblem({ name: "pack.zip", size: SKILL_ZIP_MAX_BYTES + 1 })).not.toBeNull();
  });
});
