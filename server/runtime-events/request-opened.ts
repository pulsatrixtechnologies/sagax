// @ts-nocheck
/** handleRequestOpened (#1388). Pure move from server/index.ts bus.subscribe. */
import { TASK_WORKSPACES_DIR } from "../workspace/workspace.ts";
import { toolChangesRules } from "../../shared/step-up.ts";
import { mcpAllowKey } from "../../shared/approval-describe.ts";
import { CONFIDENTIAL_CARD_REFUSED } from "../threads/confidential-threads.ts";
import { DATA_DIR } from "../config.ts";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import {
  autoVerdict,
} from "../approvals/auto-approve.ts";
import { memberAutoApprovalAllowed } from "../approvals/member-auto-approval.ts";
import { watchReadCovered } from "../proactive/proactive-ask.ts";
import {
  ownerModeForTurn,
  perspicaxSelfAnswer,
  perspicaxSelfAnswerAt,
} from "../approvals/owner-autonomy.ts";
import {
  cardRuleCandidate,
  folderRuleCandidate,
  matchOwnerRule,
  ownerDecision,
  ownerVerdictOver,
  ruleInputFor,
} from "../approvals/owner-approval.ts";
import { appendDecision, decisionCall } from "../decision-log.ts";
import { cardStandingGrants, orgServerExecRouting } from "../exec-target.ts";
import { providerLabel } from "../memes/providers.ts";
import { providerMcpTool, providerToolAllowKey } from "../provider-tool-allow.ts";
import {
  memberEnvironmentAutonomyAllowed,
  ownAttachmentRead,
  ownEnvironmentAutonomy,
  ownEnvironmentTool,
} from "../people/member-environment.ts";
import {
  customRuleNotice,
  reviewCustomRules,
  serverHome,
} from "../rules/custom-rules-review.ts";
import {
  safetyPermissionEffect,
  stashSafetyNote,
} from "../safety/safety-review.ts";
import { confidentialCardAnswerable } from "../threads/confidential-threads.ts";
import { workspaceDir } from "../workspace/workspace.ts";
import { presentRequestOpened } from "./request-opened-present.ts";
export function handleRequestOpened(event: any, ctx: any, host: any): void {
  const {
    bot, group, speaker, pushMessage,
  } = ctx;
  switch (event.type) {
    case "request.opened":
    {
      {
        const askerEarly = bot ?? (speaker ? host.store.bot(speaker.botId) : undefined);
        // a harness ask is only a card, and no adapter could take a refusal
        if (askerEarly && !event.harnessAsk && host.readAndDraft.answers(event, askerEarly, (message) => pushMessage(message))) break;
      }
      // A structured ask carries the model's own options and has no
      // allow/deny answer, so it is a question no matter which channel the
      // provider routed it through — and, like every question, no approval
      // mode may ever answer it for the person.
      const permission = event.requestType === "permission" && !event.questions?.length;
      // A permission request here is one the provider left for a person: its
      // own mode already ran (Ask, Edits, Auto's reviewer, Custom's config).
      // Only the person's explicit Full access or exact saved command answers.
      // Approve for me allows a web search. The app does not guess whether
      // the action is safe. A QUESTION always reaches the human — even Full
      // access never invents an answer.
      const asker = bot ?? (speaker ? host.store.bot(speaker.botId) : undefined);
      const unattended = permission && asker && event.requestId ? host.isUnattended(asker.id, event.threadId) : false;
      // B2.1: grant check, then speaker check, before the card (or Full access) answers
      const cardGuardTool = event.mcpTool ?? event.tool;
      const cardGuard = permission && asker && event.requestId && typeof cardGuardTool === "string"
        ? host.agentCardGuard.opened({
          requestId: event.requestId, mcpTool: cardGuardTool, bot: { id: asker.id, name: asker.name }, input: event.input, summary: event.summary,
          ...(!host.turnRoutineLineage.has(event.threadId) && host.turnSpeakerPrincipals.get(event.threadId)
            ? { speakerPrincipalId: host.turnSpeakerPrincipals.get(event.threadId)! } : {})
        })
        : null;
      if (cardGuard?.deny && asker && event.requestId) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny" }).catch(host.reportBackgroundError);
        pushMessage({ role: "bot", kind: "activity", tool: { name: `Refused ${cardGuardTool}: ${cardGuard.decision.reason === "speaker_not_granted" ? "the person this turn speaks for has" : "this bot has"} no grant for it (Settings → Tool access).`, ok: false } });
        break;
      }
      // A turn a guest drives on a Cloud home is Ask, room turns included,
      // and no command the owner saved answers for it.
      // A mail-woken routine run (S2) is held the same way: Ask, and no rule
      // the owner saved answers for it.
      const guestDriven = host.cloudGuestDriven(event.threadId) || host.botmailConfined(event.threadId);
      const ownApprovalMode = (who: BotRecord) => host.approvalModeForTurn(who, host.isInternalTurn(event.threadId), event.threadId);
      // A room turn runs at the level it was sent with, which a Chief's
      // handoff may have raised (roomTurnApprovalMode). The bot's own level
      // would make a Full room turn ask on engines that leave requests to us.
      const effectiveApprovalMode = !asker || guestDriven ? "ask"
        : group && speaker?.botId === asker.id ? host.roomTurnLevels.forRequest(event.threadId, asker.id, () => ownApprovalMode(asker))
          : ownApprovalMode(asker);
      // #1905 (2026-11-02): the one Full access decision for this turn
      // (full-access-gate.ts), read before the safety review and before any
      // card: at Full the person answered the safer path and the
      // confirmation already; an organization or personal rule, isolation
      // and a sensitive path are read below, where every level reads them.
      const fullTurn = host.fullAccessDecision(effectiveApprovalMode);
      // Safety review, before any mode answers. A hard block or the first
      // safer path is a refusal, not a card Full could accept. A confirmation
      // is an explicit card. A read may run. Shadow changes nothing.
      const safetyName = event.mcpTool ?? event.tool;
      const safetyText = [event.mcpTool, event.tool, event.command?.command, event.summary, event.input].filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
      // The person already allowed this exact email draft on its own card
      // (server/mail/email-draft-send.ts): the pass is bound to this bot, the
      // approved connector, recipients, subject and body, and is used here,
      // once. Only then is the outbound step of the safety review (a draft,
      // then a confirmation) taken as answered; every other check stays.
      const emailDraftRequest = permission && event.requestId && asker
        ? host.takeEmailSendPass(event.threadId, asker.id, event.mcpTool ?? event.tool, event.input)
        : null;
      const emailDraftCall = emailDraftRequest !== null;
      const safetyWho = permission && event.requestId ? host.safetyPrincipal(event.threadId) : undefined;
      // full-access: safety-review
      const reviewedSafety = safetyWho
        ? safetyPermissionEffect({
          text: safetyText,
          surface: /computer/i.test(safetyName) ? "computer" : /propose_routine/.test(safetyName) ? "routine" : event.mcpTool ? "mcp" : "shell",
          tool: safetyName,
          known: event.tool !== "other" || Boolean(event.mcpTool),
          // 2026-10-27 (#1098): the person's own environment, as the sandbox
          // and desktop paths already say (not read from the text)
          ...(asker ? { ownEnvironment: host.safetyOwnEnvironment(asker, event.threadId, safetyName) } : {}),
          // #1905: at Full the safer path and the confirmation are the person's
          // to skip (a block still blocks); never read from the text
          fullAccess: fullTurn.acts,
          triage: safetyWho.triage,
          ...(safetyWho.principalId ? { principalId: safetyWho.principalId } : {}),
          threadId: event.threadId,
          ...(asker ? { botId: asker.id } : {})
        })
        : null;
      const safetyEffect = emailDraftCall && reviewedSafety && reviewedSafety.kind !== "allow"
        && reviewedSafety.classKey === "outbound:send" && (reviewedSafety.verdict.code === "safer" || reviewedSafety.verdict.code === "confirm")
        ? null
        : reviewedSafety;
      if (safetyEffect?.kind === "stop" && event.requestId) {
        if (emailDraftRequest) host.patchEmailSend(event.threadId, emailDraftRequest, { status: "failed", error: safetyEffect.message });
        stashSafetyNote(event.requestId, safetyEffect.message);
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : asker ? host.registry.get(asker.modelSelection.instanceId) : undefined;
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message: safetyEffect.message }).catch(host.reportBackgroundError);
        pushMessage({ role: "bot", kind: "activity", tool: { name: safetyEffect.message, ok: false } });
        break;
      }
      // Native shell descriptors are distinct from computer/MCP permissions;
      // choosing a local desktop must not disable an exact shell grant.
      // A command on the server asked by a member's bot waits for an
      // organization admin: no saved command, session grant or mode answers it.
      // So does every other card of that bot except a file tool that stays in
      // its own task workspace: all bots share one container, user and HOME,
      // so a write to the shared settings or a read of a secret is as good as
      // a command (memberBotAdminApproval).
      const memberAsker = Boolean(permission && asker && host.memberOwnedInOrg(asker));
      // `mcpTool`: the engine's own `<server>__<tool>` name when `tool` is a
      // kind (ACP "other") or a bare name (Codex), so a built-in Sagax tool
      // in the member's own scope (member-tool-scope.ts) is recognized.
      // 2026-10-14: a tool within the owner's own rights (a remote or
      // personal MCP server, a web search) is the owner's card, not an admin's.
      // 2026-10-16: a tool of the owner's own isolated environment (their
      // server environment, their Local VM), mounted for this turn, runs
      // unasked while the organization allows it (member-environment.ts).
      const ownEnvironment = Boolean(permission && asker && event.requestId && host.ownEnvironmentRequest(asker, event.threadId, event.mcpTool ?? event.tool, guestDriven));
      // 2026-10-16 security review: what Sagax may answer by itself (its own
      // tools, the owner's environment) is held for a card when the person
      // protects one of the call's classes with a security key, so that
      // card then asks for the key (#648).
      // 2026-10-17: a built-in is Sagax's by identity, never by a name another
      // server of the turn could have spelled (sagax-internal-tools.ts).
      const foreignServers = permission && asker && event.requestId ? host.foreignMcpServerNames(asker, event.threadId) : [];
      const internalTool = permission && asker && event.requestId ? host.sagaxInternalTool(event.mcpTool ?? event.tool, foreignServers) : null;
      // Tailcat (2026-10-22, server/remote-support/remote-session-exec.ts): a command on a
      // client's computer that does more than read is the person's call every
      // time: a card no level, rule or Always allow answers.
      const remoteInput = typeof event.input === "string" ? event.input : undefined;
      const remoteCall = permission && asker && event.requestId
        ? host.remoteSessionToolCall(event.mcpTool ?? event.tool, remoteInput, (session) => {
          const principalId = host.remoteSessionSpeaker(event.threadId);
          return principalId ? host.remoteSessions.osFor({ principalId, botId: asker.id, threadId: event.threadId, ...(session ? { id: session } : {}) }) : null;
        })
        : null;
      // Bot computers (#2726): a command on a host whose access rule is Ask
      // that does more than read waits for this card (Always allow runs it).
      const hostCommand = permission && asker && event.requestId ? host.hostComputerExecCommand(event.mcpTool ?? event.tool, remoteInput) : undefined;
      const hostPrincipal = hostCommand ? host.remoteSessionSpeaker(event.threadId) : undefined;
      if (hostCommand && hostPrincipal && asker && host.hostComputers.needsCard(hostPrincipal, asker.id, hostCommand, host.hostComputerHostName(remoteInput))) {
        event.requiresExplicitApproval = true;
        host.noteRemoteExecRequest(event.threadId, event.requestId!, remoteInput);
      }
      if (remoteCall?.remote && !remoteCall.readOnly) {
        event.requiresExplicitApproval = true;
        // the route runs it only after this card's yes (grantRemoteExecApproval)
        host.noteRemoteExecRequest(event.threadId, event.requestId!, remoteInput);
      }
      // 2026-10-19 (owner setup, server/approvals/owner-autonomy.ts): a Perspicax read
      // or coordination lease on Sagax's own mount, never a name another
      // server of the turn could have spelled, never a guest's turn.
      // Security review: a read only for the owner's own work (another
      // person's turn, a webhook, another owner's hop keep their card), and
      // never past the owner's own deny or ask rule; a lease at any turn.
      const perspicaxCandidate = permission && asker && event.requestId && !guestDriven
        && !host.foreignToolSpelling(event.mcpTool ?? event.tool, foreignServers)
        ? perspicaxSelfAnswer(event.mcpTool ?? event.tool, (api) => host.perspicaxMcp?.reviewedReads(asker.id, api) ?? false) : null;
      const perspicaxOwnerRule = perspicaxCandidate && asker
        ? matchOwnerRule(host.ownerApprovals.rulesOf(host.approvalOwnerId(asker, event.threadId), asker.id), {
          ownerId: host.approvalOwnerId(asker, event.threadId), botId: asker.id, tool: event.mcpTool ?? event.tool,
          ...(typeof event.input === "string" ? { input: event.input } : {})
        })
        : undefined;
      const perspicaxSelfKind = perspicaxCandidate && perspicaxOwnerRule?.behavior !== "deny" && perspicaxOwnerRule?.behavior !== "ask"
        && (perspicaxCandidate === "lease" || (asker && host.ownerLineageFor(asker, event.threadId) === "owner"))
        ? perspicaxCandidate : null;
      const selfAnswerStepUp = (ownEnvironment || internalTool || perspicaxSelfKind) && asker
        ? host.autoAnswerStepUp(asker, event.threadId, {
          tool: event.tool,
          ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          summary: event.summary
        })
        : [];
      // 2026-10-19 a call on the owner's own destination (their server
      // environment, their own computer or its Local VM) is the owner's card
      // at their own level, never an admin's; and an owner who holds
      // host.commands (given in Perspicax) answers the server commands of
      // their own bots.
      const destination = permission && asker && event.requestId ? host.destinationOfCall(asker, event.threadId, event.mcpTool ?? event.tool, guestDriven) : null;
      const ownDestination = Boolean(destination);
      // 2026-10-19 (PR 3): on a bot someone else owns, the speaker's own
      // destination is the speaker's card.
      const destinationAnswerer = destination && !destination.byOwner ? destination.person : undefined;
      const cardAnswerer = asker ? destinationAnswerer ?? host.approvalOwnerId(asker, event.threadId) : "";
      const destinationOrigin = asker && destination ? host.destinationTurnOrigin(asker, event.threadId, destination.person) : "other";
      // Security review 2026-10-19: a call on a person's environment Sagax
      // mounted this turn that is not the card answerer's own (a peer hop
      // that mounted the sender's person, a turn nobody wrote in someone's
      // confidential thread): no mode, rule or session grant of the answerer
      // answers it, and it is judged at Ask.
      const foreignDestination = Boolean(permission && asker && event.requestId && !destination && host.mountedDestinationOf(asker, event.threadId, event.mcpTool ?? event.tool) !== null);
      // 2026-10-19 (PR 3): the speaker's explicit Always allow rules answer a
      // call in their own isolated environment (their cloud computer, their
      // Local VM) on someone else's bot, while the organization allows it;
      // never their mode, and never on their real computer.
      const speakerEnvironmentRules = Boolean(destinationAnswerer && ownEnvironmentTool(event.mcpTool ?? event.tool) && memberEnvironmentAutonomyAllowed(host.cfg.organization));
      // 2026-10-27 (#1098): a call in the person's own sandbox (their cloud
      // computer or Local VM, mounted for this turn, never a guest's turn or
      // someone else's place): its standing grants (session allow, saved
      // command, Always allow key) are the person's own on a member's bot
      // too, and the organization's "Toujours permettre" switch does not
      // take their Allow rules away there. The shared host keeps its rule.
      const ownSandboxCall = Boolean(permission && asker && event.requestId && !guestDriven && !foreignDestination && (ownEnvironment || speakerEnvironmentRules));
      const grantsOffered = cardStandingGrants({ memberOwned: memberAsker, ownSandbox: ownSandboxCall, callerManagesHostCommands: false }).offered;

      // 2026-10-19 (prod 0.5.27, #810 follow-up): computer_select only picks
      // among the places this turn mounted for the person it is for (their
      // cloud computer, their own computer, its Local VM): never an admin's,
      // and no card at all (autoVerdict ownComputerChoice). Each call on the
      // place it picks keeps its own rules (member-environment.ts
      // ownComputerChoiceCall).
      const ownComputerChoice = Boolean(permission && asker && event.requestId && !host.foreignToolSpelling(event.mcpTool ?? event.tool, foreignServers)
        && host.ownComputerChoiceRequest(asker, event.threadId, event.mcpTool ?? event.tool, cardAnswerer, guestDriven));
      const serverLevelCard = Boolean(memberAsker && asker && host.memberBotAdminApproval({
        tool: event.mcpTool ?? event.tool, command: event.command,
        // #1169: a file view names its path in its arguments
        paths: event.paths?.length ? event.paths : host.fileViewToolPaths(event.mcpTool ?? event.tool, typeof event.input === "string" ? event.input : undefined),
        workspaceRoot: join(realpathSync(DATA_DIR), "task-workspaces", asker.id),
        readRoots: [workspaceDir(asker.id)],
        ownerScopedMcpServer: host.ownerScopedMcpServerFor(asker, event.threadId),
        // #1930: the speaker's own grok.com connector, like a claude.ai one;
        // #3346: and a request the server holds for a connector it runs with
        // the turn's own principal (connectorHub, server only)
        ownAccountConnector: host.engineAccountConnectorCall(event, host.turnAccessByThread.get(event.threadId)?.via),
        ownEnvironment,
        ownDestination,
        ownComputerChoice,
        foreignMcpServers: foreignServers,
        // #1269: a read of the member's own bot is not an admin card
        rawInput: event.input,
        // 2026-10-28: vm_exec, shared_computer, attach_file and
        // add_mcp_server that stay in the member's own environment
        hostPlace: host.memberHostToolPlace(asker, event.threadId),
        callerBotId: asker.id,
        ownsBot: (id: string) => {
          if (id === asker.id) return true;
          const other = host.store.bot(id);
          const mine = host.recordedBotOwner(asker);
          const theirs = other ? host.recordedBotOwner(other) : undefined;
          return Boolean(mine && theirs && mine === theirs);
        }
      }));
      // Security review 2026-10-19: a holder of host.commands answers a
      // server-level card of their own bot only for their own turn, when the
      // card is theirs to answer (not a confidential thread of someone else),
      // and always by hand: no permission mode, rule, saved command or
      // Always allow answers it (`strictCard`), and the right is checked
      // again when the card is answered (adminApprovalCheck).
      const serverCommandHolder = Boolean(serverLevelCard && asker && !guestDriven
        && host.ownEnvironmentOrigin(asker, event.threadId) === "owner"
        && host.approvalOwnerId(asker, event.threadId).trim().toLowerCase() === host.effectiveBotOwner(asker).trim().toLowerCase()
        && host.principalCan(host.effectiveBotOwner(asker), "host.commands"));
      const adminApproval = serverLevelCard && !serverCommandHolder;
      /** A card no grant answers: an admin's, or a holder's server command. */
      const strictCard = adminApproval || serverCommandHolder;
      // 2026-10-19: a read of the person's own attachments (the files they
      // sent, staged in their own destination) needs no card, at any level,
      // from the owner's own turn; deny and ask rules, a safety hold and a
      // security key still come first (auto-approve.ts).
      const attachmentRead = Boolean(ownDestination && asker && !strictCard && destinationOrigin === "owner" && ownAttachmentRead({
        tool: event.mcpTool ?? event.tool,
        input: typeof event.input === "string" ? event.input : undefined,
        roots: host.ownAttachmentRoots(asker, event.threadId)
      }));
      // 2026-10-20 a command that only reads (ls, cat, grep, git
      // status...) on the person's own computer (their PC, its Local VM,
      // their cloud computer) never asks, whatever the engine, the level or
      // the bot that asked; deny and ask rules, a safety hold and a security
      // key still come first (auto-approve.ts).
      // The cloud computer is isolated, so any turn reads there unasked; the
      // person's real computer only from their own turn. A deny or ask rule
      // the person kept (Settings > Security) keeps its say.
      const readOnlyTool = /^(?:mcp__)?(sagax-environment|sagax-desktop)__run_command$/.exec((event.mcpTool ?? event.tool ?? "").trim());
      const readOnlyText = event.command?.command ?? host.runCommandOf(typeof event.input === "string" ? event.input : undefined);
      const readOnlyCommand = Boolean(ownDestination && asker && !strictCard && !guestDriven && !foreignDestination && readOnlyTool
        && (readOnlyTool[1] === "sagax-environment" || destinationOrigin === "owner")
        && host.isReadOnlyCommand(readOnlyText)
        && !matchOwnerRule(host.ownerApprovals.rulesOf(cardAnswerer, asker.id).filter((rule) => rule.behavior !== "allow"), {
          ownerId: cardAnswerer, botId: asker.id, tool: event.mcpTool ?? event.tool,
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.cwd ? { cwd: event.command.cwd } : {})
        }));
      // Security review 2026-10-19: no saved Allow key (the Sagax gate's
      // Always allow) answers or is offered for a call no rule may answer:
      // someone else's environment, or a destination outside an isolated
      // environment the person's rules cover (their real computer, their
      // cloud computer while the organization turned autonomy off).
      const gateGrantBlocked = foreignDestination || (ownDestination && !ownEnvironment && !speakerEnvironmentRules && !attachmentRead);
      // #1426: a Sagax tool that does not exist (a name the model made up,
      // such as image_gen after a native image tool was withheld) can only
      // fail: refused at once with words the model can act on, never a card
      // for the person or an admin.
      const madeUpTool = permission && asker && event.requestId && !host.foreignToolSpelling(event.mcpTool ?? event.tool, foreignServers)
        ? host.builtinAgentToolName(event.mcpTool ?? event.tool) : null;
      if (madeUpTool && asker && event.requestId && !host.knownAgentToolName(madeUpTool)) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        const message = host.unknownAgentToolRefusal(madeUpTool);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message }).catch(host.reportBackgroundError);
        appendDecision(host.DATA_DIR, {
          threadId: event.threadId, requestId: event.requestId, botId: asker.id, botName: asker.name,
          tool: event.tool, decision: "auto-denied", source: "unknown-tool"
        });
        break;
      }
      // A confidential thread's card goes to its owner only: one they could
      // not answer (an organization admin's card, another person's machine)
      // is refused rather than shown to anyone else.
      if (permission && asker && event.requestId && host.store.isConfidentialThread(event.threadId) && !confidentialCardAnswerable({
        adminApproval, host: host.approvalHostOf(asker), threadOwner: host.approvalOwnerId(asker, event.threadId)
      })) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message: CONFIDENTIAL_CARD_REFUSED }).catch(host.reportBackgroundError);
        pushMessage({ role: "bot", kind: "activity", tool: { name: CONFIDENTIAL_CARD_REFUSED, ok: false } });
        appendDecision(host.DATA_DIR, {
          threadId: event.threadId, requestId: event.requestId, botId: asker.id, botName: asker.name,
          tool: event.tool, decision: "auto-denied", source: "confidential"
        });
        break;
      }
      // 2026-10-22 a member bot runs on its OWN computer by default, and
      // only an admin targets the shared organization server. This covers the
      // engine's native host shell (event.command: a Bash/shell call on the
      // shared server), never the bot's own-computer tools (sagax-environment,
      // sagax-desktop are already owner level) nor host MCP tools such as
      // vm_exec, attach_file or shared_computer, which keep their own gating.
      // When an admin (or a host.shell delegate) does not drive this turn and
      // the bot has a computer of its own, that host-shell command no longer
      // waits for an admin in a dead end (server/exec-target.ts
      // orgServerExecRouting): the bot is told to run it on its own computer.
      // With no computer of its own, the "runs on the server" card stays: only
      // an admin runs on the shared server (its wording says the bot has none).
      if (permission && asker && event.requestId && adminApproval && event.command
        && orgServerExecRouting({
          callerMayDriveOrgServer: host.turnDrivesOrgServer(event.threadId),
          botHasOwnComputer: host.botHasOwnComputerForTurn(asker, event.threadId)
        }) === "use-bot-computer") {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message: host.EXEC_USE_BOT_COMPUTER }).catch(host.reportBackgroundError);
        pushMessage({ role: "bot", kind: "activity", tool: { name: host.EXEC_USE_BOT_COMPUTER, ok: false } });
        appendDecision(host.DATA_DIR, {
          threadId: event.threadId, requestId: event.requestId, botId: asker.id, botName: asker.name,
          tool: event.tool, decision: "auto-denied", source: "exec-target"
        });
        break;
      }
      decideRequestOpened(event, ctx, host, { adminApproval, asker, attachmentRead, cardAnswerer, destination, destinationAnswerer, destinationOrigin, effectiveApprovalMode, emailDraftCall, emailDraftRequest, foreignDestination, gateGrantBlocked, grantsOffered, guestDriven, internalTool, memberAsker, ownComputerChoice, ownDestination, ownEnvironment, ownSandboxCall, permission, perspicaxSelfKind, readOnlyCommand, readOnlyText, safetyEffect, safetyWho, selfAnswerStepUp, serverCommandHolder, speakerEnvironmentRules, strictCard, unattended });
      break;
    }
  }
}

