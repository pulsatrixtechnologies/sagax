// What the interactive cards may do, as the Electron renderer decides it
// (feature parity matrix, package WP2): the approval dock
// (`PendingApproval.tsx`), the option card's dismiss (`OptionCard.tsx`), the
// credential card's resume and dismiss (`SecretRequestCard.tsx`), the access
// card (`AccessCard.tsx`), the parallel task card (`ParallelTaskCard.tsx`), the goal run card
// (`GoalRunCard.tsx`) and the error row's Retry (`ChatView.tsx` `ErrorRow`).
//
// Pure rules only, so they are unit tested without a simulator. The views in
// ios/App/Cards read them and never decide on their own.
import Foundation

// MARK: - Wire pieces of an approval card

/// `OptionCardData.toolHints`: MCP annotations, and the product the
/// server declared for the tool.
public struct ToolHints: Codable, Hashable, Sendable {
    public var readOnly: Bool?
    public var destructive: Bool?
    public var product: String?
    public var productId: String?

    public init(readOnly: Bool? = nil, destructive: Bool? = nil) {
        self.readOnly = readOnly
        self.destructive = destructive
    }
}

/// `CommandAllowlistCandidate` in `shared/command-allowlist.ts`.
public struct CommandAllowlistCandidate: Codable, Hashable, Sendable {
    public var command: String
    public var cwd: String
    public var providerInstanceId: String

    public init(command: String, cwd: String, providerInstanceId: String) {
        self.command = command
        self.cwd = cwd
        self.providerInstanceId = providerInstanceId
    }
}

/// Any durable proposal payload (routine, profile, model, tightening, team
/// setup). The phone needs to know one is there and, for routines and team
/// setups, a word or two of it; everything else decodes and is dropped.
public struct ProposalRequestMarker: Codable, Hashable, Sendable {
    public struct Operation: Codable, Hashable, Sendable {
        public var action: String?
        /// Set when a new routine was proposed to start paused (#898).
        /// Absent on older cards: those start live.
        public var paused: Bool? = nil
    }

    public var operation: Operation?
    /// Team setup: a deletion rather than a setup.
    public var deletion: Bool?

    public init(operation: Operation? = nil, deletion: Bool? = nil) {
        self.operation = operation
        self.deletion = deletion
    }
}

// MARK: - Risk (lib/approval-describe.ts)

/// How much a permission ask can change: the dock's "Allow all read-only"
/// covers `read` and nothing else.
public enum ApprovalRisk: String, Sendable {
    case read, write, destructive, execute
}

public enum ApprovalRiskClassifier {
    private enum Operation { case read, create, update, delete, run }

    private static let builtin: [String: ApprovalRisk] = [
        "Read": .read, "Glob": .read, "Grep": .read, "WebFetch": .read, "WebSearch": .read,
        "read": .read, "fetch": .read, "search": .read, "think": .read,
        "Write": .write, "Edit": .write, "MultiEdit": .write, "NotebookEdit": .write, "edit": .write,
        "Bash": .execute, "shell": .execute, "execute": .execute,
        "delete": .destructive,
    ]

    private static let verbs: [(Set<String>, Operation)] = [
        (["query", "read", "list", "get", "search", "find", "describe", "fetch", "show", "view", "lookup", "count",
          "browse", "inspect", "status"], .read),
        (["create", "add", "new", "post", "insert", "submit", "open", "book"], .create),
        (["write", "update", "patch", "put", "set", "edit", "modify", "upsert", "assign", "move", "rename", "change",
          "close", "merge"], .update),
        (["delete", "remove", "destroy", "purge", "erase", "drop", "wipe", "uninstall"], .delete),
        (["action", "run", "execute", "exec", "invoke", "trigger", "start", "stop", "restart", "reboot", "send", "call",
          "isolate", "kill"], .run),
    ]

    private static func operation(of word: String?) -> Operation? {
        guard let word else { return nil }
        let lower = word.lowercased()
        return verbs.first { $0.0.contains(lower) }?.1
    }

    private static func risk(of op: Operation) -> ApprovalRisk {
        switch op {
        case .read: .read
        case .create, .update: .write
        case .delete: .destructive
        case .run: .execute
        }
    }

    /// `mcp__<server>__<tool>`, split on the first two `__` only.
    public static func parseToolId(_ tool: String) -> (server: String?, name: String) {
        guard tool.hasPrefix("mcp__") else { return (nil, tool) }
        let rest = tool.dropFirst(5)
        guard let split = rest.range(of: "__"), split.lowerBound > rest.startIndex else { return (nil, tool) }
        let name = rest[split.upperBound...]
        guard !name.isEmpty else { return (nil, tool) }
        return (String(rest[..<split.lowerBound]), String(name))
    }

