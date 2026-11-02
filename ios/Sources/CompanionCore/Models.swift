// The harness's wire types, in Swift.
//
// These mirror `server/store.ts` and the payloads in `server/index.ts`.
// There is no shared type system across the two languages, so the contract
// is pinned by fixtures instead: `Tests/CompanionCoreTests/Fixtures` holds
// real responses captured from a running server, and the decoding tests
// read them. When the server changes a payload, a test here fails.
//
// Everything the server may omit is optional, and nothing is decoded more
// strictly than it has to be — a phone that refuses to show a conversation
// because one message gained a field is worse than one that ignores it.
import Foundation

// MARK: - Messages

/// Inline live or recorded video (`kind == .video`).
public struct WireVideoWidget: Codable, Hashable, Sendable {
    public var kind: String
    public var playbackUrl: String
    public var title: String?
    public var streamer: String?
    public var source: String?
    public var posterUrl: String?
    public var durationMs: Double?
    public var viewerCount: Int?
}

public struct SkillRequestCardData: Codable, Hashable, Sendable {
    public var version: Int
    public var requestId: String
    public var botId: String
    public var threadId: String
    public var stagedId: String
    public var action: String
    public var name: String
    public var gist: String
    /// Optional so approval cards persisted by older desktop builds still decode.
    public var source: String?
    /// The exact, secret-scrubbed instructions the approval enables.
    public var preview: String?
    public var sha256: String?
    public var warnings: [String]
    public var createdAt: Int64

    /// A current client echoes this only after it can show the complete
    /// proposal. Legacy cards remain visible but deny-only.
    public var reviewedSha256: String? {
        guard let preview, !preview.isEmpty, let sha256, sha256.utf8.count == 64 else { return nil }
        let hexadecimal = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        guard sha256.unicodeScalars.allSatisfy(hexadecimal.contains) else { return nil }
        return sha256
    }
}

/// `OptionCardData.plain` on the wire.
public struct ApprovalPlainWords: Codable, Hashable, Sendable {
    public var title: String
    public var line: String
    public var risk: String? = nil
    /// The verb phrase after "wants to" ("view the schedule in ConnectWise
    /// PSA"), in `locale`. Nil on older servers.
    public var action: String? = nil
    /// The language the server worded these in (the person's own, #1089).
    /// Nil on older servers, which word them in English.
    public var locale: String? = nil
    public init(title: String, line: String, risk: String? = nil, action: String? = nil, locale: String? = nil) {
        self.title = title
        self.line = line
        self.risk = risk
        self.action = action
        self.locale = locale
    }
}

/// The rule an answer saved (`OptionCardData.ruleSaved`).
public struct SavedOwnerRule: Codable, Hashable, Sendable {
    public var id: String?
    /// "allow", "ask" or "deny".
    public var behavior: String
    public var description: String
    public init(id: String? = nil, behavior: String, description: String) {
        self.id = id
        self.behavior = behavior
        self.description = description
    }
}

/// Who answered a card when it was not a tap (`CardAnswerer`): `via` is
/// "call", "ai-client", "primary-bot" or "auto-review"; `bot` names the
/// Primary Bot that answered.
public struct CardAnsweredBy: Codable, Hashable, Sendable {
    public var via: String?
    public var bot: String?
    public init(via: String? = nil, bot: String? = nil) {
        self.via = via
        self.bot = bot
    }
}

/// The rule a permission card can keep (`OptionCardData.ownerRule`).
public struct OwnerRuleCandidate: Codable, Hashable, Sendable {
    public var description: String
    /// A folder rule that also covers changing files (write, delete).
    public var writes: Bool? = nil
    public var from: String? = nil
}

public struct OptionCard: Codable, Hashable, Sendable {
    public var title: String
    public var subtitle: String
    public var options: [String]
    /// 2026-10-30: a proactive proposal (`ProactiveProposalRules`): answered
    /// on its own route, never as a typed message. Nil on every other card.
    public var proactiveProposal: ProactiveProposalRef? = nil
    public var answered: String?
    public var dismissed: Bool?
    /// Present when this card is a live provider ask — the thing that makes
    /// it answerable rather than historical.
    public var requestId: String?
    public var tool: String?
    /// Why auto mode stopped to ask anyway.
    public var held: String?
    /// The narrow grant "always allow" would remember, e.g. `Bash:git`.
    public var allowKey: String?
    /// The Allow rule (an `allowKey`) saved when this card was answered with
    /// Always allow: the card says so and offers Edit rule.
    public var alwaysAllowed: String? = nil
    /// Learned skills must show their complete reviewed contents before an
    /// approval button is offered on a compact companion surface.
    public var skillRequest: SkillRequestCardData? = nil
    /// The model's own questions and options (Claude's `AskUserQuestion`).
    /// Present only on a structured ask; every other card leaves it nil.
    public var questionRequest: QuestionRequestCardData? = nil
    /// What an answered question was answered WITH. `answered` only records
    /// the behavior once the harness settles a live ask, so without this a
    /// settled question card would read "answer" instead of the reply.
    public var answeredText: String? = nil
    /// Terminal: the proposal went stale while open. Nothing can answer it
    /// and no client may offer its options (`OptionCardData.expired`).
    public var expired: Bool? = nil
    /// Catalog key for `held` when it is one of the fixed notes.
    public var heldCode: String? = nil
    /// The server's plain English words for a permission card ("Allow
    /// Quasar to run a command?" and one line), the same generator as its
    /// push (shared/approval-describe.ts). Nil on older servers.
    public var plain: ApprovalPlainWords? = nil
    /// When the server declines it if nobody answers (milliseconds since
    /// 1970): an AI client's hidden conversation.
    public var expiresAt: Double? = nil
    /// The provider can remember an allow for the rest of its session
    /// ("Always allow this session").
    public var allowSession: Bool? = nil
    /// A permission ask's full arguments as redacted JSON.
    public var toolInput: String? = nil
    /// MCP tool annotations, when the provider passes them on.
    public var toolHints: ToolHints? = nil
    /// The exact native command an owner or admin may remember
    /// ("Always allow this command").
    public var commandAllowlist: CommandAllowlistCandidate? = nil
    /// 2026-10-20: the owner's rule this card keeps in one click ("Always
    /// allow": this bot, this kind of action or this program). Nil on older
    /// servers.
    public var ownerRule: OwnerRuleCandidate? = nil
    /// 2026-10-26 (#1065): the second "Always allow", every file of the
    /// folder of the one this card reads (and its subfolders). Nil when the
    /// server offers only the exact path.
    public var ownerRuleFolder: OwnerRuleCandidate? = nil
    /// Organization server: a server command of a member's bot that only an
    /// organization admin answers. Never remembered.
    public var adminApproval: Bool? = nil
    /// 2026-10-14: the person's own rule saved with this answer (Always allow
    /// on the card, `OptionCardData.ruleSaved`). Nil on older servers.
    public var ruleSaved: SavedOwnerRule? = nil
    /// A change the person took back (Undo).
    public var undone: Bool? = nil
    /// How the card was answered when not by a tap (`CardAnswerer.via`).
    public var answeredBy: CardAnsweredBy? = nil
    /// 2026-10-28: the person's own "Ask first" rule that kept this card.
    public var heldRule: HeldRule? = nil
    /// The custom rule that decided this card (an "Ask first" one held it).
    public var customRule: CardRuleNotice? = nil
    /// The engine's own `<server>__<tool>` when `tool` is only a kind (ACP
    /// "other") or a bare name.
    public var mcpTool: String? = nil
    /// Durable proposals. Only their presence matters to the phone: a
    /// proposal is confirmed or cancelled, never remembered or batched.
    public var routineRequest: ProposalRequestMarker? = nil
    public var profileRequest: ProposalRequestMarker? = nil
    public var modelRequest: ProposalRequestMarker? = nil
    public var ruleRequest: ProposalRequestMarker? = nil
    public var tighteningRequest: ProposalRequestMarker? = nil
    public var teamSetupRequest: ProposalRequestMarker? = nil

    /// A card is actionable while it is unanswered and still has a request
    /// behind it. Everything else is transcript.
    public var isPending: Bool {
        requestId != nil && answered == nil && dismissed != true && expired != true
    }

    /// Permission cards carry a tool; questions do not.
    public var isPermission: Bool { tool != nil }

    /// A structured ask draws its own card: the model posed real questions
    /// with real options, and a flat row of buttons cannot say which
    /// question a tap answered.
    public var questions: [AskQuestion] {
        guard let questionRequest, !questionRequest.questions.isEmpty else { return [] }
        return questionRequest.questions
    }

    /// The wire API accepts an approval behavior rather than the button's
    /// display text. Treat the one refusal as deny and every other offered
    /// permission choice as allow: providers may say "Approve", "Yes", or
    /// "Always allow", and none of those should accidentally become a deny.
    public func responseBehavior(for choice: String) -> String {
        Self.responseBehavior(for: choice, isPermission: isPermission)
    }

    /// The ID-only form is used by Live Activity buttons, which carry the
    /// card kind but not the full card payload.
    public static func responseBehavior(for choice: String, isPermission: Bool) -> String {
        guard isPermission else { return "answer" }
        return isRefusal(choice) ? "deny" : "allow"
    }

    /// Shared by all of the app's card surfaces and by Live Activities.
    public static func isRefusal(_ choice: String) -> Bool {
        let normalized = choice.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["deny", "cancel", "dismiss"].contains(normalized)
    }

    /// A provider may include the standing grant as an option of its own.
    /// Only remember it when the server supplied the narrow grant key.
    public func shouldRememberPermission(for choice: String) -> Bool {
        guard isPermission, allowKey != nil else { return false }
        let normalized = choice.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.caseInsensitiveCompare("Always allow") == .orderedSame
    }
}

public struct ToolActivity: Codable, Hashable, Sendable {
    public var name: String
    public var ok: Bool?
    /// The same chip as a phrase a voice can read.
    public var spoken: String?
    /// Marks an error fixed by installing something, not by retrying.
    public var setup: Bool?
    /// Marks an error caused by a Claude Code CLI too old for the chosen
    /// model; the phone offers to run Claude's updater. Absent on older
    /// computers, so it stays optional.
    public var claudeUpdate: Bool?
    /// What the step returned, when the computer kept it. A teammate's
    /// "X replied" chip carries the report itself here (redacted, ≤2000
    /// characters) so it can be read without opening the teammate's thread.
    /// Previews still read `name`: the chip label is the summary.
    public var output: String?
    /// The driver's one-line summary: for a shell step, the command itself.
    /// The run card (`verify-steps.ts` `commandOf`) reads its steps here.
    public var summary: String?
    /// A ConnectWise widget drawn in place of the quiet tool chip. A bad
    /// widget is dropped; the rest of the activity still decodes.
    public var widget: CwWidget?
    /// The call's arguments, as the JSON text the driver kept (the step
    /// row reads its target here: which file, which command).
    public var input: String? = nil
    /// How long the call ran, set when it settles.
    public var durationMs: Double? = nil
    /// The product this tool serves, as the connector or the server declared
    /// it at run time (shared/wire.ts `tool.product`); the step row names it.
    public var product: String? = nil
    /// The id the tool's name starts with for that product, declared with it.
    public var productId: String? = nil
    /// 2026-10-28: what answered the call's ask with no card; the row's
    /// details only, never its line.
    public var autoApproval: ToolAutoApproval? = nil
    /// #1329: a "do not finish until" check (relaunch x/N, met, bound);
    /// the chat draws it in the reader's language.
    public var finishUntil: FinishUntilLine? = nil
    /// 2026-10-29: the step this call is, for the working line ("Reading
    /// your email", "Running scrape.py"), the same whatever the engine
    /// (shared/working-step.ts). Absent from older servers.
    public var step: WorkingStep? = nil
    /// Usage-limit switch / return / wait (shared/limit-failover.ts). A
    /// switched or back row stays out of the chat (#1668 / #1698).
    public var limitFailover: LimitFailoverLine? = nil

    public init(name: String, ok: Bool? = nil, spoken: String? = nil, setup: Bool? = nil, claudeUpdate: Bool? = nil, output: String? = nil, summary: String? = nil, widget: CwWidget? = nil) {
        self.name = name
        self.ok = ok
        self.spoken = spoken
        self.setup = setup
        self.claudeUpdate = claudeUpdate
        self.output = output
        self.summary = summary
        self.widget = widget
    }

    enum CodingKeys: String, CodingKey {
        case name, ok, spoken, setup, claudeUpdate, output, summary, widget, input, durationMs, product, productId, autoApproval, finishUntil, step, limitFailover
    }