/** The verdict half of request.opened: saved commands, custom and owner rules, then the card. */
function decideRequestOpened(event: any, ctx: any, host: any, s: any): void {
  const { pushMessage } = ctx;
  const { adminApproval, asker, attachmentRead, cardAnswerer, destination, destinationAnswerer, destinationOrigin, effectiveApprovalMode, emailDraftCall, emailDraftRequest, foreignDestination, gateGrantBlocked, grantsOffered, guestDriven, internalTool, memberAsker, ownComputerChoice, ownDestination, ownEnvironment, ownSandboxCall, permission, perspicaxSelfKind, readOnlyCommand, readOnlyText, safetyEffect, safetyWho, selfAnswerStepUp, serverCommandHolder, speakerEnvironmentRules, strictCard, unattended } = s;
      const command = permission && asker && event.requestId && !event.requiresExplicitApproval && event.command && !strictCard && !guestDriven
        ? host.commandAllowlistCandidate({ ...event.command, providerInstanceId: event.providerInstanceId ?? asker.modelSelection.instanceId })
        // #1098: a command in the person's own sandbox can be saved too
        : permission && asker && event.requestId && !event.requiresExplicitApproval && ownSandboxCall && !strictCard
          ? host.sandboxCommandCandidate(event.mcpTool ?? event.tool, event.input, event.providerInstanceId ?? asker.modelSelection.instanceId)
          : null;
      // a Sagax gate card can be remembered as an Allow rule for this exact tool
      const gateAllowKey = permission && event.sagaxGate && event.mcpTool ? mcpAllowKey(event.mcpTool) : undefined;
      // 2026-10-16: the person's custom rules, in their own words
      // (shared/custom-rules.ts). Deny refuses here, ask keeps the card
      // whatever grant would answer, allow answers only what the owner's
      // own route may (never an admin card, a guest's turn, a safety hold or
      // a sandbox widening) and only within its risk scope.
      const customCall: CustomRuleCall | null = permission && asker && event.requestId
        ? {
          tool: event.tool,
          ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          // compared only by an exact command's binding
          ...(event.command?.cwd ? { cwd: event.command.cwd } : {}),
          providerInstanceId: event.providerInstanceId ?? asker!.modelSelection.instanceId,
          ...(event.paths?.length ? { paths: event.paths } : {}),
          summary: event.summary
        }
        : null;
      const customReview = customCall && asker
        ? reviewCustomRules(host.customRules.rulesOf(cardAnswerer, asker.id, { ownSandbox: ownSandboxCall }), customCall, asker.id, serverHome(), { ...host.ruleProductsOf(asker.id), startedBy: host.turnStartFor(event.threadId) })
        : null;
      const customDecision = customReview?.decision.kind === "allow"
        && (strictCard || guestDriven || safetyEffect?.kind === "hold" || event.requiresExplicitApproval === true)
        ? { kind: "none" as const }
        : customReview?.decision;
      if (customDecision?.kind === "deny" && asker && event.requestId) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message: "Refused by the person's rule." }).catch(host.reportBackgroundError);
        const notice = customRuleNotice(customDecision);
        if (emailDraftRequest) host.patchEmailSend(event.threadId, emailDraftRequest, { status: "failed", error: `Refused by your rule "${customDecision.rule.when.slice(0, 120)}".` });
        pushMessage({
          role: "bot", kind: "activity",
          tool: { name: `Refused ${event.summary.slice(0, 120)}: your rule "${customDecision.rule.when.slice(0, 120)}".`, ok: false, ...(notice ? { ruleNotice: notice } : {}) }
        });
        appendDecision(host.DATA_DIR, {
          threadId: event.threadId, requestId: event.requestId, botId: asker.id, botName: asker.name,
          tool: event.tool, summary: event.summary, decision: "auto-denied", source: "custom-rule-deny", rule: customDecision.rule.id,
          ...(customCall ? { call: decisionCall(customCall) } : {})
        });
        return;
      }
      // A person may remember one exact read-shaped tool from one configured
      // MCP server. Bind it to the provider and current server config: a
      // provider switch or server edit invalidates the grant rather than
      // silently transferring it. Built-in tools and unconfigured/spoofed
      // server names never get a durable key. Never on a member's bot (one
      // action at a time) nor on an admin's card, nor a call bound for another person's place.
      const providerInstanceId = asker ? event.providerInstanceId ?? asker.modelSelection.instanceId : "";
      const providerTool = permission && asker && event.requestId && !event.requiresExplicitApproval && !guestDriven && !strictCard && !foreignDestination && !memberAsker
        ? providerMcpTool(event.tool)
        : null;
      const configuredMcp = providerTool && asker ? host.engineMcpServers(asker, event.threadId)[providerTool.server] : undefined;
      const toolAllowKey = configuredMcp === undefined
        ? null
        : providerToolAllowKey(providerInstanceId, event.tool, configuredMcp);
      // 2026-10-21 (parité 1C): a message send whose every recipient is on
      // the bot's allowed recipients goes with no card (shared/allowed-recipients.ts).
      const recipientsListed = Boolean(permission && asker && event.requestId && !strictCard && !guestDriven && !foreignDestination
        && host.sendRecipientsAllowed((host.botForThread(asker.id, event.threadId) ?? asker).allowedRecipients, event.mcpTool ?? event.tool, event.input));
      // 2026-10-30: a plain read of the person's own engine account
      // connector (their grok.com Outlook, Teams, calendar): no card at any
      // level; a write keeps its card (outbound)
      const connectorRead = Boolean(permission && event.accountConnector === true && event.engineConnector === true && event.outbound !== true
        && !strictCard && !guestDriven && !foreignDestination);
      const baseVerdict = permission && asker && event.requestId
        ? autoVerdict(strictCard || foreignDestination ? "ask" : effectiveApprovalMode, event.tool, {
          recipientsAllowed: recipientsListed,
          connectorRead,
          // #3431 (decision 3): a read the person's yes to this watch's domain covers
          watchRead: Boolean(!strictCard && !guestDriven && !foreignDestination && event.outbound !== true && (() => {
            const run = host.activeRoutineRunForThread?.(event.threadId);
            return watchReadCovered({
              tool: event.mcpTool ?? event.tool,
              botId: asker.id,
              watches: run?.proactive?.watches,
              choices: run?.runAs && host.proactiveChoices ? host.proactiveChoices.get(run.runAs) : null,
            });
          })()),
          reachMeSelf: Boolean(host.reachMeTeams?.answersConnectorCall(event.threadId, event.mcpTool ?? event.tool, event.input)),
          ...(event.outbound === true ? { outbound: true } : {}),
          requiresExplicitApproval: event.requiresExplicitApproval,
          sagaxGate: event.sagaxGate === true,
          ruleAllowed: Boolean(gateAllowKey && !strictCard && !guestDriven && !gateGrantBlocked && host.botForThread(asker.id, event.threadId)?.alwaysAllow?.includes(gateAllowKey)),
          providerToolAllowed: Boolean(toolAllowKey && host.botForThread(asker.id, event.threadId)?.alwaysAllow?.includes(toolAllowKey)),
          commandAllowed: Boolean(command && host.commandAllowlist.matches(asker.id, command)),
          safetyHold: safetyEffect?.kind === "hold",
          // A gate card stays a person's choice. Reads the gate already
          // trusts never reach this branch.
          safetyAllow: safetyEffect?.kind === "allow" && safetyEffect.auto === true && event.sagaxGate !== true,
          widgetApproved: !strictCard && !guestDriven && !event.requiresExplicitApproval &&
            host.cwActionPasses.take(event.threadId, event.mcpTool ?? event.tool, event.input) !== null,
          ...(customDecision?.kind === "ask" ? { customRule: { behavior: "ask" as const, id: customDecision.rule.id } } : {}),
          emailDraftApproved: emailDraftCall && !strictCard && !guestDriven && !event.requiresExplicitApproval,
          // person-asked mail in the owner's turn
          // follows Ask / Auto / Full; routine and other turns force a draft.
          personAskedMail: Boolean(asker) && !guestDriven && host.ownEnvironmentOrigin(asker!, event.threadId) === "owner",
          ownerTurn: Boolean(asker) && !guestDriven && host.ownEnvironmentOrigin(asker!, event.threadId) === "owner",
          // 2026-10-16: Sagax's own person-scoped tools answer themselves
          // (sagax-internal-tools.ts) on any engine and at any level, except
          // a Data call that is not visibly contained, a send, a rule change or a
          // class the person protects with a security key.
          sagaxInternal: !strictCard && !guestDriven && !event.requiresExplicitApproval && internalTool !== null
            && host.sagaxInternalSelfAnswers(event.mcpTool ?? event.tool, typeof event.input === "string" ? event.input : undefined, asker ? host.dataSelfAnswerRoots(asker, event.threadId) : [], host.IDENTITY.kind === "perspicax"),
          // Only at Auto or Auto-accept edits, only the owner's own turn
          // (reads excepted), never a call a security key protects.
          ownEnvironment: Boolean(asker) && ownEnvironmentAutonomy({
            call: ownEnvironment, mode: strictCard ? "ask" : effectiveApprovalMode, tool: event.mcpTool ?? event.tool,
            ...(typeof event.input === "string" ? { input: event.input } : {}),
            origin: asker ? host.ownWorkOrigin(asker, event.threadId, event.mcpTool ?? event.tool, event.input) : "other", stepUpRequired: selfAnswerStepUp
          }),
          ownAttachmentRead: attachmentRead,
          ownComputerChoice: ownComputerChoice && !strictCard,
          ownReadOnlyCommand: readOnlyCommand,
          ...(perspicaxSelfKind && !strictCard && !foreignDestination && perspicaxSelfAnswerAt(perspicaxSelfKind, effectiveApprovalMode)
            ? { perspicaxSelf: perspicaxSelfKind } : {}),
          ...(event.mcpTool ? { toolName: event.mcpTool } : {}),
          stepUpRequired: (attachmentRead || readOnlyCommand || recipientsListed || connectorRead) && !selfAnswerStepUp.length && asker
            ? host.autoAnswerStepUp(asker, event.threadId, {
              tool: event.tool,
              ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
              ...(typeof event.input === "string" ? { input: event.input } : {}),
              ...(readOnlyCommand && readOnlyText ? { command: readOnlyText } : {}),
              summary: event.summary
            })
            : selfAnswerStepUp,
          ruleChange: toolChangesRules(event.mcpTool ?? event.tool),
          ownSandbox: ownSandboxCall
        })
        : null;
      // 2026-10-14 (bot owner permissions): what the owner decided ahead of
      // time, for a card of the owner route only. Never an admin card, a
      // safety hold, a sandbox widening, a question, a guest's turn or a
      // teammate tool (peer review has its own card).
      const ownerTool = event.mcpTool ?? event.tool;
      // 2026-10-26 (one approval level): the owner's rules are read
      // even when the level already answered (Full access, Approve for me):
      // a deny rule refuses and an ask rule keeps the card whatever the
      // level. Only the person's own answer on a draft's or a widget's card
      // is never asked again.
      const personAnswered = baseVerdict?.source === "email-draft-approval" || baseVerdict?.source === "widget-approval";
      // #2091 (decided 2026-11-05): a guest's or botmail turn keeps its owner
      // layer: its card offers Always allow like every other one (situation
      // "origin", so only a rule saved from such a card answers it)
      const ownerLayer = Boolean(permission && asker && event.requestId && !personAnswered && !strictCard
        && !/^(?:mcp__[^_]+__)?(?:askuserquestion|ask_user)$/i.test(ownerTool) && host.memberOwnScopeTool(ownerTool) !== "conversation");
      // 2026-10-21 (review of #938): what a rule reads of this call, the
      // engine's shell line included when it reports one beside no input
      // (Codex, the ACP engines): never an empty scope
      const ruleInput = ruleInputFor(typeof event.input === "string" ? event.input : undefined, event.command?.command);
      // 2026-10-21 (parité R10, ligne 80): a screen action of this Mac, from
      // the person's own turn, names the app it acts on as the server reads
      // it (never the model's words); "Toujours permettre" then keeps that
      // app (owner-approval.ts appRuleCandidate). Never on an organization
      // server, a guest's turn, someone else's environment or an admin's
      // card, and never for a shell, the settings or a password manager.
      const screenApp = permission && asker && event.requestId && !host.cfg.organization && !guestDriven && !foreignDestination && !strictCard
        && host.hostScreenTurn(asker.id, event.threadId) && /^(?:mcp__)?computer__/i.test(ownerTool)
        && host.ownEnvironmentOrigin(asker, event.threadId) === "owner"
        ? event.screenApp
        : undefined;
      const offeredApp = screenApp && host.appRuleOffered(screenApp) ? screenApp : undefined;
      const ownerCall = ownerLayer && asker
        ? { ownerId: cardAnswerer, botId: asker.id, tool: ownerTool, ...(ruleInput !== undefined ? { input: ruleInput } : {}), ...(event.command?.cwd ? { cwd: event.command.cwd } : {}), ...(offeredApp ? { app: offeredApp } : {}), ...(ownSandboxCall ? { ownSandbox: true } : {}) }
        : null;
      // 2026-10-17 (re-review of #690): the owner's permission mode (auto,
      // bypass) and Always allow rules never answer what Sagax itself would
      // not: a call in a class the person protects with a security key keeps
      // its card (its Allow then needs the key), and an own-environment call
      // from a turn that is not the owner's own (another bot, a routine, a
      // webhook, a trigger, an email) runs unasked only as a plain read,
      // never of a dotfile or credential path.
      const ownerStepUp = ownerCall && asker
        ? (ownEnvironment || internalTool ? selfAnswerStepUp : host.autoAnswerStepUp(asker, event.threadId, {
          tool: event.tool,
          ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          summary: event.summary
        }))
        : [];
      // Security review 2026-10-19: an own-destination call that is not an
      // own-environment call Sagax may run unasked (the person's own
      // computer, or their server environment while the organization turned
      // autonomy off) is never answered by the owner's mode or rules either:
      // the card shows (a read of their own attachments excepted).
      // 2026-10-19 ("Toujours permettre" on every card): someone else's
      // environment stays apart (crossPerson: no rule of anyone answers it
      // and none is offered); the rest is answered only by an allow rule the
      // person saved from such a card (owner-approval.ts `from`).
      const ownerOriginRefused = Boolean(ownerCall && asker && (
        (ownEnvironment && !ownEnvironmentAutonomy({
          call: true, mode: "auto", tool: event.mcpTool ?? event.tool,
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          origin: host.ownWorkOrigin(asker, event.threadId, event.mcpTool ?? event.tool, event.input), stepUpRequired: []
        }))
        || (ownDestination && !ownEnvironment && !attachmentRead && !speakerEnvironmentRules)
      ));
      const owner = ownerCall && asker
        ? ownerDecision({
          // 2026-10-19 (owner setup): Approve for me or Full access on the
          // owner's own work reads as the owner mode "auto" (destructive
          // calls, ask rules, holds and security keys keep their card).
          mode: destinationAnswerer ? "approval" : ownerModeForTurn({
            approvalMode: effectiveApprovalMode,
            lineage: ownerCall.ownerId.trim().toLowerCase() === host.effectiveBotOwner(asker).trim().toLowerCase() ? host.ownerModeLineageFor(asker, event.threadId) : "other",
            autoAllowed: !(host.memberOwnedInOrg(asker) && !memberAutoApprovalAllowed(host.cfg.organization)),
            bypassAllowed: host.ownerBypassAllowed(asker, ownerCall.ownerId)
          }),
          rules: host.ownerApprovals.rulesOf(ownerCall.ownerId, asker.id),
          call: ownerCall,
          personMustAnswer: safetyEffect?.kind === "hold" || event.requiresExplicitApproval === true,
          stepUpRequired: ownerStepUp.length > 0,
          autonomyRefused: ownerOriginRefused || guestDriven,
          // #1065: the owner's real computer from their own turn on their
          // own bot, which Bypass answers (never another origin or person)
          ownComputerOwnTurn: Boolean(ownDestination && !ownEnvironment && destination?.byOwner && destinationOrigin === "owner"),
          crossPerson: foreignDestination,
          // 2026-10-26: a delete or a bulk change in the person's own
          // sandbox or Local VM is theirs at auto and bypass
          ownEnvironment: Boolean(ownEnvironment && !foreignDestination)
        })
        : null;
      // 2026-10-19 an admin's card of a member's bot (or a holder's
      // server command) is answered by an allow rule a person who answers
      // such cards saved on one of them, for this bot, while that person
      // still holds the right and no security key of theirs protects the
      // call. Never a guest's turn or someone else's environment.
      const strictCall = strictCard && permission && asker && event.requestId && !guestDriven && !foreignDestination
        && !/^(?:mcp__[^_]+__)?(?:askuserquestion|ask_user)$/i.test(ownerTool)
        ? { botId: asker.id, tool: ownerTool, ...(ruleInput !== undefined ? { input: ruleInput } : {}), ...(event.command?.cwd ? { cwd: event.command.cwd } : {}) }
        : null;
      // 2026-10-20 (security review): never on a turn that is not the
      // person's own (a routine, a webhook, another bot)
      const strictRule = strictCall && asker && !baseVerdict?.approve && safetyEffect?.kind !== "hold" && event.requiresExplicitApproval !== true && host.ownEnvironmentOrigin(asker, event.threadId) === "owner"
        ? host.strictCardRule(asker, event.threadId, strictCall, adminApproval ? "admin" : "holder", {
          tool: event.tool,
          ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          summary: event.summary
        })
        : undefined;
      if (owner?.kind === "deny" && asker && event.requestId) {
        const instance = event.providerInstanceId ? host.registry.get(event.providerInstanceId) : host.registry.get(asker.modelSelection.instanceId);
        void instance?.adapter.respondToRequest(event.threadId, event.requestId, { behavior: "deny", message: "Refused by the owner's rule." }).catch(host.reportBackgroundError);
        pushMessage({ role: "bot", kind: "activity", tool: { name: `Refused ${event.summary.slice(0, 120)}: your rule "${owner.rule.description.slice(0, 120)}".`, ok: false } });
        appendDecision(host.DATA_DIR, {
          threadId: event.threadId, requestId: event.requestId, botId: asker.id, botName: asker.name,
          tool: event.tool, summary: event.summary, decision: "auto-denied", source: "owner-rule-deny", rule: owner.rule.id,
          ...(customCall ? { call: decisionCall(customCall) } : {})
        });
        return;
      }
      // An organization rule (Refuser, Demander d'abord) or the person's own
      // deny/ask rule always wins over the owner's mode (owner-approval.ts
      // ownerVerdictOver, #1065).
      const ownerVerdict = ownerVerdictOver(baseVerdict, owner, event.tool);
      // The person's allow rule, when nothing answered and the owner's own
      // rules did not hold the card (an owner ask rule or an admin card win).
      const customAllow = permission && asker && event.requestId && !ownerVerdict?.approve && customDecision?.kind === "allow"
        && (!owner || (owner.kind === "card" && (owner.reason === "no-rule" || owner.reason === "destructive")))
        ? autoVerdict(effectiveApprovalMode, event.tool, {
          customRule: { behavior: "allow", id: customDecision.rule.id },
          requiresExplicitApproval: event.requiresExplicitApproval,
          sagaxGate: event.sagaxGate === true
        })
        : null;
      const verdict = strictRule
        ? { approve: `approved ${event.tool} (rule of ${host.strictRuleOwnerName(strictRule.ownerId)})`, source: "admin-rule" as const, rule: strictRule.id }
        : customAllow?.approve && customDecision?.kind === "allow"
          ? { ...customAllow, rule: customDecision.rule.id }
          : ownerVerdict;
      const customNotice = customDecision ? customRuleNotice(customDecision) : undefined;
      // What "Always allow" or "Always deny" would remember on this card.
      // Never on a card a rule could not answer (a security key class, a
      // turn that is not the owner's own).
      // 2026-10-19 ("On doit avoir des cartes, mais avoir la possibilité
      // de faire TOUJOURS le Toujours permettre"): every permission card
      // offers one to the person who answers it, with the exact scope the
      // card shows (this bot, this tool, this target or exact command), never
      // for someone else's environment or a guest's turn. A security key the
      // person chose still asks at each use (ownerDecision step-up).
      // Review of #938: a held card stays held, an admin's card included
      // (it keeps the whole request, never the program)
      const heldCard = safetyEffect?.kind === "hold" || event.requiresExplicitApproval === true;
      const ruleFrom: OwnerRule["from"] = strictCall ? "admin"
        : heldCard ? "hold"
          : ownerOriginRefused || guestDriven || foreignDestination ? "origin" : undefined;
      // owner-approval.ts cardRuleCandidate: a card that never had a rule
      // keeps the whole request; an engine's own shell line on an admin's
      // card that is not held keeps its program for this bot (2026-10-21).
      // #2091: a call with no readable arguments keeps the whole tool, and a
      // cross-person or guest card offers its rule like every other one.
      const ownerRuleCandidate = (owner?.kind === "card" && owner.reason !== "admin") || (strictCall && !baseVerdict?.approve)
        ? cardRuleCandidate({
          tool: ownerTool,
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          ...(event.command?.cwd ? { cwd: event.command.cwd } : {}),
          ...(offeredApp && !strictCall ? { app: offeredApp } : {})
        }, { ...(ruleFrom ? { from: ruleFrom } : {}), held: heldCard }, host.serverApprovalWords(host.languageOfPerson(cardAnswerer)))
        : undefined;
      // 2026-10-26 (#1065): the second "Toujours permettre", the whole
      // folder of the file this card reads, beside the exact path.
      // An admin card offers it only for a read inside one agent root
      // (this bot's workspace, or this conversation's task folder).
      const ownerRuleFolderCandidate = ownerRuleCandidate && (!strictCall || (ruleFrom === "admin" && !heldCard))
        ? folderRuleCandidate({
          tool: ownerTool,
          ...(typeof event.input === "string" ? { input: event.input } : {}),
          ...(event.command?.command ? { command: event.command.command } : {}),
          ...(asker ? { roots: [workspaceDir(asker.id), join(TASK_WORKSPACES_DIR, asker.id, event.threadId)] } : {})
        }, { ...(ruleFrom ? { from: ruleFrom } : {}), held: heldCard }, host.serverApprovalWords(host.languageOfPerson(cardAnswerer)))
        : undefined;
      // Auto's reviewer is the engine's own. Claude accepts `--permission-mode
      // auto` for any model and starts in Manual without a word when auto is
      // unavailable (Haiku 4.5, Sonnet 4.5, an org that disabled it), so the
      // bot asks about everything. Say once per session why, and what stops it.
      if (
        permission &&
        asker &&
        event.nativeReview === "inactive" &&
        effectiveApprovalMode === "auto" &&
        !host.nativeReviewNoticed.has(event.threadId)
      ) {
        host.nativeReviewNoticed.add(event.threadId);
        const model = host.sessionModelByThread.get(event.threadId);
        pushMessage({
          role: "bot",
          kind: "activity",
          tool: {
            name: `Approve for me: ${providerLabel(event.provider)}'s automatic reviewer is not available${model ? ` for ${model}` : ""}, so this bot asks before each action. Choose a model it supports, or Full access, to stop the prompts.`,
            ok: true
          }
        });
      }
      presentRequestOpened(event, ctx, host, { adminApproval, asker, cardAnswerer, command, customCall, customDecision, customNotice, customReview, destinationAnswerer, effectiveApprovalMode, emailDraftRequest, foreignDestination, gateAllowKey, gateGrantBlocked, grantsOffered, guestDriven, ownSandboxCall, owner, ownerCall, ownerOriginRefused, ownerRuleCandidate, ownerRuleFolderCandidate, ownerStepUp, permission, safetyEffect, safetyWho, serverCommandHolder, strictCard, toolAllowKey, unattended, verdict });
}