    /// The tokens a product prefix takes (cw_psa_* is two), as `productFor`.
    private static func prefixTokens(_ name: String) -> Int {
        let lower = name.lowercased()
        let prefixes: [(String, Int)] = [
            ("cw_psa", 2), ("cw_rmm", 2), ("cw_automate", 2), ("sc", 1),
            ("screenconnect", 1), ("m365", 1), ("outlook", 1), ("graph", 1), ("bookstack", 1), ("passportal", 1),
            ("axcient", 1), ("itglue", 1),
        ]
        for (prefix, tokens) in prefixes where lower == prefix || lower.hasPrefix(prefix + "_") {
            return tokens
        }
        return 0
    }

    private static func operationFromArgs(_ args: [String: Any]?) -> Operation? {
        guard let args else { return nil }
        for key in ["operation", "method", "op", "verb", "mode", "action"] {
            guard let value = args[key] as? String else { continue }
            switch value.uppercased() {
            case "GET": return .read
            case "POST": return .create
            case "PUT", "PATCH": return .update
            case "DELETE": return .delete
            default: break
            }
            let first = value.split(whereSeparator: { $0 == " " || $0 == "_" || $0 == "-" }).first.map(String.init)
            if let op = operation(of: first) { return op }
        }
        return nil
    }

    private static func parseArgs(_ text: String?) -> [String: Any]? {
        guard let text, text.drop(while: \.isWhitespace).first == "{",
              let data = text.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return value
    }

    /// Annotations win when present; otherwise the operation's own verb.
    private static func risk(_ op: Operation?, hints: ToolHints?, builtin: ApprovalRisk?) -> ApprovalRisk? {
        if hints?.destructive == true { return .destructive }
        if hints?.readOnly == true { return .read }
        let guessed = builtin ?? op.map(risk(of:))
        if hints?.readOnly == false, guessed == nil || guessed == .read { return .write }
        return guessed
    }

    /// `describeApproval(...).risk`: the risk of one permission ask.
    public static func risk(tool: String?, input: String?, hints: ToolHints? = nil) -> ApprovalRisk? {
        guard let tool else { return nil }
        let builtin = builtin[tool]
        let parsed = parseToolId(tool)
        guard parsed.server != nil else { return risk(nil, hints: hints, builtin: builtin) }
        let tokens = Array(parsed.name.split(separator: "_").map(String.init).dropFirst(prefixTokens(parsed.name)))
        var op = operation(of: tokens.last)
        var rest = Array(tokens.dropLast())
        if op == nil {
            op = operation(of: tokens.first)
            rest = Array(tokens.dropFirst())
        }
        if let argsOp = operationFromArgs(parseArgs(input)),
           op == nil || op == .update || op == .run,
           tokens.count <= 1 || rest.isEmpty {
            op = argsOp
        }
        return risk(op, hints: hints, builtin: builtin)
    }

    public static func risk(of card: OptionCard) -> ApprovalRisk? {
        risk(tool: card.tool, input: card.toolInput ?? card.subtitle, hints: card.toolHints)
    }
}

// MARK: - The approval dock (PendingApproval.tsx)

/// One open permission ask on a thread: the dock shows them one at a time.
public struct PendingApproval: Hashable, Sendable, Identifiable {
    public var message: Message
    public var card: OptionCard
    public var requestId: String
    public var tool: String
    /// Asked by a parallel task of this conversation: its own thread, where
    /// the answer goes, and its name for the dock.
    public var threadId: String? = nil
    public var parallelTitle: String? = nil

    public var id: String { requestId }

    public init(message: Message, card: OptionCard, requestId: String, tool: String, threadId: String? = nil, parallelTitle: String? = nil) {
        self.message = message
        self.card = card
        self.requestId = requestId
        self.tool = tool
        self.threadId = threadId
        self.parallelTitle = parallelTitle
    }

    /// The thread the answer goes to.
    public func answerThread(conversation: String) -> String { threadId ?? conversation }
}

/// What the dock's primary button says.
public enum ApprovalPrimary: Hashable, Sendable {
    case allowOnce, confirm, enable, update
    /// A team setup's own first option.
    case option(String)
}

/// The decisions the dock offers for one request, in the desktop's order:
/// Cancel turn (quiet, left), then Deny or Cancel, the one remembering
/// choice that applies, and the primary.
public struct ApprovalDockActions: Hashable, Sendable {
    /// An organization admin must answer: the owner can only stop the turn.
    public var waitingForAdmin = false
    public var cancelTurn = false
    /// "Cancel" for a proposal, "Deny" for a tool.
    public var denyIsCancel = false
    /// Remember the server's `allowKey` for the bot ("Always allow").
    public var alwaysAllowTool = false
    /// Keep the card's owner rule (`OptionCard.ownerRule`).
    public var alwaysAllowRule = false
    /// 2026-10-26 (#1065): also keep the whole folder (`ownerRuleFolder`);
    /// the Always allow of the exact file then reads "this file".
    public var alwaysAllowFolder = false
    /// The folder rule covers changing files, not only reading: the labels say so.
    public var alwaysAllowFolderWrites = false
    /// The provider keeps the allow for its session.
    public var alwaysAllowSession = false
    /// Remember the exact command ("Always allow this command").
    public var alwaysAllowCommand = false
    public var primary: ApprovalPrimary = .allowOnce
    /// A learned skill without a reviewed hash is deny-only.
    public var primaryDisabled = false
}

