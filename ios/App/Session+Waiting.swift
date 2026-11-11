// What waits for the person, pinned over the composer (#3415, #3471): the
// server's one list (`GET /api/approvals?waiting=1&botId=`,
// shared/waiting-items.ts, CompanionCore/PinnedWaiting.swift), read when a
// chat opens and again when a live frame may open or close an item, never
// on a short timer (the desktop's useServerWaitingThreads).
import Foundation
import CompanionCore

extension Session {
    /// Frames that come together (a card and its notice) read the list once.
    static let waitingReloadDelay: Duration = .milliseconds(400)

    /// The key a chat's list is kept under: the bot's id, or a room's
    /// thread (a room picks its items out of the person's whole list).
    func waitingKey(_ chat: Chat) -> String {
        switch chat {
        case let .bot(bot): bot.id
        case let .room(room): "room:\(room.threadId)"
        }
    }

    /// The pinned card's items for this chat, oldest first.
    func pinnedEntries(for chat: Chat) -> [PinnedWaitingEntry] {
        guard let payload = waitingLists[waitingKey(chat)] else { return [] }
        let scoped: WaitingPayload = if case .room = chat { PinnedWaiting.inThread(payload, threadId: chat.threadId) } else { payload }
        return PinnedWaiting.entries(scoped) { [state] threadId in state.messages[threadId] }
    }

    /// Reads the list for this chat (one bot's, or the person's for a room).
    func loadWaiting(for chat: Chat) async {
        let key = waitingKey(chat)
        let botId: String? = if case let .bot(bot) = chat { bot.id } else { nil }
        var payload: WaitingPayload?
        let read = await perform(quietly: true) { payload = try await $0.waitingItems(botId: botId) }
        if read, let payload, waitingLists[key] != payload { waitingLists[key] = payload }
    }

    /// A live frame: the lists it may change are read again, soon.
    func noteWaitingFrame(_ frame: Frame) {
        guard !waitingLists.isEmpty else { return }
        switch frame {
        case .message, .messagePatch: break
        default: return
        }
        for (key, payload) in waitingLists {
            let waiting = Set(payload.waiting.map(\.threadId))
            if PinnedWaiting.changes(frame, threads: waitingThreads(key), waiting: waiting) {
                scheduleWaitingReload(key)
            }
        }
    }

    /// The conversations a list covers: a bot's topics and tasks, or a
    /// room's thread.
    private func waitingThreads(_ key: String) -> Set<String> {
        if key.hasPrefix("room:") { return [String(key.dropFirst("room:".count))] }
        guard let bot = state.bot(key) else { return [] }
        var threads: Set<String> = [bot.threadId]
        if let main = bot.mainThreadId { threads.insert(main) }
        for task in bot.tasks ?? [] { threads.insert(task.threadId) }
        return threads
    }

    private func scheduleWaitingReload(_ key: String) {
        guard waitingReloads[key] == nil else { return }
        waitingReloads[key] = Task { [weak self] in
            try? await Task.sleep(for: Self.waitingReloadDelay)
            guard let self else { return }
            self.waitingReloads[key] = nil
            let chat: Chat? = if key.hasPrefix("room:") {
                self.state.rooms.first { "room:\($0.threadId)" == key }.map(Chat.room)
            } else {
                self.state.bot(key).map(Chat.bot)
            }
            if let chat { await self.loadWaiting(for: chat) }
        }
    }
}
