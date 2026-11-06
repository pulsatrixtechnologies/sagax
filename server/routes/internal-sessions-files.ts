// attach-file and vm-exec for internal session routes (#1383).
import { ATTACHMENTS_DIR, deleteAttachment } from "../attachments/attachments.ts";
import { attachForTurn, saveBotAttachment } from "../bots/bot-attachment.ts";
import { VM_WORKSPACE_GUEST } from "../computer/container-computer.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import type { InternalSessionsBot, InternalSessionsDeps } from "./internal-sessions-types.ts";
import { PASS } from "./table.ts";

/** Cap on attach_file calls per automated turn (person-direct turns are uncapped). */
const MAX_ATTACHED_FILES_PER_TURN = 10;

export async function handleInternalSessionsFiles(
  deps: InternalSessionsDeps,
  ctx: InternalRouteContext,
  internalSender: InternalSessionsBot,
): Promise<typeof PASS | void> {
  const { res, path, method, json, capability, readBody } = ctx;
  if (method === "POST" && path === "/api/internal/attach-file") {
    const from = internalSender;
    const threadId = capability.threadId;
    const source = deps.ownsThread(from.id, threadId);
    if (!source) return json(res, 403, { error: "source conversation does not belong to sender" });
    const body = await readBody();
    const requestedPath = typeof body.path === "string" ? body.path : "";
    const requestedName = typeof body.name === "string" ? body.name : undefined;
    try {
      const vm = await deps.attachmentVm(capability);
      // The cap is an anti-loop limit for automated turns; the person's
      // own request attaches what they asked for.
      const outcome = await attachForTurn(capability, deps.personDirectTurn(from, threadId) ? Number.POSITIVE_INFINITY : MAX_ATTACHED_FILES_PER_TURN, {
        save: () => {
          // The agents capability carries no VM; the thread's claimed desktop does.
          return saveBotAttachment({
            path: requestedPath,
            name: requestedName,
            // The attachment store is not a source: only the bot's own files are.
            roots: deps.messageFileRoots(from.id, threadId).filter((root) => root !== ATTACHMENTS_DIR),
            ...(vm ? { guest: { root: VM_WORKSPACE_GUEST, host: vm.workspaceDir } } : {}),
            // A file this turn saved where the person asked, outside those
            // folders: one copy, so it opens from chat on any device. The
            // data dir holds every bot's memory and the app's own state.
            ...(capability.deliversSavedFiles && capability.turnStartedAt !== undefined
              ? { savedThisTurn: { since: capability.turnStartedAt, refuse: [deps.dataDir()] } }
              : {}),
          });
        },
        // The copy is awaited: the turn may have been stopped, replaced or
        // deleted, or the bot removed from the room, before it finished.
        stillLive: () => deps.isActive({ ...capability, ...(vm ? { localVmTarget: vm } : {}) }) &&
          deps.ownsThread(from.id, threadId) !== null,
        publish: (saved) => {
          deps.appendMessage(threadId, {
            role: "bot",
            kind: "text",
            text: "",
            attachments: [saved.attachment],
            ...(source.group ? { from: { botId: from.id, name: from.name, color: from.color } } : {}),
          });
        },
        // Each save gets its own stored file, so an unpublished one is ours to remove.
        discard: (saved) => deleteAttachment(saved.attachment.path),
      });
      if (outcome.status === "limit") {
        return json(res, 429, { error: `You already attached ${MAX_ATTACHED_FILES_PER_TURN} files this turn. Put the rest in one document or archive summary instead.` });
      }
      if (outcome.status === "ended") {
        return json(res, 409, { error: "This turn ended before the file could be attached, so nothing was posted." });
      }
      const { saved } = outcome;
      const label = saved.attachment.kind === "file"
        ? saved.attachment.name
        : (requestedName?.trim() || requestedPath.split(/[\\/]/).at(-1) || "image");
      return json(res, 200, { ok: true, name: label, bytes: saved.bytes });
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      const message = status === 404
        ? `No file was found at ${requestedPath}. Save it under /home/cua/workspace (or your working folder) and pass its exact path.`
        : error instanceof Error ? error.message : "could not attach that file";
      return json(res, status, { error: message });
    }
  }
  if (method === "POST" && path === "/api/internal/vm-exec") {
    const threadId = capability.threadId;
    if (!deps.ownsThread(internalSender.id, threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const body = await readBody();
    // Only the desktop this thread has claimed for the running turn; a bot
    // without one has nothing to run a command in.
    try {
      const vm = await deps.attachmentVm(capability);
      if (!vm) return json(res, 409, { error: "You have no Local VM desktop in this turn, so there is nowhere to run a command." });
      const runtime = await deps.containerRuntime();
      deps.requireActive(capability);
      if (!runtime || !deps.isActive({ ...capability, localVmTarget: vm }) ||
          deps.computerHeld(internalSender.id)) {
        return json(res, 409, { error: "The Local VM is no longer available to this turn." });
      }
      const result = await deps.containerExec(vm, typeof body.command === "string" ? body.command : "", {
        runtime,
        timeoutSeconds: typeof body.timeout_seconds === "number" ? body.timeout_seconds : undefined,
        commandVariables: deps.commandVariables(capability.botId, threadId),
      });
      deps.touchVmIdle(vm);
      return json(res, 200, result);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      return json(res, status, { error: error instanceof Error ? error.message : "could not run the command" });
    }
  }
  return PASS;
}