/// The body of one `POST /api/threads/:t/respond` the dock sends.
public struct ApprovalDecision: Hashable, Sendable {
    public var requestId: String
    public var behavior: String
    public var message: String?
    public var reviewedSha256: String?
    /// "Always allow this session".
    public var always: Bool
    /// "Always allow this command".
    public var rememberCommand: Bool
    /// "Always allow": saved on the bot BEFORE the answer is sent.
    public var alwaysAllowKey: String?
    /// A verified security key step-up for this answer (Client+StepUp.swift).
    public var stepUp: String?
    /// "Always allow" on a card with an owner rule: keep that rule ("allow").
    public var rule: String? = nil
    /// "folder" with `rule`: keep the card's folder rule, not the exact path.
    public var ruleScope: String? = nil

    public init(
        requestId: String, behavior: String, message: String? = nil, reviewedSha256: String? = nil,
        always: Bool = false, rememberCommand: Bool = false, alwaysAllowKey: String? = nil
    ) {
        self.requestId = requestId
        self.behavior = behavior
        self.message = message
        self.reviewedSha256 = reviewedSha256
        self.always = always
        self.rememberCommand = rememberCommand
        self.alwaysAllowKey = alwaysAllowKey
    }
}

public enum ApprovalDockRules {
    /// A proposal is confirmed or cancelled; never remembered or batched.
    public static func isProposal(_ card: OptionCard) -> Bool {
        card.skillRequest != nil || card.routineRequest != nil || card.profileRequest != nil
            || card.ruleRequest != nil || card.teamSetupRequest != nil
    }

    /// Open approvals on a thread, oldest first. Questions are not here
    /// (they carry no tool); answered, dismissed and expired cards drop out.
    public static func pendingApprovals(_ messages: [Message]) -> [PendingApproval] {
        messages.compactMap { message in
            guard message.kind == .options, message.ownerWait == nil, let card = message.card,
                  let requestId = card.requestId, let tool = card.tool,
                  card.answered == nil, card.dismissed != true, card.expired != true
            else { return nil }
            return PendingApproval(message: message, card: card, requestId: requestId, tool: tool)
        }
    }

    /// The asks "Allow all read-only" covers: plain tool asks that only
    /// read, never a proposal, a question or an admin's command.
    public static func readOnly(_ approvals: [PendingApproval]) -> [PendingApproval] {
        approvals.filter { pending in
            let card = pending.card
            guard card.adminApproval != true, !isProposal(card), card.modelRequest == nil,
                  card.ruleRequest == nil, card.tighteningRequest == nil, card.questionRequest == nil
            else { return false }
            return ApprovalRiskClassifier.risk(of: card) == .read
        }
    }

    /// Which request is on screen: the one picked by id, else the oldest.
    /// Following the id keeps the same request in view when another one is
    /// answered and leaves the list.
    public static func stepperIndex(_ approvals: [PendingApproval], requestId: String?) -> Int {
        guard let requestId, let index = approvals.firstIndex(where: { $0.requestId == requestId }) else { return 0 }
        return index
    }

