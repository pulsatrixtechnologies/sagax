// The bot's task list (shared/bot-task-list.ts, server/routes/bot-task-list.ts):
// the to-do list a bot keeps for the person. Not the bot's conversations
// (`BotTask` in Models.swift is a thread), hence the name `BotTodo` here.
//
//   GET    /api/bots/:id/task-list                    { tasks: [...] }
//   POST   /api/bots/:id/task-list/:taskId/complete   the person marks it done
//   POST   /api/bots/:id/task-list/:taskId/resume     waiting back in progress
//   POST   /api/bots/:id/task-list/:taskId/reopen     a done one back in progress
//   DELETE /api/bots/:id/task-list/:taskId            remove it
//
// The live frame `bot.tasks` carries ids only; the panel reads the list again.
import Foundation

public enum BotTodoState: String, Codable, Hashable, Sendable, CaseIterable {
    case doing, waiting, done
}

/// One change of state: what it became, when, and who made it.
public struct BotTodoEvent: Codable, Hashable, Sendable {
    public enum Actor: String, Codable, Hashable, Sendable {
        case bot, person
    }

    public var state: BotTodoState
    /// Epoch milliseconds.
    public var at: Double
    public var by: Actor

    public init(state: BotTodoState, at: Double, by: Actor) {
        self.state = state
        self.at = at
        self.by = by
    }
}

public struct BotTodo: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var botId: String
    /// The person the task belongs to. Absent on a one-person server.
    public var ownerId: String?
    /// The conversation the bot added it from, so "Answer" opens it.
    public var threadId: String?
    public var title: String
    public var state: BotTodoState
    /// The bot's note on the task: what it found, what it needs. Several lines.
    public var note: String?
    /// Every change of state, oldest first. Absent on a task saved before.
    public var history: [BotTodoEvent]?
    /// Epoch milliseconds.
    public var createdAt: Double
    public var updatedAt: Double

    public init(id: String, botId: String, ownerId: String? = nil, threadId: String? = nil,
                title: String, state: BotTodoState, note: String? = nil, history: [BotTodoEvent]? = nil,
                createdAt: Double, updatedAt: Double) {
        self.id = id
        self.botId = botId
        self.ownerId = ownerId
        self.threadId = threadId
        self.title = title
        self.state = state
        self.note = note
        self.history = history
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, botId, ownerId, threadId, title, state, note, history, createdAt, updatedAt
    }

    /// A history entry this build cannot read drops out; the task stays.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        botId = try c.decode(String.self, forKey: .botId)
        ownerId = try c.decodeIfPresent(String.self, forKey: .ownerId)
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
        title = try c.decode(String.self, forKey: .title)
        state = try c.decode(BotTodoState.self, forKey: .state)
        note = try? c.decodeIfPresent(String.self, forKey: .note)
        history = (try? c.decodeIfPresent([Lossy<BotTodoEvent>].self, forKey: .history))?.compactMap(\.value)
        createdAt = try c.decode(Double.self, forKey: .createdAt)
        updatedAt = try c.decode(Double.self, forKey: .updatedAt)
    }

    /// The note, trimmed; nil when there is none.
    public var noteText: String? {
        guard let text = note?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    /// The note's first non-empty line, for a row's preview.
    public var notePreview: String? {
        noteText?.split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
    }

    /// The history, newest first, as the detail shows it.
    public var historyNewestFirst: [BotTodoEvent] {
        (history ?? []).enumerated()
            .sorted { $0.element.at != $1.element.at ? $0.element.at > $1.element.at : $0.offset > $1.offset }
            .map(\.element)
    }
}

/// What the person can do to a task (`personBotTaskActions`, plus Remove).
public enum BotTodoAction: String, Hashable, Sendable, CaseIterable {
    case complete, resume, reopen, remove

    /// Method and path of the request, or nil for an id this client will not send.
    public func request(botId: String, taskId: String) -> (method: String, path: String)? {
        guard let path = BotTodoList.taskPath(botId: botId, taskId: taskId) else { return nil }
        if self == .remove { return ("DELETE", path) }
        return ("POST", "\(path)/\(rawValue)")
    }
}

/// The groups the panel shows, in its order.
public struct BotTodoGroups: Equatable, Sendable {
    public var waiting: [BotTodo] = []
    public var doing: [BotTodo] = []
    public var done: [BotTodo] = []

    public init(waiting: [BotTodo] = [], doing: [BotTodo] = [], done: [BotTodo] = []) {
        self.waiting = waiting
        self.doing = doing
        self.done = done
    }

    public var isEmpty: Bool { waiting.isEmpty && doing.isEmpty && done.isEmpty }
}

/// How a read of the list ended.
public enum BotTodoLoad: Equatable, Sendable {
    case loaded([BotTodo])
    /// An older server without the route: it comes with the server update.
    case needsUpdate
    /// A real failure the person sees.
    case failed
}

public enum BotTodoList {
    public static let groupOrder: [BotTodoState] = [.waiting, .doing, .done]

    /// English source of the composer draft "Answer" prepares (the app's
    /// catalog localizes it); `%@` takes the task's title.
    public static let answerDraftFormat = "About the task “%@”: "

    /// What waits for the person first, then what the bot is doing, then
    /// what is done. Newest first in each group (`groupBotTasks`).
    public static func grouped(_ tasks: [BotTodo]) -> BotTodoGroups {
        let newest: (BotTodo, BotTodo) -> Bool = { $0.updatedAt > $1.updatedAt }
        return BotTodoGroups(
            waiting: tasks.filter { $0.state == .waiting }.sorted(by: newest),
            doing: tasks.filter { $0.state == .doing }.sorted(by: newest),
            done: tasks.filter { $0.state == .done }.sorted(by: newest)
        )
    }