    public init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        name = try box.decode(String.self, forKey: .name)
        ok = try box.decodeIfPresent(Bool.self, forKey: .ok)
        spoken = try box.decodeIfPresent(String.self, forKey: .spoken)
        setup = try box.decodeIfPresent(Bool.self, forKey: .setup)
        claudeUpdate = try box.decodeIfPresent(Bool.self, forKey: .claudeUpdate)
        output = try box.decodeIfPresent(String.self, forKey: .output)
        summary = try box.decodeIfPresent(String.self, forKey: .summary)
        input = try? box.decodeIfPresent(String.self, forKey: .input)
        durationMs = try? box.decodeIfPresent(Double.self, forKey: .durationMs)
        product = try? box.decodeIfPresent(String.self, forKey: .product)
        productId = try? box.decodeIfPresent(String.self, forKey: .productId)
        finishUntil = try? box.decodeIfPresent(FinishUntilLine.self, forKey: .finishUntil)
        autoApproval = try? box.decodeIfPresent(ToolAutoApproval.self, forKey: .autoApproval)
        step = try? box.decodeIfPresent(WorkingStep.self, forKey: .step)
        limitFailover = try? box.decodeIfPresent(LimitFailoverLine.self, forKey: .limitFailover)
        do {
            widget = try box.decodeIfPresent(CwWidget.self, forKey: .widget)
        } catch {
            widget = nil
        }
    }

    public func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(name, forKey: .name)
        try box.encodeIfPresent(ok, forKey: .ok)
        try box.encodeIfPresent(spoken, forKey: .spoken)
        try box.encodeIfPresent(setup, forKey: .setup)
        try box.encodeIfPresent(claudeUpdate, forKey: .claudeUpdate)
        try box.encodeIfPresent(output, forKey: .output)
        try box.encodeIfPresent(summary, forKey: .summary)
        try box.encodeIfPresent(widget, forKey: .widget)
        try box.encodeIfPresent(input, forKey: .input)
        try box.encodeIfPresent(durationMs, forKey: .durationMs)
        try box.encodeIfPresent(product, forKey: .product)
        try box.encodeIfPresent(productId, forKey: .productId)
        try box.encodeIfPresent(autoApproval, forKey: .autoApproval)
        try box.encodeIfPresent(step, forKey: .step)
        try box.encodeIfPresent(limitFailover, forKey: .limitFailover)
    }

    /// The output worth expanding the chip for; nil when there is none.
    public var expandableOutput: String? {
        guard let text = output?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}

/// A compaction record: from this message on, rebuilds of the thread's
/// context carry `summary` instead of the earlier messages.
public struct Compaction: Codable, Hashable, Sendable {
    public var summary: String
    public var tokensBefore: Int
    /// "harness" for Sagax's own fold, which the chat never draws (desktop
    /// ChatView); absent or "person" for one the person asked for.
    public var by: String?
    public init(summary: String, tokensBefore: Int, by: String? = nil) {
        self.summary = summary
        self.tokensBefore = tokensBefore
        self.by = by
    }

    public var chipText: String {
        let tokens = NumberFormatter.localizedString(from: NSNumber(value: tokensBefore), number: .decimal)
        return "Context compacted · \(tokens) tokens summarised"
    }
}

/// The thread an activity chip opened — "Opened thread #Title on Scout" —
/// so the phone can go there. Newer computers only; a chip without one is
/// just a receipt.
public struct ThreadRef: Codable, Hashable, Sendable {
    public var botId: String
    public var threadId: String
    public var title: String
    /// Stamped by the server when the target thread no longer exists
    /// (#176): no "Open thread" for it.
    public var gone: Bool? = nil

    /// The reference while its thread still exists.
    public var live: ThreadRef? { gone == true ? nil : self }

    public init(botId: String, threadId: String, title: String) {
        self.botId = botId
        self.threadId = threadId
        self.title = title
    }
}

/// A credential request created by the desktop for one paused task.
///
/// The phone may fill this request only through the QR-pinned HPKE transport.
/// The payload contains identifiers and display copy, never the credential.
public struct SecretRequestCardData: Codable, Hashable, Sendable {
    public var target: String?
    public var label: String?
    public var description: String?
    public var placeholder: String?
    public var helpUrl: String?
    public var requestKey: String?
    public var provided: Bool?
    public var dismissed: Bool?
    public var resumed: Bool?
    public var error: String?
    /// A newer request for the same key replaced this one.
    public var superseded: Bool? = nil
    /// A bot's sign-in request (target "vaultLogin"): the site and, once
    /// answered, the login chosen (VaultLoginCard.swift).
    public var vault: VaultRequestPublic? = nil

    public var isPending: Bool { provided != true && dismissed != true && superseded != true }
}

public struct Sender: Codable, Hashable, Sendable {
    public var botId: String
    public var name: String
    public var color: String
}

/// One person or bot behind a reaction (shared/reactions.ts).
public struct ReactionActor: Codable, Hashable, Sendable {
    public var id: String
    /// "person" or "bot".
    public var kind: String?
    public var name: String?
}

/// One emoji on a message. Current servers send everyone who put it there in
/// `actors`; older ones sent one entry per person with `by` ("user" or a
/// bot id). Both decode.
public struct Reaction: Codable, Hashable, Sendable {
    public var emoji: String
    public var by: String?
    public var actors: [ReactionActor]?
    public var at: Double?

    /// How many put this emoji there.
    public var count: Int { actors.map { max($0.count, 1) } ?? 1 }

    /// Whether `principalId` (or, on an older server, the desktop's "user")
    /// is among them.
    public func includes(_ principalId: String?) -> Bool {
        if by == "user" { return true }
        guard let principalId = principalId?.lowercased(), !principalId.isEmpty else { return false }
        return actors?.contains { $0.id.lowercased() == principalId } ?? false
    }
}

public struct CommChip: Codable, Hashable, Sendable {
    public var groupId: String
    /// The thread this note points at (`Comm.threadId`). A bot-to-bot line
    /// already named here is not drawn again.
    public var threadId: String? = nil
    /// The channel thread no longer exists (#176).
    public var gone: Bool? = nil
    public var withBotId: String
    public var withName: String
    public var withColor: String
    /// 2026-10-21 (parity 1C): `sent` on the sender's note, `received` on the
    /// recipient's. Older servers send neither: see `isReceived`.
    public var direction: String? = nil
    /// The words a sender's note sent, cut short ("Messaged @X: text").
    public var text: String? = nil
}

public struct Message: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case text, options, activity, screen, video, secret
        /// The harness's receipt of a settled turn: "[digest] · tools: … ·
        /// reply: …". Desktop shows it only behind "show tool calls"; it is
        /// a log line, not something anyone said, so the phone draws it as
        /// a chip that opens the parts (`DigestSummary`) and never previews
        /// or speaks it. Named so it cannot fall into `unknown`, which draws
        /// whatever text a message carries as a bubble.
        case digest
        case compaction
        /// One background routine run, upserted into the thread that asked
        /// for it and patched as the run moves. `routineRun` carries the card.
        case routineRun = "routine.run"
        /// A legacy connect-an-app request from a conversation. The card is
        /// gone; such a message now renders as its own text, if any.
        case connector
        /// A turn that could not run for lack of engine access on an
        /// organization server; `access` carries the card (`AccessCard.tsx`).
        case access
        /// The receipt of a room goal; `goalRun` carries it (`GoalRunCard.tsx`).
        case goalRun = "goal.run"
        /// A bot-authored card, list or form (`show_widget`); `widget`
        /// carries the tree and `text` its readable fallback.
        case widget
        /// #1480: a neutral line about the group's people ("Ann left the
        /// group"); `roster` carries it, `text` is its English fallback.
        case roster
        /// A kind this build has never heard of.
        ///
        /// Not decorative. `kind` is not optional, so without this a single
        /// unrecognised message fails the decode of the whole response it
        /// arrived in — the thread does not render one message oddly, it
        /// does not render. The harness gains message kinds on its own
        /// schedule and the phone is updated on the App Store's, so "newer
        /// computer than phone" is the normal state of things, not an edge
        /// case. Degrading to the text a message carries is worth more than
        /// being right about its shape.
        case unknown

        public init(from decoder: any Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .unknown
        }
    }

    public enum Role: String, Codable, Sendable {
        case bot, user

        /// Same reasoning, and `bot` rather than a third case: an unplaceable
        /// message drawn as yours would be the phone claiming you said
        /// something you did not.
        public init(from decoder: any Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Role(rawValue: raw) ?? .bot
        }
    }

    public var id: String
    public var role: Role
    public var kind: Kind
    public var at: Double
    public var text: String?
    /// Provider turn markers let clients fold settled narration while keeping
    /// the final answer visible. Older servers may omit both fields.
    public var turnId: String?
    public var turnTerminal: Bool?
    public var card: OptionCard?
    public var secret: SecretRequestCardData?
    public var tool: ToolActivity?
    public var threadRef: ThreadRef?
    /// `kind == .compaction`: the record itself.
    public var compaction: Compaction?
    /// `kind == .routineRun`: the run's status and what it said. Absent
    /// leaves the message's text, which the computer writes for exactly
    /// the clients that cannot read the card.
    public var routineRun: RoutineRunCard?
    /// The message this one follows; nil at the thread root. Two messages
    /// sharing a parent are a fork.
    public var parentId: String?
    /// Set when this line began as a queued send: the id the harness quoted
    /// when it held the message, echoed back on the line that finally landed.
    /// Clients match it against their held-send rows to retire them.
    public var queueId: String?
    /// Rooms: which member said this.
    public var from: Sender?
    public var reactions: [Reaction]?
    public var comm: CommChip?
    /// Screen messages in the paged shape: the pixels live behind
    /// `/api/threads/:threadId/messages/:id/image` rather than inline.
    public var hasImage: Bool?
    /// Screen and video messages: the person's message of that turn asked
    /// for this view (shared/requested-views.ts). Drawn only with it; rows
    /// from before 2026-10-20 have none and stay hidden.
    public var requested: Bool? = nil
    /// Screen messages in the full shape: base64 pixels, inline.
    public var png: String?
    public var mime: String?
    /// Agent-generated images carried on a text reply, including late message patches.
    public var attachments: [MessageImageAttachment]?
    /// `kind == .access`: why the turn could not run.
    public var access: AccessCard? = nil
    /// `kind == .goalRun`: the room goal's receipt.
    public var goalRun: GoalRunCard? = nil
    /// A phone call or a purchase the bot asks for (`Message.outbound`,
    /// shared/wire.ts `OutboundCard`): drawn as its own card.
    public var outbound: OutboundCardData? = nil
    /// The request line, live card or result of a parallel task.
    public var parallelTask: ParallelTaskRef? = nil
    /// Flat reply reference for an inline quote; unrelated to `parentId`.
    public var replyToId: String? = nil
    /// Stable client identity for at-most-once send retries.
    public var sendId: String? = nil
    /// A user line sent into a running turn: the model saw it mid-turn.
    public var steered: Bool? = nil
    /// A peer bot's aside folded into a running turn, never a new request.
    public var aside: Bool? = nil
    /// "api" when a user line arrived through the server's HTTP API.
    public var via: String? = nil
    /// Words said on a voice call. The thread draws one card per callId.
    public var voiceCall: VoiceCallMeta? = nil
    /// Which signed-in person sent a user line on a shared workspace.
    public var sender: MessageAuthor? = nil
    /// A user-role line another bot delivered into this conversation.
    public var peerAsk: PeerAsk? = nil
    /// A room line a bot pushed in with post_to_room.
    public var peerPost: PeerPost? = nil
    /// Auto rooms: the decision model picked this reply's speaker.
    public var routedBy: RoutedBy? = nil
    /// Rooms: "chat" or "goal" for a user line. Absent is ordinary chat.
    public var channelMode: String? = nil
    /// Sent while the bot was mid-turn and still waiting to auto-send.
    public var queued: Bool? = nil
    /// The server-proven user message this reply answers: what Regenerate
    /// re-sends through the edit route.
    public var requestMessageId: String? = nil
    /// Provider completion outcome, independent of whether it emitted text.
    public var turnSucceeded: Bool? = nil
    /// "failed": a dropped worker, or a person or bot removed mid-turn.
    public var status: String? = nil
    /// An exact request was stopped.
    public var requestCancelled: Bool? = nil
    /// Projected for someone who is not the approval audience:
    /// "waiting-on-owner" or "owner-settled" (`OwnerWait.tsx`).
    public var state: String? = nil
    /// Whose approval a projected card waits on.
    public var ownerName: String? = nil
    /// `kind == .digest`: the structured digest; the phone reads which
    /// credentials paid for the turn from it (`DigestChip.tsx` TurnAccessChip).
    public var digest: MessageDigest? = nil
    /// `kind == .video`: inline player payload.
    public var video: WireVideoWidget? = nil
    /// `kind == .widget`: the bot's widget tree (ChatWidget.swift).
    public var widget: ChatWidgetPayload? = nil
    /// `kind == .roster` (#1480): who left the group.
    public var roster: RosterNote? = nil
    /// A page the bot proposed (`propose_page`, shared/wire.ts
    /// `pagePublish`): drawn as the card the person publishes it from.
    public var pagePublish: PagePublishRef? = nil
    /// User messages: the Data result or the page (`page`, 2026-10-28) the
    /// person was viewing when they sent it. The page draws as a chip over
    /// the words; the text stays exactly what they typed.
    public var dataContext: MessageDataContext? = nil

    public var date: Date { Date(timeIntervalSince1970: at / 1000) }

    /// The owner-wait projection, when this card waits on someone else.
    public var ownerWait: OwnerWaitState? { state.flatMap(OwnerWaitState.init(rawValue:)) }

    /// A dropped worker or a person or bot removed during the turn.
    public var isFailed: Bool { status == "failed" }

    /// A teammate's reply chip carrying its report: someone else's words,
    /// so they read as prose in full rather than as a clipped tool log.
    public var isTeammateReport: Bool {
        kind == .activity && (threadRef != nil || comm != nil) && tool?.expandableOutput != nil
    }
}

