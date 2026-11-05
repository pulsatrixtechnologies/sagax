// Threads in a conversation between two people, like a bot's (desktop #262,
// AGENTS.md "Conversations with a person have threads like a bot",
// server/people/people-dms.ts, src/state/store.tsx `personThreadKept` and
// `peopleDmReadTarget`). The pair shares the list, titles, pins, archive and
// snooze; the open thread and unread are each person's own.
//
// The server answers a client that knows threads only when it sends
// `x-sagax-person-threads: 1` (`CompanionClient.makeRequest` sends it on
// every request, as the desktop's `api()` does): its own open thread in
// `threadId` and the whole list in `tasks`. A live `group` frame always
// names the default thread, so the phone keeps the one it has open.
import Foundation

public enum PersonThreads {
    /// The request header that asks for the person's own open thread.
    public static let header = "x-sagax-person-threads"

    /// `personThreadKept`: the thread a live room frame leaves open. A frame
    /// with a transcript page (a switch, a new thread) is authoritative; a
    /// metadata frame keeps the open thread while it still exists.
    public static func keptThreadId(previous: Room, incoming: Room) -> String {
        guard incoming.peopleDm == true, incoming.messages == nil, previous.threadId != incoming.threadId else {
            return incoming.threadId
        }
        let stillThere = (incoming.tasks ?? []).contains { $0.threadId == previous.threadId }
        return stillThere ? previous.threadId : incoming.threadId
    }

    /// `peopleDmReadTarget`: the thread to read for the open conversation,
    /// never a sibling: the open thread when it is unread. Nil reads the
    /// whole conversation (a flag on the row with no unread thread, or an
    /// older server without threads).
    public static func readTarget(_ room: Room) -> String? {
        guard room.peopleDm == true, let tasks = room.tasks else { return nil }
        guard let open = tasks.first(where: { $0.threadId == room.threadId }) else { return nil }
        return open.unread == true || !room.unread ? room.threadId : nil
    }

    /// The conversation shows an unread mark while any of its threads is
    /// unread for the viewer (the server's `group.unread`).
    public static func unreadThreads(_ room: Room) -> Int {
        (room.tasks ?? []).filter { $0.unread == true }.count
    }
}

public extension CompanionClient {
    /// `POST /api/groups/:id/read {threadId}`: that thread only, for the
    /// caller (a person's conversation or a room where they were tagged).
    func markRead(roomId: String, threadId: String) async throws {
        guard Self.validRouteID(roomId), Self.validRouteID(threadId) else { throw APIError.badURL }
        try await send(try makeRequest("POST", "/api/groups/\(roomId)/read", body: ["threadId": threadId]))
    }

    /// `PATCH /api/groups/:id/tasks/:t` with `archivedAt` (ms, or null to
    /// restore) or `snoozedUntil` (ms, 0 until new activity, null to wake).
    /// Only the fields passed are sent.
    func patchRoomTask(groupId: String, threadId: String, archivedAt: Double?? = .none, snoozedUntil: Double?? = .none) async throws {
        guard Self.validRouteID(groupId), Self.validRouteID(threadId) else { throw APIError.badURL }
        var body: [String: Any] = [:]
        if case let .some(value) = archivedAt { body["archivedAt"] = value.map { $0 as Any } ?? NSNull() }
        if case let .some(value) = snoozedUntil { body["snoozedUntil"] = value.map { $0 as Any } ?? NSNull() }
        guard !body.isEmpty else { return }
        try await send(try makeRequest("PATCH", "/api/groups/\(groupId)/tasks/\(threadId)", body: body))
    }
}
