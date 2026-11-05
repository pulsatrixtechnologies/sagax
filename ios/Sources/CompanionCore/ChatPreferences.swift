// The parts of the chat's preferences that are logic rather than screen:
// how much of a bot's working-out the transcript shows, and what sits on
// the composer's chip row.
//
// These live in the core, away from SwiftUI, because they are the pieces
// worth testing — the views that read them are wiring.
import Foundation

/// How much of a bot's activity the transcript shows.
public enum ActivityDetail: String, CaseIterable, Codable, Sendable {
    /// Every chip, as the harness sent them.
    case full
    /// Consecutive chips fold into one summary; failures never fold.
    case reduced
    /// No activity chips at all.
    case hidden

    public var label: String {
        switch self {
        case .full: "Full"
        case .reduced: "Reduced"
        case .hidden: "Hidden"
        }
    }

    public var caption: String {
        switch self {
        case .full: "Every step a bot takes."
        case .reduced: "Steps fold into one line. Failures always show."
        case .hidden: "No activity, only messages."
        }
    }

    /// The desktop's Settings > Appearance > Tool calls ("Details",
    /// `features.showToolCalls`, off by default): on shows every step, off
    /// the pared-down chat (steps gone, narration folded, failures kept).
    /// The phone follows that one switch rather than a setting of its own.
    public static func forToolCalls(_ showToolCalls: Bool?) -> ActivityDetail {
        showToolCalls == true ? .full : .hidden
    }
}