    /// `PendingApprovalActions`: what the dock offers for this request.
    /// `ownerOrAdmin`: this person owns the bot or administers the server.
    /// `hasBot`: the asker is a bot the phone knows (a grant needs one).
    public static func actions(for pending: PendingApproval, ownerOrAdmin: Bool, hasBot: Bool) -> ApprovalDockActions {
        let card = pending.card
        var actions = ApprovalDockActions()
        if card.adminApproval == true, !ownerOrAdmin {
            actions.waitingForAdmin = true
            actions.cancelTurn = true
            return actions
        }
        let routine = card.routineRequest != nil
        let skill = card.skillRequest != nil
        let profile = card.profileRequest != nil
        let rule = card.ruleRequest != nil
        let teamSetup = card.teamSetupRequest != nil
        let durable = routine || skill || profile || rule || teamSetup
        let canRememberCommand = ownerOrAdmin && !durable && card.allowKey == nil && card.commandAllowlist != nil && card.ownerRule == nil
        // 2026-10-20 (owner): the card offers Deny, Always allow, Allow once;
        // the composer's stop button ends a turn
        actions.cancelTurn = false
        actions.denyIsCancel = routine || profile || rule || teamSetup
        // 2026-10-20 (owner): one "Always allow", one click; the card's owner
        // rule first (every card since #855), then the older grants
        actions.alwaysAllowRule = card.ownerRule != nil
        actions.alwaysAllowFolder = card.ownerRule != nil && card.ownerRuleFolder != nil && !durable
        actions.alwaysAllowFolderWrites = actions.alwaysAllowFolder && card.ownerRuleFolder?.writes == true
        actions.alwaysAllowTool = !actions.alwaysAllowRule && !durable && hasBot && card.allowKey != nil
        actions.alwaysAllowSession = !actions.alwaysAllowRule && !durable && card.allowKey == nil && !canRememberCommand && card.allowSession == true
        actions.alwaysAllowCommand = !actions.alwaysAllowRule && canRememberCommand
        if teamSetup {
            actions.primary = .option(card.options.first ?? "")
        } else if skill {
            actions.primary = card.skillRequest?.action == "update" ? .update : .enable
        } else if routine || profile || rule {
            actions.primary = .confirm
        }
        actions.primaryDisabled = skill && card.skillRequest?.reviewedSha256 == nil
        return actions
    }

    public enum Choice: Sendable { case allowOnce, deny, alwaysAllowTool, alwaysAllowSession, alwaysAllowCommand, alwaysAllowRule, alwaysAllowFolder }

    /// The respond body for one dock button (`decideRequest` in the store).
    public static func decision(_ choice: Choice, for pending: PendingApproval) -> ApprovalDecision {
        let card = pending.card
        let allow = choice != .deny
        var decision = ApprovalDecision(
            requestId: pending.requestId,
            behavior: allow ? "allow" : "deny",
            message: allow ? nil : "Denied by the user.",
            reviewedSha256: allow ? card.skillRequest?.reviewedSha256 : nil,
            always: choice == .alwaysAllowSession && card.allowKey == nil && card.allowSession == true,
            rememberCommand: choice == .alwaysAllowCommand,
            alwaysAllowKey: choice == .alwaysAllowTool ? card.allowKey : nil
        )
        if choice == .alwaysAllowRule, card.ownerRule != nil { decision.rule = "allow" }
        if choice == .alwaysAllowFolder, card.ownerRule != nil, card.ownerRuleFolder != nil {
            decision.rule = "allow"
            decision.ruleScope = "folder"
        }
        return decision
    }

    /// The parallel tasks of `threadId` that wait on the person: their
    /// approvals join this conversation's dock (`waitingParallelTasks`).
    public static func waitingParallelTasks(_ tasks: [BotTask], of threadId: String) -> [BotTask] {
        tasks.filter {
            $0.parallelOf?.threadId == threadId && $0.parallelOf?.reportedAt == nil && $0.activity == "waiting-on-you"
        }
    }

    /// A parallel task's open approvals, tagged with that task.
    public static func parallelPendings(_ messages: [Message], task: BotTask) -> [PendingApproval] {
        pendingApprovals(messages).map {
            var pending = $0
            pending.threadId = task.threadId
            pending.parallelTitle = task.title
            return pending
        }
    }
}

/// What a settled approval card says happened (`approvalCardOutcome`).
public enum ApprovalOutcome: Hashable, Sendable {
    case expired, allowed, alwaysAllowed, denied, cancelled
    case routineScheduled, routineCreatedPaused, routineUpdated, routinePaused, routineResumed, routineRunQueued, routineDeleted
    case skillEnabled, skillUpdated, profileUpdated, ruleUpdated
    case teamSetupApplied, botDeleted

    public static func of(_ card: OptionCard) -> ApprovalOutcome? {
        if card.expired == true { return .expired }
        guard let answered = card.answered else { return nil }
        let proposal = ApprovalDockRules.isProposal(card)
        guard answered == "allow" else { return proposal ? .cancelled : .denied }
        // answered with Always allow: the saved rule reads like the web pill
        if !proposal, card.alwaysAllowed?.isEmpty == false { return .alwaysAllowed }
        if let setup = card.teamSetupRequest { return setup.deletion == true ? .botDeleted : .teamSetupApplied }
        switch card.routineRequest?.operation?.action {
        case "create":
            return card.routineRequest?.operation?.paused == true ? .routineCreatedPaused : .routineScheduled
        case "update": return .routineUpdated
        case "pause": return .routinePaused
        case "resume": return .routineResumed
        case "run_now": return .routineRunQueued
        case "delete": return .routineDeleted
        default: break
        }
        if let skill = card.skillRequest { return skill.action == "update" ? .skillUpdated : .skillEnabled }
        if card.profileRequest != nil { return .profileUpdated }
        if card.ruleRequest != nil { return .ruleUpdated }
        return .allowed
    }
}

