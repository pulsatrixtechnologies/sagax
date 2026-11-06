import { api, persistBotUpdate, persistTaskApproval, type Bot } from "@/state/store";
import { stepUpApprovals } from "@/lib/step-up-client";
import type { Routine } from "./routines";
import type { BotCreationDraft } from "./bot-creation-draft";
import { imageAttachmentFromFile } from "./composer-attachments";
import type { BotVisibility } from "../../shared/wire";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar";
import { isMemberBotField } from "../../shared/viewer-capabilities";
import { readableError } from "./plain-error";

/** Fields an organization member may send: the member set, and a field
 * their permissions open (`mayWrite`, BOT_FIELD_PERMISSIONS; the server's
 * memberBotFieldRefusal accepts the same). 2026-10-26: every member
 * holds the keys about their own bots, so only what reaches past their own
 * environment (a folder on the server's disk, the server's cloud computer
 * or shared browser profiles) is left out without its permission. */
function memberWritableProfile<T extends object>(profile: T, mayWrite?: (field: string) => boolean): Partial<T> {
  const next: Partial<T> = {};
  for (const key of Object.keys(profile) as Array<keyof T>) {
    if (profile[key] === undefined) continue;
    if (isMemberBotField(String(key)) || mayWrite?.(String(key)) === true) next[key] = profile[key];
  }
  return next;
}

export async function preparedBotTemplate(draft: BotCreationDraft) {
  const template = draft.export();
  if (template.profile.avatarUrl?.startsWith("blob:")) {
    if (!draft.avatarFile) throw new Error("Choose the avatar image again");
    const uploaded = await imageAttachmentFromFile(draft.avatarFile);
    const avatarUrl = uploaded && botAvatarUrlFromStoredPath(uploaded.path);
    if (!avatarUrl) throw new Error("Could not store the avatar image");
    template.profile.avatarUrl = avatarUrl;
  }
  return template;
}

/** Create only after the user commits. File setup and native consent finish
 * before Chief handover or routine activation can affect other work. */