// MARK: - Bots and rooms

/// `OutboundPolicy`: ask, or allow up to `dailyCap` sends a day.
public struct OutboundPolicy: Codable, Hashable, Sendable {
    public var policy: String
    public var dailyCap: Int
    public init(policy: String, dailyCap: Int) { self.policy = policy; self.dailyCap = dailyCap }
    public static let `default` = OutboundPolicy(policy: "ask", dailyCap: 25)
    /// A typed cap: a whole number from 1 to 1000, else nil.
    public static func cap(_ text: String) -> Int? {
        guard let value = Int(text.trimmingCharacters(in: .whitespaces)), (1...1000).contains(value) else { return nil }
        return value
    }
}

public struct ModelSelection: Codable, Hashable, Sendable {
    public var instanceId: String
    public var model: String
    /// Optional reasoning effort passed through to engines that support it.
    /// Older computers omit this field, which means the engine default.
    public var effort: String?
    /// Explicit model-specific variant, for engines that offer variants
    /// instead of effort levels (`capabilities.modelVariants`). Omitted
    /// leaves the native session alone.
    public var variant: String? = nil
    /// Auto (#153): the server picks the best model per task; `model` stays
    /// the fallback. Choosing a model pins it again (absent).
    public var auto: Bool? = nil

    public init(instanceId: String, model: String, effort: String? = nil, variant: String? = nil) {
        self.instanceId = instanceId
        self.model = model
        self.effort = effort
        self.variant = variant
    }
}

/// The bot that opened a thread, on itself or on a teammate. Absent — which
/// is every thread from an older computer — means the person opened it.
public struct ThreadOpener: Codable, Hashable, Sendable {
    public var botId: String
    public var name: String
    public var delegationId: String?
    public var at: Double
}

/// The bot that closed a thread with close_thread, once its result was
/// read. Absent means the thread is open; the computer clears it the moment
/// a new turn starts there, so a reopened thread simply loses the stamp.
public struct ThreadCloser: Codable, Hashable, Sendable {
    public var botId: String
    public var name: String
    public var at: Double
}

/// A folder within one bot, in the order saved by the desktop.
public struct BotProject: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var emoji: String?
}

/// One step of a bot's setup checklist (GET /api/bots/:id/overview `setup`).
public struct BotSetupStep: Codable, Hashable, Sendable {
    /// "identity", "soul", "folder", "apps" or "schedule".
    public var id: String
    public var done: Bool

    public init(id: String, done: Bool) {
        self.id = id
        self.done = done
    }
}

/// A bot-to-bot conversation waiting on the person (`WireWaitingApproval`).
public struct BotWaitingApproval: Codable, Hashable, Sendable {
    public var threadId: String
    /// The bot that opened it.
    public var openedByName: String?

    public init(threadId: String, openedByName: String? = nil) {
        self.threadId = threadId
        self.openedByName = openedByName
    }
}

public struct BotTask: Codable, Hashable, Sendable {
    public var threadId: String
    /// A room thread's own turn limit, minutes (#216); nil follows the
    /// server's default.
    public var turnTimeoutMinutes: Int? = nil
    public var title: String
    public var createdAt: Double
    public var modelSelection: ModelSelection?
    public var busy: Bool?
    /// Runtime state from newer computers; used to recover approvals in
    /// background threads without downloading every conversation.
    public var activity: String?
    /// This thread's own turn is done and a dispatched teammate has not
    /// settled yet (#1223): a wait, not work. Newer computers send it while
    /// leaving busy/activity idle, so older builds simply see the thread
    /// idle instead of spinning a work glyph for the whole teammate run.
    public var waitingOnTeammate: Bool?
    public var unread: Bool?
    public var approvalMode: String?
    public var autoApprove: Bool?
    public var alwaysAllow: [String]?
    public var projectId: String?
    public var openedBy: ThreadOpener?
    public var closedBy: ThreadCloser?
    /// Asleep until: 0 is the "until new activity" sentinel and sleeps until
    /// the thread does anything again, a timestamp sleeps until that moment,
    /// and nil means awake. Expired time snoozes heal server-side on read,
    /// so snapshots are authoritative; the sentinel wakes server-side on the
    /// first activity too.
    public var snoozedUntil: Double?

    /// When the person put this thread away, in epoch milliseconds. The
    /// field's presence — not its value — marks the thread archived: the
    /// task API accepts any epoch number, so a thread persisted with
    /// archivedAt: 0 is archived. Absent means it was never put away.
    public var archivedAt: Double?
    /// Bot-only internal execution. Keep it addressable, but out of thread pickers.
    public var routineRunId: String?
    /// An AI client's own conversation with this bot (#291): reachable from
    /// a link or the bot's activity, never in the list, previews, unread or
    /// notifications.
    public var hidden: Bool? = nil
    /// An automatic "<routine> · Results" thread (2026-10-22): a routine's
    /// reports now go to the person's own conversation, so this old thread is
    /// kept but never listed, previewed or counted unread.
    public var routineResults: Bool? = nil
    /// Out of the person's thread list: a routine run's execution, an
    /// automatic routine results thread or an AI client's hidden conversation.
    public var isHiddenFromPerson: Bool { routineRunId != nil || routineResults == true || hidden == true }
    /// A confidential thread ("Fil confidentiel"): never remembered,
    /// exported or shared beyond its owner. Permanent once set; only
    /// deleting the thread ends it. Absent means an ordinary thread.
    public var confidential: Bool? = nil
    /// The one question every view asks: show the classification banner.
    public var isConfidential: Bool { confidential == true }
    /// The person pinned this thread above the update-ordered list.
    /// The thread runs its bot's model (true) or one of its own (false);
    /// absent on an older server (#261).
    public var followsBotModel: Bool? = nil
    public var pinned: Bool? = nil
    /// Newest message time. Absent on older computers; the list uses createdAt.
    public var updatedAt: Double? = nil
    /// The message pinned to the top of this thread (`PATCH tasks
    /// {pinnedMessageId}`). Absent means none.
    public var pinnedMessageId: String? = nil
    /// A parallel task: the conversation and request it answers.
    public var parallelOf: TaskParallelOf? = nil
    /// What this thread has spent, banked once per turn.
    public var usage: TaskUsage? = nil
    /// True after an edit or branch switch rewound the visible conversation.
    public var rewound: Bool? = nil
    /// When the current busy stretch began (elapsed readout).
    public var turnStartedAt: Double? = nil
    /// Organization server: the person this 1:1 thread belongs to.
    public var ownerPrincipalId: String? = nil
    /// Where this conversation works when pinned (`cloud`, `vm`, `local`,
    /// `browser`); nil follows the bot's Works on (src/lib/place.ts).
    public var surface: String? = nil

    /// The time the thread list sorts and stamps by.
    public var listStamp: Double { updatedAt ?? createdAt }

    /// The thread list's quiet second line, worded as the desktop words it.
    public var openedByLabel: String? {
        openedBy.map { "opened by \($0.name)" }
    }

    /// A bot closed this thread and nothing has happened there since.
    public var isClosed: Bool { closedBy != nil }

    /// Archived means the field is present, not nonzero: the task API
    /// accepts any epoch number, so a thread persisted with
    /// archivedAt: 0 is archived.
    public var isArchived: Bool { archivedAt != nil }

    /// Working is activity or flag: the wire can carry either alone, so the
    /// archive action's busy gate and the working status ask the same
    /// question. A run counts as work here exactly as its row already
    /// labels it Working.
    public var isWorking: Bool { activity == "working" || activity == "running" || busy == true }

    /// The one line under a title: who closed it once a bot has, "Archived"
    /// once the person put it away, "Snoozed" while it sleeps, otherwise who
    /// opened it, otherwise nothing. Closed wins because it is the newer
    /// fact; archived and snoozed win over the opener because they explain
    /// why the row sits where it does.
    public var bylineLabel: String? {
        if let closedBy { return "closed by \(closedBy.name)" }
        if isArchived { return "Archived" }
        if isSnoozed() { return "Snoozed" }
        return openedByLabel
    }

    /// Snoozed means asleep right now: 0 is the "until new activity"
    /// sentinel and sleeps until woken, while a timestamp sleeps only until
    /// it passes. The server drops expired snoozes from snapshots, but a
    /// live event never refreshes one, so the clock is checked too.
    public func isSnoozed(now: Date = Date()) -> Bool {
        guard let until = snoozedUntil else { return false }
        return until == 0 || until > now.timeIntervalSince1970 * 1_000
    }

    /// Waiting on a dispatched teammate: the thread's own turn is done and
    /// a teammate has not settled. Flag-only, matching Android: the live
    /// #1228 wire paints busy, working, and this flag together during a
    /// coordination wait, so the flag alone decides — a quiet wait, never
    /// the work spinner.
    public var isWaitingOnTeammate: Bool { waitingOnTeammate == true }

    /// Whether the row must stay in the list regardless of closed state:
    /// it is working, waiting on someone, has something they have not read,
    /// or is holding a queued send. Queued is client state the harness
    /// reports out-of-band, so it arrives as an input rather than living on
    /// the wire-decoded task.
    public func demandsAttention(queued: Bool = false) -> Bool {
        if isWorking || isWaitingOnTeammate || unread == true { return true }
        if queued { return true }
        switch activity {
        case "waiting-on-you", "waiting", "queued": return true
        default: return false
        }
    }
}

/// The snooze presets the desktop offers, computed in the person's local
/// time on purpose: it is their evening and their morning; the server
/// stores the absolute moment either way.
public enum ThreadSnoozePreset {
    /// The next local 6 PM — "later today", rolling to tomorrow evening
    /// once tonight's is already past.
    public static func tonight(now: Date = Date(), calendar: Calendar = .current) -> Double {
        var when = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now) ?? now
        if when <= now { when = calendar.date(byAdding: .day, value: 1, to: when) ?? when }
        return when.timeIntervalSince1970 * 1_000
    }

    /// Tomorrow morning at 9 local: a clean overnight break.
    public static func tomorrowMorning(now: Date = Date(), calendar: Calendar = .current) -> Double {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        let when = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        return when.timeIntervalSince1970 * 1_000
    }
}

/// A message the harness is holding until the running turn settles. The
/// phone's copy of a server-owned queue entry, identified by the harness's
/// queueId and never by its text.
public struct QueuedSend: Codable, Hashable, Identifiable, Sendable {
    public var queueId: String
    public var text: String
    /// Why the harness held it. "capacity" is the known value; anything else
    /// parses and is shown as a plain queued line.
    public var reason: String?

    public var id: String { queueId }

    public init(queueId: String, text: String, reason: String? = nil) {
        self.queueId = queueId
        self.text = text
        self.reason = reason
    }

    /// The composer text after this held send is pulled back for editing.
    /// Its words lead — they were written first — and anything already typed
    /// stays below them after a blank line, so an edit never drops a draft.
    public func editDraft(keeping draft: String) -> String {
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
        return "\(text)\n\n\(draft)"
    }
}

