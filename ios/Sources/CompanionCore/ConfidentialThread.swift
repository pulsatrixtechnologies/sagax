// Confidential threads ("Fil confidentiel"), the phone's half of
// server/threads/confidential-threads.ts: a thread its owner marked confidential
// is never remembered, exported or shared beyond them. The flag is
// permanent; only deleting the thread ends it, so no surface offers a way
// back. Everything a view needs to decide is here, so it is tested without
// a simulator.
import Foundation

/// The classification banner of a confidential thread: a solid band at the
/// top of the conversation and another above the composer. It is a fact
/// about the thread, not a notice, so it has no close control.
public enum ConfidentialBanner {
    /// The band's height, reserved whenever the thread is confidential so
    /// the transcript never jumps when it appears.
    public static let height: Double = 28
    /// Never dismissible: there is no state that hides it.
    public static let isDismissible = false
    /// The SF Symbol drawn before the label.
    public static let symbol = "lock.fill"

    /// Shown exactly when the thread open is confidential.
    public static func shows(for task: BotTask?) -> Bool {
        task?.isConfidential == true
    }

    /// Shown exactly when the bot's selected thread is confidential. Rooms
    /// never are.
    public static func shows(for chat: Chat) -> Bool {
        guard case let .bot(bot) = chat else { return false }
        return shows(for: bot.tasks?.first { $0.threadId == bot.threadId })
    }

    /// Localization keys (Localizable.xcstrings).
    public static let labelKey = "CONFIDENTIEL"
    public static let accessibilityKey = "Fil confidentiel : ce fil n'est ni mémorisé, ni exporté, ni partagé"
}

/// The New thread choices for a bot: an ordinary thread and a confidential
/// one. Where the organization makes new threads confidential by default,
/// the ordinary choice says so explicitly (`confidential: false`), else it
/// sends nothing and the server's default applies.
public struct NewThreadChoice: Equatable, Sendable {
    public var confidential: Bool?

    public static func ordinary(orgDefaultConfidential: Bool) -> NewThreadChoice {
        NewThreadChoice(confidential: orgDefaultConfidential ? false : nil)
    }

    public static let confidentialThread = NewThreadChoice(confidential: true)
}

// MARK: - Surfaces outside the chat

/// What a confidential thread shows on a surface that is not the chat
/// itself: home-screen widgets, the Dynamic Island, a banner built on the
/// device, the share sheet. Never its words, never its title (a title is
/// taken from the first message): at most « Fil confidentiel ».
public enum ConfidentialRedaction {
    /// The only text such a surface carries; also the server's push body.
    public static let placeholder = "Fil confidentiel"

    /// A notification banner built on the device from a live frame: the
    /// server already sends the placeholder, and the device never trusts
    /// that alone.
    public static func notificationBody(_ body: String, confidential: Bool) -> String {
        confidential ? placeholder : body
    }

    /// The Live Activity text of an update: the placeholder and no card
    /// (an ask in a confidential thread is answered in the chat only).
    public static func liveActivity(for update: ChatUpdate, botName: String) -> (headline: String, line: String, card: OptionCard?) {
        if update.isConfidential { return (placeholder, "", nil) }
        let headline = update.kind == .needsYou ? "\(botName) needs you" : "\(botName) is working"
        let line = update.line.isEmpty ? (update.card?.title ?? "") : update.line
        return (headline, line, update.card)
    }

    /// The share sheet's line under a bot: its open thread's title, or the
    /// placeholder when that thread is confidential.
    public static func shareSubtitle(for bot: Bot) -> String {
        guard let task = bot.tasks?.first(where: { $0.threadId == bot.threadId }) else { return "Bot" }
        return "Bot · \(task.isConfidential ? placeholder : task.title)"
    }
}

extension ChatUpdate {
    /// The update is about a confidential thread.
    public var isConfidential: Bool { ConfidentialBanner.shows(for: chat) }
}

extension Bot {
    /// This bot record with every confidential thread's record left out, so
    /// no title of one rides along with another thread's row.
    public func withoutConfidentialTasks() -> Bot {
        guard let tasks, tasks.contains(where: \.isConfidential) else { return self }
        var copy = self
        copy.tasks = tasks.filter { !$0.isConfidential }
        return copy
    }
}

extension Chat {
    /// The chat as a surface outside the conversation may keep it.
    public var withoutConfidentialTasks: Chat {
        if case let .bot(bot) = self { return .bot(bot.withoutConfidentialTasks()) }
        return self
    }
}

extension CompanionState {
    /// Whether `threadId` is one of a bot's confidential threads.
    public func isConfidentialThread(_ threadId: String) -> Bool {
        bots.contains { $0.tasks?.contains { $0.threadId == threadId && $0.isConfidential } == true }
    }

    /// The updates a home-screen widget may keep: none about a confidential
    /// thread, and no confidential thread's record on any other row.
    public var widgetUpdates: [ChatUpdate] {
        updates.filter { !$0.isConfidential }.map {
            ChatUpdate(chat: $0.chat.withoutConfidentialTasks, kind: $0.kind, line: $0.line, card: $0.card)
        }
    }
}
