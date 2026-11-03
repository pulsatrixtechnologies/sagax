// A path shown once: preview, save disabled, or refuse. An existing skill
// is replaced only with agreement. Another skill is left as it was.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import { PASS } from "./table.ts";
import { createShownPathRoutes } from "./shown-path.ts";
import { installSkill, listSkills, readSkillFile, removeSkill } from "../skills/skills.ts";
import { ensureWorkspace, workspaceDir } from "../workspace.ts";

const steps = [{ id: "1", kind: "note", text: "Check the total." }];

let counter = 0;
let BOT = "";
beforeEach(() => {
  BOT = `shown-path-${process.pid}-${counter++}`;
  rmSync(join(DATA_DIR, "skill-state", BOT), { recursive: true, force: true });
  rmSync(workspaceDir(BOT), { recursive: true, force: true });
  ensureWorkspace(BOT);
});

function setup(refused: { status: number; body: Record<string, unknown> } | null = null) {
  const audits: Array<{ name: string; replaced: boolean }> = [];
  const route = createShownPathRoutes({
    bot: (id) => (id === BOT ? { id: BOT } : undefined),
    refusal: () => refused,
    existingNames: (botId) => listSkills(botId).map((skill) => skill.name),
    install: (botId, source, files) => {
      const result = installSkill(botId, source, files);
      return "error" in result ? result : { name: result.name };
    },
    remove: (botId, name) => removeSkill(botId, name),
    audit: (_auth, _req, row) => audits.push(row),
  });
  const post = async (body: unknown, method = "POST", path = `/api/bots/${BOT}/shown-path`) => {
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
}

describe("shown path route", () => {
  it("previews, refuses, and saves without touching an uploaded skill", async () => {
    installSkill(BOT, "upload:kept.md", [{ path: "SKILL.md", content: "---\nname: uploaded-one\ndescription: Stays.\n---\n\n# uploaded-one\n" }]);
    const { post, audits } = setup();
    const preview = await post({ mode: "preview", title: "Weekly total", description: "Read the total", steps });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ ok: true, name: "weekly-total", exists: false });
    expect(String(preview.body.markdown)).toContain("Check the total.");
    expect(listSkills(BOT).map((skill) => skill.name)).toEqual(["uploaded-one"]);

    const refused = await post({ mode: "refuse", title: "Weekly total", steps });
    expect(refused.body).toEqual({ ok: true, refused: true });
    expect(listSkills(BOT).map((skill) => skill.name)).toEqual(["uploaded-one"]);

    const saved = await post({ mode: "save", title: "Weekly total", description: "Read the total", steps, recordedAt: "2026-10-27T12:00:00.000Z" });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ ok: true, installed: "weekly-total", replaced: false });
    const names = listSkills(BOT).map((skill) => [skill.name, skill.enabled]);
    expect(names).toEqual([["uploaded-one", false], ["weekly-total", false]]);
    expect(audits).toEqual([{ botId: BOT, name: "weekly-total", replaced: false }]);
  });

  it("does not replace an existing skill unless the person agrees", async () => {
    const { post } = setup();
    await post({ mode: "save", title: "Weekly total", steps });
    const blocked = await post({ mode: "save", title: "Weekly total", steps: [{ id: "2", kind: "note", text: "A different step." }] });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ ok: false, code: "exists", name: "weekly-total" });
    const kept = readSkillFile(BOT, "weekly-total") ?? "";
    expect(kept).toContain("Check the total.");
    expect(kept).not.toContain("A different step.");

    const replaced = await post({ mode: "save", title: "Weekly total", steps: [{ id: "2", kind: "note", text: "A different step." }], replace: true });
    expect(replaced.status).toBe(201);
    expect(replaced.body).toMatchObject({ installed: "weekly-total", replaced: true });
    const next = readSkillFile(BOT, "weekly-total") ?? "";
    expect(next).toContain("A different step.");
    expect(next).not.toContain("Check the total.");
  });

  it("keeps the skills routes' rights and refuses a bad body", async () => {
    expect((await setup({ status: 403, body: { error: "no" } }).post({ mode: "save", title: "Weekly total", steps })).status).toBe(403);
    const { post } = setup();
    expect((await post({ mode: "save", title: "", steps })).status).toBe(400);
    expect((await post({ mode: "save", title: "Weekly total", steps: [] })).status).toBe(400);
    expect((await post({}, "GET")).out).toBe(PASS);
    expect((await post({ mode: "preview", title: "Weekly total", steps }, "POST", "/api/bots/nobody/shown-path")).status).toBe(404);
  });
});
