// Agents tool family: Team, bots, rooms setup, profile and proposals.
// Definitions and handlers. Assembled in order by agents-catalog.ts;
// dispatched by agents-call.ts. Never import server/index.ts.

import type { ToolCallContext, ToolCallResult } from "../agents-call-types.ts";
import type { Json } from "../agents-client.ts";
import {
  CHIEF_PROFILE_TARGET,
  PERSON_QUOTE,
  PROPOSAL_OUTCOME,
  SELF_CHANGE_OUTCOME,
  ordinal,
  completedProposalResult,
  confirmationResult,
} from "./shared.ts";

export const DEF_START_THREAD = {
    name: "start_thread",
    description:
      "Open a new thread: one conversation with its own history and its own run, shown to the person as a row under the bot it belongs to. Leave bot_id out to open it on yourself, for a separate job that should run on its own (\"review each pull request\" — one thread per pull request) instead of inside this conversation. Give bot_id (from list_bots) to open it on a teammate: that is a handoff into a fresh thread, which starts after your current turn ends and whose result is delivered here, like delegate_bot. The title is the row's name: short and specific; write it as #Title when you mention it. Not for a question you need answered now (ask_bot), a task for the teammate's usual conversation (delegate_bot), or a note nobody acts on. If refused, do not retry: say what you still wanted opened.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", description: "The thread's name: one short line, at most 80 characters, telling it apart from the others (e.g. \"QA: PR #412 login fix\")." },
        message: { type: "string", description: "The complete first message of the thread — everything the run needs, since it will not see this conversation." },
        bot_id: { type: "string", description: "Optional: the teammate's id from list_bots. Leave out to open the thread on yourself." },
        folder: { type: "string", description: "Optional: the name of one of that bot's existing folders to file the thread under. Leave out unless the person named one." },
        report_back: { type: "boolean", description: "Optional, on yourself only: true runs it as a parallel task of this conversation. The person sees its live card here and its result is posted back here as a reply when it finishes. Use it when the person asks for something unrelated while you are busy, so both run at once." },
        workspace: { type: "string", enum: ["this_computer", "browser", "cloud", "local_vm"], description: "Optional, on yourself, when your Workspace is Auto: where that thread works (this_computer = their files and apps, browser = web only, cloud = keeps running while they are away, local_vm = isolated). A place not allowed or offline falls back." },
        read_only: { type: "boolean", description: "On yourself: read-only (starts in Ask)." },
        thread_id: { type: "string", description: "On yourself: resume your earlier thread by id." },
      },
      required: ["title", "message"],
    },
  };

export const DEF_CREATE_BOT = {
    name: "create_bot",
    description:
      "Create a specialist bot in your section. Primary Bot only. Below Full Access the user approves a card first, except on Approve for me when the user asked for it in their own message. instructions become its soul. Omit modelSelection to use the workspace default, or choose exact IDs from list_team_setup. MCP servers and automatic approvals start disabled. Assign work through delegate_bot. Maximum four new bots per turn.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short, unique display name for the specialist." },
        role: { type: "string", description: "The specialist's job title or role." },
        instructions: { type: "string", description: "What this specialist is responsible for and how it should work." },
        modelSelection: { type: "object", additionalProperties: false, properties: {
          instanceId: { type: "string" }, model: { type: "string" },
          effort: { type: "string" }, variant: { type: "string" },
        }, required: ["instanceId", "model"] },
        cwd: {
          type: "string",
          maxLength: 1024,
          description: "Absolute path of the folder this specialist's tools read and write in (for example /Users/me/Projects/site). It must already exist. Leave it out for the specialist's private workspace.",
        },
        suggestion: { type: "boolean", description: "True if the user did not ask for this bot." },
      },
      required: ["name", "role", "instructions"],
    },
  };

