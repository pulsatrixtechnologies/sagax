// What the Updates pill shows: only the chats doing something.
//
// Three kinds, in the order a person cares about them — a bot that has
// stopped and needs an answer, a bot mid-turn, and a bot that finished with
// something you have not read. A bot that is idle and read is not an update
// and never appears here; that is what the roster below is for.
//
// The computation lives in Core rather than the app target so the Updates
// sheet, the Live Activity, and home-screen widgets all consume one
// definition of "what needs you" and can never disagree; ChatUpdate is
// Codable so the same value can serialize into a widget snapshot.
import Foundation

public struct ChatUpdate: Identifiable, Hashable, Codable {
    public enum Kind: Int, Comparable, Codable, Sendable {
        case needsYou = 0, working, toReview
        public static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }
    }

    public let chat: Chat
    public let kind: Kind
    /// One line under the name — the question, what it is doing, or what it said.
    public let line: String
    /// The card to answer, when `kind == .needsYou`.
    public let card: OptionCard?

    public var id: String { chat.conversationID }

    /// The options a compact surface may offer as one-tap answers: a live
    /// ask with a real card, minus SKILL.md requests, which must be read in
    /// the chat before they enable anything. The Updates sheet's pills and
    /// the widgets' buttons share this one rule, so they can never disagree
    /// about what is answerable.
    public var answerOptions: [String] {
        Self.answerOptions(kind: kind, card: card)
    }

    /// #2909: one short label per answer, each shown whole on its pill; nil
    /// while `answerOptions` is set means they cannot all be shown whole:
    /// the surface offers Open only, which goes to the card.
    public var answerLabels: [String]? {
        let options = answerOptions
        return options.isEmpty ? nil : NotificationChoiceLabels.labels(for: options)
    }

    /// #2909: what the row says before anyone picks: the question, then
    /// what happened (a markdown table as readable lines), multi-line.
    public var context: String {
        guard kind == .needsYou, let card else { return line }
        let ask = NeedsYouText(update: self)
        let parts = [ask.question, ask.detail ?? ""].map { NotificationContextLines.plain($0) }.filter { !$0.isEmpty }
        let text = parts.joined(separator: "\n")
        return text.isEmpty ? line : text
    }

    /// The rule behind `answerOptions`, in the form a snapshot row can also
    /// reach: it sees the kind and the card, nothing else.
    public static func answerOptions(kind: Kind, card: OptionCard?) -> [String] {
        guard kind == .needsYou, let card, card.isPending, card.skillRequest == nil else { return [] }
        return card.options
    }
}

extension CompanionState {
    public var updates: [ChatUpdate] {
        var out: [ChatUpdate] = []
        var seen = Set<String>()

        // Newest approval first, one per chat: the pill headlines the most
        // recent thing that stopped, and the sheet lists the rest.
        for pending in pendingApprovals {
            guard let chat = chat(forThread: pending.threadId), seen.insert(chat.conversationID).inserted else { continue }
            let card = pending.message.card
            // a bot writes its question in Markdown: the lock screen reads its words
            out.append(ChatUpdate(chat: chat, kind: .needsYou, line: PlainText.from(markdown: card?.subtitle ?? card?.title ?? ""), card: card))
        }

        for bot in bots where bot.hidden != true {
            for task in bot.attentionOrderedTasks(queuedThreadIds: queuedThreadIds) {
                guard let projected = bot.projected(forThread: task.threadId) else { continue }
                let chat = Chat.bot(projected)
                guard seen.insert(chat.conversationID).inserted else { continue }
                if task.activity == "waiting-on-you" {
                    out.append(ChatUpdate(chat: chat, kind: .needsYou, line: "Waiting on you", card: nil))
                } else if let held = pendingQueued[task.threadId], !held.isEmpty {
                    out.append(ChatUpdate(chat: chat, kind: .working, line: queuedLine(for: held), card: nil))
                } else if projected.busy == true {
                    out.append(ChatUpdate(chat: chat, kind: .working, line: workingLine(threadId: task.threadId), card: nil))
                } else if projected.unread {
                    out.append(ChatUpdate(chat: chat, kind: .toReview, line: lastLine(threadId: task.threadId), card: nil))
                }
            }
        }
        for room in rooms {
            let chat = Chat.room(room)
            guard !seen.contains(chat.conversationID) else { continue }
            if let held = pendingQueued[room.threadId], !held.isEmpty {
                seen.insert(chat.conversationID)
                out.append(ChatUpdate(chat: chat, kind: .working, line: queuedLine(for: held), card: nil))
            } else if room.busyBotId != nil {
                seen.insert(chat.conversationID)
                out.append(ChatUpdate(chat: chat, kind: .working, line: workingLine(threadId: room.threadId), card: nil))
            } else if room.unread {
                seen.insert(chat.conversationID)
                out.append(ChatUpdate(chat: chat, kind: .toReview, line: lastLine(threadId: room.threadId), card: nil))
            }
        }
        return out.sorted { $0.kind < $1.kind }
    }