export async function createConfiguredBot(
  draft: BotCreationDraft,
  request: typeof api = api,
  update: typeof persistBotUpdate = persistBotUpdate,
  approvals = typeof window === "undefined" ? undefined : stepUpApprovals(window.ogb?.approvals),
  visibility?: BotVisibility,
  options?: {
    memberFieldsOnly?: boolean;
    /** A field beyond the member set that this member's permissions open
     * (#1076): kept on the follow-up patch instead of being dropped. */
    memberMayWrite?: (field: string) => boolean;
  },
): Promise<{ bot: Bot; warnings: string[] }> {
  const template = await preparedBotTemplate(draft);
  const { chiefOfStaff, managedSections, toolScope, ...profile } = template.profile;
  const memberFieldsOnly = options?.memberFieldsOnly === true;
  if (!profile.name?.trim()) throw new Error("Give the bot a name");
  // The server adds a chosen preset's skills (switched on only for an
  // organization's preset) and starter notes; for the same skill name or
  // note file, the preset's wins over the draft's.
  const preset = draft.preset;
  const mayWrite = (field: string) => options?.memberMayWrite?.(field) === true;
  const response = await request<{ bot: Bot }>("/api/bots", {
    method: "POST", body: JSON.stringify(memberFieldsOnly
      ? { name: profile.name, title: profile.title, description: profile.description, modelSelection: profile.modelSelection, requireAvailableModel: true, useDefaults: false,
        // 2026-10-26: the team, who sees it, its tools and a preset are the member's own choice
        ...(profile.section !== undefined && mayWrite("section") ? { section: profile.section } : {}),
        ...(visibility !== undefined && mayWrite("visibility") ? { visibility } : {}),
        ...(Object.hasOwn(template.profile, "toolScope") && mayWrite("toolScope") ? { settings: { toolScope } } : {}),
        ...(preset ? { preset: preset.id } : {}) }
      : { name: profile.name, title: profile.title,
        description: profile.description, modelSelection: profile.modelSelection, section: profile.section,
        requireAvailableModel: true, useDefaults: false, ...(visibility !== undefined ? { visibility } : {}),
        ...(Object.hasOwn(template.profile, "toolScope") ? { settings: { toolScope } } : {}),
        ...(preset ? { preset: preset.id } : {}) }),
  });
  let bot = response.bot;
  const routines: Array<{ id: string; enabled: boolean }> = [];
  const warnings: string[] = [];
  try {
    // The create endpoint already validated the chosen model and completed
    // workspace effort defaults. Do not overwrite those with the raw draft.
    const savedProfile = memberFieldsOnly ? memberWritableProfile(profile, options?.memberMayWrite) : profile;
    const consent = memberFieldsOnly ? memberWritableProfile(draft.consent, options?.memberMayWrite) : draft.consent;
    const patched = await update(bot.id, { ...savedProfile, modelSelection: bot.modelSelection, ...consent }, new AbortController().signal,
      request, approvals, bot);
    bot = { ...bot, ...patched };
    if (profile.approvalMode === "full" || profile.approvalMode === "custom") {
      // persistBotUpdate sets the bot default first. An initial thread is
      // already present, so it takes the level in its own write: through the
      // desktop's private bridge when there is one, over the API for Full
      // when there is not (Custom cannot get this far without the bridge).
      if (patched.approvalMode !== profile.approvalMode) {
        throw new Error("The bot's requested approval level was not granted");
      }
      const granted = await persistTaskApproval(bot.id, bot.threadId, {
        approvalMode: profile.approvalMode,
        acknowledgeLocalAuto: draft.consent.acknowledgeLocalAuto === true,
      }, approvals, request);
      if (granted.approvalMode !== profile.approvalMode) {
        throw new Error("The initial thread's requested approval level was not granted");
      }
    }
    for (const [path, text] of Object.entries(template.memory)) {
      if (preset?.notes.includes(path)) continue;
      await request(`/api/bots/${bot.id}/memory/file`, {
        method: "PUT", body: JSON.stringify({ path, text }),
      });
    }
    for (const skill of template.skills) {
      if (preset?.skills.includes(skill.name)) continue;
      await request(`/api/bots/${bot.id}/skill-template`, { method: "POST", body: JSON.stringify(skill) });
    }
    for (const routine of template.routines) {
      const result = await request<{ routine: Routine }>("/api/routines", {
        method: "POST", body: JSON.stringify({ ...routine, botId: bot.id, enabled: false }),
      });
      routines.push({ id: result.routine.id, enabled: routine.enabled !== false });
    }
  } catch (error) {
    const cleanup: string[] = [];
    for (const routine of routines) {
      try { await request(`/api/routines/${routine.id}`, { method: "DELETE" }); }
      catch { cleanup.push(`routine ${routine.id}`); }
    }
    try { await request(`/api/bots/${bot.id}`, { method: "DELETE" }); }
    catch { cleanup.push(`bot ${bot.name} (${bot.id})`); }
    const message = readableError(error);
    throw new Error(cleanup.length ? `${message}. Cleanup failed for ${cleanup.join(", ")}; remove them before retrying.` : message);
  }
  // Creation is complete. Activation failures leave a visible, configured
  // bot with paused routines; never delete a bot whose routine may have run,
  // undo a Chief handover, or invite a duplicate creation retry.
  if (chiefOfStaff && (!memberFieldsOnly || mayWrite("chiefOfStaff"))) {
    try {
      const result = await request<{ bot: Bot }>(`/api/bots/${bot.id}`, {
        method: "PATCH", body: JSON.stringify(memberFieldsOnly && !mayWrite("acknowledgePeerScope")
          ? { chiefOfStaff, managedSections }
          : { chiefOfStaff, managedSections, acknowledgePeerScope: true }),
      });
      bot = { ...bot, ...result.bot };
    } catch (error) {
      warnings.push(`Review this bot's Primary Bot setting: ${readableError(error)}`);
    }
  }
  for (const routine of routines.filter(routine => routine.enabled)) {
    try { await request(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }); }
    catch (error) { warnings.push(`Could not activate a routine: ${readableError(error)}`); }
  }
  return { bot, warnings };
}