export const DEF_LIST_TEAM_SETUP = {
    name: "list_team_setup",
    description: "Primary Bot only: list every bot of the person (whatever its team), their teams, and exact engine/model choices for team setup. Call before proposing configuration; never invent model IDs. A new default model: threads following the bot (main, routines) move at their next turn.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  };

export const DEF_PROPOSE_TEAM_SETUP = {
    name: "propose_team_setup",
    description: "Primary Bot only: submit all requested specialist creation, profile/model configuration, and authorized team moves in ONE combined plan. Use catalog engine/model IDs from list_team_setup. Combine all fields per bot. New teams must be named in newTeams and have a specialist in this plan; access is granted only to those teams. Models change bot defaults: threads following the bot move at their next turn. If review is pending, the decision resumes you once; do not ask again, poll, or repeat the proposal." + PROPOSAL_OUTCOME,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        reason: { type: "string", minLength: 1, maxLength: 500 },
        newTeams: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 60 } },
        operations: { type: "array", minItems: 1, maxItems: 24, items: {
          type: "object", additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["create", "update"] },
            key: { type: "string", description: "For create: your stable short name for this new bot in this plan." },
            botId: { type: "string", description: "For update: exact existing bot ID from list_team_setup." },
            fields: { type: "object", additionalProperties: false, properties: {
              name: { type: "string", maxLength: 100 }, title: { type: "string", maxLength: 200 },
              chiefOfStaff: { type: "boolean", description: "Hand the Primary Bot role to this bot, or remove it. One Primary Bot per person: explicitly step the current Primary Bot down in the same plan when replacing it. Does not grant access to other teams or change execution permissions." },
              description: { type: "string", maxLength: 4000 }, soul: { type: "string", description: "Standing instructions; required with name/title/modelSelection for every new bot." },
              cwd: { type: "string", maxLength: 1024, description: "Create only: absolute path of the folder the new bot's tools read and write in. It must already exist. Leave it out for a private workspace." },
              section: { type: "string", maxLength: 60, description: "Exact authorized existing team, or a team explicitly named in newTeams. Empty string means General." },
              modelSelection: { type: "object", additionalProperties: false, properties: {
                instanceId: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, variant: { type: "string" },
              }, required: ["instanceId", "model"] },
            } },
          }, required: ["action", "fields"],
        } },
      }, required: ["reason", "operations"],
    },
  };

export const DEF_IMPORT_PLUGIN_TEAM = {
    name: "import_plugin_team",
    description: "Primary Bot only: import an installed plugin's agents as a new team for the person (one bot per agent, each on the model its frontmatter names, tools restricted where the engine allows). Pass the marketplace and plugin names as the person sees them in Plugins; team is the new team's name (default: the plugin's). The person reviews one card listing every bot, model and tool limit." + PROPOSAL_OUTCOME,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        marketplace: { type: "string", minLength: 1, maxLength: 200 },
        plugin: { type: "string", minLength: 1, maxLength: 200 },
        team: { type: "string", maxLength: 60 },
        reason: { type: "string", maxLength: 500 },
      },
      required: ["marketplace", "plugin"],
    },
  };

export const DEF_PROPOSE_BOT_DELETION = {
    name: "propose_bot_deletion",
    description: "Primary Bot only: when the user explicitly asks to delete a named teammate, submit a separate deletion request for that exact bot. Deletion removes its conversations, memory, instructions, skills, and any computer owned only by it; generated project files and shared team computers remain. Running work or an unavailable computer provider can block deletion safely. Never delete yourself, substitute an archive, or put deletion into a setup batch. If review is pending, the decision and result resume you once." + PROPOSAL_OUTCOME,
    inputSchema: { type: "object", additionalProperties: false, properties: {
      bot_id: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1, maxLength: 500 }, quote: PERSON_QUOTE,
    }, required: ["bot_id", "reason"] },
  };

export const DEF_ARCHIVE_BOT = {
    name: "archive_bot",
    description: "Primary Bot only: archive one of the person's bots (kept, restorable) or restore it. Already archived: nothing changes, said so. A temporary agent (create_agent) archived is gone for good. With quote it applies at once, else a card.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      bot_id: { type: "string", minLength: 1 }, restore: { type: "boolean" }, quote: PERSON_QUOTE,
    }, required: ["bot_id"] },
  };

export const DEF_CREATE_ROOM = {
    name: "create_room",
    description:
      "Create a room in your own section when the user asks for one (maximum four per turn). Primary Bots only. Choose active peers from list_bots; you are included automatically as the default responder. This creates no turns or messages. Section moves stay with the user. Follow the tool result under the effective access level; if permission is refused, ask the user to make the room change instead, without trying another route.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100, description: "Display name for the room (e.g. \"Nalamdesk Team\")." },
        member_bot_ids: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string" },
          description: "List of bot IDs to include as members of the room.",
        },
        bulletin: {
          type: "string",
          maxLength: 12_000,
          description: "Optional initial bulletin / goal / instructions pinned for this room.",
        },
      },
      required: ["name", "member_bot_ids"],
    },
  };