    /// How long a task that just moved to Done keeps its checked row before
    /// the row folds away (`BOT_TASK_DONE_LINGER_MS`).
    public static let doneLinger: TimeInterval = 2.5

    /// The panel's one list: what waits for the person first, then what is
    /// in progress, newest first. A done task is not listed, except the ones
    /// that just moved to Done (`finishing`), kept among the in-progress rows
    /// until their row folds away (`listBotTasks`).
    public static func listed(_ tasks: [BotTodo], finishing: Set<String> = []) -> [BotTodo] {
        let groups = grouped(tasks)
        let rest = (groups.doing + groups.done.filter { finishing.contains($0.id) })
            .sorted { $0.updatedAt > $1.updatedAt }
        return groups.waiting + rest
    }

    /// The ids that went from open to Done between two reads. Nothing on the
    /// first read: a task already done when it first shows is never listed.
    public static func justFinished(from old: [BotTodo]?, to new: [BotTodo]) -> Set<String> {
        guard let old else { return [] }
        let before = Dictionary(old.map { ($0.id, $0.state) }, uniquingKeysWith: { _, last in last })
        return Set(new.filter { task in
            guard task.state == .done, let was = before[task.id] else { return false }
            return was != .done
        }.map(\.id))
    }

    /// The moves the person is offered, in menu order (`personBotTaskActions`).
    public static func moves(for state: BotTodoState) -> [BotTodoAction] {
        switch state {
        case .doing: [.complete]
        case .waiting: [.complete, .resume]
        case .done: [.reopen]
        }
    }

    /// Every action on a task's menu: its moves, then Remove.
    public static func actions(for state: BotTodoState) -> [BotTodoAction] {
        moves(for: state) + [.remove]
    }

    /// The conversation "Answer" opens: the task's own, else the bot's main one.
    public static func answerThread(_ task: BotTodo, botThreadId: String?) -> String? {
        if let thread = task.threadId, !thread.isEmpty { return thread }
        if let botThreadId, !botThreadId.isEmpty { return botThreadId }
        return nil
    }

    /// The draft "Answer" leaves in the composer, unsent. `format` is the
    /// localized `answerDraftFormat`.
    public static func answerDraft(title: String, format: String = answerDraftFormat) -> String {
        let name = title.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return format.replacingOccurrences(of: "%@", with: name)
    }

    /// A prepared draft joining what the composer already holds: an empty
    /// composer takes it, one that already starts with it stays, anything
    /// else keeps its text after the draft.
    public static func merge(draft: String, into existing: String) -> String {
        let current = existing.trimmingCharacters(in: .whitespacesAndNewlines)
        if current.isEmpty { return draft }
        if existing.hasPrefix(draft) { return existing }
        return draft + existing
    }

    /// A failed read (src/lib/server-route.ts `routeMissingOnServer`): an
    /// older server answers "no route: ..." (404), or refuses a member as
    /// admin-only (403, APIError.isAdminOnly). Neither is an error. Any other 404 is a
    /// bot this person cannot reach: no tasks for them.
    public static func outcome(of error: Error) -> BotTodoLoad {
        guard case let .status(code, message) = error as? APIError else { return .failed }
        if routeMissing(code: code, message: message) { return .needsUpdate }
        if code == 404 { return .loaded([]) }
        return .failed
    }

    /// The card shows nothing when there is nothing to list, and a failed
    /// read is not a reason to show anything: only the older server's line.
    public static func sectionHidden(needsUpdate: Bool, listedIsEmpty: Bool) -> Bool {
        !needsUpdate && listedIsEmpty
    }

    /// The quiet read again after a failed one: 2 s, doubling, never past 60 s.
    public static func retryDelay(attempt: Int) -> TimeInterval {
        min(60, 2 * pow(2, Double(max(0, attempt))))
    }

    public static func routeMissing(code: Int, message: String?) -> Bool {
        let text = message ?? ""
        if code == 404 { return text.hasPrefix("no route:") }
        if code == 403 { return APIError.isAdminOnly(message: text) }
        return false
    }

    static func listPath(botId: String) -> String? {
        guard CompanionClient.validRouteID(botId) else { return nil }
        return "/api/bots/\(botId)/task-list"
    }

    static func taskPath(botId: String, taskId: String) -> String? {
        guard let base = listPath(botId: botId), CompanionClient.validRouteID(taskId) else { return nil }
        return "\(base)/\(taskId)"
    }
}

private struct BotTodoListResponse: Decodable {
    var tasks: [Lossy<BotTodo>]?
}

extension CompanionClient {
    /// The person's task list for one bot. A row this build cannot read drops out.
    public func botTodos(botId: String) async throws -> [BotTodo] {
        guard let path = BotTodoList.listPath(botId: botId) else { throw APIError.badURL }
        let response = try await send(try makeRequest("GET", path), as: BotTodoListResponse.self)
        return (response.tasks ?? []).compactMap(\.value)
    }

    /// One action of the person on a task: complete, resume, reopen or remove.
    public func act(_ action: BotTodoAction, onBotTodo taskId: String, botId: String) async throws {
        guard let route = action.request(botId: botId, taskId: taskId) else { throw APIError.badURL }
        if route.method == "DELETE" {
            try await send(try makeRequest("DELETE", route.path))
        } else {
            try await send(try makeRequest("POST", route.path, body: [String: String]()))
        }
    }
}
