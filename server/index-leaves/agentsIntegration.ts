// @ts-nocheck
/** agentsIntegration (#1388). Pure move from server/index.ts. */
import { botCreationOffered } from "../bots/bot-creation.ts";
import { meetingNotetakerEnabled, DATA_DIR } from "../config.ts";
import { mcpIdentityEnv, mcpPolicyEnv } from "../mcp/mcp-permissions.ts";
import { personDisplayName } from "../people/viewer-identity.ts";
import { phoneToolTurn } from "../phone/phone-tools.ts";
import * as tts from "../tts/index.ts";
import { join } from "node:path";
export type Host = Record<string, any>;

export function createAgentsIntegration(getHost: () => Host): any {
function agentsIntegration(
  botId: string,
  threadId: string,
  depth: number,
  skillAuthoring: boolean,
  generation: string,
  roomHandoffId?: string,
  // Order of both callers (start-turn-computer-mount.ts, group-member-turn-launch-tools.ts):
  // the 0.8.28 order, which a later move had swapped, so a direct turn never got start_thread.
  roomCoordination = false,
  ownThreadCreation = false,
  hostFiles = false,
  /** The turn's engine has no web search of its own (server/web-search/native.ts). */
  noNativeWebSearch = false,
) {
  const host = getHost();
  const token = host.mintInternalCapability({
    botId,
    threadId,
    generation,
    depth,
    kind: "agents",
    skillAuthoring,
    createdBots: 0,
    openedThreads: 0,
    roomHandoffId,
    roomCoordination,
    ownThreadCreation,
    // Only an engine whose own tools read and write host files; a Cloud home
    // or hosted workspace keeps attach_file to the conversation's folders.
    ...(hostFiles && !host.HOSTED_WORKSPACE ? { deliversSavedFiles: true } : {})
  });
  return {
    command: process.execPath,
    args: [host.agentsProxyPath],
    env: {
      ...host.AGENTS_NODE_FLAG,
      SAGAX_HARNESS_URL: `http://127.0.0.1:${host.PORT}`,
      SAGAX_BOT_ID: botId,
      SAGAX_THREAD_ID: threadId,
      SAGAX_COMMS_TOKEN: token,
      SAGAX_TURN_DEPTH: String(depth),
      SAGAX_ROOM_TURN: roomCoordination ? "1" : "0",
      // 2026-10-28: a teammate one hop away keeps its tools, not the peer ones
      SAGAX_PEER_HOP: host.peerHopTurn(depth, roomCoordination) ? "1" : "0",
      // A real room (group conversation). A person's direct chat also sets
      // SAGAX_ROOM_TURN (bounded coordination), so a tool absent from rooms
      // only (propose_page) reads this, never SAGAX_ROOM_TURN.
      SAGAX_GROUP_TURN: host.store.groupByThread(threadId) ? "1" : "0",
      SAGAX_OWN_THREAD_CREATION: ownThreadCreation ? "1" : "0",
      SAGAX_SKILL_AUTHORING_ENABLED: skillAuthoring ? "1" : "0",
      // The agent-to-agent tools (server/agent-api.ts) in every turn outside
      // a room; a room uses post_to_room. The route re-checks.
      SAGAX_AGENT_API: !host.store.groupByThread(threadId) && host.store.bot(botId) && host.agentApiMounted(host.store.bot(botId)!) ? "1" : "0",
      SAGAX_MEMORY_ENABLED: host.store.bot(botId)?.memoryEnabled === false ? "0" : "1",
      // A room turn in a group whose shared memory is on gets
      // group_memory_update (server/memory/group-memory.ts); the route re-checks.
      SAGAX_GROUP_MEMORY: host.groupMemoryWritable(host.store.groupByThread(threadId), botId) ? "1" : "0",
      // The shared-computer tools are advertised only while the workspace
      // gate is on; the routes behind them refuse regardless.
      SAGAX_SHARED_COMPUTERS_ENABLED: host.lendingEnabled() ? "1" : "0",
      // A Cloud home offers no this computer and no Local VM (cloud-home.ts),
      // so select_computer lists neither and vm_exec is not shown.
      SAGAX_CLOUD_HOME: "0",
      // Same capability rule for voice: the tool is offered only when this
      // bot can actually speak, and the route re-checks on every call.
      SAGAX_VOICE_NOTES: (() => {
        const speaking = host.botForThread(botId, threadId) ?? host.store.bot(botId);
        // 2026-10-16: on the organization's xAI voice only for the person
        // this turn is for (the route re-checks).
        const given = host.orgXaiMediaGiven("voice", host.turnMediaPrincipal(threadId), host.effectiveBotOwner(speaking ?? {}));
        // #1098: the person's own voice key serves their own turns.
        const owner = host.providerAccountOwner(host.turnMediaPrincipal(threadId) ?? host.effectiveBotOwner(speaking ?? {}));
        const held = owner ? host.perspicaxDirectory?.providerKeys(owner.sub) ?? [] : [];
        const ownVoice = ["elevenlabs", "fish", "xai"].some((provider) => held.includes(provider));
        return (ownVoice || tts.voiceReady(host.cfg, speaking?.voice, { xaiKeyGiven: given })) && speaking?.voiceNotes !== false ? "1" : "0";
      })(),
      // end_call is offered only while this thread is on a live phone call.
      // The route re-checks; a turn that is not a call never sees the tool.
      SAGAX_MEME_REPLIES: (() => {
        const speaking = host.botForThread(botId, threadId) ?? host.store.bot(botId);
        return speaking?.memeReplies === "off" ? "0" : "1";
      })(),
      SAGAX_VOICE_CALL: host.voiceCalls.active(threadId) ? "1" : "0",
      // connect_github: any chat (#2109); the device flow has a built-in
      // client id (server/github/builtin-client.ts). The route re-checks.
      SAGAX_GITHUB_CONNECT: host.githubConnect.deviceFlowAvailable() ? "1" : "0",
      // join_meeting: Settings > Developer > Experimental > Meeting notetaker, direct
      // conversations only. The internal route re-checks both.
      SAGAX_MEETINGS: meetingNotetakerEnabled(host.cfg) && !host.store.groupByThread(threadId) ? "1" : "0",
      // phone_tool: the person speaking, in a 1:1 turn of their own words
      // (their own phone, on their bot or one shared with them, 2026-10-28),
      // and a phone of theirs offers tools now. The route re-checks.
      // vault_http_request: this bot may send an API key of the person here
      // (server/vault/credential-http.ts). The route re-checks every call.
      SAGAX_VAULT_HTTP: host.vaultHttpMounted(botId, threadId) ? "1" : "0",
      SAGAX_PHONE_TOOLS: (() => {
        const bot = host.store.bot(botId);
        if (!bot) return "";
        const turn = phoneToolTurn({
          ownsThread: true,
          inRoom: Boolean(host.store.groupByThread(threadId)),
          depth,
          speakerOrigin: host.turnSpeakers.get(threadId)?.origin,
          speakerPrincipal: host.turnSpeakerPrincipals.get(threadId),
          ownTurn: host.speakerOwnWordsTurn(bot, threadId),
          tainted: host.phoneToolTaintedThreads.has(threadId)
        });
        return "error" in turn ? "" : host.phoneTools.botTools(turn.person).join(",");
      })(),
      // recall_topic: a person's turn in a single-stream segment
      // (server/streams/single-stream.ts). The route re-checks.
      SAGAX_SINGLE_STREAM: depth === 0 && host.store.taskByThread(botId, threadId)?.streamSegment === true ? "1" : "0",
      // route_message: a person's turn in a 1:1 conversation whose busy sends
      // the bot may route (server/busy-routing.ts). The route re-checks.
      SAGAX_ROUTE_MESSAGES: depth === 0 && host.autoRoutableThread(botId, threadId) ? "1" : "0",
      // And for a role: team setup, bot creation and deletion, rooms and
      // retries are shown only to a Chief of Staff, whom their routes require.
      SAGAX_CHIEF_OF_STAFF: host.store.bot(botId)?.chiefOfStaff === true ? "1" : "0",
      // 2026-10-17: create_bot for any other bot of the person that may
      // create one (server/bots/bot-creation.ts); the route re-checks the turn.
      SAGAX_CREATE_BOTS: (() => {
        const bot = host.store.bot(botId);
        return bot && botCreationOffered(bot, host.ownerBotsReadOnly(bot)) ? "1" : "0";
      })(),
      // The Perspicax gateway tools on an organization server linked to Perspicax;
      // /api/internal/perspicax/tool re-checks that a profile is mounted.
      SAGAX_PERSPICAX_TOOLS: host.IDENTITY.kind === "perspicax" && host.perspicaxMcp ? "1" : "0",
      // Technician key for remote support: this computer only (desktop PC or
      // the bot's cloud computer). The private file never goes in the env.
      SAGAX_REMOTE_SUPPORT_DIR: join(DATA_DIR, "remote-support"),
      // The opener (person and bot) is not read from this env: the engine
      // launches the proxy and could forge it. It comes only from the owner
      // the server attaches to the /api/internal/perspicax/tool answer.
      ...(() => {
        const speakerId = host.safetyPrincipal(threadId).principalId;
        const speaker = speakerId ? host.principals.byId(speakerId) : undefined;
        return {
          SAGAX_TECHNICIAN_NAME: (personDisplayName(speaker) || host.cfg.profile?.name?.trim() || "").slice(0, 80),
          SAGAX_ORG_NAME: (process.env.SAGAX_ORG_NAME?.trim() || "Pulsatrix").slice(0, 80)
        };
      })(),
      // Who the permission layer judges (server/mcp/mcp-permissions.ts).
      ...mcpIdentityEnv(host.mcpIdentityOf(botId, threadId)),
      ...mcpPolicyEnv(process.env),
      // The claim tools (server/perspicax/perspicax-claims.ts) while this turn has a
      // Perspicax account connection mounted for the person speaking; the route re-checks.
      SAGAX_CLAIMS: host.perspicaxMcp?.hasMounted(threadId, generation, botId) ? "1" : "0",
      // Grok bridge (#2193): the speaker has a live per-person link.
      SAGAX_GROK_BRIDGE: (() => {
        if (!host.grokBridgeAllowed()) return "0";
        const person = host.safetyPrincipal(threadId).principalId?.trim().toLowerCase()
          || (host.store.bot(botId) ? host.effectiveBotOwner(host.store.bot(botId)!).trim().toLowerCase() : "")
          || (host.IDENTITY.kind === "solo" ? host.localPrincipalId() : "");
        if (!person) return "0";
        const live = host.grokBridgeService.live(person);
        return live.ok ? "1" : "0";
      })(),
      // sagax_web_search: an engine without a web search of its own, for a
      // person who saved a search provider (a local file read, no network).
      // The route re-checks; the key never goes in this env.
      SAGAX_WEB_SEARCH: noNativeWebSearch && (() => {
        const scope = host.webSearchScopeForThread(threadId);
        return scope ? host.webSearchStore.ready(scope) : false;
      })() ? "1" : "0",
      // The person's own OpenAPI operations. Empty in a room, for another
      // member, and when they have not pasted a document. Headers stay out.
      SAGAX_OPENAPI_TOOLS: host.openApiToolsEnv(botId, threadId)
    }
  };
}
  return agentsIntegration;
}