export const DEF_MANAGE_ROOM = {
    name: "manage_room",
    description:
      "Manage a room from list_rooms: rename it, change its bulletin, or add/remove/set members. Primary Bots only, for a room in your own section; members are your own person's bots from list_bots, whatever their team; keep yourself as a member. Busy rooms, pending approvals and team-goal leads are protected. You cannot move rooms or bots between sections. Follow the tool result under the effective access level; if the change is refused, report the blocker and ask the user to make the change instead, without trying another route.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        room_id: { type: "string", description: "The ID of the group room to manage." },
        action: {
          type: "string",
          enum: ["add_members", "remove_members", "set_members", "rename", "set_bulletin"],
          description: "The action to perform on the room.",
        },
        member_bot_ids: {
          type: "array",
          items: { type: "string" },
          description: "List of bot IDs when action is add_members, remove_members, or set_members.",
        },
        name: { type: "string", minLength: 1, maxLength: 100, description: "New name for the room when action is rename." },
        bulletin: { type: "string", maxLength: 12_000, description: "New bulletin text when action is set_bulletin; an empty string clears it." },
      },
      required: ["room_id", "action"],
    },
  };

export const DEF_RETRY_THREAD = {
    name: "retry_thread",
    description:
      "Primary Bot only. Resume a teammate's thread whose last run failed, stalled or could not start — the one an incident report named — exactly where it stopped, keeping its conversation and files. The teammate gets a line saying you asked for the retry and why. Use it when the cause looks transient (a crash, a timeout, a busy service). Use delegate_bot with a corrected brief instead when the request itself needs to change, and tell the person instead when only they can fix the cause (a sign-in, a missing credential, an unanswered question). Never retry the same thread more than twice.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        bot_id: { type: "string", description: "The teammate's id, from the incident report or list_bots." },
        thread_id: { type: "string", description: "The failed thread's id, from the incident report." },
        note: { type: "string", description: "Optional: one sentence for the teammate about what to watch for this time." },
      },
      required: ["bot_id", "thread_id"],
    },
  };

export const DEF_PROPOSE_PROFILE = {
    name: "propose_profile",
    description:
      "Submit user-requested changes to your own name, title, description, standing instructions (SOUL.md), working folder (cwd), or your alert and voice toggles (notifications, speakReplies). Keep SOUL.md short — who you are and the rules you never break; put step-by-step procedure into a skill instead." + CHIEF_PROFILE_TARGET + SELF_CHANGE_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: 100, description: "New display name." },
        title: { type: "string", maxLength: 200, description: "New role or title." },
        description: { type: "string", maxLength: 4000, description: "New one-line blurb shown in rosters." },
        soul: { type: "string", description: "Full replacement text for SOUL.md, at most 24000 bytes." },
        cwd: {
          type: "string",
          maxLength: 1024,
          description: "Absolute path of the folder your tools read and write in (for example /Users/me/Projects/site). It must already exist. An empty string means your private workspace. A new folder waits for the person's confirmation unless this conversation has Full access.",
        },
        notifications: {
          type: "boolean",
          description: "Completion and attention notifications for this bot on the host and paired clients.",
        },
        speakReplies: {
          type: "boolean",
          description: "Speak this bot's replies aloud as they settle, without being asked.",
        },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "One sentence the user will see explaining why." },
        for_bot_id: {
          type: "string",
          description: "Primary Bot only: the id of another bot of the person whose profile this changes. Omit to change your own.",
        },
        quote: PERSON_QUOTE,
      },
      required: ["reason"],
    },
  };

export const DEF_PROPOSE_MODEL = {
    name: "propose_model",
    description:
      "Submit a user-requested switch of this bot's default engine and model. Use the exact instance and model ids the person named, or for a Primary Bot the ids from the team-setup catalog. The result warns about capabilities the switch gains or loses; threads following the bot (main, routines) move at their next turn." + SELF_CHANGE_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        model_selection: {
          type: "object",
          additionalProperties: false,
          properties: {
            instanceId: { type: "string", minLength: 1, description: "Engine instance id, for example codex or claude." },
            model: { type: "string", minLength: 1, description: "Exact model id on that instance." },
            effort: { type: "string", description: "Optional effort level the instance offers; omit for the engine default." },
            variant: { type: "string", description: "Optional explicit model variant; choose this or effort, not both." },
          },
          required: ["instanceId", "model"],
          description: "The new default selection.",
        },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "One sentence the user will see explaining why." },
        for_bot_id: {
          type: "string",
          description: "Primary Bot only: the id of another bot of the person whose default model this changes. Omit to change your own.",
        },
        quote: PERSON_QUOTE,
      },
      required: ["model_selection", "reason"],
    },
  };

