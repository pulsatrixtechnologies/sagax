import type { Action, Bot, BotAnnouncement, Group } from "./model";
import { applyFolderOwner, folderOwnerPath, currentTaskBot, peopleDmReadTarget } from "./model";
import { MESSAGE_PAGE_SIZE, api } from "./api";
import { readableError } from "@/lib/plain-error";
import { approvalModeFor, botApprovalSetting } from "../../../shared/approval-mode";
import { stepUpApprovals } from "@/lib/step-up-client";
import { singleStreamTurnField } from "@/lib/thread-preferences";
import { makeConfidentialBody } from "@/lib/confidential-thread";
import type { DispatchEnv } from "./dispatch-types";

export function dispatchTasksEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, threadPages, withTaskWrites, navigation,
    persistTaskPatch, dispatch, botBeforeUpdate,
  } = env;
  switch (action.type) {
        case "setModel":
          if (action.threadId) {
            persistTaskPatch(action.botId, action.threadId, {
              modelSelection: action.selection,
              ...(action.updateBotDefault ? { updateBotDefault: true } : {}),
            });
            break;
          }
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(
              action.botId,
              { modelSelection: action.selection, threadId: botBeforeUpdate.switchingTo ?? botBeforeUpdate.threadId },
              botBeforeUpdate,
            );
          }
          break;
        case "updateTask": {
          const saved = persistTaskPatch(action.botId, action.threadId, action.patch);
          if (action.onSettled) void saved.then(() => action.onSettled!(true), () => action.onSettled!(false));
          break;
        }
        case "makeTaskConfidential":
          void api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(makeConfidentialBody()),
          }).then((result) => {
            if (result?.bot) rawDispatch({ type: "botPatched", bot: withTaskWrites(result.bot) });
            rawDispatch({ type: "taskMadeConfidential", botId: action.botId, threadId: action.threadId });
            action.onDone?.();
          }).catch((error: unknown) => {
            if (action.onError) action.onError(readableError(error));
            else showError(error);
          });
          break;
        case "refreshTaskPermissions": {
          const bot = stateRef.current.bots.find((candidate) => candidate.id === action.botId);
          const task = bot?.tasks?.find((candidate) => candidate.threadId === action.threadId);
          if (!bot || !task) {
            showError(new Error("That thread is no longer available"));
            break;
          }
          // the bot's own setting, never the open conversation's level
          const mode = botApprovalSetting(bot);
          const current = approvalModeFor(currentTaskBot(bot, action.threadId));
          const acknowledgeLocalAuto = action.acknowledgeLocalAuto === true;
          // Full, Custom, and leaving Custom stay on the private desktop
          // channel. Ask, Edits, and Auto can use the thread settings route.
          const needsDesktop = mode === "full" || mode === "custom" || current === "custom";
          // #1674: without the private channel (the desktop app on a remote
          // server, a browser), Full comes back through the thread route:
          // an organization server grants it to the bot's owner, any other
          // says why. Custom stays on the desktop channel.
          const bridge = window.ogb?.approvals;
          const refreshed = needsDesktop && (bridge || mode === "custom" || current === "custom")
            ? bridge
              ? stepUpApprovals(bridge)!.setMode(action.botId, mode, {
                threadId: action.threadId, threadOnly: true, refreshPermissions: true, acknowledgeLocalAuto,
              })
              : Promise.reject(new Error("Custom approval, and leaving it, are set in the Sagax desktop app on the computer that runs this server"))
            : api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
              method: "PATCH",
              body: JSON.stringify({ refreshPermissions: true, ...(acknowledgeLocalAuto ? { acknowledgeLocalAuto: true } : {}) }),
            }).then((result) => result.bot);
          void refreshed.then((updated) => {
            if (updated) rawDispatch({ type: "botPatched", bot: withTaskWrites(updated) });
          }).catch(showError);
          break;
        }
        case "followBotModel":
          void api<{ bot: BotAnnouncement }>(`/api/bots/${action.botId}/threads/follow-model`, { method: "POST", body: "{}" })
            .then(({ bot }) => rawDispatch({ type: "botPatched", bot: withTaskWrites(bot) }))
            .catch(showError);
          break;
        case "createProject":
          api(`${folderOwnerPath(action)}/projects`, { method: "POST", body: JSON.stringify({ name: action.name, emoji: action.emoji }) })
            .then((answer) => {
              applyFolderOwner(dispatch, action, answer);
              action.onCreated?.(answer.project);
            }).catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "updateProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "PATCH", body: JSON.stringify(action.patch) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "deleteProject":
          api(`${folderOwnerPath(action)}/projects/${action.projectId}`, { method: "DELETE" })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onDeleted?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "reorderProjects":
          api(`${folderOwnerPath(action)}/projects/order`, { method: "PATCH", body: JSON.stringify({ projectIds: action.projectIds }) })
            .then((answer) => { applyFolderOwner(dispatch, action, answer); action.onSaved?.(); })
            .catch((error) => { showError(error); action.onError?.(readableError(error)); });
          break;
        case "interrupt": {
          const interruptBody = {
            ...(action.threadId ? { threadId: action.threadId } : {}),
            ...(action.expectedUtteranceId ? { expectedUtteranceId: action.expectedUtteranceId } : {}),
          };
          api(`/api/bots/${action.botId}/interrupt`, {
            method: "POST",
            body: Object.keys(interruptBody).length ? JSON.stringify(interruptBody) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        }
        // tasks: the server answers with the bot AND the live transcript,
        // because switching changes which conversation is on screen
        case "newTask":
        case "switchTask": {
          // Opening a task from a notification or the sidebar reads THAT
          // thread, once the switch is under way: the server announces it
          // (the "bot" frame reads Bot.switchingTo) and taskSwitched marks it
          // here. Never before: a switch that fails (a thread deleted
          // meanwhile) leaves the thread it was on, and its unread, as they were.
          const revision = (navigation.get(action.botId) ?? 0) + 1;
          navigation.set(action.botId, revision);
          const selectedAtStart = env.shared.selectionRevision;
          const ready = action.type === "newTask"
            ? botPatchQueue.flush(action.botId)
            : Promise.resolve();
          // A new task's thread is empty, so only the switch needs a page.
          void ready.then(() => api<{ bot: Bot }>(action.type === "newTask"
            ? `/api/bots/${action.botId}/tasks`
            : `/api/bots/${action.botId}/tasks/${action.threadId}${action.whole ? "" : `?messages=${MESSAGE_PAGE_SIZE}`}`, { method: "POST", body: JSON.stringify(action.type === "newTask" ? { projectId: action.projectId, cwd: action.cwd, ...(action.confidential !== undefined ? { confidential: action.confidential } : {}), ...(action.stream ?? singleStreamTurnField().singleStream ? { stream: true } : {}) } : {}) }))
            .then((r) => {
              if (action.type === "newTask") action.onCreated?.();
              if (!r?.bot || navigation.get(action.botId) !== revision) return;
              const selectsAfterCreation = action.type === "newTask" && action.cwd !== undefined;
              if (selectsAfterCreation && env.shared.selectionRevision !== selectedAtStart) return;
              if (Array.isArray(r.bot.messages)) threadPages.set(r.bot.threadId, { messages: r.bot.messages, hasMore: r.bot.hasMore, activeLeafId: r.bot.activeLeafId, at: Date.now() });
              dispatch({ type: "taskSwitched", bot: r.bot });
              if (selectsAfterCreation) rawDispatch({ type: "select", id: action.botId });
            })
            .catch((error) => {
              // The latest switch, failed, leaves the thread it was on on screen.
              if (action.type === "switchTask" && navigation.get(action.botId) === revision) {
                rawDispatch({ type: "switchTaskFailed", botId: action.botId, threadId: action.threadId });
              }
              if (action.type === "newTask" && action.onError) action.onError(readableError(error));
              else showError(error);
            });
          break;
        }
        case "renameTask":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "regenerateTaskTitle":
          api(`/api/bots/${action.botId}/tasks/${action.threadId}/title`, { method: "POST" })
            .then(() => action.onSettled?.(true))
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "deleteTask":
          threadPages.delete(action.threadId);
          api<{ bot?: BotAnnouncement }>(`/api/bots/${action.botId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => { if (r?.bot) dispatch({ type: "botPatched", bot: r.bot }); action.onSettled?.(true); })
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        // Channel tasks mirror bot tasks, but hydrate the whole channel so
        // switching atomically replaces its transcript, folder and pin.
        case "newGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks`, { method: "POST", body: JSON.stringify(action.projectId ? { projectId: action.projectId } : {}) })
            .then((r) => r?.group && dispatch({ type: "groupPatched", group: r.group }))
            .catch(showError);
          break;
        case "switchGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}?messages=${MESSAGE_PAGE_SIZE}`, { method: "POST" })
            .then((r) => {
              if (!r?.group) return;
              dispatch({ type: "groupPatched", group: r.group });
              // A person conversation: opening an unread thread reads it,
              // for this person only (server/people/people-dms.ts).
              const read = peopleDmReadTarget(r.group);
              if (read) api(`/api/groups/${action.groupId}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
            })
            .catch(showError);
          break;
        case "updateGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).then(() => action.onSettled?.(true), (error) => { showError(error); action.onSettled?.(false); });
          break;
        case "renameGroupTask":
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: action.title }),
          }).catch(showError);
          break;
        case "pinGroupTask":
          // title is echoed so an older server rewrites the same title
          // instead of blanking a pin-only body into "Untitled".
          api(`/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: action.pinned, title: action.title }),
          }).catch(showError);
          break;
        case "setConversationTurnLimit":
          api(action.dm ? `/api/groups/${action.groupId}` : `/api/groups/${action.groupId}/tasks/${action.threadId}`, {
            method: "PATCH",
            body: JSON.stringify({ turnTimeoutMinutes: action.minutes }),
          }).catch(showError);
          break;
        case "deleteGroupTask":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/tasks/${action.threadId}`, { method: "DELETE" })
            .then((r) => { if (r?.group) dispatch({ type: "groupPatched", group: r.group }); action.onSettled?.(true); })
            .catch((error) => { showError(error); action.onSettled?.(false); });
          break;
        case "interruptGroup":
          api(`/api/groups/${action.groupId}/interrupt`, {
            method: "POST",
            body: action.threadId ? JSON.stringify({ threadId: action.threadId }) : undefined,
          }).catch((error) => {
            showError(error);
            action.onError?.();
          });
          break;
        case "setGroupHold":
          api<{ group?: Partial<Group> & { id: string } }>(`/api/groups/${action.groupId}/holds`, {
            method: "POST",
            body: JSON.stringify({ botId: action.botId, held: action.held }),
          })
            .then((r) => { if (r?.group) dispatch({ type: "groupPatched", group: r.group }); })
            .catch(showError);
          break;
        case "updateBot": {
          if (botBeforeUpdate) {
            botPatchQueue.enqueue(action.botId, action.patch, botBeforeUpdate);
          }
          break;
        }
        default:
          break;
  }
}
