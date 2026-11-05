import type { Action } from "./model";
import { threadsReadOnScreen, peopleDmReadTarget } from "./model";
import { api, createBotWithRole, requestConfirmedBotDeletion } from "./api";
import { readableError } from "@/lib/plain-error";
import { t } from "@/lib/i18n";
import { onNudgeSent } from "@/lib/desktop-nudge";
import type { DispatchEnv } from "./dispatch-types";

export function dispatchBotsEffects(action: Action, env: DispatchEnv): void {
  const {
    rawDispatch, stateRef, showError, botPatchQueue, waitForExecutionSettings, executionBotsBeforeAction,
  } = env;
  switch (action.type) {
        case "newBot": {
          // The picker can close/remount before React paints pending state.
          if (env.shared.creatingBot) break;
          env.shared.creatingBot = true;
          rawDispatch({ type: "botCreationPending", on: true });
          void createBotWithRole(action.role, api, action.visibility, action.section, action.settings)
            .then(({ bot, profileError }) => {
              rawDispatch({ type: "botAdded", bot, preserveSelection: action.preserveSelection });
              action.onCreated?.(bot);
              if (profileError) {
                showError(t("newBot.profileFailed", { error: profileError }));
                rawDispatch({ type: "toggleSettings", open: true, section: "soul" });
              }
            })
            .catch((error) => {
              if (action.onError) action.onError(readableError(error));
              else showError(error);
            })
            .finally(() => {
              env.shared.creatingBot = false;
              rawDispatch({ type: "botCreationPending", on: false });
            });
          break;
        }
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          const duplicateProfile = {
            name: `${source.name} copy`,
            title: source.title,
            description: source.description,
            soul: source.soul,
            notifications: source.notifications,
            modelSelection: source.modelSelection,
            computer: source.computer,
            cloudBackend: source.cloudBackend,
            autoStartVps: source.autoStartVps,
            avatarUrl: source.avatarUrl,
            avatarCrop: source.avatarCrop,
            avatarZoom: source.avatarZoom,
            avatarFocusX: source.avatarFocusX,
            avatarFocusY: source.avatarFocusY,
            // a private bot's copy stays private; anything else is the default
            ...(source.teamMemorySharing !== undefined && source.teamMemorySharing !== "shared" ? { teamMemorySharing: "private" as const } : {}),
          };
          // A copy of a restricted bot is restricted from its first moment.
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify({
              ...(source.visibility && source.visibility !== "everyone" ? { visibility: source.visibility } : {}),
              ...(Object.hasOwn(source, "toolScope") ? { settings: { toolScope: source.toolScope } } : {}),
            }),
          })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                // JSON.stringify omits undefined optional fields while preserving
                // an explicit null avatar clear, so duplication mirrors the source.
                body: JSON.stringify(duplicateProfile),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          rawDispatch({ type: "botDeletionPending", botId: action.botId, on: true });
          void requestConfirmedBotDeletion(
            action.botId,
            async (botId) => {
              // Preserve edits when lifecycle guards refuse deletion, while
              // preventing an older debounced PATCH from landing after a
              // successful DELETE.
              await botPatchQueue.flush(botId);
              return api(`/api/bots/${botId}`, { method: "DELETE" });
            },
            (botId) => {
              botPatchQueue.cancel(botId);
              rawDispatch({ type: "deleteBot", botId });
            },
          )
            .catch(showError)
            .finally(() => rawDispatch({ type: "botDeletionPending", botId: action.botId, on: false }));
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const id = action.id;
          const bot = stateRef.current.bots.find((b) => b.id === id);
          const group = stateRef.current.groups.find((g) => g.id === id);
          if (bot?.unread) {
            api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) }).catch(() => {});
            // threads hidden: the one conversation's other unread threads too
            for (const threadId of threadsReadOnScreen(bot, bot.threadId).slice(1)) {
              api(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId }) }).catch(() => {});
            }
          } else if (group?.peopleDm) {
            // per thread: the one open, or the whole conversation when only
            // the conversation itself was marked unread
            const read = peopleDmReadTarget(group);
            if (read) api(`/api/groups/${id}/read`, { method: "POST", body: JSON.stringify(read) }).catch(() => {});
          } else if (group?.unread) {
            api(`/api/groups/${id}/read`, { method: "POST" }).catch(() => {});
          }
          break;
        }
        case "createGroup":
          api(`/api/groups`, {
            method: "POST",
            body: JSON.stringify({
              memberIds: action.memberIds,
              ...(action.humanIds?.length ? { humanIds: action.humanIds } : {}),
              name: action.name,
              section: action.section,
              ...(window.ogb?.remoteClient?.active
                ? { setup: { bulletin: "", defaultResponder: { kind: "mentions" } } }
                : {}),
            }),
          })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "openPeopleDm":
          api(`/api/people-dms`, { method: "POST", body: JSON.stringify({ principalId: action.principalId }) })
            .then(({ group }) => {
              rawDispatch({ type: "groupPatched", group });
              rawDispatch({ type: "select", id: group.id });
            })
            .catch(showError);
          break;
        case "nudgePerson":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ principalId: action.principalId, ...(action.threadId ? { threadId: action.threadId } : {}) }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "nudgeGroup":
          api(`/api/nudges`, { method: "POST", body: JSON.stringify({ groupId: action.groupId }) })
            .then((sent) => onNudgeSent(sent))
            .catch(showError);
          break;
        case "sendGroup": {
          const threadId =
            action.threadId ?? stateRef.current.groups.find((group) => group.id === action.groupId)?.threadId;
          const sendId = action.sendId ?? crypto.randomUUID();
          void waitForExecutionSettings(executionBotsBeforeAction)
            .then(() => api(`/api/groups/${action.groupId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                text: action.text,
                replyToId: action.replyToId,
                threadId,
                sendId,
                mode: action.mode ?? "chat",
              }),
            }))
            .then((body) => {
              action.onSent?.();
              if (body?.message && typeof body.threadId === "string") {
                rawDispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
              }
              if (
                body?.queued &&
                typeof body.threadId === "string" &&
                typeof body.queueId === "string"
              ) {
                rawDispatch({
                  type: "optimisticMessageRemoved",
                  threadId: body.threadId,
                  sendId,
                });
                rawDispatch({
                  type: "pendingQueued",
                  threadId: body.threadId,
                  queueId: body.queueId,
                  text: action.text,
                });
              }
            })
            .catch((error) => {
              if (threadId) {
                rawDispatch({ type: "optimisticMessageRemoved", threadId, sendId });
              }
              showError(error);
              action.onError?.();
            });
          break;
        }
        case "patchGroup":
          api(`/api/groups/${action.groupId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(showError);
          break;
        case "deleteGroup":
          api(`/api/groups/${action.groupId}`, { method: "DELETE" }).catch(showError);
          break;
        case "leaveGroup":
          // the group leaves this client once the server took them out; their
          // other devices get "group.left"
          api(`/api/groups/${action.groupId}/leave`, { method: "POST" })
            .then(() => rawDispatch({ type: "groupDeleted", groupId: action.groupId }))
            .catch(showError);
          break;
  }
}
