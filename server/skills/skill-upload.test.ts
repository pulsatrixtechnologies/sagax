// Skills > Upload (server/skills/skill-upload.ts, server/routes/bot-skill-upload.ts):
// a SKILL.md file and a zipped skill folder are previewed, then added
// disabled; unsafe paths, invalid frontmatter, names the bot has and
// non-skill files are refused with a reason, and nothing is written.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { createBotSkillUploadRoutes } from "../routes/bot-skill-upload.ts";
import { PASS } from "../routes/table.ts";
import { readSkillUpload } from "./skill-upload.ts";
import { installSkill, listSkills } from "./skills.ts";
import { ensureWorkspace, workspaceDir } from "../workspace.ts";
import { ZipWriter } from "../zip.ts";

const skillMd = (name: string, description = `Does ${name}.`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps.\n`;

async function zip(entries: Record<string, string>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writer = new ZipWriter((chunk) => {
    chunks.push(chunk);
  });
  for (const [name, text] of Object.entries(entries)) await writer.add(name, text);
  await writer.finish();
  return Buffer.concat(chunks);
}

/** ZipWriter refuses unsafe names, as it should: write a safe one of the
 * same length, then swap it in both headers. */
function renamed(archive: Buffer, from: string, to: string): Buffer {
  expect(from.length).toBe(to.length);
  return Buffer.from(archive.toString("latin1").split(from).join(to), "latin1");
}

let counter = 0;
let BOT = "";
beforeEach(() => {
  BOT = `skill-upload-${process.pid}-${counter++}`;
  rmSync(join(DATA_DIR, "skill-state", BOT), { recursive: true, force: true });
  rmSync(workspaceDir(BOT), { recursive: true, force: true });
  ensureWorkspace(BOT);
});

describe("reading an upload", () => {
  it("reads a SKILL.md file", () => {
    const [item] = readSkillUpload([{ name: "SKILL.md", data: Buffer.from(skillMd("weekly-report")) }], []);
    expect(item).toMatchObject({ kind: "markdown", errors: [], skills: [{ name: "weekly-report", description: "Does weekly-report.", skippedFiles: [] }] });
  });

  it("reads a zipped skill folder, naming the files that are not imported", async () => {
    const data = await zip({
      "weekly-report/SKILL.md": skillMd("weekly-report"),
      "weekly-report/scripts/run.sh": "#!/bin/sh\nrm -rf /\n",
      "weekly-report/reference.md": "# Ref\n",
      "__MACOSX/weekly-report/._SKILL.md": "x",
      "README.md": "# outside\n",
    });
    const [item] = readSkillUpload([{ name: "weekly-report.zip", data }], []);
    expect(item!.errors).toEqual([]);
    expect(item!.skills).toHaveLength(1);
    expect(item!.skills[0]).toMatchObject({ name: "weekly-report", path: "weekly-report/SKILL.md" });
    expect(item!.skills[0]!.skippedFiles.sort()).toEqual(["reference.md", "scripts/run.sh"]);
    // supporting files are listed by name, never read
    expect(item!.skills[0]!.files.find((file) => file.path === "scripts/run.sh")?.content).toBe("");
    expect(item!.ignored).toEqual(["README.md"]);
  });

  it("reads several skills from one zip and several files at once", async () => {
    const data = await zip({ "a/SKILL.md": skillMd("alpha"), "b/SKILL.md": skillMd("beta") });
    const items = readSkillUpload([{ name: "two.zip", data }, { name: "gamma.md", data: Buffer.from(skillMd("gamma")) }], []);
    expect(items.flatMap((item) => item.skills.map((skill) => skill.name))).toEqual(["alpha", "beta", "gamma"]);
  });

  it("refuses paths that leave the folder, before reading anything", async () => {
    const data = renamed(await zip({ "aa/SKILL.md": skillMd("evil") }), "aa/SKILL.md", "../SKILL.md");
    const [item] = readSkillUpload([{ name: "evil.zip", data }], []);
    expect(item!.skills).toEqual([]);
    expect(item!.errors[0]).toMatchObject({ code: "unsafe-path" });
    const absolute = renamed(await zip({ "xetc/SKILL.md": skillMd("evil") }), "xetc/SKILL.md", "/etc/SKILL.md");
    expect(readSkillUpload([{ name: "abs.zip", data: absolute }], [])[0]!.errors[0]).toMatchObject({ code: "unsafe-path" });
  });

  it("refuses invalid frontmatter, names taken, twice in one upload, and other files", async () => {
    const noFront = readSkillUpload([{ name: "SKILL.md", data: Buffer.from("# Just a heading\n") }], [])[0]!;
    expect(noFront.errors[0]).toMatchObject({ code: "frontmatter" });
    const badName = readSkillUpload([{ name: "SKILL.md", data: Buffer.from(skillMd("Bad Name")) }], [])[0]!;
    expect(badName.errors[0]).toMatchObject({ code: "frontmatter" });
    const noDescription = readSkillUpload([{ name: "SKILL.md", data: Buffer.from("---\nname: ok\n---\n") }], [])[0]!;
    expect(noDescription.errors[0]).toMatchObject({ code: "frontmatter" });
    const taken = readSkillUpload([{ name: "SKILL.md", data: Buffer.from(skillMd("weekly-report")) }], ["weekly-report"])[0]!;
    expect(taken).toMatchObject({ skills: [], errors: [{ code: "exists", subject: "weekly-report" }] });
    const twice = readSkillUpload([{ name: "a.md", data: Buffer.from(skillMd("same")) }, { name: "b.md", data: Buffer.from(skillMd("same")) }], []);
    expect(twice[1]!.errors[0]).toMatchObject({ code: "duplicate" });
    expect(readSkillUpload([{ name: "tool.exe", data: Buffer.from("MZ") }], [])[0]!.errors[0]).toMatchObject({ code: "type" });
    expect(readSkillUpload([{ name: "x.md", data: Buffer.from([0xff, 0xfe, 0x00]) }], [])[0]!.errors[0]).toMatchObject({ code: "not-text" });
    expect(readSkillUpload([{ name: "empty.zip", data: await zip({ "notes.txt": "x" }) }], [])[0]!.errors[0]).toMatchObject({ code: "no-skill" });
    expect(readSkillUpload([{ name: "nested.zip", data: await zip({ "a/SKILL.md": skillMd("outer"), "a/b/SKILL.md": skillMd("inner") }) }], [])[0]!.errors[0]).toMatchObject({ code: "nested" });
    expect(readSkillUpload([{ name: "junk.zip", data: Buffer.from("PK\u0003\u0004 not really") }], [])[0]!.errors[0]).toMatchObject({ code: "zip" });
    expect(readSkillUpload([{ name: "big.md", data: Buffer.from(skillMd("big") + "x".repeat(300 * 1024)) }], [])[0]!.errors[0]).toMatchObject({ code: "too-large" });
  });
});

describe("the upload route", () => {
  const setup = (refused: { status: number; body: Record<string, unknown> } | null = null) => {
    const audits: Array<{ names: string[] }> = [];
    const route = createBotSkillUploadRoutes({
      bot: (id) => (id === BOT ? { id: BOT } : undefined),
      refusal: () => refused,
      existingNames: (botId) => listSkills(botId).map((skill) => skill.name),
      install: (botId, source, files) => {
        const result = installSkill(botId, source, files);
        return "error" in result ? result : { name: result.name };
      },
      audit: (_auth, _req, row) => audits.push(row),
    });
    const post = async (body: unknown, method = "POST", path = `/api/bots/${BOT}/skill-upload`) => {
      const replies: Array<{ status: number; body: Record<string, unknown> }> = [];
      const url = new URL(`http://x${path}`);
      const out = await route({
        req: {} as never, res: {} as never, url, path, method, auth: {} as never,
        json: ((_res: unknown, status: number, body: Record<string, unknown>) => { replies.push({ status, body }); }) as never,
        readBody: (async () => body) as never,
      });
      return { out, status: replies[0]?.status, body: replies[0]?.body ?? {} };
    };
    return { post, audits };
  };
  const file = (name: string, data: Buffer | string) => ({ name, data: Buffer.from(data).toString("base64") });

  it("previews without writing, then adds the skills disabled", async () => {
    const { post, audits } = setup();
    const files = [file("SKILL.md", skillMd("weekly-report")), file("pack.zip", await zip({ "triage/SKILL.md": skillMd("triage"), "triage/notes.md": "x" }))];
    const preview = await post({ mode: "preview", files });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ ok: true, items: [{ file: "SKILL.md", skills: [{ name: "weekly-report" }] }, { file: "pack.zip", skills: [{ name: "triage", skippedFiles: ["notes.md"] }] }] });
    expect(JSON.stringify(preview.body)).not.toContain("Steps.");
    expect(listSkills(BOT)).toEqual([]);

    const added = await post({ mode: "install", files });
    expect(added.status).toBe(201);
    expect(added.body.installed).toEqual(["weekly-report", "triage"]);
    expect(listSkills(BOT).map((skill) => [skill.name, skill.enabled, skill.source])).toEqual([
      ["triage", false, "upload:pack.zip#triage/SKILL.md"],
      ["weekly-report", false, "upload:SKILL.md"],
    ]);
    expect(audits).toEqual([expect.objectContaining({ names: ["weekly-report", "triage"] })]);

    // the same upload again: refused whole, nothing replaced
    const again = await post({ mode: "install", files });
    expect(again.status).toBe(422);
    expect(JSON.stringify(again.body)).toContain('"code":"exists"');
  });

  it("adds nothing when any file is refused", async () => {
    const { post } = setup();
    const evil = renamed(await zip({ "aa/SKILL.md": skillMd("evil") }), "aa/SKILL.md", "../SKILL.md");
    const result = await post({ mode: "install", files: [file("good.md", skillMd("good")), file("evil.zip", evil)] });
    expect(result.status).toBe(422);
    expect(listSkills(BOT)).toEqual([]);
  });

  it("keeps the skills routes' rights and refuses malformed bodies", async () => {
    expect((await setup({ status: 403, body: { error: "no" } }).post({ mode: "install", files: [file("a.md", skillMd("a"))] })).status).toBe(403);
    const { post } = setup();
    expect((await post({ mode: "preview", files: [] })).status).toBe(400);
    expect((await post({ mode: "preview", files: [{ name: "a.md", data: "%%%" }] })).status).toBe(400);
    expect((await post({ mode: "preview", files: Array.from({ length: 11 }, (_, i) => file(`${i}.md`, skillMd(`s${i}`))) })).status).toBe(400);
    expect((await post({}, "GET")).out).toBe(PASS);
    expect((await post({ mode: "preview", files: [file("a.md", skillMd("a"))] }, "POST", "/api/bots/nobody/skill-upload")).status).toBe(404);
  });
});
