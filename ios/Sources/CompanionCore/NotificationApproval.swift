// Allow or Deny from a notification, without opening the card.
//
// Allow once only. "Always allow" is not offered: the lock screen does not
// show the whole card, and a standing grant from there is the risk this
// closes. A class the person protects with a security key is not granted
// in the background. That Allow opens Sagax and the existing ceremony
// (Face ID or a key) runs. Until the ceremony answers, nothing is approved.
import Foundation

public enum NotificationApproval {
    public static let allowAction = "sagax.approval.allow"
    public static let denyAction = "sagax.approval.deny"
    /// A question's Reply, with a text field (`UNTextInputNotificationAction`).
    public static let replyAction = "sagax.question.reply"
    /// `UNNotificationDefaultActionIdentifier`.
    public static let defaultAction = "com.apple.UNNotificationDefaultActionIdentifier"
    /// `UNNotificationDismissActionIdentifier`.
    public static let dismissAction = "com.apple.UNNotificationDismissActionIdentifier"

    public static let category = "SAGAX_APPROVAL"
    public static let keyCategory = "SAGAX_APPROVAL_KEY"
    public static let updateCategory = "SAGAX_UPDATE"
    /// A question that names its request (server/push/payload.ts `QUESTION_CATEGORY`).
    public static let questionCategory = "SAGAX_QUESTION"
    /// #2697: a bot needs the person with no request behind it (a run's
    /// report, a proactive find): Approve and Deny answer the bot in its
    /// conversation (server/push/payload.ts `NEEDS_YOU_CATEGORY`).
    public static let needsYouCategory = "SAGAX_NEEDS_YOU"
    public static let approveAction = "sagax.needsyou.approve"
    public static let declineAction = "sagax.needsyou.deny"
    /// #2697: a proactive proposal card: Do it and Not now answer the
    /// proposal (`POST /api/bots/:id/proactive/:proposalId`).
    public static let proposalCategory = "SAGAX_PROPOSAL"
    public static let doItAction = "sagax.proposal.accept"
    public static let notNowAction = "sagax.proposal.decline"
    /// Bundled chime (ios/App/approval.caf). Distinct from the system sound and the nudge.
    public static let soundFile = "approval.caf"
    /// APNs subtitle key. `%@` is the routine's name.
    public static let routineSubtitleKey = "Open routine %@"
    /// userInfo flag: the follow-up banner, after a key was required in the background.
    public static let stepUpPending = "pending"

    public enum Decision: Equatable, Sendable {
        case open(NotificationTarget)
        /// Allow once. `needsKey` means the action already brought the app forward.
        case allow(threadId: String, requestId: String, needsKey: Bool)
        case deny(threadId: String, requestId: String)
        /// The person opened the follow-up banner. Run the security-key ceremony, then Allow once.
        case confirmKey(threadId: String, requestId: String)
        /// Reply to a question from the banner: the typed text is the answer.
        case reply(threadId: String, requestId: String, text: String)
        /// Approve or Deny on a needs-you: a short answer in the bot's
        /// conversation (`groupId` when it came out of a room).
        case needsYou(botId: String, threadId: String, groupId: String?, approve: Bool)
        /// Do it or Not now on a proactive proposal card.
        case proposal(botId: String, proposalId: String, accept: Bool)
    }

    /// What to do after the server refuses an Allow because a key is required.
    /// Active: the ceremony can run. Otherwise nothing is approved, and a
    /// banner asks the person to open Sagax.
    public enum StepUpFollowUp: Equatable, Sendable {
        case ceremony
        case deferToApp
    }

    public static func afterRefusal(appActive: Bool) -> StepUpFollowUp {
        appActive ? .ceremony : .deferToApp
    }

    /// The category a local banner registers. Only an approval or a
    /// question that names its request gets actions: Allow and Deny, or Reply.
    public static func category(kind: String, requestId: String?, needsKey: Bool, choices: [String] = [], proposalId: String? = nil) -> String {
        // #2697: a proactive proposal and a needs-you with no request behind it
        if kind == "proposal" { return token(proposalId) != nil ? proposalCategory : updateCategory }
        if kind == "needs-you", token(requestId) == nil { return needsYouCategory }
        if kind == "question" {
            guard token(requestId) != nil else { return updateCategory }
            guard !choices.isEmpty else { return questionCategory }
            let layout = NotificationChoices.layout(choices)
            return NotificationChoices.categoryIdentifier(layout.shown, overflow: layout.overflow)
        }
        guard kind == "approval", token(requestId) != nil else { return updateCategory }
        return needsKey ? keyCategory : category
    }