export const DEF_PROPOSE_RULE = {
    name: "propose_rule",
    description:
      "Propose add, change or remove of one personal Auto-review rule (allow / ask / deny) after the person confirms an action or asks in chat. Writes custom-approval-rules; org Ask/Deny still win. List/edit with sagax_settings (family rules). Confirm card unless a Primary Bot quote names the rule. Allow never auto-applies from Full alone." + PROPOSAL_OUTCOME,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["add", "change", "remove"], description: "add, change or remove." },
        when: { type: "string", minLength: 1, maxLength: 500, description: "add: when-text (3+ words). change: prefer changes.when." },
        behavior: { type: "string", enum: ["allow", "ask", "deny"], description: "add: allow, ask or deny. change: prefer changes.behavior." },
        rule_id: { type: "string", minLength: 1, description: "change/remove: id from sagax_settings list (family rules)." },
        scope_bot_id: { type: ["string", "null"], description: "Omit = this bot; null = every bot of the person; or a bot id they own." },
        risk_scope: {
          type: "array",
          items: { type: "string", enum: ["destructive", "irreversible", "money", "external-send"] },
          description: "allow only: risk classes covered.",
        },
        changes: {
          type: "object",
          additionalProperties: false,
          properties: {
            when: { type: "string", minLength: 1, maxLength: 500 },
            behavior: { type: "string", enum: ["allow", "ask", "deny"] },
            botId: { type: ["string", "null"] },
            enabled: { type: "boolean" },
            riskScope: {
              type: "array",
              items: { type: "string", enum: ["destructive", "irreversible", "money", "external-send"] },
            },
          },
          description: "change: at least one field.",
        },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "One sentence the user will see explaining why." },
        quote: PERSON_QUOTE,
      },
      required: ["action", "reason"],
    },
  };

export const DEF_PROPOSE_TEAM_MEMORY = {
    name: "propose_team_memory",
    description:
      "Propose something every bot on the team should know: who a person is (person), where something lives (place), what was decided (decision), or what a name means (term). Every addition or replacement waits for a member of this team, or an organization admin, to confirm its card before entering shared prompts. End the turn and do not claim it is remembered before confirmation; accepted facts stay unchanged until then.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["person", "place", "decision", "term"], description: "What kind of entry this is." },
        name: { type: "string", maxLength: 120, description: "The person's name, the thing or document, the decision in a few words, or the term." },
        detail: { type: "string", maxLength: 600, description: "One or two sentences: the person's role, where the thing lives, what was decided and where, what the term means." },
        aliases: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 }, description: "Other names it goes by, for example a nickname or an abbreviation." },
      },
      required: ["kind", "name", "detail"],
    },
  };

export const DEF_NUDGE_PERSON = {
    name: "nudge_person",
    description:
      "Shake a colleague's window (organization servers only), once every few minutes. Pass principal_id for one person, or group_id for the other people of a group chat.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        principal_id: { type: "string", maxLength: 120 },
        group_id: { type: "string", maxLength: 80 },
      },
    },
  };

export const TEAM_TOOL_NAMES: ReadonlySet<string> = new Set(['start_thread', 'create_bot', 'list_team_setup', 'propose_team_setup', 'propose_bot_deletion', 'import_plugin_team', 'archive_bot', 'create_room', 'manage_room', 'retry_thread', 'propose_profile', 'propose_model', 'propose_rule', 'propose_team_memory', 'nudge_person'] as const);