public struct Bot: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var threadId: String
    /// The bot's main thread (`WireBot.mainThreadId`): where a bot-to-bot
    /// line is drawn. Absent on an older computer; the selected thread is
    /// the fallback, as on the desktop.
    public var mainThreadId: String? = nil
    public var name: String
    public var title: String
    public var description: String
    public var notifications: Bool
    public var color: String
    /// An app-owned `/api/attachments/:name` URL. The URL is intentionally
    /// relative so every paired device fetches it from its own computer.
    public var avatarUrl: String?
    /// `mascot` draws the mascot itself — its gradient body with the bot's
    /// live face on top. The rest crop `avatarUrl` and replace the mascot
    /// entirely, and the value names the mask. See `shared/bot-avatar.ts`.
    public var avatarCrop: AvatarCrop?
    public var unread: Bool
    public var modelSelection: ModelSelection
    public var createdAt: Double
    /// Backup models for this bot (`Bot.fallback`): tried in order, only
    /// when Automatic recovery is on and the provider proves a request
    /// never started. At most five, one per engine.
    public var fallback: [ModelSelection]?
    /// Sending on the person's behalf (`shared/outbound.ts`); missing is
    /// the default: ask every time, 25 a day when allowed.
    public var outbound: OutboundPolicy?
    public var busy: Bool?
    /// What the bot is doing on its current thread: "working",
    /// "waiting-on-you", "idle", "no-signal" or "dead". Transient on the
    /// computer, and older computers omit it; a thread's own `activity`
    /// outranks it.
    public var activity: String?
    /// A dispatched teammate has not settled yet; the bot itself is waiting
    /// on it rather than working (#1223). Carries the active thread's wait;
    /// per-thread waits live on the task.
    public var waitingOnTeammate: Bool?
    public var pinned: Bool?
    public var hidden: Bool?
    /// Desktop sidebar section. Missing or blank means the built-in Bots area.
    public var section: String?
    public var chiefOfStaff: Bool?
    /// ask, auto, full, or custom. Missing on older harnesses; autoApprove
    /// remains the compatibility mirror for older companion builds.
    public var approvalMode: String?
    /// 2026-10-28: the bot's own level as its owner chose it, never a
    /// conversation's (`WireBot.approvalSetting`). Nil on older servers.
    public var approvalSetting: String? = nil
    /// The bot's proactive mode (`ProactiveMode`); nil reads as the default.
    public var proactiveMode: String? = nil
    /// The level the open conversation really runs at, with why, when it is
    /// not `approvalSetting` (`WireBot.approvalApplied`).
    public var approvalApplied: AppliedApprovalLevel? = nil
    public var autoApprove: Bool?
    public var alwaysAllow: [String]?
    /// People and bots this bot writes to without a card (`allowedRecipients`).
    /// Absent on an older computer: nobody is on the list.
    public var allowedRecipients: [String]? = nil
    public var computer: String?
    /// Which cloud computer backs `computer == "cloud"`. Absent (older
    /// harnesses included) means the hosted Boat; "vps" means the user's own
    /// server, which has no interactive desktop to offer a phone.
    public var cloudBackend: String?
    public var speakReplies: Bool?
    /// #1329: the person's "do not finish until" sentence. Absent = off.
    public var finishUntil: String? = nil
    /// #1329: relaunches Sagax starts on its own while `finishUntil` is not
    /// met. Absent = `FinishUntilLine.defaultRounds`.
    public var finishUntilMaxRounds: Int? = nil
    public var voice: String?
    /// The server's mirror of the active task's pinned message. Read
    /// `pinnedMessageIdForShownThread`, which prefers the task's own pin.
    public var pinnedMessageId: String? = nil
    public var mascotExpression: String?
    /// Which body from the mascot body catalog this bot wears. Absent (an
    /// older harness included) means the shipped `cursor` silhouette.
    public var mascotBody: String?
    public var tasks: [BotTask]?
    /// Bot-to-bot conversations waiting on the person: never listed, their
    /// cards join the open conversation (WireBot.waitingApprovals).
    public var waitingApprovals: [BotWaitingApproval]? = nil
    public var projects: [BotProject]?
    public var messages: [Message]?
    public var activeLeafId: String?
    /// Paged responses only: there is more transcript above what you got.
    public var hasMore: Bool?
    /// Which Sagax character stands for the bot (owl, shape or Trombi) and
    /// its look. Absent or malformed means the owl; see `MascotLook`.
    public var mascotLook: MascotLook?
    /// The owl's special edition. Absent or unknown means `none`.
    public var mascotSkin: MascotSkin?
    /// The uploaded picture's framing inside its crop: zoom 1...3 and the
    /// focus point 0...1. Read them through `framing`, which clamps.
    public var avatarZoom: Double?
    public var avatarFocusX: Double?
    public var avatarFocusY: Double?
    /// The first line of the bot's standing instructions, for search
    /// subtitles. Older servers omit it.
    public var instructionsLead: String?
    /// Whether the bot may send spoken notes; on unless false.
    public var voiceNotes: Bool? = nil
    /// Who owns the bot (organization servers). Absent or "local-owner" is
    /// the computer's own person.
    public var ownerUserId: String? = nil
    /// Sections a Primary Bot manages beyond its own (owner-approved).
    public var managedSections: [String]? = nil
    // The advanced panel's reads (WP16, BA5, BA6, BA14, BA15). Absent on an
    // older computer, and each means the desktop's default.
    /// The working folder; absent is the private bot folder.
    public var cwd: String? = nil
    /// The bot's own built-in browser switch; absent means on.
    public var browser: Bool? = nil
    /// The MCP servers it mounts; absent means every enabled one.
    public var mcpServers: [String]? = nil
    /// Memory on; absent means on.
    public var memoryEnabled: Bool? = nil
    /// Memory upkeep on; absent means on.
    public var memoryUpkeep: Bool? = nil
    /// Who can see it on a served workspace; absent is everyone.
    public var visibility: BotVisibility? = nil
    /// Its grants on an organization server (slice 4), and the older
    /// person-only list.
    public var grants: [BotGrantRecord]? = nil
    public var directGrants: [String]? = nil
    /// Ask before contacting other bots (Permissions); absent is off.
    public var approvePeerComms: Bool? = nil
    /// Bot-to-bot conversations this viewer may read, both ends (`shared/wire.ts`
    /// WireBotConversation). Absent: none. Read only; see `BotConversations`.
    public var botConversations: [BotConversation]? = nil
    /// #1137, organization server: who pays for this bot's replies
    /// ("owner" or "speaker"); absent is the default `turnPayerDefault`,
    /// which only an organization server sends.
    public var turnPayer: String? = nil
    public var turnPayerDefault: String? = nil

    /// #1137: who pays now (its own choice, else the default), or nil on a
    /// solo server.
    public var effectiveTurnPayer: String? {
        guard let fallback = turnPayerDefault else { return nil }
        return turnPayer ?? fallback
    }

    /// The look the renderers draw: the stored one, or the owl.
    public var resolvedMascotLook: CompleteMascotLook {
        (mascotLook ?? .owl).complete
    }

    /// The owl's skin, `none` when absent.
    public var resolvedMascotSkin: MascotSkin { mascotSkin ?? .none }

    /// The picture's framing, clamped the way the desktop clamps it.
    public var framing: (zoom: Double, focusX: Double, focusY: Double) {
        (AvatarFraming.clampZoom(avatarZoom), AvatarFraming.clampFocus(avatarFocusX), AvatarFraming.clampFocus(avatarFocusY))
    }

    /// Routine runs' executions and automatic results threads are hidden.
    public var visibleTasks: [BotTask] {
        (tasks ?? []).filter { !$0.isHiddenFromPerson }
    }

    /// Older computers only send the profile default. Newer ones snapshot
    /// each thread's model independently, including the thread open here.
    public var currentTaskModelSelection: ModelSelection {
        tasks?.first { $0.threadId == threadId }?.modelSelection ?? modelSelection
    }

    public var currentTaskBusy: Bool? {
        tasks?.first { $0.threadId == threadId }?.busy ?? busy
    }

    /// A view snapshot, never a replacement for the shared profile record.
    /// The selected thread stays local even when another client navigates.
    public func projected(forThread selectedThreadId: String) -> Bot? {
        let task = tasks?.first { $0.threadId == selectedThreadId }
        guard task != nil || selectedThreadId == threadId else { return nil }
        var view = self
        view.threadId = selectedThreadId
        view.modelSelection = task?.modelSelection ?? modelSelection
        view.busy = task?.busy ?? (selectedThreadId == threadId ? busy : false)
        view.activity = task?.activity ?? (selectedThreadId == threadId ? activity : nil)
        view.waitingOnTeammate = task?.waitingOnTeammate ?? (selectedThreadId == threadId ? waitingOnTeammate : false)
        view.unread = task?.unread ?? (selectedThreadId == threadId ? unread : false)
        view.approvalMode = task?.approvalMode ?? task?.autoApprove.map { $0 ? "auto" : "ask" } ?? approvalMode
        view.autoApprove = task?.autoApprove ?? autoApprove
        view.alwaysAllow = task?.alwaysAllow ?? alwaysAllow
        if selectedThreadId != threadId {
            // the server judged the open conversation only
            view.approvalApplied = nil
            view.messages = nil
            view.activeLeafId = nil
            view.hasMore = nil
        }
        return view
    }
}

public enum AvatarCrop: String, Codable, CaseIterable, Hashable, Sendable {
    case mascot, circle, rounded, square

    /// The desktop may gain crop modes before this app updates. Falling back
    /// keeps the complete bot/fleet payload decodable and guarantees a safe,
    /// deterministic identity image instead of dropping the agent.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? .mascot
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// The "who" section of a bot overview: identity and its soul in one line.
public struct BotOverviewWho: Codable, Hashable, Sendable {
    public var name: String
    public var title: String
    public var blurb: String
    public var soulLead: String
}

public struct BotOverviewRecent: Codable, Hashable, Sendable {
    /// epoch milliseconds, like every other timestamp on the wire
    public var at: Double
    public var summary: String
}

/// One service's connector tool grants, summarized for read-only display.
/// Levels mirror the web grant editor: all tools, an exact list of
/// `toolCount` tools, or no tools.
public struct BotOverviewGrant: Codable, Hashable, Sendable {
    public enum Level: String, Codable, Hashable, Sendable {
        case all
        case partial
        case none

        /// The server may add levels before this app updates. Falling back
        /// to partial keeps the row honest ("some tools") without costing
        /// the reader the whole overview.
        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: raw) ?? .partial
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encode(rawValue)
        }
    }

    public var slug: String
    public var level: Level
    /// Granted tool count; 0 unless level is partial.
    public var toolCount: Int

    public init(slug: String, level: Level, toolCount: Int) {
        self.slug = slug
        self.level = level
        self.toolCount = toolCount
    }
}

/// A read-only summary of one bot: who it is, what it does, what it can
/// reach, what it won't do, and its recent activity. No settings and no
/// transcript — this is the shape a phone is allowed to poll for.
public struct BotOverview: Codable, Hashable, Sendable {
    public var who: BotOverviewWho
    public var does: [String]
    public var reaches: [String]
    public var wont: [String]
    public var recent: [BotOverviewRecent]
    /// Per-service connector tool grants, when the bot carries a grants
    /// record. Older computers omit the key entirely (legacy all-tools
    /// behavior); an empty list is an explicit no-tools record.
    public var grants: [BotOverviewGrant]?
    /// The setup checklist (`setup`, newer servers): what the bot panel's
    /// Suggestions card offers to finish.
    public var setup: [BotSetupStep]? = nil

    private enum CodingKeys: String, CodingKey {
        case who, does, reaches, wont, recent, grants, setup
    }

    public init(
        who: BotOverviewWho,
        does: [String],
        reaches: [String],
        wont: [String],
        recent: [BotOverviewRecent],
        grants: [BotOverviewGrant]? = nil
    ) {
        self.who = who
        self.does = does
        self.reaches = reaches
        self.wont = wont
        self.recent = recent
        self.grants = grants
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        who = try container.decode(BotOverviewWho.self, forKey: .who)
        does = try container.decode([String].self, forKey: .does)
        reaches = try container.decode([String].self, forKey: .reaches)
        wont = try container.decode([String].self, forKey: .wont)
        recent = try container.decode([BotOverviewRecent].self, forKey: .recent)
        // One malformed entry must not cost the whole overview; a shape
        // this build cannot read is dropped, like elsewhere in the fleet.
        // If every entry is unreadable, though, the grants field stays
        // absent rather than claiming the bot deliberately grants nothing.
        if let list = try? container.decodeIfPresent([Lossy<BotOverviewGrant>].self, forKey: .grants) {
            let readable = list.compactMap(\.value)
            grants = readable.isEmpty && !list.isEmpty ? nil : readable
        } else {
            grants = nil
        }
        setup = (try? container.decodeIfPresent([Lossy<BotSetupStep>].self, forKey: .setup))?.compactMap(\.value)
    }
}

public struct GroupResponder: Codable, Hashable, Sendable {
    public var kind: String
    public var botId: String?
    /// An Auto room's fallback: the lead it had (`GroupDefaultResponder`).
    public var fallbackBotId: String?
}

