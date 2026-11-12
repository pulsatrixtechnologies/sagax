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

    /// The pinned card's items for this chat, oldest first: the server's
    /// list, or, when the phone has none (an older server or desktop relay,
    /// a refused read), the approvals of the transcript and of the parallel
    /// tasks, as before the list existed.
    func pinnedEntries(for chat: Chat) -> [PinnedWaitingEntry] {
        let payload = waitingLists[waitingKey(chat)]
        let scoped: WaitingPayload? = if case .room = chat, let payload { PinnedWaiting.inThread(payload, threadId: chat.threadId) } else { payload }
        let botId: String = if case let .bot(bot) = chat { bot.id } else { "" }
        return PinnedWaiting.pinned(
            scoped,
            fallback: ApprovalDockRules.pendingApprovals(visibleTranscript(forThread: chat.threadId)) + parallelApprovals(for: chat),
            botId: botId, botName: chat.name, conversation: chat.threadId
        ) { [state] threadId in state.messages[threadId] }
    }

    /// Reads the list for this chat (one bot's, or the person's for a room).
    /// A refused read (403, 404: a server or a desktop relay without the
    /// list) drops the list kept for it, so the pinned card falls back to
    /// the transcript's approvals; any other failure keeps the last list.
    func loadWaiting(for chat: Chat) async {
        let key = waitingKey(chat)
        let botId: String? = if case let .bot(bot) = chat { bot.id } else { nil }
        var payload: WaitingPayload?
        var refused = false
        let read = await perform(quietly: true) { client in
            do {
                payload = try await client.waitingItems(botId: botId)
            } catch APIError.status(let code, _) where code == 403 || code == 404 {
                refused = true
            }
        }
        if refused {
            waitingLists[key] = nil
        } else if read, let payload, waitingLists[key] != payload {
            waitingLists[key] = payload
        }
        if waitingLists[key]?.served != true { await loadParallelApprovalThreads(for: chat) }
    }

    /// A live frame: the lists it may change are read again, soon.
    func noteWaitingFrame(_ frame: Frame) {
        guard !waitingLists.isEmpty else { return }
        switch frame {
        case .message, .messagePatch, .messageRemoved: break
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