// MARK: - Option card (OptionCard.tsx)

public enum OptionCardRules {
    /// A first-run quiz, not a live ask (those carry a request id).
    public static func isOnboardingCard(_ message: Message) -> Bool {
        // a proactive proposal stays until answered, like a live ask
        message.kind == .options && message.card != nil && message.card?.requestId == nil && message.card?.proactiveProposal == nil
    }

    /// Hidden once picked, dismissed, or talked past (a later user text).
    public static func hidesOnboardingCard(_ message: Message, in transcript: [Message]) -> Bool {
        guard isOnboardingCard(message), let card = message.card else { return false }
        if card.dismissed == true || card.answered != nil { return true }
        guard let index = transcript.firstIndex(where: { $0.id == message.id }) else { return false }
        return transcript[(index + 1)...].contains { $0.role == .user && $0.kind == .text }
    }

    /// Closing a card: a quiz is patched dismissed; a live ask is answered
    /// (a tool is denied, a question declined) through respond.
    public enum Dismissal: Hashable, Sendable {
        case patch
        case respond(behavior: String, message: String)
    }

    public static func dismissal(for card: OptionCard) -> Dismissal {
        guard card.requestId != nil else { return .patch }
        if card.tool != nil { return .respond(behavior: "deny", message: "Dismissed by user.") }
        return .respond(
            behavior: "answer",
            message: "The user closed this question without answering. Use your best judgment and continue."
        )
    }
}

/// "Ignore the question" on a live ask (parity Q2).
///
/// The silent X is not this. The server refuses the canned dismiss sentence
/// until the question is already answered, so a tap here is an explicit
/// answer: the person chose not to pick an option, and the bot continues.
/// The sentence is English because the model reads it, and it is not the
/// canned dismiss sentence the server rejects.
public enum QuestionIgnore {
    public static let answer = "The user skipped this question without choosing an option. Continue with your best judgment."

    public enum Face: Equatable, Sendable {
        case ignore
        /// Seconds left before the server declines the card on its own.
        case closesAutomatically(remaining: Int)
    }

    public static func canIgnore(_ card: OptionCard) -> Bool {
        guard card.isPending, !card.isPermission else { return false }
        if card.routineRequest != nil || card.skillRequest != nil || card.profileRequest != nil
            || card.modelRequest != nil || card.ruleRequest != nil || card.teamSetupRequest != nil || card.tighteningRequest != nil
            || card.adminApproval == true { return false }
        return true
    }

    /// `expiresAt` is milliseconds. No deadline, or one already past, is a
    /// plain Ignore. A countdown only while the card will close by itself.
    public static func face(expiresAt: Double?, now: Date = Date()) -> Face {
        guard let expiresAt, expiresAt.isFinite else { return .ignore }
        let remaining = expiresAt / 1_000 - now.timeIntervalSince1970
        guard remaining > 0, remaining < 24 * 60 * 60 else { return .ignore }
        return .closesAutomatically(remaining: Int(remaining.rounded(.down)))
    }

    /// `m:ss`, or `h:mm:ss` once an hour is left.
    public static func clock(_ seconds: Int) -> String {
        let left = max(0, seconds)
        if left >= 3_600 {
            return String(format: "%d:%02d:%02d", left / 3_600, (left % 3_600) / 60, left % 60)
        }
        return String(format: "%d:%02d", left / 60, left % 60)
    }

    public static func isSkip(_ text: String?) -> Bool {
        text?.trimmingCharacters(in: .whitespacesAndNewlines) == answer
    }
}

// MARK: - Credential card (SecretRequestCard.tsx)

public enum SecretCardRules {
    public enum Outcome: Sendable { case provided, dismissed }

    /// `credentialResumeOutcome` in shared/credential-request.ts.
    public static func outcome(_ secret: SecretRequestCardData) -> Outcome? {
        if secret.provided == true { return .provided }
        if secret.dismissed == true { return .dismissed }
        return nil
    }

    /// A decline that resumed (or never failed) leaves nothing to show.
    public static func isHidden(_ secret: SecretRequestCardData) -> Bool {
        outcome(secret) == .dismissed && (secret.resumed == true || (secret.error ?? "").isEmpty)
    }

    /// "Not now" on a card still waiting.
    public static func canDismiss(_ secret: SecretRequestCardData) -> Bool {
        outcome(secret) == nil && secret.superseded != true
    }

    /// "Try again": the key is saved (or declined) but resuming failed.
    public static func canRetryResume(_ secret: SecretRequestCardData) -> Bool {
        outcome(secret) != nil && secret.superseded != true && secret.resumed != true && !(secret.error ?? "").isEmpty
    }
}

// MARK: - Parallel task card (ParallelTaskCard.tsx)