public struct Room: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var threadId: String
    public var name: String
    public var memberIds: [String]
    public var defaultResponder: GroupResponder
    public var bulletin: String
    public var unread: Bool
    public var createdAt: Double
    public var dm: Bool?
    /// Desktop sidebar section. Missing or blank means the built-in Channels area.
    public var section: String?
    public var busyBotId: String?
    /// Independent user conversations in this channel. Bot-to-bot rooms
    /// omit tasks because their transcript is the canonical private chat.
    public var tasks: [BotTask]?
    public var messages: [Message]?
    public var hasMore: Bool?
    /// Pinned to the home row. Older servers have no group pins and omit it.
    public var pinned: Bool?
    /// People in this room, beside the bots. Absent on a bot-to-bot room.
    public var humanIds: [String]? = nil
    /// Compatibility mirror of the active task's pinned message.
    public var pinnedMessageId: String? = nil
    /// Organization server: the principal who created the room.
    public var createdBy: String? = nil
    /// Organization server: who owns the room's settings; nil when its
    /// organization admins do, absent on a solo server.
    public var ownerId: String? = nil
    /// Organization server: a direct conversation between two people.
    public var peopleDm: Bool? = nil
    /// The narrowest audience the room ever had (a served workspace): it
    /// never widens on its own (server/bot-visibility.ts).
    public var audienceFloor: BotVisibility? = nil
    /// The room's shared memory; absent means on.
    public var memoryEnabled: Bool? = nil
    /// When the busy member's turn started.
    public var turnStartedAt: Double? = nil
    /// True while any member is mid-turn (computed by the server).
    public var working: Bool? = nil
    public var setupCompletedAt: Double? = nil
    public var setupSkippedAt: Double? = nil
    /// The room's working folder (`cwd`): where every member's shell and
    /// file tools run. Absent is each bot's own folder.
    public var cwd: String? = nil
    /// The folder the room pinned on its first turn; once set, the working
    /// folder no longer changes for that thread.
    public var pinnedCwd: String? = nil
    /// A direct conversation's own turn limit, minutes (#216); nil follows
    /// the server's default.
    public var turnTimeoutMinutes: Int? = nil
}

// MARK: - Responses

struct Lossy<Element: Decodable>: Decodable {
    let value: Element?

    init(from decoder: Decoder) throws {
        value = try? Element(from: decoder)
    }
}

public struct Fleet: Decodable, Sendable {
    public var bots: [Bot]
    public var groups: [Room]
    /// Held sends for every bot thread, the same snapshot the
    /// bot.queued frames carry. Older computers omit it.
    public var botQueuedMessages: [String: [QueuedSend]]?
    /// The sidebar sections in the server's order (`store.sections`), the
    /// order the desktop shows them in. Older computers omit it.
    public var sections: [String]?

    private enum CodingKeys: String, CodingKey { case bots, groups, botQueuedMessages, sections }

    public init(bots: [Bot], groups: [Room], botQueuedMessages: [String: [QueuedSend]]? = nil, sections: [String]? = nil) {
        self.bots = bots
        self.groups = groups
        self.botQueuedMessages = botQueuedMessages
        self.sections = sections
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bots = try container.decodeIfPresent([Lossy<Bot>].self, forKey: .bots)?.compactMap(\.value) ?? []
        groups = try container.decodeIfPresent([Lossy<Room>].self, forKey: .groups)?.compactMap(\.value) ?? []
        // One malformed entry must not cost the whole fleet: the roster is
        // worth more than the queue note beside it.
        botQueuedMessages = (try? container.decodeIfPresent(
            [String: [Lossy<QueuedSend>]].self,
            forKey: .botQueuedMessages
        ))??.mapValues { list in list.compactMap(\.value) }
        sections = (try? container.decodeIfPresent([String].self, forKey: .sections)) ?? nil
    }
}

public struct ThreadPage: Codable, Sendable {
    public var messages: [Message]
    public var hasMore: Bool?
    public var activeLeafId: String?
}

public struct SearchHit: Codable, Hashable, Identifiable, Sendable {
    public var threadId: String
    public var messageId: String
    public var at: Double
    public var role: Message.Role
    public var kind: Message.Kind
    public var snippet: String
    public var matchStart: Int
    public var matchLength: Int
    public var botId: String?
    public var groupId: String?
    public var name: String
    public var task: String?
    public var onActivePath: Bool

    public var id: String { "\(threadId):\(messageId)" }
}

public struct TranscriptExport: Sendable {
    public var data: Data
    public var filename: String
    public var contentType: String

    public init(data: Data, filename: String, contentType: String) {
        self.data = data
        self.filename = filename
        self.contentType = contentType
    }
}

public struct PairedDevice: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var createdAt: Double
    public var lastSeenAt: Double
}

public struct PairResponse: Codable, Sendable {
    public var token: String
    public var device: PairedDevice
    /// What the computer calls itself — worth showing so someone with two
    /// paired machines can tell them apart.
    public var serverName: String
    /// Every address the computer answers on, best first. Stored with the
    /// connection so the app can walk to the next one when the address it
    /// paired on stops resolving. Absent from older sidecars.
    public var hosts: [String]?
    /// Full HTTPS/HTTP routes from newer sidecars. Absent during a staggered
    /// rollout; `hosts` remains the compatibility path for older builds.
    public var endpoints: [CompanionEndpoint]?

    private enum CodingKeys: String, CodingKey {
        case token, device, serverName, hosts, endpoints
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        token = try container.decode(String.self, forKey: .token)
        device = try container.decode(PairedDevice.self, forKey: .device)
        serverName = try container.decode(String.self, forKey: .serverName)
        hosts = try container.decodeIfPresent([String].self, forKey: .hosts)
        if container.contains(.endpoints) {
            // These routes are advisory and the credential may already have
            // been redeemed. One malformed or future-kind entry must not
            // discard the valid token and legacy host fallback with it.
            endpoints = (try? container.decode([Lossy<CompanionEndpoint>].self, forKey: .endpoints))?
                .compactMap(\.value) ?? []
        } else {
            endpoints = nil
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(token, forKey: .token)
        try container.encode(device, forKey: .device)
        try container.encode(serverName, forKey: .serverName)
        try container.encodeIfPresent(hosts, forKey: .hosts)
        try container.encodeIfPresent(endpoints, forKey: .endpoints)
    }
}

/// The authenticated, refreshable connection identity advertised by the
/// companion sidecar at `GET /api/companion/endpoints`.
///
/// This intentionally mirrors only the non-secret routing subset of a pair
/// response. Existing paired phones can learn that hosted access was enabled
/// later without minting another device token or scanning another QR code.
public struct CompanionConnectionMetadata: Decodable, Sendable {
    public var serverName: String
    public var hosts: [String]?
    public var endpoints: [CompanionEndpoint]

    private enum CodingKeys: String, CodingKey { case serverName, hosts, endpoints }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        serverName = try container.decode(String.self, forKey: .serverName)
        hosts = try container.decodeIfPresent([String].self, forKey: .hosts)

        // Endpoint metadata is a replacement snapshot, not an optional hint.
        // Keep a future malformed kind from discarding valid routes beside it,
        // but reject a response with no usable route so the caller retains its
        // last known-good snapshot.
        let decoded = try container.decode([Lossy<CompanionEndpoint>].self, forKey: .endpoints)
            .compactMap(\.value)
        let stable = decoded.enumerated().sorted {
            $0.element.priority == $1.element.priority
                ? $0.offset < $1.offset
                : $0.element.priority < $1.element.priority
        }.map(\.element)
        var seen = Set<String>()
        endpoints = stable.filter { seen.insert($0.url).inserted }.prefix(8).map { $0 }
        guard !endpoints.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .endpoints,
                in: container,
                debugDescription: "Companion endpoint metadata must contain at least one valid route."
            )
        }
    }
}

/// A freshly minted provider viewer. It is deliberately not Codable for
/// persistence: the URL is a short-lived bearer credential and belongs only
/// in memory for the browser session that requested it.
public struct CloudDesktopSession: Decodable, Sendable {
    public let url: URL

    private enum CodingKeys: String, CodingKey { case joinUrl }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try container.decode(String.self, forKey: .joinUrl)
        guard let parsed = URL(string: raw),
              parsed.scheme?.lowercased() == "https",
              parsed.host != nil
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .joinUrl,
                in: container,
                debugDescription: "Cloud desktop URL must be HTTPS"
            )
        }
        url = parsed
    }
}

public struct ProviderSnapshot: Codable, Hashable, Sendable {
    public var state: String
    public var reason: String?
    public var authenticated: Bool?
    public var version: String?
    /// "metered" or "subscription": how a cost figure is captioned.
    public var billing: String? = nil
    /// A ChatGPT plan sign-in: its model list arrives only after sign-in.
    public var chatgptPlan: Bool? = nil
    /// A newer engine version unlocks capabilities (the installed one stays usable).
    public var update: EngineUpdateNotice? = nil

    public var isAvailable: Bool { state == "available" }
}

/// `snapshot.update`: what a newer engine version brings, and the command
/// that installs it.
public struct EngineUpdateNotice: Codable, Hashable, Sendable {
    public var title: String
    public var message: String
    public var command: String

    public init(title: String, message: String, command: String) {
        self.title = title
        self.message = message
        self.command = command
    }
}

