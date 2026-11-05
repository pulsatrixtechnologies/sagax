import { describe, expect, it } from "vitest";

import { fixtureVault } from "./obsidian-import-fixture.ts";
import {
  DEFAULT_VAULT_OPTIONS,
  botImportAttachmentPath,
  botImportNotePath,
  inlineTags,
  parseFrontMatter,
  pieces,
  planVaultImport,
  pxTag,
  safeVaultPath,
  stripVaultRoot,
  topicSlug,
  vaultTextHoldsSecret,
} from "./obsidian-import.ts";

function vault() {
  const files = fixtureVault();
  const { root, paths } = stripVaultRoot(files.map((file) => file.path));
  return { root, files: files.map((file, i) => ({ ...file, path: paths[i]! })) };
}

describe("vault paths", () => {
  it("refuses a path that could leave the vault", () => {
    for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd", "C:/x.md", "a\\b.md", "a//b.md", "a/./b.md", "a\u0000.md", ""]) {
      expect(safeVaultPath(bad), bad).toBeNull();
    }
    expect(safeVaultPath("./Projects/Alpha plan.md")).toBe("Projects/Alpha plan.md");
  });

  it("finds the vault's own top folder", () => {
    expect(stripVaultRoot(["V/a.md", "V/b/c.md"])).toEqual({ root: "V", paths: ["a.md", "b/c.md"] });
    expect(stripVaultRoot(["a.md", "b/c.md"]).root).toBe("");
  });

  it("checks the paths the server writes", () => {
    expect(botImportNotePath("memory/Field Notes - Welcome.md")).toBe(true);
    expect(botImportNotePath("memory/../SOUL.md")).toBe(false);
    expect(botImportNotePath("memory/a/b.md")).toBe(false);
    expect(botImportAttachmentPath("memory-attachments/Field-Notes/assets/diagram.png")).toBe(true);
    expect(botImportAttachmentPath("memory-attachments/../SOUL.md")).toBe(false);
    expect(botImportAttachmentPath("memory-attachments/x/run.sh")).toBe(false);
    expect(botImportAttachmentPath("docs/diagram.png")).toBe(false);
  });
});