    public func chat(forThread threadId: String) -> Chat? {
        if let bot = bot(forThread: threadId) { return .bot(bot) }
        if let room = room(forThread: threadId) { return .room(room) }
        return nil
    }

    /// One line for a thread's held sends. Only a capacity hold waits for a
    /// free slot; a hold behind the running turn is simply queued, and the
    /// pill must not promise a slot it is not waiting for.
    private func queuedLine(for held: [QueuedSend]) -> String {
        if held.count == 1 {
            return held[0].reason == "capacity"
                ? String(localized: "Queued. Waiting for an available slot")
                : String(localized: "Queued")
        }
        return String(localized: "\(held.count) messages queued")
    }

    private func workingLine(threadId: String) -> String {
        if let live = streaming[threadId], !live.isEmpty {
            return PlainText.from(markdown: String(live.suffix(120)))
        }
        // The hidden "On your computer" line is never the working line either.
        if let last = visibleTranscript(forThread: threadId).last(where: { !isHiddenStatusNotice($0) }), last.kind == .activity, let tool = last.tool {
            return tool.name
        }
        return "Working…"
    }

    private func lastLine(threadId: String) -> String {
        guard let last = visibleTranscript(forThread: threadId).last(where: { $0.kind != .digest && !isHiddenStatusNotice($0) }) else { return "" }
        switch last.kind {
        // The new card kinds read as their text until their cards land
        // (WP2), exactly as they did while they decoded as `unknown`.
        case .text, .unknown, .connector, .access, .goalRun, .widget, .roster: return PlainText.from(markdown: last.text ?? "")
        case .options: return PlainText.from(markdown: last.card?.title ?? "")
        case .secret: return last.secret?.label ?? last.text ?? "Credential required"
        case .activity: return last.tool?.name ?? ""
        case .screen: return "Screenshot"
        case .video: return last.video?.title ?? "Video"
        case .digest: return ""
        case .compaction: return last.compaction?.chipText ?? last.text ?? ""
        case .routineRun: return last.routineRun?.previewLine ?? last.text ?? ""
        }
    }
}

/// #2909: a bot's markdown as readable plain lines (shared/notification-context.ts
/// `notificationContextText`): a table row becomes "Header : value · …",
/// bold, links and code keep their words, a bullet becomes "• ".
public enum NotificationContextLines {
    public static func plain(_ markdown: String) -> String {
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var out: [String] = []
        var header: [String]?
        for raw in lines {
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") { continue }
            if isRule(trimmed) { continue }
            if trimmed.contains("|"), trimmed.hasPrefix("|") || trimmed.hasSuffix("|") {
                let cells = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "|")).components(separatedBy: "|").map { inline($0) }
                if let names = header {
                    let row = cells.enumerated().compactMap { index, cell -> String? in
                        guard !cell.isEmpty else { return nil }
                        let name = index < names.count ? names[index] : ""
                        return !name.isEmpty && name != cell ? "\(name) : \(cell)" : cell
                    }
                    if !row.isEmpty { out.append(row.joined(separator: " · ")) }
                } else {
                    header = cells
                }
                continue
            }
            header = nil
            var line = trimmed
            while line.hasPrefix("#") { line.removeFirst() }
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") { line = "• " + line.dropFirst(2) }
            let clean = inline(line)
            if clean.isEmpty {
                if let last = out.last, !last.isEmpty { out.append("") }
            } else {
                out.append(clean)
            }
        }
        while out.last == "" { out.removeLast() }
        return out.joined(separator: "\n")
    }

    private static func isRule(_ line: String) -> Bool {
        guard line.contains("-") else { return false }
        return line.allSatisfy { "|-: ".contains($0) } && line.filter({ $0 == "-" }).count >= 2
    }

    private static func inline(_ text: String) -> String {
        var value = text
        // links keep their words
        if let regex = try? NSRegularExpression(pattern: "!?\\[([^\\]]*)\\]\\([^)]*\\)") {
            value = regex.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: "$1")
        }
        for mark in ["**", "__", "~~", "`"] { value = value.replacingOccurrences(of: mark, with: "") }
        return value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