public struct ModelOption: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String
    /// The reasoning variants this model offers, on an engine with
    /// `capabilities.modelVariants`.
    public var variants: [ModelVariantOption]? = nil
    /// A model added by hand (a local server's), not the engine's catalogue.
    public var custom: Bool? = nil
    /// A model on this machine (the picker's Local group, #261).
    public var local: Bool? = nil
    /// A local model already loaded: listed first.
    public var loaded: Bool? = nil
    /// The reasoning levels this model takes (`ModelEffort`); empty: none.
    public var effortLevels: [String]? = nil
    /// The level the engine runs it at when none is sent.
    public var defaultEffort: String? = nil
    /// Only when two servers of one computer expose the same model name: the
    /// server's label, a quiet sub-line. `label` is the model name alone,
    /// never "host:port: name" (2026-10-26).
    public var server: String? = nil
    /// A model on another person's computer: that person's display name.
    public var sharedBy: String? = nil

    /// The quiet second line under the name: "Shared by <Name>" when another
    /// person's computer serves it, then the server when a name is duplicated.
    /// The name itself is never prefixed or cut.
    public var subtext: String? {
        let name = sharedBy?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let host = server?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let parts = [name.isEmpty ? "" : String(localized: "Shared by \(name)"), host].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// One reasoning variant of a model (`shared/runtime-events.ts`).
public struct ModelVariantOption: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

public struct ModelCatalog: Codable, Hashable, Sendable {
    public var `default`: String
    public var options: [ModelOption]
}

/// The small, phone-safe part of an engine's capabilities needed by bot
/// settings. Missing capabilities or effort levels mean the engine does not
/// offer a reasoning control.
public struct InstanceCapabilities: Codable, Hashable, Sendable {
    public var effortLevels: [String]?
    /// The engine takes a model-specific variant instead of an effort level.
    public var modelVariants: Bool? = nil
    /// The engine can drive the built-in browser (Works on: Browser).
    public var browserMcp: Bool? = nil

    public init(effortLevels: [String]? = nil, modelVariants: Bool? = nil, browserMcp: Bool? = nil) {
        self.effortLevels = effortLevels
        self.modelVariants = modelVariants
        self.browserMcp = browserMcp
    }
}

public struct Instance: Codable, Hashable, Identifiable, Sendable {
    public var instanceId: String
    public var driverKind: String
    public var displayName: String?
    public var snapshot: ProviderSnapshot
    public var models: ModelCatalog
    public var capabilities: InstanceCapabilities? = nil
    /// "subscription" (a sign-in plan), "api" (a pasted key) or "custom"
    /// (a local engine with no catalogue); nil reads as a sign-in plan.
    public var access: String? = nil

    public var id: String { instanceId }
}

public struct InstanceList: Codable, Sendable {
    public var instances: [Instance]
}

/// Which engine actually speaks — `VoiceProvider` in `server/tts/index.ts`.
/// Derived from `ConfigFlag.provider`, never decoded straight off the wire.
public enum VoiceProvider: Hashable, Sendable {
    case elevenlabs
    case fish
    case system
    case chatterbox
    /// Grok's voices (xAI), on a computer that offers them.
    case xai

    /// The exact string the config write carries. The server matches
    /// spellings, not meanings, so neither does this.
    public var wireValue: String {
        switch self {
        case .elevenlabs: "elevenlabs"
        case .fish: "fish"
        case .system: "system"
        case .chatterbox: "chatterbox"
        case .xai: "xai"
        }
    }
}

public struct ConfigFlag: Codable, Hashable, Sendable {
    public var configured: Bool
    public var apiKeyConfigured: Bool?
    public var ready: Bool?
    public var voice: String?
    /// The voice engine, absent on a computer that predates the choice. Read
    /// it through `ConfigStatus.voiceProvider`, which applies the server's own
    /// fallback; nothing should compare this string directly.
    public var provider: String?
    /// Chatterbox's credential is an address, not a key. `describeVoice`
    /// sends it and the model id empty under every other engine — and an
    /// older computer omits them — so both read as "not set".
    public var baseUrl: String?
    public var model: String?
}

public struct Profile: Codable, Hashable, Sendable {
    public var name: String
    public var email: String
}

/// The person behind this session, as `GET /api/config` names them.
public struct ConfigViewer: Codable, Hashable, Sendable {
    public var principalId: String?
    public var role: String?
    /// The administrator lets this person use shared bots only.
    public var botsReadOnly: Bool?
    /// Whether this person may make bots; absent on an older server (yes).
    public var canCreateBots: Bool?
    /// Organization server (2026-10-09): the permission keys this person
    /// holds (shared/permissions.ts), every key for an admin. Absent on an
    /// older server: a member then holds the member defaults (`viewerCan`).
    public var permissions: [String]?
    /// The operator at the server's own computer (`viewer.operator`).
    public var isOperator: Bool?

    public init(principalId: String? = nil, role: String? = nil, botsReadOnly: Bool? = nil, canCreateBots: Bool? = nil,
                permissions: [String]? = nil, isOperator: Bool? = nil) {
        self.principalId = principalId
        self.role = role
        self.botsReadOnly = botsReadOnly
        self.canCreateBots = canCreateBots
        self.permissions = permissions
        self.isOperator = isOperator
    }

    private enum CodingKeys: String, CodingKey {
        case principalId, role, botsReadOnly, canCreateBots, permissions
        case isOperator = "operator"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        principalId = try? c.decodeIfPresent(String.self, forKey: .principalId)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        botsReadOnly = try? c.decodeIfPresent(Bool.self, forKey: .botsReadOnly)
        canCreateBots = try? c.decodeIfPresent(Bool.self, forKey: .canCreateBots)
        // An odd value reads as no list (the member defaults), never as a
        // failed config.
        permissions = try? c.decodeIfPresent([String].self, forKey: .permissions)
        isOperator = try? c.decodeIfPresent(Bool.self, forKey: .isOperator)
    }
}

public struct ConfigDecider: Codable, Hashable, Sendable {
    public struct Jobs: Codable, Hashable, Sendable {
        public var roomRouting: Bool?
    }
    public var enabled: Bool?
    public var jobs: Jobs?
}

/// The experimental switches the panel reads (`src/lib/feature-flags.ts`).
/// Each one decodes on its own: an unknown or odd value is simply off.
public struct ServerFeatures: Codable, Hashable, Sendable {
    public var browser: Bool?
    public var templates: Bool?
    public var vpsComputer: Bool?
    public var boatComputer: Bool?

    public init(browser: Bool? = nil, templates: Bool? = nil, vpsComputer: Bool? = nil, boatComputer: Bool? = nil) {
        self.browser = browser
        self.templates = templates
        self.vpsComputer = vpsComputer
        self.boatComputer = boatComputer
    }

    private enum CodingKeys: String, CodingKey { case browser, templates, vpsComputer, boatComputer }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        browser = try? c.decodeIfPresent(Bool.self, forKey: .browser)
        templates = try? c.decodeIfPresent(Bool.self, forKey: .templates)
        vpsComputer = try? c.decodeIfPresent(Bool.self, forKey: .vpsComputer)
        boatComputer = try? c.decodeIfPresent(Bool.self, forKey: .boatComputer)
    }
}

/// `browserEngine` in the config: "engine" when the server has one.
public struct BrowserEngineStatus: Codable, Hashable, Sendable {
    public var kind: String?
    public var reason: String?
    public var installable: Bool?

    public init(kind: String? = nil, reason: String? = nil, installable: Bool? = nil) {
        self.kind = kind
        self.reason = reason
        self.installable = installable
    }

    private enum CodingKeys: String, CodingKey { case kind, reason, installable }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        installable = try? c.decodeIfPresent(Bool.self, forKey: .installable)
    }
}

public struct ConfigStatus: Codable, Sendable {
    public var box: ConfigFlag?
    public var tts: ConfigFlag?
    public var imageGen: ConfigFlag?
    public var profile: Profile?
    /// Who is asking (`ConfigStatus.viewer` in shared/wire.ts). Absent on
    /// older computers.
    public var viewer: ConfigViewer? = nil
    /// The decision model (Jev) and its jobs; a room in Auto routes with it
    /// only while `roomRouting` is on (`jevRoomRoutingOn`).
    public var decider: ConfigDecider? = nil
    /// Settings > Experimental features (`FeatureFlagConfig.features`).
    public var features: ServerFeatures? = nil
    /// Whether this server can give a bot a browser (`browserEngine`).
    public var browserEngine: BrowserEngineStatus? = nil
    /// An OMB Cloud home: no "this computer" and no Local VM.
    public var cloudHome: Bool? = nil
    /// Organization server: the engines its admin allows in Perspicax
    /// (#261); nil or empty means every engine.
    public var allowedEngines: [String]? = nil
    /// Stable <instance>/<model> ids, off at organization then person level.
    public var disabledModels: [String]? = nil
    public var myDisabledModels: [String]? = nil

    /// `jevRoomRoutingOn`: an Auto room with Jev off answers like a lead room.
    public var jevRoomRoutingOn: Bool {
        decider?.enabled == true && decider?.jobs?.roomRouting == true
    }

    /// Whether synthesis is available on the paired computer. Deliberately
    /// provider-neutral: under ElevenLabs this is a key on file, while under
    /// the built-in engine `providerConfigured` in `server/tts/index.ts`
    /// reports whether the computer has voices it can use and no credential
    /// exists at all. Only the reason behind the flag changes — so anything
    /// that *explains* a false here has to ask `voiceProvider` first.
    /// Either way the credential itself never appears in this response.
    public var isTTSConfigured: Bool {
        tts?.configured == true || tts?.apiKeyConfigured == true
    }

    /// An empty voice means there is no workspace fallback. Clients must not
    /// present that state as a usable "Workspace default" choice.
    public var hasWorkspaceDefaultVoice: Bool {
        !(tts?.voice?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }

    public func canSpeak(agentVoice: String?) -> Bool {
        let hasAgentVoice = !(agentVoice?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        return isTTSConfigured && (hasAgentVoice || hasWorkspaceDefaultVoice)
    }

    /// `voiceProvider(cfg)` in `server/tts/index.ts`: only the exact
    /// strings `"fish"`, `"system"`, and `"chatterbox"` select those engines. A missing
    /// field — a computer older than the choice — and an engine this build
    /// has never heard of both fall back to ElevenLabs, which is the
    /// server's own rule and what keeps an unrecognised engine from being
    /// explained to the user with copy written for a different one.
    public var voiceProvider: VoiceProvider {
        switch tts?.provider {
        case "fish": .fish
        case "system": .system
        case "chatterbox": .chatterbox
        case "xai": .xai
        default: .elevenlabs
        }
    }

    /// Walkie synthesizes directly on the phone through its own ElevenLabs
    /// key. A voice chosen from another provider's catalog is not compatible.
    public func walkieAgentVoice(_ voice: String?) -> String? {
        voiceProvider == .elevenlabs ? voice : nil
    }
}

// MARK: - Agent profiles, voices, routines, and notifications

public struct BotProfilePatch: Encodable, Sendable {
    /// `nil` means "leave the field alone". Profile actions deliberately send
    /// only the fields they own so an avatar upload cannot overwrite identity
    /// or voice values that changed on another client while the sheet was open.
    public var name: String?
    public var title: String?
    public var description: String?
    public var notifications: Bool?
    public var avatarUrl: AvatarURL?
    public var avatarCrop: AvatarCrop?
    public var mascotBody: String?
    public var voice: String?
    public var speakReplies: Bool?
    /// #1329: one sentence; an empty string clears it.
    public var finishUntil: String?
    /// #1329: the relaunch bound; `.clear` goes back to the default.
    public var finishUntilMaxRounds: Rounds?
    /// One of the twelve `MausColors` names.
    public var color: String?
    public var mascotSkin: MascotSkin?
    public var mascotLook: MascotLook?
    public var mascotExpression: String?
    /// Sent as given; the server clamps zoom to 1...3 and focus to 0...1.
    public var avatarZoom: Double?
    public var avatarFocusX: Double?
    public var avatarFocusY: Double?

    /// `avatarUrl` needs three wire states: omitted, a stored path, or JSON
    /// null to clear. A nested optional would technically represent that, but
    /// makes call sites easy to get wrong (`nil` is ambiguous at a glance).
    public enum AvatarURL: Equatable, Sendable {
        case set(String)
        case clear
    }

    /// Same three wire states as `avatarUrl`: omitted, a number, or null.
    public enum Rounds: Equatable, Sendable {
        case set(Int)
        case clear
    }

    public init(
        name: String? = nil,
        title: String? = nil,
        description: String? = nil,
        notifications: Bool? = nil,
        avatarUrl: AvatarURL? = nil,
        avatarCrop: AvatarCrop? = nil,
        mascotBody: String? = nil,
        voice: String? = nil,
        speakReplies: Bool? = nil,
        color: String? = nil,
        mascotSkin: MascotSkin? = nil,
        mascotLook: MascotLook? = nil,
        mascotExpression: String? = nil,
        avatarZoom: Double? = nil,
        avatarFocusX: Double? = nil,
        avatarFocusY: Double? = nil,
        finishUntil: String? = nil,
        finishUntilMaxRounds: Rounds? = nil
    ) {
        self.name = name
        self.title = title
        self.description = description
        self.notifications = notifications
        self.avatarUrl = avatarUrl
        self.avatarCrop = avatarCrop
        self.mascotBody = mascotBody
        self.voice = voice
        self.speakReplies = speakReplies
        self.color = color
        self.mascotSkin = mascotSkin
        self.mascotLook = mascotLook
        self.mascotExpression = mascotExpression
        self.avatarZoom = avatarZoom
        self.avatarFocusX = avatarFocusX
        self.avatarFocusY = avatarFocusY
        self.finishUntil = finishUntil
        self.finishUntilMaxRounds = finishUntilMaxRounds
    }

    private enum CodingKeys: String, CodingKey {
        case name, title, description, notifications, avatarUrl, avatarCrop, mascotBody, voice, speakReplies
        case color, mascotSkin, mascotLook, mascotExpression, avatarZoom, avatarFocusX, avatarFocusY
        case finishUntil, finishUntilMaxRounds
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeIfPresent(name, forKey: .name)
        try values.encodeIfPresent(title, forKey: .title)
        try values.encodeIfPresent(description, forKey: .description)
        try values.encodeIfPresent(notifications, forKey: .notifications)
        if let avatarUrl {
            switch avatarUrl {
            case let .set(path): try values.encode(path, forKey: .avatarUrl)
            case .clear: try values.encodeNil(forKey: .avatarUrl)
            }
        }
        try values.encodeIfPresent(avatarCrop, forKey: .avatarCrop)
        try values.encodeIfPresent(mascotBody, forKey: .mascotBody)
        try values.encodeIfPresent(voice, forKey: .voice)
        try values.encodeIfPresent(speakReplies, forKey: .speakReplies)
        try values.encodeIfPresent(color, forKey: .color)
        try values.encodeIfPresent(mascotSkin, forKey: .mascotSkin)
        try values.encodeIfPresent(mascotLook, forKey: .mascotLook)
        try values.encodeIfPresent(mascotExpression, forKey: .mascotExpression)
        try values.encodeIfPresent(avatarZoom, forKey: .avatarZoom)
        try values.encodeIfPresent(avatarFocusX, forKey: .avatarFocusX)
        try values.encodeIfPresent(avatarFocusY, forKey: .avatarFocusY)
        try values.encodeIfPresent(finishUntil, forKey: .finishUntil)
        if let finishUntilMaxRounds {
            switch finishUntilMaxRounds {
            case let .set(rounds): try values.encode(rounds, forKey: .finishUntilMaxRounds)
            case .clear: try values.encodeNil(forKey: .finishUntilMaxRounds)
            }
        }
    }
}

public struct Voice: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var label: String
    public var description: String?
}

public struct RoutineSchedule: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case once, daily, interval
        /// A five-field cron expression, or several joined by "; " (one per
        /// minute of a day, 2026-10-29), in an explicit IANA zone
        /// (`shared/routine-schedule.ts`).
        case cron
        /// Starts when the routine's own webhook receives a delivery
        /// (`{ type: "webhook" }`, 2026-10-29: chosen in the editor).
        case webhook
        /// Starts when an email arrives (`{ type: "event", source: "email" }`).
        /// Kept as it is: the editor never makes one.
        case event
        /// A schedule introduced by a newer desktop. It remains visible but
        /// cannot be toggled or saved until the user chooses a supported kind.
        case unknown

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: raw) ?? .unknown
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            try container.encode(rawValue)
        }
    }
    public var type: Kind
    public var at: Double?
    public var time: String?
    public var weekdays: [Int]?
    public var everyMinutes: Int?
    public var anchorAt: Int64?
    /// `cron`: minute hour day-of-month month weekday.
    public var expression: String?
    /// `cron`: the IANA zone the expression is read in.
    public var timeZone: String?
    /// `interval`: the local wall-clock window runs happen in. Absent means
    /// all day. (`weekdays` restricts an interval to those days.)
    public var window: RoutineIntervalWindow? = nil
    /// `interval`: inclusive epoch-millisecond cutoff. Absent means never.
    public var endsAt: Int64? = nil
    /// Repeating schedules (`shared/routine-timing.ts`): absent or "exact"
    /// starts at the scheduled slot; "flexible" somewhere in
    /// [slot - windowEarlyMinutes, slot + windowLateMinutes].
    public var timing: String? = nil
    public var windowEarlyMinutes: Int? = nil
    public var windowLateMinutes: Int? = nil
    /// `event`: what starts it ("email").
    public var source: String? = nil

    /// Started by a webhook or an email, not by the clock.
    public var isTrigger: Bool { type == .webhook || type == .event }

    public init(
        type: Kind, at: Double? = nil, time: String? = nil, weekdays: [Int]? = nil,
        everyMinutes: Int? = nil, anchorAt: Int64? = nil, expression: String? = nil,
        timeZone: String? = nil, window: RoutineIntervalWindow? = nil, endsAt: Int64? = nil
    ) {
        self.type = type
        self.at = at
        self.time = time
        self.weekdays = weekdays
        self.everyMinutes = everyMinutes
        self.anchorAt = anchorAt
        self.expression = expression
        self.timeZone = timeZone
        self.window = window
        self.endsAt = endsAt
    }

    /// The same schedule with the interval restrictions an editor that does
    /// not show them must keep: days, window and end date. Only when both
    /// are intervals; changing the kind drops them, as on the desktop.
    public func keepingIntervalRestrictions(of original: RoutineSchedule) -> RoutineSchedule {
        guard type == .interval, original.type == .interval else { return self }
        var kept = self
        if kept.weekdays == nil { kept.weekdays = original.weekdays }
        if kept.window == nil { kept.window = original.window }
        if kept.endsAt == nil { kept.endsAt = original.endsAt }
        return kept
    }

    public static func cron(expression: String, timeZone: String) -> Self {
        .init(type: .cron, expression: expression, timeZone: timeZone)
    }

    /// How the reference shows a cron schedule: `CRON_TZ=<zone> <expression>`,
    /// or the bare expression when the zone is missing. Nil for other kinds.
    public var cronDisplay: String? {
        guard type == .cron, let expression, !expression.isEmpty else { return nil }
        guard let timeZone, !timeZone.isEmpty else { return expression }
        return "CRON_TZ=\(timeZone) \(expression)"
    }

    public static func once(at: Date) -> Self {
        .init(type: .once, at: at.timeIntervalSince1970 * 1_000, time: nil, weekdays: nil)
    }

    public static func daily(time: String, weekdays: [Int]) -> Self {
        .init(type: .daily, at: nil, time: time, weekdays: weekdays)
    }

    public static func interval(everyMinutes: Int, anchorAt: Date) -> Self {
        .init(
            type: .interval,
            at: nil,
            time: nil,
            weekdays: nil,
            everyMinutes: everyMinutes,
            anchorAt: Int64((anchorAt.timeIntervalSince1970 * 1_000).rounded())
        )
    }
}