    /// `nil` dismisses the banner and does nothing else.
    /// `replyText`: what the person typed in Reply; empty opens the conversation.
    public static func decide(actionIdentifier: String, info: [String: String], replyText: String? = nil) -> Decision? {
        if actionIdentifier == dismissAction { return nil }
        let threadId = token(info["threadId"])
        let requestId = token(info["requestId"])
        let target = NotificationTarget(payload: info)
        if let index = NotificationChoices.index(of: actionIdentifier) {
            // a question's choice: the chosen words are the answer
            let choices = NotificationChoices.choices(from: info["choices"])
            guard let threadId, let requestId, choices.indices.contains(index) else { return target.map(Decision.open) }
            return .reply(threadId: threadId, requestId: requestId, text: choices[index])
        }
        switch actionIdentifier {
        case approveAction, declineAction:
            guard let threadId, let botId = token(info["botId"]) else { return target.map(Decision.open) }
            return .needsYou(botId: botId, threadId: threadId, groupId: token(info["groupId"]), approve: actionIdentifier == approveAction)
        case doItAction, notNowAction:
            guard let botId = token(info["botId"]), let proposalId = token(info["proposalId"]) else { return target.map(Decision.open) }
            return .proposal(botId: botId, proposalId: proposalId, accept: actionIdentifier == doItAction)
        case NotificationChoices.openAction:
            return target.map(Decision.open)
        case replyAction:
            let text = (replyText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard let threadId, let requestId, !text.isEmpty else { return target.map(Decision.open) }
            return .reply(threadId: threadId, requestId: requestId, text: String(text.prefix(4_000)))
        case allowAction:
            guard let threadId, let requestId else { return target.map(Decision.open) }
            return .allow(threadId: threadId, requestId: requestId, needsKey: info["needsKey"] == "1")
        case denyAction:
            guard let threadId, let requestId else { return target.map(Decision.open) }
            return .deny(threadId: threadId, requestId: requestId)
        case defaultAction:
            if info["stepUp"] == stepUpPending, let threadId, let requestId {
                return .confirmKey(threadId: threadId, requestId: requestId)
            }
            return target.map(Decision.open)
        default:
            return target.map(Decision.open)
        }
    }

    /// A route id the phone will put in a URL. Anything else opens the
    /// conversation instead of being sent.
    static func token(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...128).contains(value.utf8.count) else { return nil }
        let ok = value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
                || byte == 45 || byte == 95
        }
        return ok ? value : nil
    }
}

/// How many answers a notification, the island or the watch can carry, and
/// what goes past that. iOS shows four actions on a banner; past four, three
/// answers and Open, so nothing is offered that cannot be pressed.
public enum NotificationChoices {
    /// The most actions iOS shows on a notification (and the watch mirrors).
    public static let limit = 4

    public struct Layout: Equatable, Sendable {
        public var shown: [String]
        /// More answers than fit: the last button opens the conversation.
        public var overflow: Bool
    }

    public static func layout(_ options: [String], limit: Int = limit) -> Layout {
        var clean: [String] = []
        for option in options {
            let value = option.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, !clean.contains(value) { clean.append(value) }
        }
        guard clean.count > limit else { return Layout(shown: clean, overflow: false) }
        return Layout(shown: Array(clean.prefix(max(limit - 1, 0))), overflow: true)
    }

    /// The action id of the choice at `index` (`sagax.question.choice.<n>`).
    public static let actionPrefix = "sagax.question.choice."
    /// Open the conversation, past the limit.
    public static let openAction = "sagax.question.open"

    public static func actionIdentifier(_ index: Int) -> String { "\(actionPrefix)\(index)" }

    /// The index an action id names, or nil.
    public static func index(of actionIdentifier: String) -> Int? {
        guard actionIdentifier.hasPrefix(actionPrefix) else { return nil }
        return Int(actionIdentifier.dropFirst(actionPrefix.count))
    }

    /// A category per set of choices: the same choices reuse it. Short and
    /// stable (a hash), so the phone keeps a bounded few.
    public static func categoryIdentifier(_ shown: [String], overflow: Bool) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in (shown.joined(separator: "\u{1F}") + (overflow ? "\u{1F}+" : "")).utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return "\(NotificationApproval.questionCategory).\(String(hash, radix: 16))"
    }

    /// Whether a category id is one of these per-choices categories.
    public static func isChoicesCategory(_ identifier: String) -> Bool {
        identifier.hasPrefix("\(NotificationApproval.questionCategory).")
    }

    /// The choices a push or a frame carries (`choices`), cleaned.
    public static func choices(from value: Any?) -> [String] {
        if let list = value as? [String] { return layout(list, limit: 10).shown }
        if let list = value as? [Any] { return layout(list.compactMap { $0 as? String }, limit: 10).shown }
        if let joined = value as? String, !joined.isEmpty {
            return layout(joined.components(separatedBy: "\u{1F}"), limit: 10).shown
        }
        return []
    }
}

/// What an ask says, question first: the card's plain question, then its
/// detail. A card whose title is only a header ("Approval needed") asks
/// with its subtitle.
public struct NeedsYouText: Equatable, Sendable {
    public var question: String
    public var detail: String?

    public init(question: String, detail: String?) {
        self.question = question
        self.detail = detail
    }

    public init(title: String?, subtitle: String?, line: String = "") {
        let title = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = (subtitle ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let line = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.hasSuffix("?"), !subtitle.isEmpty, subtitle != title {
            question = title
            detail = subtitle
        } else {
            question = !subtitle.isEmpty ? subtitle : !line.isEmpty ? line : title
            detail = nil
        }
    }

    public init(update: ChatUpdate) {
        self.init(title: update.card?.title, subtitle: update.card?.subtitle, line: update.line)
    }
}

/// What the phone says once an answer from a banner or the watch went
/// (or did not): the words live in the app's catalog.
public enum AnswerFeedback: Equatable, Sendable {
    case allowed
    case denied
    case answered(String)
    case failed

    public static func answered(_ decision: NotificationApproval.Decision) -> AnswerFeedback {
        switch decision {
        case .allow, .confirmKey: .allowed
        case .deny: .denied
        case let .needsYou(_, _, _, approve): approve ? .allowed : .denied
        case let .proposal(_, _, accept): accept ? .allowed : .denied
        case let .reply(_, _, text): .answered(text)
        case .open: .failed
        }
    }

    /// Whether a `/respond` body means the answer landed. `unavailable` is
    /// the server saying the action never ran (turn ended, ask timed out,
    /// wrong thread); a body with no outcome still counts as landed.
    public static func respondLanded(_ outcome: String?) -> Bool {
        outcome != "unavailable"
    }
}

/// The question a banner asked: its first line (the body puts it first).
public enum NotificationQuestion {
    public static func first(line body: String) -> String {
        let line = body.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > 90 ? String(trimmed.prefix(89)) + "…" : trimmed
    }
}