/// The card's state: the recorded end state wins, then the task's own live
/// state (`liveParallelState` in shared/parallel-tasks.ts).
public enum ParallelCardState: String, Hashable, Sendable {
    case queued, running, waiting, done, failed, stopped

    public static func of(_ ref: ParallelTaskRef, task: BotTask?) -> ParallelCardState {
        switch ref.recordedState {
        case .done: return .done
        case .failed: return .failed
        case .stopped: return .stopped
        default: break
        }
        if task?.activity == "waiting-on-you" { return .waiting }
        if task?.busy == true { return .running }
        if ref.recordedState == .queued { return .queued }
        switch ref.recordedState {
        case .running: return .running
        default: return .queued
        }
    }

    /// Stop shows while the task can still be stopped.
    public var isLive: Bool { self == .running || self == .waiting || self == .queued }
}

// MARK: - Error row (ChatView.tsx ErrorRow)

public enum ErrorRowRules {
    /// A failed turn is an activity row whose chip name starts `error:`.
    public static func isError(_ message: Message) -> Bool {
        message.kind == .activity && (message.tool?.name.hasPrefix("error:") ?? false)
    }

    /// The error text without its `error:` tag.
    public static func text(_ message: Message) -> String {
        guard let name = message.tool?.name, name.hasPrefix("error:") else { return message.tool?.name ?? "" }
        return name.dropFirst(6).trimmingCharacters(in: .whitespaces)
    }

    /// Retry belongs to the conversation's last row (bookkeeping after the
    /// failure does not count), on a bot that is not working and has a user
    /// line to send again. A setup error or a Claude update shows its own
    /// fix instead.
    public static func retryableErrorId(in messages: [Message], busy: Bool, pendingId: String? = nil) -> String? {
        guard !busy,
              let last = messages.last(where: { $0.kind != .digest && $0.kind != .compaction }),
              isError(last), last.tool?.setup != true, last.tool?.claudeUpdate != true,
              MessageActionRules.regenerateSource(in: messages, pendingId: pendingId) != nil
        else { return nil }
        return last.id
    }
}

// MARK: - Access card (AccessCard.tsx)

/// One line of the access card, worded by the app's catalog.
public enum AccessLine: Hashable, Sendable {
    case engineMissing(engine: String)
    case engineMissingOwner
    case keyRefused
    case keyRefusedAdmin
    case noAccessOther(engine: String)
    case noAccessRoutine(engine: String)
    case noAccessAdminOrgKey
    case noAccessMine(engine: String)
    case noAccessMineAdmin
    case noAccessRoutineMine(engine: String)
    case payerDisabledRoutineMine
    case payerDisabledSpeaker
    case payerDisabledOwner
    case routineDelegation(routine: String, person: String?)
    case routineDelegationReason(String)
    /// #1137: the owner pays and their computer's model is offline (nil:
    /// the owner's name is unknown).
    case ownerModelOffline(owner: String?)
    /// #1137: the owner pays; the viewer wrote, and the owner's access is
    /// what is missing.
    case ownerPaysOther(bot: String, engine: String)
    case ownerPaysDisabled(bot: String)
    /// #1137: the viewer is the owner who pays for everyone.
    case ownerPaysMine(bot: String, engine: String)
    /// #1137: each person pays, and the viewer has no access to the engine.
    case speakerPays(bot: String, engine: String)
    case speakerPaysServerEngine(bot: String, engine: String)
}

public struct AccessCardLines: Hashable, Sendable {
    public var text: AccessLine
    public var hint: AccessLine?
    public var detail: String?
    /// Where the viewer adds their own key (Perspicax console).
    public var keysUrl: String?
    /// The viewer could sign in with their own subscription on the computer.
    public var signIn = false
    /// The viewer could reconnect their routines on the computer.
    public var reconnect = false
    /// #1137: offer to choose a model the viewer can pay for.
    public var chooseModel = false