/// `RoutineIntervalWindow` in `shared/routines.ts`: "HH:mm" local times.
public struct RoutineIntervalWindow: Codable, Hashable, Sendable {
    public var start: String
    public var end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

/// `RoutineContextAttachment` in `shared/routines.ts`.
public struct RoutineAttachment: Codable, Hashable, Sendable {
    public var id: String
    public var kind: String
    public var name: String
    public var path: String
    public var size: Int

    public init(id: String, kind: String, name: String, path: String, size: Int) {
        self.id = id
        self.kind = kind
        self.name = name
        self.path = path
        self.size = size
    }
}

/// `Routine.runAs` in `shared/routines.ts` (organization server).
public struct RoutineRunAs: Codable, Hashable, Sendable {
    public var principalId: String
    public var name: String
}

/// `Routine.suspended` in `shared/routines.ts` (organization server).
public struct RoutineSuspension: Codable, Hashable, Sendable {
    public var reason: String
    public var at: Double
}

/// Runs skipped while the person was away (`RoutineAwaySkips`).
/// Every field is optional so a partial object cannot drop the routine.
public struct RoutineAwaySkips: Codable, Hashable, Sendable {
    public var count: Int?
    public var firstAt: Double?
    public var lastAt: Double?
    /// Set once the person is back and the count was reported.
    public var reportedAt: Double?
}

public struct Routine: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var prompt: String
    public var botId: String
    public var runOn: String
    public var enabled: Bool
    public var schedule: RoutineSchedule
    public var durationMinutes: Int
    public var timeoutMinutes: Int?
    public var nextRunAt: Double?
    public var createdAt: Double
    public var updatedAt: Double
    /// "bot" or "room-goal". Absent on older computers (a bot routine).
    public var target: String? = nil
    public var groupId: String? = nil
    /// "skip" or "queue" when a run is still going at the next start.
    public var overlap: String? = nil
    public var skippedRuns: Int? = nil
    public var lastSkippedAt: Double? = nil
    public var failureStreak: Int? = nil
    /// Failed runs in a row that pause this routine (RoutineAutoPause).
    /// Absent: the default (5); 0 never pauses.
    public var autoPauseAfter: Int? = nil
    /// The routine paused itself after this many failures in a row.
    public var autoPaused: RoutineAutoPauseState? = nil
    public var attachments: [RoutineAttachment]? = nil
    public var sourceThreadId: String? = nil
    public var resultsThreadId: String? = nil
    public var runAs: RoutineRunAs? = nil
    public var suspended: RoutineSuspension? = nil
    // The scoped listing of an organization server (AU20, RoutineScope.swift).
    // Absent from a plain listing and from older servers.
    /// Whose routine it is (its bot's owner, or the person it runs as).
    public var owner: RoutineOwner? = nil
    public var teamIds: [String]? = nil
    public var bot: RoutineScopeChoice? = nil
    /// False outside the caller's own routines: no Run now.
    public var canRun: Bool? = nil
    /// False outside the caller's own routines: no Edit, Pause or Delete.
    public var canEdit: Bool? = nil
    /// Someone else's routine: no prompt, attachments or threads.
    public var redacted: Bool? = nil
    /// Skip scheduled runs while the person is away. Absent means it runs.
    public var onlyWhenPresent: Bool? = nil
    /// Post this routine's completed result in the conversation (2026-10-22).
    /// Absent inherits the installation default; a quiet run stays silent and
    /// questions, approvals and errors always reach the person.
    public var postResults: Bool? = nil
    /// Delete once the schedule ends and the last run settles (#1648).
    public var deleteWhenFinished: Bool? = nil
    /// "Remember the last run": each run starts with the previous report.
    public var continuity: Bool? = nil
    /// The tag after + on the bot's mail address (letters and digits).
    public var mailAlias: String? = nil
    /// Skipped runs to report once the person is back.
    public var awaySkips: RoutineAwaySkips? = nil
    /// The pre-check run before each scheduled turn, kept as sent: a watch
    /// ("Only when something changes", RoutineWatch.swift) or a condition
    /// set elsewhere. An edit sends it only when the person changed it.
    public var precheck: WidgetJSON? = nil
    /// 2026-10-28 (RoutineFolders.swift): the folder of its bot it sits in.
    /// Absent: no folder (and on an older server).
    public var folder: String? = nil
}

public struct RoutineRun: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var routineId: String
    public var routineName: String
    public var prompt: String?
    public var durationMinutes: Int?
    public var timeoutMinutes: Int?
    public var botId: String
    public var runOn: String
    public var scheduledFor: Double
    public var status: String
    public var manual: Bool
    public var triggerSource: String?
    public var threadId: String?
    public var startedAt: Double?
    public var finishedAt: Double?
    public var output: String?
    public var error: String?
    public var createdAt: Double
    public var seenAt: Double?
    /// A short, redacted question or approval reason while waiting.
    public var attention: String? = nil
    /// "bot" or "room-goal"; absent on older computers.
    public var target: String? = nil
    /// A team goal's outcome (`RoutineGoalStatus`).
    public var goalStatus: String? = nil
    public var groupId: String? = nil
    /// The room task a team-goal run works in.
    public var executionThreadId: String? = nil
    public var sourceThreadId: String? = nil
    public var resultsThreadId: String? = nil
    public var attachments: [RoutineAttachment]? = nil
    /// Someone else's run (AU20): status and timing only.
    public var redacted: Bool? = nil
    /// This failure paused its routine (failed runs in a row).
    public var autoPaused: RoutineRunAutoPause? = nil
    /// What the run cost in dollars, when the engine said (2026-10-29).
    public var cost: Double? = nil
    /// A completed run with nothing for the person: it posted nothing.
    public var quiet: Bool? = nil
}

/// Where a routine posts its dated results (`ResultsDestination.tsx`).
public enum RoutineResultsDestination: Hashable, Sendable {
    /// "Keep current destination": the field is left out.
    case keep
    /// "The bot's main thread": null (the server posts there).
    case newThread
    /// An existing conversation of the bot.
    case thread(String)
}

public struct RoutineInput: Encodable, Sendable {
    public var name: String
    public var prompt: String
    public var botId: String
    public var runOn: String
    public var enabled: Bool?
    public var schedule: RoutineSchedule
    public var durationMinutes: Int
    /// A value replaces the stored limit; nil leaves it unchanged on PATCH.
    public var timeoutMinutes: Int?
    /// Explicitly writes JSON null when `timeoutMinutes` is nil.
    public var clearTimeout: Bool
    /// "bot" or "room-goal"; nil leaves it out (an older editor).
    public var target: String?
    /// The team goal's room; ignored for a bot task.
    public var groupId: String?
    /// "skip" or "queue"; nil leaves it out.
    public var overlap: String?
    /// The files each run receives; nil leaves them out.
    public var attachments: [RoutineAttachment]?
    public var results: RoutineResultsDestination
    /// The editor wrote the whole schedule, the interval's days, window and
    /// end date included: an absent one is cleared (null), not kept.
    public var completeSchedule: Bool
    /// Organization server: the person the routine runs as (a principal
    /// id, RunAsField); nil leaves it to the server (the routine's current
    /// person, else the caller).
    public var runAs: String? = nil
    /// "Only when I'm here". Nil leaves the stored value alone on an edit
    /// and means off on a create.
    public var onlyWhenPresent: Bool? = nil
    /// Post results in the conversation. Nil leaves the stored value alone on
    /// an edit and inherits the installation default on a create.
    public var postResults: Bool? = nil
    /// Delete once finished. Nil leaves the stored value alone on an edit
    /// and means off on a create.
    public var deleteWhenFinished: Bool? = nil
    /// Failed runs in a row that pause it (0 never). Nil leaves the stored
    /// value alone on an edit and keeps the default (5) on a create.
    public var autoPauseAfter: Int? = nil
    /// "Only when something changes": keep (nothing sent), set or remove.
    public var watch: RoutineWatchEdit = .keep
    /// "Remember the last run". Nil leaves the stored value alone.
    public var continuity: Bool? = nil
    /// The mail tag. Nil leaves it alone; empty clears it.
    public var mailAlias: String? = nil

    public init(
        name: String, prompt: String, botId: String, runOn: String = "maus",
        enabled: Bool? = nil, schedule: RoutineSchedule, durationMinutes: Int = 30,
        timeoutMinutes: Int? = nil, clearTimeout: Bool = false,
        target: String? = nil, groupId: String? = nil, overlap: String? = nil,
        attachments: [RoutineAttachment]? = nil, results: RoutineResultsDestination = .keep,
        completeSchedule: Bool = false
    ) {
        self.name = name
        self.prompt = prompt
        self.botId = botId
        self.runOn = runOn
        self.enabled = enabled
        self.schedule = schedule
        self.durationMinutes = durationMinutes
        self.timeoutMinutes = timeoutMinutes
        self.clearTimeout = clearTimeout
        self.target = target
        self.groupId = groupId
        self.overlap = overlap
        self.attachments = attachments
        self.results = results
        self.completeSchedule = completeSchedule
        self.onlyWhenPresent = nil
    }

