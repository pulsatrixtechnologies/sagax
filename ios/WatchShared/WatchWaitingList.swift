import CompanionCore

enum WatchWaitingList {
    static func read(using client: CompanionClient, botId: String? = nil) async throws -> WaitingPayload {
        do {
            let result = try await client.waitingItems(botId: botId)
            if result.served { return result }
        } catch APIError.status(let code, _) where code == 403 || code == 404 {
            // Desktop relays and older servers expose their asks in the fleet.
        }
        let snapshot = try await client.fleetForHydration()
        var state = CompanionState()
        state.hydrate(snapshot.fleet, waitingThreads: snapshot.waitingThreads)
        var payload = WaitingPayload(waiting: [], messages: [:])
        for (thread, message) in state.pendingApprovals {
            guard let chat = state.chat(forThread: thread) else { continue }
            let asker: String
            switch chat {
            case let .bot(bot): asker = bot.id
            case .room: asker = message.from?.botId ?? ""
            }
            guard botId == nil || botId == asker else { continue }
            if let entry = PinnedWaitingEntry(message: message, botId: asker, botName: chat.name, threadId: thread) {
                payload.waiting.append(entry.item)
                payload.messages[entry.id] = message
            }
        }
        return payload
    }
}

extension PinnedWaitingEntry {
    init?(message: Message, botId: String, botName: String, threadId: String) {
        guard let card = message.card else { return nil }
        let item = WaitingItem(
            id: card.requestId ?? message.id, kind: card.isPermission ? "approval" : "question",
            botId: botId, botName: botName, threadId: threadId, messageId: message.id, at: message.at,
            title: card.title, text: card.subtitle, options: card.options
        )
        self.init(item: item, message: message)
    }
}