    public static func of(_ access: AccessCard, viewerPrincipalId: String?, admin: Bool) -> AccessCardLines {
        func same(_ a: String?, _ b: String?) -> Bool {
            guard let a, let b, !a.isEmpty, !b.isEmpty else { return false }
            return a.lowercased() == b.lowercased()
        }
        let owner = same(viewerPrincipalId, access.ownerPrincipalId)
        switch access.kind {
        case .routineDelegation:
            let runAs = same(viewerPrincipalId, access.runAsPrincipalId)
            let reason = access.suspendReason
            let person = access.runAsName.flatMap { $0.isEmpty ? nil : $0 }
            return AccessCardLines(
                text: .routineDelegation(routine: access.routineName ?? "", person: person),
                hint: reason.map { .routineDelegationReason($0) },
                reconnect: runAs && reason != "no_right"
            )
        case .engineMissing:
            return AccessCardLines(text: .engineMissing(engine: access.engine), hint: owner && !admin ? .engineMissingOwner : nil)
        case .keyRefused:
            return AccessCardLines(
                text: .keyRefused,
                hint: admin ? .keyRefusedAdmin : nil,
                detail: (owner || admin) ? access.detail : nil
            )
        default:
            break
        }
        let engine = access.engine
        // "" when the card names no bot: the app words it ("this bot").
        let bot = access.botName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // #1137: the owner pays, and their computer's model is offline.
        if access.cause == "owner_model_offline" {
            let name = access.ownerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return AccessCardLines(text: .ownerModelOffline(owner: name.isEmpty ? nil : name))
        }
        let payer = (access.payerPrincipalId?.isEmpty == false) ? access.payerPrincipalId : access.ownerPrincipalId
        let mine = same(viewerPrincipalId, payer)
        // #1137: the owner pays; the viewer is the person who wrote.
        if access.ownerPays == true && !mine {
            return AccessCardLines(text: access.cause == "payer_disabled" ? .ownerPaysDisabled(bot: bot) : .ownerPaysOther(bot: bot, engine: engine))
        }
        if access.cause == "payer_disabled" {
            if access.routine == true || access.payer == "owner" {
                return AccessCardLines(text: mine ? .payerDisabledRoutineMine : .payerDisabledOwner)
            }
            return AccessCardLines(text: mine ? .payerDisabledSpeaker : .noAccessOther(engine: engine))
        }
        var own = AccessCardLines(text: .noAccessMine(engine: engine))
        own.keysUrl = access.keysUrl
        own.signIn = access.subscriptionSignIn == true
        // #1137: each person pays for this bot, and the viewer has no access
        // that the organization gave them.
        if access.cause == "server_engine_not_allowed" && mine && access.speakerPays == true && access.routine != true {
            own.text = .speakerPaysServerEngine(bot: bot, engine: engine)
            own.chooseModel = true
            return own
        }
        if access.routine == true {
            if mine {
                own.text = .noAccessRoutineMine(engine: engine)
                own.hint = admin ? .noAccessMineAdmin : nil
                return own
            }
            return AccessCardLines(text: .noAccessRoutine(engine: engine), hint: admin ? .noAccessAdminOrgKey : nil)
        }
        if mine {
            own.hint = admin ? .noAccessMineAdmin : nil
            if access.speakerPays == true {
                own.text = .speakerPays(bot: bot, engine: engine)
                own.chooseModel = true
            } else if access.ownerPays == true {
                own.text = .ownerPaysMine(bot: bot, engine: engine)
            }
            return own
        }
        return AccessCardLines(text: .noAccessOther(engine: engine), hint: admin ? .noAccessAdminOrgKey : nil)
    }
}

// MARK: - Goal run card (GoalRunCard.tsx)

public enum GoalRunText {
    /// Whitespace folded, cut with an ellipsis past `limit`.
    public static func compact(_ value: String?, limit: Int) -> String {
        let clean = (value ?? "")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        guard clean.count > limit else { return clean }
        let cut = clean.prefix(limit - 1)
        return String(cut).trimmingCharacters(in: .whitespaces) + "…"
    }

    public static let detailLimit = 280
    public static let goalLimit = 180

    /// "Turn n of max" while working, else the number of turns run.
    public enum Turns: Hashable, Sendable {
        case current(turn: Int, of: Int)
        case total(Int)
    }

    public static func turns(_ run: GoalRunCard) -> Turns {
        run.isRunning ? .current(turn: min(run.turnCount + 1, run.maxTurns), of: run.maxTurns) : .total(run.turnCount)
    }
}

// MARK: - What an ask is about (ApprovalCard.tsx toolLabel, PendingApproval.tsx label)

/// The verb phrase after "wants to", worded by the app's catalog.
public enum ApprovalToolAction: Hashable, Sendable {
    case runCommand, readFile, writeFile, editFile, fetchWebPage, searchWeb
    case scheduleRoutine, changeRoutine, enableSkill, updateSkill, updateProfile
    case deleteFile, think, takeAction, useTool
    /// A tool the catalog has no phrase for: its own name, in words.
    case named(String)

    public static func of(tool: String?) -> ApprovalToolAction {
        guard let tool else { return .takeAction }
        switch tool {
        case "Bash", "shell": return .runCommand
        case "Read", "read": return .readFile
        case "Write": return .writeFile
        case "Edit", "edit": return .editFile
        case "WebFetch", "fetch": return .fetchWebPage
        case "WebSearch": return .searchWeb
        case "schedule_routine": return .scheduleRoutine
        case "manage_routine": return .changeRoutine
        case "stage_skill": return .enableSkill
        case "update_skill": return .updateSkill
        case "update_profile": return .updateProfile
        case "delete": return .deleteFile
        case "think": return .think
        case "other": return .takeAction
        case "tool": return .useTool
        default: break
        }
        let name = ApprovalRiskClassifier.parseToolId(tool).name
        let words = name.split(whereSeparator: { $0 == "_" }).joined(separator: " ")
        return .named(words.isEmpty ? tool : words)
    }
}

