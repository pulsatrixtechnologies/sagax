/**
 * GET /api/bot-defaults, skill preview and avatar preview (#1388 B1).
 * Literal paths. Never imports server/index.ts.
 */
import { z } from "zod";

import { generateAvatarImage, avatarGenerationRequestSchema } from "../media/avatar-image.ts";
import { parseBotProfilePatch } from "../bots/bot-profile.ts";
import { autoNewBotSelection } from "../models/default-model-selection.ts";
import { githubSkillFetch } from "../github/github-access.ts";
import { pickBotName } from "../names.ts";
import { botSkillTemplateSchema, newBotDefaultsSchema } from "../bots/new-bot-defaults.ts";
import { orgXaiRefusal } from "../org/org-xai-media.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";
import { fetchSkillFromSource } from "../skills/skill-fetch.ts";
import { prepareSkillFolder } from "../skills/skill-folder.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreDefaultsRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      cfg,
      newBotApprovalMode,
      memberDefaultSelection,
      defaultSelection,
      githubCredentialsFor,
      orgAvatarImageConfig,
      requesterPrincipal,
    } = deps;

    if (method === "GET" && path === "/api/bot-defaults") {
      // #1445: a member's new bot is not built from the admin's template
      // (POST /api/bots): the model it starts on is the one chosen for them,
      // among what they can run.
      const member = auth.kind === "session" && !auth.scopes.includes("admin");
      return json(res, 200, {
        defaults: structuredClone(cfg.newBotDefaults ?? newBotDefaultsSchema.parse({})),
        // 2026-10-11: what a new bot starts on when the template names no
        // level (New bot shows it): Approve for me, or the organization's.
        approvalMode: newBotApprovalMode(),
        // A new bot opens on Auto (docs/plans/2026-10-08-auto-model.md): the
        // engine is auto-resolved, the model is Auto. A template that pins a
        // model wins over this on the client, so an advanced default is kept.
        modelSelection: member ? await memberDefaultSelection(sessionPrincipal(auth)) : autoNewBotSelection(await defaultSelection()),
        ...(member ? { memberDefault: true } : {}),
        suggestedName: pickBotName(store.bots.map(bot => bot.name)),
      });
    }
    if (method === "POST" && path === "/api/bot-defaults/skills/preview") {
      const checked = z.object({ source: z.string().min(1).max(2000) }).strict().safeParse(await readBody(req));
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const input = checked.data;
      const fetched = await fetchSkillFromSource(input.source, githubSkillFetch(githubCredentialsFor(sessionPrincipal(auth))));
      if ("error" in fetched) return json(res, 422, { error: fetched.error });
      const skills = [];
      for (const skill of fetched.skills) {
        const prepared = prepareSkillFolder(skill.files);
        if ("error" in prepared) return json(res, 422, { error: prepared.error });
        const template = botSkillTemplateSchema.safeParse({
          name: prepared.parsed.name,
          description: prepared.parsed.description,
          source: skill.source,
          text: prepared.skillMd,
          enabled: false,
          warnings: prepared.warnings,
        });
        if (!template.success) return json(res, 422, { error: template.error.message });
        skills.push(template.data);
      }
      return json(res, 200, { skills });
    }
    if (method === "POST" && path === "/api/bot-defaults/avatar") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "avatar preview must be a JSON object" });
      const profile = parseBotProfilePatch(body.profile, true);
      if (!profile.ok) return json(res, 400, { error: profile.error });
      const checked = avatarGenerationRequestSchema.safeParse({ prompt: body.prompt });
      if (!checked.success) return json(res, 400, { error: checked.error.message });
      const { prompt } = checked.data;
      const imageCfg = orgAvatarImageConfig(requesterPrincipal(auth));
      if (!imageCfg) return json(res, 403, orgXaiRefusal("image"));
      const generated = await generateAvatarImage(imageCfg as never, {
        name: profile.patch.name ?? "", title: profile.patch.title ?? "", description: profile.patch.description ?? "",
      }, prompt);
      // A preview belongs to the draft. Upload it through the existing image
      // endpoint only when the user commits the new bot or its defaults.
      return json(res, 200, { dataUrl: `data:${generated.mime};base64,${generated.bytes.toString("base64")}` });
    }
    return PASS;
  };
}
