// Skills > Upload in the persona editor (server/skills/skill-upload.ts): a SKILL.md
// file, a zipped skill folder, or several at once, previewed first and then
// added DISABLED to the bot's skill store, like a GitHub import.
//
//   POST /api/bots/:id/skill-upload  { mode: "preview" | "install",
//                                      files: [{ name, data: base64 }] }
//
// preview answers what each file holds (name, description, scan warnings,
// files that are not imported) and why a file or a skill is refused; it
// writes nothing. install reads the same files again, refuses the whole
// upload (422, with the same preview) if anything in it is refused, and
// otherwise adds every skill. The rights are the skills routes' own (the
// bot's owner, someone who manages it, or an organization admin; never
// when an admin manages this person's integrations), passed in as
// `refusal`; every install is written to the admin activity log.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  SKILL_UPLOAD_BODY_MAX_BYTES,
  SKILL_UPLOAD_MAX_FILES,
  SKILL_UPLOAD_TOTAL_MAX_BYTES,
  previewItem,
  readSkillUpload,
  type SkillUploadFile,
} from "../skills/skill-upload.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotSkillUploadDeps {
  bot(id: string): { id: string } | null | undefined;
  /** Why this caller may not change the bot's skills, or null. */
  refusal(auth: RequestAuth, botId: string): { status: number; body: Record<string, unknown> } | null;
  /** The skill names the bot already has (its own, and assigned library ones). */
  existingNames(botId: string): string[];
  /** server/skills/skills.ts installSkill */
  install(botId: string, source: string, files: Array<{ path: string; content: string }>): { name: string } | { error: string };
  audit?(auth: RequestAuth, req: IncomingMessage, row: { botId: string; names: string[]; files: string[] }): void;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const bodySchema = z.object({
  mode: z.enum(["preview", "install"]),
  files: z.array(z.object({ name: z.string().min(1).max(512), data: z.string() })).min(1).max(SKILL_UPLOAD_MAX_FILES),
});

export function createBotSkillUploadRoutes(deps: BotSkillUploadDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/bots\/([\w-]+)\/skill-upload$/.exec(path);
    if (!m || !(method === "POST")) return PASS;
    const botId = m[1]!;
    if (!deps.bot(botId)) return json(res, 404, { error: "no such bot" });
    const refused = deps.refusal(auth, botId);
    if (refused) return json(res, refused.status, refused.body);
    let raw: unknown;
    try {
      raw = await readBody(req, SKILL_UPLOAD_BODY_MAX_BYTES);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 413) return json(res, 413, { error: `An upload is at most ${SKILL_UPLOAD_TOTAL_MAX_BYTES / (1024 * 1024)} MB.`, code: "too-large" });
      throw error;
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json(res, 400, { error: `send { mode: preview or install, files: 1 to ${SKILL_UPLOAD_MAX_FILES} of { name, data: base64 } }` });
    const files: SkillUploadFile[] = [];
    let total = 0;
    for (const file of parsed.data.files) {
      if (!BASE64.test(file.data)) return json(res, 400, { error: `${file.name} is not base64`, code: "invalid" });
      const data = Buffer.from(file.data, "base64");
      total += data.length;
      if (total > SKILL_UPLOAD_TOTAL_MAX_BYTES) return json(res, 413, { error: `An upload is at most ${SKILL_UPLOAD_TOTAL_MAX_BYTES / (1024 * 1024)} MB.`, code: "too-large" });
      files.push({ name: file.name, data });
    }
    const items = readSkillUpload(files, deps.existingNames(botId));
    const preview = items.map(previewItem);
    const refusedAny = items.some((item) => item.errors.length > 0);
    const count = items.reduce((sum, item) => sum + item.skills.length, 0);
    if (parsed.data.mode === "preview") return json(res, 200, { items: preview, ok: !refusedAny && count > 0 });
    if (refusedAny || count === 0) return json(res, 422, { error: "Nothing was added: fix or remove the files marked in the preview.", code: "refused", items: preview });
    const installed: string[] = [];
    const errors: string[] = [];
    for (const item of items) {
      for (const skill of item.skills) {
        const source = item.kind === "zip" ? `upload:${item.file}#${skill.path}` : `upload:${item.file}`;
        const result = deps.install(botId, source, skill.files);
        if ("error" in result) errors.push(`${skill.name}: ${result.error}`);
        else installed.push(result.name);
      }
    }
    if (installed.length) {
      try {
        deps.audit?.(auth, req, { botId, names: installed, files: items.map((item) => item.file) });
      } catch {
        // an audit row never undoes the change it records
      }
    }
    if (!installed.length) return json(res, 422, { error: errors.join("; ") || "nothing was added", code: "install", items: preview });
    return json(res, 201, { installed, errors, items: preview });
  };
}