    private enum CodingKeys: String, CodingKey {
        case name, prompt, botId, runOn, enabled, schedule, durationMinutes, timeoutMinutes
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(name, forKey: .name)
        try values.encode(prompt, forKey: .prompt)
        try values.encode(botId, forKey: .botId)
        try values.encode(runOn, forKey: .runOn)
        try values.encodeIfPresent(enabled, forKey: .enabled)
        try values.encode(schedule, forKey: .schedule)
        try values.encode(durationMinutes, forKey: .durationMinutes)
        if let timeoutMinutes { try values.encode(timeoutMinutes, forKey: .timeoutMinutes) }
        else if clearTimeout { try values.encodeNil(forKey: .timeoutMinutes) }
    }
}

public enum RoutineRunLocation: String, CaseIterable, Codable, Hashable, Sendable {
    case maus
    case cloud
}

/// Desktop-equivalent run-location availability, derived only from paired-safe
/// status endpoints. Selecting Cloud VM requires both the host credential and
/// an available Boat agent. An existing cloud routine remains editable without
/// silently changing where it runs if that VM is temporarily unavailable.
public struct RoutineRunAvailability: Equatable, Sendable {
    public var cloudConfigured: Bool
    public var cloudInstanceAvailable: Bool

    public init(config: ConfigStatus?, instances: [Instance]) {
        cloudConfigured = config?.box?.configured == true
        cloudInstanceAvailable = instances.contains {
            $0.driverKind == "boxAgent" && $0.snapshot.isAvailable
        }
    }

    public var cloudReady: Bool { cloudConfigured && cloudInstanceAvailable }

    public func canSelect(_ location: RoutineRunLocation, preserving current: RoutineRunLocation) -> Bool {
        location == .maus || cloudReady || current == .cloud
    }
}

public extension Routine {
    var runLocation: RoutineRunLocation {
        RoutineRunLocation(rawValue: runOn) ?? .maus
    }

    /// Mirrors the desktop `canToggleRoutine` policy. A one-time routine has
    /// no meaningful Resume action once its scheduled instant has passed.
    func canToggle(at date: Date = Date()) -> Bool {
        switch schedule.type {
        case .daily:
            true
        case .interval:
            (5...1_440).contains(schedule.everyMinutes ?? 0) && schedule.anchorAt != nil
        case .once:
            (schedule.at ?? -.infinity) > date.timeIntervalSince1970 * 1_000
        case .cron:
            !(schedule.expression ?? "").isEmpty && !(schedule.timeZone ?? "").isEmpty
        case .webhook, .event:
            true
        case .unknown:
            false
        }
    }
}

public struct NotificationTarget: Equatable, Sendable {
    public let botId: String
    /// The conversation to open. Empty when the banner names only a run
    /// (an owner's access card: desktop `openNotificationTarget`).
    public let threadId: String
    /// A routine run's notification: open its detail, not the report thread
    /// (#1700, desktop `openNotificationTarget`).
    public let routineRunId: String?

    public init?(botId: String?, threadId: String?, routineRunId: String? = nil) {
        let bot = botId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let thread = threadId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let run = routineRunId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !bot.isEmpty, !thread.isEmpty || !run.isEmpty else { return nil }
        self.botId = bot
        self.threadId = thread
        self.routineRunId = run.isEmpty ? nil : run
    }

    /// A message from a person, or a tag in a room, has no bot: the
    /// conversation's id names the owner then (#262, #274). A routine run
    /// push also carries `routineRunId` so a tap opens the run's detail.
    public init?(payload: [String: String]) {
        let botId = payload["botId"].flatMap { $0.isEmpty ? nil : $0 }
        self.init(
            botId: botId ?? payload["groupId"],
            threadId: payload["threadId"],
            routineRunId: payload["routineRunId"]
        )
    }

    public func requiresTaskSwitch(activeThreadId: String) -> Bool {
        !threadId.isEmpty && threadId != activeThreadId
    }
}

/// The harness's error body. Every non-2xx response carries one.
public struct APIErrorBody: Codable, Sendable {
    public var error: String
}

/// One frame of a bot's computer, as it arrives on the stream.
public struct ScreenFrame: Hashable, Sendable {
    public var png: String
    public var mime: String

    public init(png: String, mime: String) {
        self.png = png
        self.mime = mime
    }

    /// Decoded pixels, or nil if the base64 was not what it claimed to be.
    /// Returning nil rather than throwing keeps the caller a view.
    public var data: Data? { Data(base64Encoded: png) }
}

/// `POST /api/bots` — the harness answers with the bot it made.
public struct CreatedBot: Codable, Sendable {
    public var bot: Bot
}

/// `POST /api/groups` — the harness answers with the room it made.
public struct CreatedRoom: Codable, Sendable {
    public var group: Room
}

struct SearchResponse: Codable, Sendable {
    var hits: [SearchHit]
}

struct MessageResponse: Codable, Sendable {
    var message: Message
}

struct EditResponse: Decodable, Sendable {
    var message: Message?
}

struct ActiveBranchResponse: Codable, Sendable {
    var activeLeafId: String
}

struct BotResponse: Codable, Sendable {
    var bot: Bot
}
struct SidebarSectionResponse: Codable, Sendable {
    var section: String
    var bots: [Bot]
}
struct RoomResponse: Codable, Sendable {
    var group: Room
}
struct VoiceListResponse: Codable, Sendable {
    var voices: [Voice]
    var error: String?
}

struct AttachmentResponse: Codable, Sendable {
    var path: String
    var mime: String
    var bytes: Int
}

struct GeneratedAvatarResponse: Codable, Sendable {
    var avatarUrl: String
    var bot: Bot
}

struct RoutinesResponse: Codable, Sendable {
    var routines: [Routine]
    var runs: [RoutineRun]
    // AU20: what a scoped listing adds; absent from an older server.
    var scope: RoutineScope? = nil
    var allowed: RoutineScopeAllowed? = nil
    var facets: RoutineScopeFacets? = nil
    /// 2026-10-28: each bot's folder order; absent from an older server.
    var folders: [String: [String]]? = nil
}

struct RoutineResponse: Codable, Sendable { var routine: Routine }

struct RoutineAwayStateResponse: Decodable, Sendable { var state: String }
struct RoutineRunResponse: Codable, Sendable { var run: RoutineRun }

// MARK: - Server sessions (pairing with a server directly)

/// What `POST /api/auth/pair` returns on a server: the bearer, the session
/// it opened, and the server's public descriptor.
public struct ServerPairResponse: Codable, Sendable {
    public var token: String
    public var session: ServerSession
    public var environment: ServerEnvironment
}

public struct ServerSession: Codable, Hashable, Sendable {
    public var id: String
    public var label: String
    public var scopes: [String]
    public var expiresAt: Double?

    public var isAdmin: Bool { scopes.contains("admin") }
}

/// `GET /.well-known/openmausbot/environment`, served without a session.
public struct ServerEnvironment: Codable, Hashable, Sendable {
    public var environmentId: String
    public var label: String
    public var platform: String?
    public var version: String?
    /// Present on an organization server that signs people in with Pulsatrix.
    public var identity: ServerIdentity? = nil

    /// The server signs people in with Pulsatrix and returns to native apps
    /// (`/auth/oidc/start?client=phone` ends on a `sagax://pair` link).
    public var offersPulsatrixSignIn: Bool {
        identity?.kind == "perspicax" && identity?.nativeReturn == true
    }
}

/// How an organization server signs people in (the descriptor's `identity`).
public struct ServerIdentity: Codable, Hashable, Sendable {
    public var kind: String
    public var `protocol`: String?
    public var issuer: String?
    public var loginPath: String?
    /// The server ends a native sign-in on a `sagax://` link.
    public var nativeReturn: Bool?
    /// Schemes a phone start may name with `&return=` (`sagax`). A server
    /// from this release on ends the phone's sign-in on `sagax://pair`.
    public var phoneReturnSchemes: [String]? = nil

    public init(kind: String, protocol: String? = nil, issuer: String? = nil, loginPath: String? = nil, nativeReturn: Bool? = nil, phoneReturnSchemes: [String]? = nil) {
        self.kind = kind
        self.protocol = `protocol`
        self.issuer = issuer
        self.loginPath = loginPath
        self.nativeReturn = nativeReturn
        self.phoneReturnSchemes = phoneReturnSchemes
    }
}

/// "Sign in with Pulsatrix" from the phone: the authentication sheet opens
/// this address on the server, and the server's answer is the pairing
/// invite link the app already accepts from a QR code
/// (`sagax://pair?address=...&token=omb_pair_...&name=...`).
public enum PulsatrixSignIn {
    /// This app's own scheme, the only one it registers and the only one a
    /// sign-in ends on.
    public static let callbackScheme = CompanionURLScheme.name

    /// The scheme to ask the server for: always `sagax`. An older server
    /// that ends on the previous scheme cannot complete this sign-in.
    public static func returnScheme(for identity: ServerIdentity?) -> String {
        callbackScheme
    }

    /// `<server origin>/auth/oidc/start?client=phone[&return=sagax]`, or nil
    /// for an address that is not http(s).
    public static func startURL(base: URL, returnScheme: String = callbackScheme) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              components.host != nil
        else { return nil }
        components.path = "/auth/oidc/start"
        components.query = nil
        components.fragment = nil
        var items = [URLQueryItem(name: "client", value: "phone")]
        if returnScheme == callbackScheme { items.append(URLQueryItem(name: "return", value: callbackScheme)) }
        components.queryItems = items
        return components.url
    }

    /// The invite the sign-in came back with, or nil (a cancelled sheet, a
    /// link for another server, anything that is not an invite).
    public static func invite(from callback: URL, expectedOrigin: URL) -> PairingInvite? {
        guard let invite = PairingInvite.parse(callback),
              invite.credential.hasPrefix("omb_pair_"),
              let address = invite.connection.baseURL,
              sameOrigin(address, expectedOrigin)
        else { return nil }
        return invite
    }

    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        func key(_ url: URL) -> String? {
            guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
            let port = url.port ?? (scheme == "https" ? 443 : 80)
            return "\(scheme)://\(host):\(port)"
        }
        guard let left = key(a), let right = key(b) else { return false }
        return left == right
    }
}

/// Keep future attachment kinds decodable; image entries display inline and
/// audio entries render as voice notes (Message.voiceNotes). Unknown kinds
/// decode without breaking, so a newer computer never gaps the transcript.
public struct MessageImageAttachment: Codable, Hashable, Sendable {
    public var kind: String
    public var path: String?
    public var mime: String?
    /// The file's display name (`kind == "file"`); the path's basename otherwise.
    public var name: String? = nil
    /// The server's duration estimate for an audio attachment, in
    /// milliseconds; shown until the player loads real metadata.
    public var durationMs: Double?
    /// Word times, when a computer sends them. Absent today: the settle
    /// keeps path and mime only.
    public var words: [VoiceNoteWord]? = nil
}

/// One voice note in Message.attachments: the parked clip's bare generated
/// filename plus the server's duration estimate. Mirrors the web bubble's
/// VoiceNoteAttachment (PR #1801), the contract this rendering matches.
public struct MessageVoiceNote: Hashable, Sendable, Identifiable {
    public var path: String
    public var mime: String?
    public var durationMs: Double?
    public var words: [VoiceNoteWord]?

    public var id: String { path }

    public init(path: String, mime: String? = nil, durationMs: Double? = nil, words: [VoiceNoteWord]? = nil) {
        self.path = path
        self.mime = mime
        self.durationMs = durationMs
        self.words = words
    }
}

extension Message {
    /// Audio attachments that can render, in wire order: kind == "audio"
    /// with a usable path, deduplicated the way generatedImages deduplicates
    /// so a clip replayed by a late message patch renders once.
    public var voiceNotes: [MessageVoiceNote] {
        var seen = Set<String>()
        return (attachments ?? []).compactMap { attachment in
            guard attachment.kind == "audio", let path = attachment.path,
                  !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  seen.insert(path).inserted else { return nil }
            return MessageVoiceNote(path: path, mime: attachment.mime, durationMs: attachment.durationMs, words: attachment.words)
        }
    }
}

/// A change to a group's people (#1480, WireMessage.roster): drawn as one
/// centred line, never a bubble.
public struct RosterNote: Codable, Hashable, Sendable {
    public var event: String
    public var personId: String
    public var name: String

    public init(event: String, personId: String, name: String) {
        self.event = event
        self.personId = personId
        self.name = name
    }
}
