import { describe, expect, it } from "vitest";

import { skillEditorApiPath, skillSourceLabel } from "./skills-ui";

describe("skillSourceLabel", () => {
  it("folds raw learn:inbox paths into a human label", () => {
    expect(skillSourceLabel("learn:inbox/alex/order-audit.SKILL.md")).toBe("Learned from inbox");
    expect(skillSourceLabel("learn:path")).toBe("Learned");
    expect(skillSourceLabel("local-import")).toBe("Imported");
    expect(skillSourceLabel("upload:notes.zip")).toBe("Uploaded");
    expect(skillSourceLabel("org:pack@1.0.0")).toBe("Organization library");
    expect(skillSourceLabel("github:acme/skills")).toBe("GitHub");
    expect(skillSourceLabel("https://skills.sh/acme/pack")).toBe("skills.sh");
    expect(skillSourceLabel("")).toBe("Source");
  });
});

describe("skillEditorApiPath", () => {
  it("routes private, me and library skills to the matching API", () => {
    expect(skillEditorApiPath("bot-1", "notes", "private")).toBe("/api/bots/bot-1/skills/notes");
    expect(skillEditorApiPath("bot-1", "notes", undefined)).toBe("/api/bots/bot-1/skills/notes");
    expect(skillEditorApiPath("bot-1", "notes", "me")).toBe("/api/me/skills-library/notes");
    expect(skillEditorApiPath("bot-1", "notes", "library")).toBe("/api/skills-library/notes");
  });
});