describe("markdown", () => {
  it("reads YAML front matter: scalars, inline and block lists", () => {
    const front = parseFrontMatter("---\ntitle: \"Hello\"\ntags: [a, b]\naliases:\n  - One\n  - Two\n---\nBody\n");
    expect(front.data).toEqual({ title: "Hello", tags: ["a", "b"], aliases: ["One", "Two"] });
    expect(front.body).toBe("Body\n");
    expect(parseFrontMatter("No header").raw).toBeNull();
  });

  it("finds #tags outside code, not headings or numbers", () => {
    expect(inlineTags("# Heading\nText #one and #two/three, #2026 `#code`\n```\n#fenced\n```\n")).toEqual(["one", "two/three"]);
  });

  it("makes Perspicax topics and tags", () => {
    expect(topicSlug("Field Notes / Été")).toBe("field-notes-ete");
    expect(topicSlug("Inbox")).toBe("inbox-notes");
    expect(topicSlug("x".repeat(80)).length).toBe(48);
    expect(pxTag("Project/Alpha")).toBe("project/alpha");
    expect(pxTag("###")).toBeNull();
  });

  it("cuts a long body under the Perspicax limit at its paragraphs", () => {
    const body = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} ${"word ".repeat(80)}`).join("\n\n");
    const parts = pieces(body);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(3800);
  });

  it("sees the secret shapes of the shared filter and of the Perspicax gate", () => {
    expect(vaultTextHoldsSecret(`key ${"ghp_"}${"a".repeat(36)}`)).toBe(true);
    expect(vaultTextHoldsSecret("Server=sql1;User Id=sa;Password=Hunter22;")).toBe(true);
    expect(vaultTextHoldsSecret("postgres://admin:s3cret@db.local/app")).toBe(true);
    expect(vaultTextHoldsSecret("The password is in the vault, see the onboarding procedure.")).toBe(false);
  });
});

describe("planVaultImport", () => {
  it("plans the fixture vault into a Perspicax tier", () => {
    const { root, files } = vault();
    expect(root).toBe("Field Notes");
    const plan = planVaultImport({
      vaultName: root,
      files,
      options: DEFAULT_VAULT_OPTIONS,
      destination: "perspicax",
      folder: root,
      existing: [{ folder: "field-notes", title: "Existing", id: "ex1", body: "something else" }],
    });
    const byTitle = Object.fromEntries(plan.notes.map((note) => [note.title, note]));
    expect(Object.keys(byTitle).sort()).toEqual(["Alpha plan", "Existing", "Jane Doe", "Welcome"]);
    // nested folders become topics under the vault's own
    expect(byTitle["Alpha plan"]!.folder).toBe("field-notes-projects-alpha");
    expect(byTitle["Jane Doe"]!.folder).toBe("field-notes-people");
    expect(byTitle.Welcome!.folder).toBe("field-notes");
    // links point at the imported titles; code and unknown targets stay as they are
    expect(byTitle.Welcome!.body).toContain("[[Alpha plan]]");
    expect(byTitle.Welcome!.body).toContain("[[Jane Doe|Jane]]");
    expect(byTitle.Welcome!.body).toContain("[[not a link]]");
    expect(byTitle["Alpha plan"]!.body).toContain("[[Jane Doe|People/Jane Doe]]");
    expect(byTitle["Alpha plan"]!.body).toContain("[[Missing note]]");
    expect(byTitle["Jane Doe"]!.body).toContain("[[Alpha plan#Owners]]");
    // tags from the front matter and the text
    expect(byTitle.Welcome!.tags).toEqual(["inbox", "start", "getting-started"]);
    expect(byTitle["Alpha plan"]!.tags).toEqual(["project/alpha", "roadmap"]);
    // properties kept as the note's front matter
    expect(byTitle["Alpha plan"]!.body.startsWith("---\naliases:")).toBe(true);
    expect(byTitle["Alpha plan"]!.body).toContain("status: active");
    // the conflict is skipped by default
    expect(byTitle.Existing).toMatchObject({ action: "skip", conflict: true });
    // Perspicax keeps no attachment: the image is reported
    expect(plan.attachments).toEqual([]);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { path: ".obsidian/app.json", reason: "system" },
      { path: ".trash/Old.md", reason: "system" },
      { path: ".env", reason: "secret" },
      { path: "Leaked key.md", reason: "secret" },
      { path: "assets/diagram.png", reason: "attachment_unsupported" },
    ]));
    expect(plan.counts).toMatchObject({ notes: 3, conflicts: 1, secrets: 2, attachments: 0, tags: 6 });
    expect(plan.counts.links).toBe(4);
    // nothing of the key reaches the plan
    expect(JSON.stringify(plan)).not.toContain("api03");
  });

  it("renames or overwrites a conflict when asked, and sees an unchanged note", () => {
    const { root, files } = vault();
    const base = { vaultName: root, files, destination: "perspicax" as const, folder: root };
    const renamed = planVaultImport({ ...base, options: { ...DEFAULT_VAULT_OPTIONS, conflict: "rename" }, existing: [{ folder: "field-notes", title: "Existing" }] });
    expect(renamed.notes.find((note) => note.source === "Existing.md")).toMatchObject({ title: "Existing (2)", action: "rename" });
    const over = planVaultImport({ ...base, options: { ...DEFAULT_VAULT_OPTIONS, conflict: "overwrite" }, existing: [{ folder: "field-notes", title: "Existing", id: "ex1" }] });
    expect(over.notes.find((note) => note.source === "Existing.md")).toMatchObject({ title: "Existing", action: "overwrite", existingId: "ex1" });
    const first = planVaultImport({ ...base, options: DEFAULT_VAULT_OPTIONS, existing: [] });
    // a second run over what the first wrote writes nothing
    const again = planVaultImport({ ...base, options: { ...DEFAULT_VAULT_OPTIONS, conflict: "rename" }, existing: first.notes.map((note) => ({ folder: note.folder, title: note.title, body: note.body })) });
    expect(again.counts.notes).toBe(0);
    expect(again.counts.unchanged).toBe(first.notes.length);
  });

  it("plans a bot's flat memory with its attachments", () => {
    const { root, files } = vault();
    const plan = planVaultImport({ vaultName: root, files, options: DEFAULT_VAULT_OPTIONS, destination: "bot", folder: root, existing: [] });
    const paths = plan.notes.map((note) => note.path).sort();
    expect(paths).toEqual([
      "memory/Field Notes - Existing.md",
      "memory/Field Notes - People - Jane Doe.md",
      "memory/Field Notes - Projects - Alpha - Alpha plan.md",
      "memory/Field Notes - Welcome.md",
    ]);
    for (const path of paths) expect(botImportNotePath(path!)).toBe(true);
    const alpha = plan.notes.find((note) => note.source === "Projects/Alpha/Alpha plan.md")!;
    expect(alpha.body).toContain("![diagram.png](memory-attachments/Field-Notes/assets/diagram.png)");
    expect(alpha.body).toContain("[[Field Notes - People - Jane Doe|People/Jane Doe]]");
    expect(alpha.body).toContain("tags: [project/alpha, roadmap]");
    expect(plan.attachments).toEqual([{ source: "assets/diagram.png", target: "memory-attachments/Field-Notes/assets/diagram.png", size: expect.any(Number) }]);
    for (const attachment of plan.attachments) expect(botImportAttachmentPath(attachment.target)).toBe(true);
  });

  it("keeps the options off when asked: flat, links and tags untouched, no properties", () => {
    const { root, files } = vault();
    const plan = planVaultImport({
      vaultName: root,
      files,
      options: { ...DEFAULT_VAULT_OPTIONS, keepStructure: false, wikilinks: false, tags: false, properties: false, attachments: false, skipSystem: false },
      destination: "perspicax",
      folder: root,
      existing: [],
    });
    const alpha = plan.notes.find((note) => note.source === "Projects/Alpha/Alpha plan.md")!;
    expect(alpha.folder).toBe("field-notes");
    expect(alpha.body).toContain("[[People/Jane Doe]]");
    expect(alpha.body).toContain("![[diagram.png]]");
    expect(alpha.body.startsWith("---")).toBe(false);
    expect(alpha.tags).toEqual([]);
    // .trash is read when asked; .obsidian holds no note
    expect(plan.notes.some((note) => note.source === ".trash/Old.md")).toBe(true);
    expect(plan.skipped).toContainEqual({ path: ".obsidian/app.json", reason: "unsupported" });
  });

  it("refuses unsafe, oversized and unsupported files", () => {
    const plan = planVaultImport({
      vaultName: "v",
      files: [
        { path: "../escape.md", size: 3, text: "abc" },
        { path: "big.md", size: 2_000_000, text: "x" },
        { path: "script.sh", size: 3 },
        { path: "keys/id_rsa", size: 3 },
      ],
      options: DEFAULT_VAULT_OPTIONS,
      destination: "bot",
      folder: "v",
      existing: [],
    });
    expect(plan.notes).toEqual([]);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual(["unsafe_path", "too_large", "unsupported", "secret"]);
  });
});
