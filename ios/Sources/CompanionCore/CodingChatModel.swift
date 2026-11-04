// View-model helpers for the coding chat: rows, changes summary, and
// polling-friendly snapshots from activity + thread messages.
import Foundation

/// Derived coding-chat state from a task's messages and activity detail.
public struct CodingChatSnapshot: Hashable, Sendable {
    public var root: String?
    public var rows: [CodingRow]
    public var files: [ChangedFile]
    public var tests: TestSummary?
    public var place: CodingPlace
    public var live: Bool
    public var canStop: Bool
    public var canContinue: Bool

    public init(
        root: String? = nil,
        rows: [CodingRow] = [],
        files: [ChangedFile] = [],
        tests: TestSummary? = nil,
        place: CodingPlace = CodingPlace(),
        live: Bool = false,
        canStop: Bool = false,
        canContinue: Bool = false
    ) {
        self.root = root
        self.rows = rows
        self.files = files
        self.tests = tests
        self.place = place
        self.live = live
        self.canStop = canStop
        self.canContinue = canContinue
    }
}

public enum CodingChatModel {
    /// Build the sheet's derived state from thread messages (or step fallback).
    public static func snapshot(
        messages: [CodingMessage],
        item: BotActivityItem,
        detail: BotActivityDetail?,
        hasStopHandler: Bool = true
    ) -> CodingChatSnapshot {
        let code = detail?.item.code ?? item.code
        let root = codingRoot(messages, code: code)
        let rows = codingRows(messages, root: root)
        let place = codingPlace(code: code, root: root)
        return CodingChatSnapshot(
            root: root,
            rows: rows,
            files: changedFiles(rows),
            tests: latestTests(rows),
            place: place,
            live: CodingChatRules.isLive(item: item, detail: detail),
            canStop: CodingChatRules.canStop(item: item, detail: detail, hasStopHandler: hasStopHandler),
            canContinue: CodingChatRules.canContinue(threadId: detail?.item.threadId ?? item.threadId)
        )
    }

    public static func snapshot(
        messages: [Message],
        item: BotActivityItem,
        detail: BotActivityDetail?,
        hasStopHandler: Bool = true
    ) -> CodingChatSnapshot {
        snapshot(
            messages: messages.map { $0.toCodingMessage() },
            item: item,
            detail: detail,
            hasStopHandler: hasStopHandler
        )
    }

    /// When the thread is not readable, draw the activity steps alone.
    public static func messagesForDetail(
        detail: BotActivityDetail?,
        threadMessages: [CodingMessage]?,
        botId: String,
        botName: String
    ) -> [CodingMessage] {
        if let threadMessages, !threadMessages.isEmpty { return threadMessages }
        guard let detail, !detail.steps.isEmpty else { return threadMessages ?? [] }
        return stepMessages(detail.steps, botId: botId, botName: botName)
    }
}