/** Handle a tool of this family, or return null when the name is not ours. */
export async function callTeamTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult | null> {
  const { botId: BOT_ID, threadId: THREAD_ID, depth: DEPTH, externalRuntime: EXTERNAL_RUNTIME, coordinating: COORDINATING } = context;
  const { api, apiResponse } = context.client;
  if (!TEAM_TOOL_NAMES.has(name)) return null;
  if (name === "start_thread") {
    const title = String(args.title ?? "").trim();
    const message = String(args.message ?? "").trim();
    if (!title || !message) return { text: "start_thread needs title (one short line) and message (the complete first message).", isError: true };
    const toBotId = typeof args.bot_id === "string" ? args.bot_id.trim() : "";
    if (COORDINATING && toBotId && toBotId !== BOT_ID) {
      return { text: "Use coordinate_bots for teammates; start_thread only opens a separate job on yourself.", isError: true };
    }
    const folder = typeof args.folder === "string" ? args.folder.trim() : "";
    const body: Record<string, unknown> = { fromBotId: BOT_ID, fromThreadId: THREAD_ID, title, message, depth: DEPTH };
    if (toBotId) body.toBotId = toBotId;
    if (folder) body.folder = folder;
    if (args.report_back === true) body.reportBack = true;
    if (typeof args.workspace === "string" && args.workspace) body.workspace = args.workspace;
    if (args.read_only === true) body.readOnly = true;
    const resumeId = typeof args.thread_id === "string" ? args.thread_id.trim() : "";
    if (resumeId) body.resumeThreadId = resumeId;
    const r = await api("/api/internal/threads", { method: "POST", body: JSON.stringify(body) });
    // V4: the per-turn thread limit returns 200 { applied:false, limit:true }.
    if (r.limit === true || r.applied === false) {
      return { text: String(r.message ?? r.error ?? "Thread limit reached for this turn.") };
    }
    if (resumeId && (!r.error || r.state === "failed")) {
      // a follow-up into a thread of its own (sub-agent resume, parity D1)
      const into = `Sent a follow-up into #${String(r.title ?? title)} [thread id: ${String(r.threadId ?? resumeId)}]`;
      if (r.state === "failed") return { text: `${into}, but it could not start: ${String(r.error ?? "unknown reason")}. Tell the person.`, isError: true };
      return { text: `${into}. ${r.state === "queued" ? "It waits for a free slot, then runs" : "It is running now"} with that thread's history; its result stays in that thread. Mention it to the person as #${String(r.title ?? title)}.` };
    }
    // A refusal opened nothing. A "failed" state opened the thread and could
    // not start its turn — that one still counts, and still has an id.
    if (r.error && r.state !== "failed") return { text: `Couldn't open that thread: ${String(r.error)}`, isError: true };
    const threadTitle = String(r.title ?? title);
    const threadId = String(r.threadId ?? "");
    const where = r.self === true ? "on yourself" : `on @${String(r.botName ?? "that bot")}`;
    const opened = `Opened thread #${threadTitle} ${where} [thread id: ${threadId}].`;
    if (r.self === true && r.parallel === true) {
      if (r.state === "failed") return { text: `${opened} It could not start: ${String(r.error ?? "unknown reason")}. Tell the person.`, isError: true };
      return { text: `${opened} It runs as a parallel task of this conversation${r.state === "queued" ? " (waiting for a free slot)" : ""}: the person sees its card here, and its result is posted back here when it finishes. Do not wait for it; carry on or end your turn.` };
    }
    if (r.self === true) {
      if (r.state === "running") {
        return { text: `${opened} It is running now, in parallel with this conversation, and its result stays in that thread — it will not be delivered here. Mention it to the person as #${threadTitle}; use list_threads in a later turn to see how it is going.` };
      }
      if (r.state === "queued") {
        const position = Number(r.position) || 1;
        const limit = Number(r.limit) || 0;
        return { text: `${opened} You are at your limit of ${limit} threads running at once, so it is ${ordinal(position)} in line and starts as soon as one of them finishes — nothing more to do. Mention it to the person as #${threadTitle}.` };
      }
      return { text: `${opened} It could not start: ${String(r.error ?? "unknown reason")}. The thread exists but nothing is running in it; tell the person.`, isError: true };
    }
    // A peer thread is a handoff: like delegate_bot, it starts after this
    // turn and reports back here, so the id is a claim ticket the model
    // must not cash in this same turn.
    const delegationId = typeof r.delegationId === "string" ? r.delegationId.trim() : "";
    const approval = r.approvalRequired === true
      ? " The person must approve this handoff first; their card appears after your turn ends."
      : "";
    const timing = r.state === "queued"
      ? ` @${String(r.botName ?? "that bot")} can run ${Number(r.limit) || 0} threads at once and they are all spoken for, so it waits ${ordinal(Number(r.position) || 1)} in line for a free slot after this turn ends.`
      : " It starts when this turn ends, like any handoff.";
    return {
      text: `${opened}${timing}${approval} Its result will be delivered to this conversation automatically (delegation id: ${delegationId || "unknown"}). Acknowledge it, mention it to the person as #${threadTitle}, and finish your turn; do not check or wait for it in this turn.`,
    };
  }
  if (name === "list_team_setup") {
    return { text: JSON.stringify(await api("/api/internal/team-setup-catalog")) };
  }
  if ((name === "propose_bot_deletion" && typeof args.quote === "string") || name === "archive_bot") {
    if (EXTERNAL_RUNTIME) return { text: `Unknown tool: ${name}`, isError: true };
    const botId = String(args.bot_id ?? "").trim();
    if (!botId) return { text: `${name} needs bot_id.`, isError: true };
    const restore = name === "archive_bot" && args.restore === true;
    const { status, body } = await apiResponse("/api/internal/settings", { method: "POST", body: JSON.stringify({
      action: "set", key: name === "archive_bot" ? "bot.hidden" : "bot.delete", target: botId, value: name === "archive_bot" ? !restore : true,
      ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
    }) });
    const text = String(body.text ?? body.error ?? "").slice(0, 4000);
    if (status >= 400 || body.error) return { text: text || "The change was refused.", isError: true };
    return { text: text || "Done." };
  }
  if (name === "import_plugin_team") {
    const result = await api("/api/internal/plugin-team-import-requests", {
      method: "POST", body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID,
        marketplace: args.marketplace, plugin: args.plugin,
        ...(typeof args.team === "string" && args.team.trim() ? { team: args.team.trim() } : {}),
        ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
      }),
    });
    if (result.error) return { text: String(result.error), isError: true };
    const completed = completedProposalResult(result, "the plugin team import");
    if (completed) return completed;
    return { text: `One review card is visible: ${String(result.title)}. Nothing has been imported yet. End this turn; the decision and structured result resume you automatically once. Do not ask again, poll, or repeat this request.` };
  }
  if (name === "propose_team_setup" || name === "propose_bot_deletion") {
    const deleting = name === "propose_bot_deletion";
    const result = await api(deleting ? "/api/internal/bot-deletion-requests" : "/api/internal/team-setup-requests", {
      method: "POST", body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID,
        ...(deleting ? { targetBotId: args.bot_id, reason: args.reason } : { plan: args }),
      }),
    });
    const completed = completedProposalResult(result, deleting ? "the requested bot deletion" : "the requested team setup");
    if (completed) return completed;
    return { text: `One review card is visible: ${String(result.title)}. Nothing has been applied. End this turn; the decision and structured result resume you automatically once. Do not ask again, poll, or repeat this proposal.` };
  }
  if (name === "create_bot") {
    const botName = String(args.name ?? "").trim();
    const role = String(args.role ?? "").trim();
    const instructions = String(args.instructions ?? "").trim();
    if (!botName || !role || !instructions) {
      return { text: "create_bot needs name, role, and instructions.", isError: true };
    }
    const r = await api(`/api/internal/create-bot`, {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        name: botName,
        role,
        instructions,
        ...(args.modelSelection !== undefined ? { modelSelection: args.modelSelection } : {}),
        ...(typeof args.cwd === "string" ? { cwd: args.cwd.trim() } : {}),
        ...(args.suggestion === true ? { suggestion: true } : {}),
      }),
    });
    // Below Full Access the server shows the person one review card and
    // creates nothing yet; Full Access applies it in this turn.
    if (r.state === "pending" && args.suggestion === true) {
      return { text: `Your suggestion is on one card for the user: ${String(r.title)}. @${botName} has not been created. End this turn; their answer resumes you once. If they choose Not now, do not suggest another specialist in this conversation unless they ask.` };
    }
    if (r.state === "pending") {
      return { text: `One review card is visible: ${String(r.title)}. @${botName} has not been created yet. End this turn; the decision and structured result resume you automatically once. Do not ask again, poll, or repeat this request.` };
    }
    if (!r.id) return completedProposalResult(r, `creating @${botName}`) ?? { text: `@${botName} was not created.`, isError: true };
    return {
      text: `Created @${r.name ?? botName} in ${r.section ?? "General"} [id: ${r.id}].${r.modelSelection ? ` Model: ${JSON.stringify(r.modelSelection)}.` : ""} Assign work with ${COORDINATING ? "coordinate_bots" : "delegate_bot"}.`,
    };
  }
  if (name === "create_room") {
    if (args.section !== undefined) return { text: "Room sections are fixed to your own section; ask the user to move rooms.", isError: true };
    const roomName = String(args.name ?? "").trim();
    const memberIds = Array.isArray(args.member_bot_ids)
      ? args.member_bot_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const bulletin = typeof args.bulletin === "string" ? args.bulletin.trim() : undefined;
    if (!roomName) {
      return { text: "create_room needs a room name.", isError: true };
    }
    if (!memberIds.length) {
      return { text: "create_room needs at least one bot ID in member_bot_ids.", isError: true };
    }
    const r = await api(`/api/internal/create-room`, {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        name: roomName,
        memberIds,
        bulletin,
      }),
    });
    if (r.error) return { text: `Couldn't create room: ${r.error}`, isError: true };
    return {
      text: `Created room “${r.name ?? roomName}” in section “${r.section ?? "General"}” [id: ${r.id}] with ${r.memberCount ?? memberIds.length} members.`,
    };
  }
  if (name === "manage_room") {
    if (args.section !== undefined || args.action === "set_section") return { text: "Moving rooms between sections is user-only.", isError: true };
    const roomId = String(args.room_id ?? "").trim();
    const action = String(args.action ?? "").trim();
    if (!roomId || !action) {
      return { text: "manage_room needs room_id and action.", isError: true };
    }
    const memberIds = Array.isArray(args.member_bot_ids)
      ? args.member_bot_ids.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const roomName = typeof args.name === "string" ? args.name.trim() : undefined;
    const bulletin = typeof args.bulletin === "string" ? args.bulletin.trim() : undefined;
    const r = await api(`/api/internal/manage-room`, {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        roomId,
        action,
        memberIds,
        name: roomName,
        bulletin,
      }),
    });
    if (r.error) return { text: `Couldn't manage room: ${r.error}`, isError: true };
    const message = typeof r.message === "string" ? r.message : `Updated room ${roomId}.`;
    return { text: message };
  }
  if (name === "propose_profile") {
    // A non-boolean toggle would be dropped silently while any valid half of
    // the request went through, applying a partial proposal the model never
    // described. Reject the whole call instead.
    if ((args.notifications !== undefined && typeof args.notifications !== "boolean")
      || (args.speakReplies !== undefined && typeof args.speakReplies !== "boolean")) {
      return { text: "propose_profile notifications and speakReplies must be true or false.", isError: true };
    }
    const changes: Json = {};
    if (typeof args.name === "string") changes.name = args.name.trim();
    if (typeof args.title === "string") changes.title = args.title.trim();
    if (typeof args.description === "string") changes.description = args.description.trim();
    if (typeof args.soul === "string") changes.soul = args.soul;
    if (typeof args.cwd === "string") changes.cwd = args.cwd.trim();
    if (typeof args.notifications === "boolean") changes.notifications = args.notifications;
    if (typeof args.speakReplies === "boolean") changes.speakReplies = args.speakReplies;
    if (!Object.keys(changes).length) {
      return { text: "propose_profile needs at least one of name, title, description, soul, cwd, notifications, or speakReplies.", isError: true };
    }
    const forBotId = String(args.for_bot_id ?? "").trim();
    const r = await api("/api/internal/profile-requests", {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        changes,
        reason: args.reason,
        // JSON.stringify drops the key entirely when no target was named
        forBotId: forBotId || undefined,
        ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
      }),
    });
    return confirmationResult(r, "the profile change", "profile");
  }
  if (name === "propose_model") {
    const raw = args.model_selection;
    const fields = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!fields || typeof fields.instanceId !== "string" || !fields.instanceId.trim() || typeof fields.model !== "string" || !fields.model.trim()) {
      return { text: "propose_model needs model_selection with instanceId and model.", isError: true };
    }
    if ((fields.effort !== undefined && (typeof fields.effort !== "string" || !fields.effort.trim()))
      || (fields.variant !== undefined && (typeof fields.variant !== "string" || !fields.variant.trim()))) {
      return { text: "propose_model effort and variant must be non-empty strings when supplied.", isError: true };
    }
    const selection: Json = { instanceId: fields.instanceId.trim(), model: fields.model.trim() };
    if (typeof fields.effort === "string" && fields.effort.trim()) selection.effort = fields.effort.trim();
    if (typeof fields.variant === "string" && fields.variant.trim()) selection.variant = fields.variant.trim();
    const forBotId = String(args.for_bot_id ?? "").trim();
    const r = await api("/api/internal/model-requests", {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        modelSelection: selection,
        reason: args.reason,
        // JSON.stringify drops the key entirely when no target was named
        forBotId: forBotId || undefined,
        ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
      }),
    });
    return confirmationResult(r, "the default model change", "model");
  }
  if (name === "propose_rule") {
    const action = String(args.action ?? "").trim();
    if (action !== "add" && action !== "change" && action !== "remove") {
      return { text: "propose_rule action must be add, change or remove.", isError: true };
    }
    if (action === "add" && (typeof args.when !== "string" || !args.when.trim())) {
      return { text: "propose_rule add needs when (at least three words naming the action).", isError: true };
    }
    if ((action === "change" || action === "remove") && (typeof args.rule_id !== "string" || !args.rule_id.trim())) {
      return { text: "propose_rule change/remove needs rule_id from sagax_settings list (family rules).", isError: true };
    }
    if (action === "change" && (args.changes === undefined || typeof args.changes !== "object" || Array.isArray(args.changes))) {
      return { text: "propose_rule change needs changes with at least one field.", isError: true };
    }
    const body: Json = {
      fromBotId: BOT_ID,
      fromThreadId: THREAD_ID,
      action,
      reason: args.reason,
      ...(typeof args.when === "string" ? { when: args.when } : {}),
      ...(typeof args.behavior === "string" ? { behavior: args.behavior } : {}),
      ...(typeof args.rule_id === "string" ? { ruleId: args.rule_id.trim() } : {}),
      ...(args.scope_bot_id === null ? { scopeBotId: null } : typeof args.scope_bot_id === "string" && args.scope_bot_id.trim() ? { scopeBotId: args.scope_bot_id.trim() } : {}),
      ...(Array.isArray(args.risk_scope) ? { riskScope: args.risk_scope } : {}),
      ...(args.changes && typeof args.changes === "object" && !Array.isArray(args.changes) ? { changes: args.changes } : {}),
      ...(typeof args.quote === "string" ? { quote: args.quote } : {}),
    };
    const r = await api("/api/internal/rule-requests", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return confirmationResult(r, "the approval-rule change", "rule");
  }
  if (name === "retry_thread") {
    const botId = String(args.bot_id ?? "").trim();
    const threadId = String(args.thread_id ?? "").trim();
    const note = typeof args.note === "string" ? args.note.trim() : "";
    if (!botId || !threadId) return { text: "retry_thread needs bot_id and thread_id — both are in the incident report.", isError: true };
    const r = await api("/api/internal/retry-thread", {
      method: "POST",
      body: JSON.stringify({ fromBotId: BOT_ID, fromThreadId: THREAD_ID, toBotId: botId, toThreadId: threadId, ...(note ? { note } : {}) }),
    });
    if (r.error) return { text: `Couldn't retry that thread: ${String(r.error)}`, isError: true };
    return { text: typeof r.message === "string" ? r.message : "The thread is running again. Its result stays in that thread; you are not woken for it — check it later with session_search or list_threads if you need to." };
  }
  if (name === "propose_team_memory") {
    const kind = String(args.kind ?? "").trim();
    const entryName = String(args.name ?? "").trim();
    const detail = String(args.detail ?? "").trim();
    if (!kind || !entryName || !detail) return { text: "propose_team_memory needs kind, name, and detail.", isError: true };
    const r = await api("/api/internal/team-memory", {
      method: "POST",
      body: JSON.stringify({
        fromBotId: BOT_ID,
        fromThreadId: THREAD_ID,
        kind,
        name: entryName,
        detail,
        aliases: Array.isArray(args.aliases) ? args.aliases.filter((alias) => typeof alias === "string") : undefined,
      }),
    });
    return confirmationResult(r, `remembering ${entryName} for the team`, "entry");
  }
  return null;
}