/// One chip on the composer's quick-reply row.
public struct QuickReply: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var prompt: String
    public var icon: String

    public init(id: String = UUID().uuidString, title: String, prompt: String, icon: String) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.icon = icon
    }

    /// The four the composer shipped with, kept as the reset target.
    public static let defaults: [QuickReply] = [
        QuickReply(id: "default.diff", title: "Show diff", prompt: "Show latest git diff", icon: "arrow.triangle.pull"),
        QuickReply(id: "default.tests", title: "Run tests", prompt: "Run all automated tests", icon: "checkmark.seal"),
        QuickReply(id: "default.explain", title: "Explain steps", prompt: "Explain the changes in detail", icon: "text.bubble"),
        QuickReply(id: "default.next", title: "What's next?", prompt: "What should we do next?", icon: "sparkles"),
    ]

    /// Icons offered by the editor. Small on purpose: a full symbol browser
    /// is a different feature, and twelve covers what a chip is ever for.
    public static let iconChoices = [
        "sparkles", "arrow.triangle.pull", "checkmark.seal", "text.bubble",
        "hammer", "ladybug", "doc.text", "terminal",
        "paperplane", "magnifyingglass", "clock.arrow.circlepath", "list.bullet",
    ]

    public static func encode(_ replies: [QuickReply]) -> String {
        guard let data = try? JSONEncoder().encode(replies) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Anything unreadable becomes the defaults. An empty *string* is a
    /// store that has never been written; an empty *list* is a row the user
    /// deliberately cleared, and those must not mean the same thing.
    public static func decode(_ json: String) -> [QuickReply] {
        guard !json.isEmpty, let data = json.data(using: .utf8) else { return defaults }
        guard let decoded = try? JSONDecoder().decode([QuickReply].self, from: data) else { return defaults }
        let ids = decoded.map { $0.id.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard ids.allSatisfy({ !$0.isEmpty }), Set(ids).count == ids.count else { return defaults }
        return decoded
    }
}

/// A completed turn's intermediate replies. The terminal answer stays outside.
public struct AssistantTurnFold: Hashable, Sendable {
    public let turnId: String
    public let messages: [Message]
    public let elapsed: Double

    public var label: String {
        guard elapsed >= 1_000 else { return "Worked" }
        let seconds = Int(elapsed / 1_000)
        let duration = seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(String(format: "%02d", seconds % 60))s"
        return "Worked for \(duration)"
    }
}

/// Where the phone draws its "New" line when an unread conversation opens:
/// above the first row that is not the person's own after their last
/// message, the replies they have not read yet. Nil when they wrote last or
/// the conversation holds no line of theirs (nothing tells what is new).
public enum NewMessagesDivider {
    public static func anchor(_ rows: [TranscriptRow]) -> String? {
        guard let lastOwn = rows.lastIndex(where: { $0.role == .user }) else { return nil }
        let after = rows.index(after: lastOwn)
        guard after < rows.endIndex else { return nil }
        return rows[after...].first { $0.role != .user }?.id
    }
}

/// A transcript entry: a message, or one stretch of work (tool steps and a
/// settled turn's narration) read as a single line.
public enum TranscriptRow: Identifiable, Hashable, Sendable {
    case message(Message)
    case activityRun(StepRun)
    case voiceCall(VoiceCallCardModel)

    /// The message a row answers for — its first, which is the one whose
    /// time and sender the transcript reads.
    public var head: Message {
        switch self {
        case let .message(message): message
        case let .activityRun(run): run.messages[0]
        case let .voiceCall(card): card.messages[0]
        }
    }

    public var id: String {
        switch self {
        case let .message(message): message.id
        case let .activityRun(run): run.id
        case let .voiceCall(card): "voice.\(card.callId)"
        }
    }

    public var at: Double { head.at }
    /// The last timestamp covered by this row. Date separators compare the
    /// next row with this value so a folded run cannot manufacture a gap.
    public var endAt: Double {
        switch self {
        case let .message(message): message.at
        case let .activityRun(run): run.messages.last?.at ?? head.at
        case let .voiceCall(card): card.messages.last?.at ?? head.at
        }
    }
    public var role: Message.Role { head.role }
    public var kind: Message.Kind { head.kind }
    public var senderName: String? { head.from?.name }
}

/// The one line a roster row shows under a chat's name.
///
/// Folded by the same rule as the transcript. Tool receipts are not
/// transcript rows at any level, so they are not the roster line either.
/// Reading the preview off the raw last message made a hidden tool call
/// the line under every chat.
public func rosterPreview(_ messages: [Message], detail: ActivityDetail) -> String {
    // The digest is a row in the chat now, as a chip, but never the line
    // under a chat's name: it follows every reply, so it would be the
    // preview of every chat and say nothing about any of them.
    // Tool steps are never the line under a chat either: only the bot's
    // words, or the "Worked for" of a turn whose narration folded.
    // A settled ask's receipt is not the line either (it stays in the chat
    // since issue #426; the roster said what came before it, as it did).
    let messages = messages.filter { $0.kind != .digest && !isToolActivityRow($0) && !isSettledPermission($0) }
    guard let last = transcriptRows(messages, detail: detail).last else { return "" }
    switch last {
    case let .message(message):
        return previewText(of: message)
    case let .activityRun(run):
        return run.englishLabel
    case let .voiceCall(card):
        return spokenLines(card.messages).last?.text ?? ""
    }
}

/// The leading icon of a home preview line (`paperclip`, `paperplane`).
public enum RosterPreviewKind: String, Hashable, Sendable {
    /// Text only: no icon.
    case plain
    /// The last line carries a file or an image, either way.
    case attachment
    /// A message this bot sent to another bot.
    case sentToBot
}

/// A roster preview with the kind that picks its icon.
public struct RosterPreviewLine: Hashable, Sendable {
    public var text: String
    public var kind: RosterPreviewKind

    public init(text: String, kind: RosterPreviewKind) {
        self.text = text
        self.kind = kind
    }
}

/// `rosterPreview` plus the icon kind, folded by the same rules.
public func rosterPreviewLine(_ messages: [Message], detail: ActivityDetail) -> RosterPreviewLine {
    let text = rosterPreview(messages, detail: detail)
    let visible = messages.filter { $0.kind != .digest && !isToolActivityRow($0) && !isSettledPermission($0) }
    guard case let .message(last)? = transcriptRows(visible, detail: detail).last else {
        return RosterPreviewLine(text: text, kind: .plain)
    }
    let kind = rosterPreviewKind(of: last)
    guard kind == .attachment, last.kind == .text, last.role == .user else {
        return RosterPreviewLine(text: text, kind: kind)
    }
    // A person's upload is stored as a transport tag: show the words, or the
    // file's name when the message was only the file.
    let parsed = AttachedMessageContent.parse(last.text ?? "")
    let words = parsed.text.trimmingCharacters(in: .whitespacesAndNewlines)
    return RosterPreviewLine(text: words.isEmpty ? (parsed.attachments.first?.name ?? text) : words, kind: kind)
}

/// Which icon one message earns in a roster row.
public func rosterPreviewKind(of message: Message) -> RosterPreviewKind {
    if let comm = message.comm { return isReceivedComm(comm, toolName: message.tool?.name) ? .plain : .sentToBot }
    if message.kind == .activity, message.threadRef != nil, message.role == .bot { return .sentToBot }
    if !(message.attachments ?? []).isEmpty { return .attachment }
    if message.kind == .text, let text = message.text,
       !AttachedMessageContent.parse(text).attachments.isEmpty {
        return .attachment
    }
    return .plain
}

/// A bot⇄bot note about a message this bot received, not one it sent. Older
/// servers send no direction: their received note reads "Message from @X".
public func isReceivedComm(_ comm: CommChip, toolName: String?) -> Bool {
    if let direction = comm.direction { return direction == "received" }
    return toolName?.hasPrefix("Message from") ?? false
}

/// What a single message reads as in a roster row.
func previewText(of message: Message) -> String {
    switch message.kind {
    case .text: return message.webhookContent?.task ?? message.text ?? ""
    // a pending card's question is the preview; the roster row already
    // says "waiting on you" beside it
    case .options:
        guard let card = message.card else { return "" }
        return card.isPending && !card.subtitle.isEmpty ? card.subtitle : card.title
    case .secret:
        return message.secret?.label ?? message.text ?? "Credential required"
    case .activity:
        let name = message.tool?.name ?? ""
        // "Messaged @X: text" on the sender's note (parity 1C)
        if let comm = message.comm, !isReceivedComm(comm, toolName: name),
           let sent = comm.text?.trimmingCharacters(in: .whitespacesAndNewlines), !sent.isEmpty {
            return name.isEmpty ? sent : "\(name): \(sent)"
        }
        return name
    case .screen: return "Screenshot"
    case .video: return message.video?.title ?? "Video"
    case .digest: return ""
    case .compaction: return message.compaction?.chipText ?? message.text ?? ""
    case .routineRun: return message.routineRun?.previewLine ?? message.text ?? ""
    case .connector, .access, .goalRun, .widget, .unknown: return message.text ?? ""
    case .roster: return message.roster.map { String(localized: "\($0.name) left the group") } ?? message.text ?? ""
    }
}

/// Rows the harness writes about a turn rather than in it: tool chips and,
/// since Phase 0, the digest and compaction receipts. Hidden together,
/// because a reader who turned activity off does not want the summary of
/// exactly those calls either.
/// A status row the server writes while a turn runs ("notice: Qwen hit a
/// rate limit and is retrying", a `recovery:` engine change, a usage-limit
/// switch). It tells the reader what the bot is doing, so, like desktop's
/// statusActivity, it is never folded with the tool chips. Hidden status
/// rows still leave via `isHiddenStatusNotice` (#1668 / #1698).
public func isStatusNotice(_ message: Message) -> Bool {
    guard message.kind == .activity, let tool = message.tool else { return false }
    if tool.limitFailover != nil { return true }
    return tool.name.hasPrefix("notice:") || tool.name.hasPrefix("recovery:")
}

/// The Workspace line Auto leaves when a turn starts on, or comes back to,
/// the person's own computer. The
/// server keeps writing it (it is how the thread knows where it last was),
/// but no client draws it: the computer is where a bot works by default
/// (desktop `isHiddenStatusActivity`, shared/workspace-line.ts). The cloud,
/// browser and Local VM lines and every "moved to" line stay.
public let quietWorkspaceLine = "notice: Workspace: On your computer"

/// Also every technical notice (`ChatNotices`, the desktop's
/// shared/chat-notices.ts): stored, never drawn. A usage-limit switch and
/// the return after it are transparent too (desktop `isHiddenStatusActivity`,
/// #1668 / #1698): rows stored before as `recovery:` lines are left out;
/// a wait stays.
public func isHiddenStatusNotice(_ message: Message) -> Bool {
    guard message.kind == .activity, let tool = message.tool else { return false }
    if tool.name == quietWorkspaceLine || ChatNotices.isTechnical(tool.name) { return true }
    let limit = tool.limitFailover?.kind
    return limit == "switched" || limit == "back"
}

/// Bookkeeping the desktop chat never draws (ChatView.tsx): a stop the
/// person asked for, stored by an older build as `error: turn stopped`, and
/// Sagax's own context fold (`compaction.by == "harness"`).
public func isHiddenReceipt(_ message: Message) -> Bool {
    if message.kind == .compaction { return message.compaction?.by == "harness" }
    guard message.kind == .activity, let name = message.tool?.name else { return false }
    return name.replacingOccurrences(of: #"^error:\s*"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces) == "turn stopped"
}

/// A tool step, running, done or failed, such as
/// `mcp_sagax-environment__run_command`. It never shows as a chip of its
/// own: a turn's steps fold into one step line (`StepRun`, desktop #488 and
/// #518), and Hidden leaves them out. Phone and iPad share `transcriptRows`.
///
/// Not a tool row: a status notice, a failed turn (`error:`), a parallel
/// task card, or a chip that opens another conversation.
public func isToolActivityRow(_ message: Message) -> Bool {
    guard message.kind == .activity, message.tool != nil else { return false }
    if message.parallelTask?.isCard == true { return false }
    if ErrorRowRules.isError(message) { return false }
    if isStatusNotice(message) { return false }
    if message.comm != nil || message.threadRef != nil { return false }
    // 2026-11-05 (visible roles): a role banner is a row of its own
    if message.tool?.roleNotice != nil { return false }
    // A ConnectWise widget is the transcript row. The tool chip stays folded.
    if message.tool?.widget != nil, CwWidgets.isViewTool(message.tool?.name) { return false }
    return true
}

/// Threads off (Settings > Appearance > Show threads, the default): the
/// single stream carries no thread receipt, so a chip that opens another
/// conversation is left out of the chat (desktop ChatView `MessagesList`
/// and ThreadChip, #1026). A bot-to-bot note (`comm`) without a thread
/// stays: on an Apple phone it is the only trace a teammate was consulted.
public func hidesThreadReceipt(_ message: Message, showThreads: Bool) -> Bool {
    !showThreads && message.threadRef != nil && message.tool != nil
}

/// The transcript the chat draws: `messages` without the thread receipts
/// the threads switch leaves out.
public func chatMessages(_ messages: [Message], showThreads: Bool) -> [Message] {
    showThreads ? messages : messages.filter { !hidesThreadReceipt($0, showThreads: false) }
}

public func isActivityReceipt(_ message: Message) -> Bool {
    switch message.kind {
    case .activity, .digest, .compaction: return true
    default: return false
    }
}

/// A finished permission ask the engine closed on its own (nobody could
/// answer it) or one put away leaves the chat; the message stays stored.
/// One a person answered, or that expired, stays as its one-line receipt
/// (issue #426, `approvalCardStaysInChat`). An open ask, a question and a
/// quiz are not this.
/// An answered, expired or closed permission ask (its receipt, if any).
public func isSettledPermission(_ message: Message) -> Bool {
    guard message.kind == .options, let card = message.card, card.isPermission else { return false }
    return !card.isPending
}

public func settledPermissionLeavesChat(_ message: Message) -> Bool {
    guard message.kind == .options, let card = message.card, card.isPermission else { return false }
    return !card.isPending && !ApprovalReceiptRules.staysInChat(card)
}

/// Folds a transcript to the requested level of detail.
///
/// Every stretch of one bot's work, its tool steps and a settled turn's
/// narration, becomes one step line ("Worked 15s · 2 tools") that opens on
/// the steps (src/lib/activity-runs.ts). Hidden drops the steps and keeps
/// the narration folded. A status notice, a failed turn, a parallel task
/// card, and a chip that opens another conversation stay rows of their own.
///
/// A digest is a row of its own, drawn as a chip: never folded into a run
/// of the tool chips it summarises, never counted as one of their steps,
/// and gone with them when activity is hidden.
///
/// `showThreads` false is Settings > Appearance > Threads off: a receipt
/// that opens another conversation (a thread chip, "Go to conversation")
/// leaves the chat, as the desktop's unified chat drops it (ChatView.tsx,
/// #1026).
///
/// `hidesPreSendRefusals` is a 1:1 bot chat (#2013): a failed turn the
/// engine refused before any prompt went out (PreSendRefusal) is not drawn;
/// the composer says it instead. A room keeps it as a quiet line.
public func transcriptRows(_ messages: [Message], detail: ActivityDetail, showThreads: Bool = true, threadBotId: String = "",
                           hidesPreSendRefusals: Bool = false) -> [TranscriptRow] {
    let voice = makeVoiceCallPlan(messages)
    // The same failure of the same bot, repeated since it last answered,
    // draws once: the last row (FailureDedup, desktop repeatedFailureIds).
    let repeatedFailures = FailureDedup.repeatedIds(messages, threadBotId: threadBotId)
    // Fold only explicitly completed turns; never guess that the last reply
    // is final on an older server or while the bot is still working.
    // Spoken call lines are already in the voice card, so they are not a
    // second "Worked for" chip.
    var narration: [String: [Message]] = [:]
    var startedAt: [String: Double] = [:]
    var lastUserAt: Double?
    var folds: [String: AssistantTurnFold] = [:]
    var hiddenIDs = Set<String>()
    for message in messages {
        if voice.hidden.contains(message.id) { continue }
        if message.role == .user { lastUserAt = message.at }
        guard message.role == .bot, message.kind == .text,
              let turnID = message.turnId, !turnID.isEmpty else { continue }
        if message.turnTerminal == true {
            guard let items = narration.removeValue(forKey: turnID), !items.isEmpty else { continue }
            folds[items[0].id] = AssistantTurnFold(
                turnId: turnID, messages: items,
                elapsed: max(0, message.at - (startedAt[turnID] ?? items[0].at))
            )
            hiddenIDs.formUnion(items.map(\.id))
        } else {
            if narration[turnID] == nil { startedAt[turnID] = lastUserAt ?? message.at }
            narration[turnID, default: []].append(message)
        }
    }

    var rows: [TranscriptRow] = []
    var run: [Message] = []
    var turnElapsed: Double?
    var turnID: String?

    // One step on its own still reads as the step line; narration is
    // folded even alone, the answer under it is what shows.
    func flush() {
        if !run.isEmpty {
            rows.append(.activityRun(StepRun(messages: run, elapsed: turnElapsed ?? StepGroup.span(run), turnId: turnID)))
        }
        run.removeAll()
        turnElapsed = nil
        turnID = nil
    }
    // A run is one bot's work: another speaker starts a new one.
    func join(_ message: Message) {
        if let first = run.first, first.role != message.role || first.from?.botId != message.from?.botId { flush() }
        run.append(message)
    }

    var seenVoice = Set<String>()
    for message in messages {
        switch foldVoiceMessage(message, plan: voice, seen: &seenVoice) {
        case let .card(card):
            flush()
            rows.append(.voiceCall(card))
            continue
        case .skip:
            continue
        case .keep:
            break
        }
        if isHiddenStatusNotice(message) || isHiddenReceipt(message) { continue }
        if repeatedFailures.contains(message.id) { continue }
        if hidesPreSendRefusals, PreSendRefusal.kind(of: message) != nil { continue }
        // A failed routine run and a routine's access card pass as a
        // banner (TransientNotices), never a row.
        if TransientNotices.isTransient(message) { continue }
        if !showThreads, message.threadRef != nil, message.tool != nil { continue }
        if hiddenIDs.contains(message.id) {
            join(message)
            if let fold = folds[message.id] {
                turnElapsed = fold.elapsed
                turnID = fold.turnId
            }
            continue
        }
        // A tool step joins the stretch of work; with activity Hidden the
        // steps go and a turn's narration stays folded.
        if isToolActivityRow(message) {
            if detail != .hidden { join(message) }
            continue
        }
        if settledPermissionLeavesChat(message) { continue }
        // A parallel task's live card and a failed turn are not receipts:
        // the desktop draws them whatever the tool-call setting says, and
        // never folds them into a run (they carry Stop, Open and Retry).
        if message.parallelTask?.isCard == true || ErrorRowRules.isError(message) {
            flush()
            rows.append(.message(message))
            continue
        }
        // Which credentials paid for a turn (organization servers) shows even
        // when activity is hidden, as the desktop's TurnAccessChip does.
        // Hidden drops the digest and compaction summaries of the steps,
        // never a notice, a failed turn, a parallel card, or a comm chip.
        let paidBy = message.kind == .digest && message.digest?.access != nil
        if detail == .hidden && (message.kind == .digest || message.kind == .compaction) && !paidBy { continue }
        // A turn that touched nothing leaves a digest with nothing to show;
        // an empty row would still cost the transcript a gap.
        if message.kind == .digest && !paidBy && DigestSummary(text: message.text ?? "").isEmpty { continue }
        flush()
        rows.append(.message(message))
    }
    flush()
    return rows
}