/// "Added to your Allow rules": the rule a card saved, as the action it
/// lets the bot take (`describeAllowRule`, shared/approval-describe.ts).
public enum AllowRuleText {
    /// The card's saved rule, only on a card that was allowed with it.
    public static func savedRule(_ card: OptionCard) -> String? {
        guard card.answered == "allow", card.expired != true, let rule = card.alwaysAllowed, !rule.isEmpty else { return nil }
        return rule
    }

    /// The action an `mcp:<server>__<tool>` rule allows; nil for other keys
    /// (the app shows those as sent).
    public static func action(of rule: String) -> ApprovalToolAction? {
        guard rule.hasPrefix("mcp:") else { return nil }
        // mcp:<server>__<tool>: the tool after the server's own name
        let key = String(rule.dropFirst(4))
        let tool = key.range(of: "__").map { String(key[$0.upperBound...]) } ?? key
        switch tool {
        case "run_command", "vm_exec", "exec": return .runCommand
        default: return .of(tool: tool)
        }
    }
}

/// The dock's heading for a request: a plain tool ask names the bot and
/// the action; a proposal says what is being confirmed.
public enum ApprovalHeading: Hashable, Sendable {
    case wantsTo(ApprovalToolAction)
    case confirmRoutine, confirmPausedRoutine, confirmRoutineChange, enableSkill, updateSkill, confirmProfileChange, confirmRuleChange
    case teamSetup(String)

    public static func of(_ card: OptionCard) -> ApprovalHeading {
        if card.teamSetupRequest != nil { return .teamSetup(card.title) }
        if let skill = card.skillRequest { return skill.action == "update" ? .updateSkill : .enableSkill }
        if card.profileRequest != nil { return .confirmProfileChange }
        if card.ruleRequest != nil { return .confirmRuleChange }
        if let routine = card.routineRequest {
            if routine.operation?.action == "create" {
                return routine.operation?.paused == true ? .confirmPausedRoutine : .confirmRoutine
            }
            return .confirmRoutineChange
        }
        return .wantsTo(.of(tool: card.tool))
    }

    /// The server's plain title ("Allow Quasar to view the schedule in
    /// ConnectWise PSA?") for a plain tool ask, when the phone reads English:
    /// those words are English, and a mixed sentence is worse than the app's
    /// own localized "wants to" heading.
    ///
    /// Since #1089 the server words the card in its person's language and
    /// says which (`plain.locale`): those words are used when they are in
    /// the reader's. An older server sends English without saying so.
    public static func plainTitle(_ card: OptionCard, language: String? = Locale.preferredLanguages.first) -> String? {
        guard case .wantsTo = of(card), let title = card.plain?.title.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return nil }
        guard sameLanguage(card.plain?.locale ?? "en", language ?? "en") else { return nil }
        return title
    }

    static func sameLanguage(_ a: String, _ b: String) -> Bool {
        let first = { (tag: String) in tag.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? "en" }
        return first(a) == first(b)
    }

    /// The server's plain line under the title, on the same terms.
    public static func plainLine(_ card: OptionCard, language: String? = Locale.preferredLanguages.first) -> String? {
        guard plainTitle(card, language: language) != nil, let line = card.plain?.line.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty else { return nil }
        return line
    }

    /// What the dock prints in its monospace block: a proposal's text, a
    /// command (the exact one when the card offers to remember it), or the
    /// card's plain summary. Raw JSON arguments stay out.
    public static func detail(_ card: OptionCard) -> String? {
        if ApprovalDockRules.isProposal(card) { return card.subtitle.isEmpty ? nil : card.subtitle }
        if let command = card.commandAllowlist?.command { return command }
        let text = card.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        guard GateArguments.isTechnical(card) else { return card.subtitle }
        // the gate's `<tool> {json}` is arguments: its JSON only
        let json = card.toolInput ?? GateArguments.split(text, known: [card.tool, card.mcpTool])?.json ?? text
        return argumentSummary(json) ?? plainLine(card)
    }

    /// Raw JSON arguments are not shown as such: the one argument a person
    /// reads to know what runs (a path, a pattern, a URL, a query).
    static func argumentSummary(_ json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let args = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        for key in ["command", "file_path", "path", "notebook_path", "pattern", "url", "query", "prompt"] {
            if let value = args[key] as? String, !value.isEmpty { return value }
        }
        return nil
    }
}
