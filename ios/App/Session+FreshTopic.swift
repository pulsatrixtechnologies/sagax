// Fresh topic on return (CompanionCore/FreshTopic.swift; the desktop's
// src/lib/fresh-topic.ts). With threads hidden, opening a bot from its row
// after a while (or coming back to the app) lands on a new, empty topic over
// the conversation at rest. A notification or a link opens its own thread
// and never asks. The person's threshold is FreshTopic.afterKey; when they
// left each bot is kept on this device.
import CompanionCore
import Foundation

private let freshTopicLeftKey = "sagax.freshTopicLeft.v1"

extension Session {
    /// A bot opened from its row (home, sidebar, compose, ⌘1 to 9): the
    /// thread it restores, with a fresh topic drawn over it when due.
    func returning(to chat: Chat) -> Chat {
        let restored = threadSelection.restoringThread(chat, connectionID: connection?.id)
        landOnBot(restored)
        return restored
    }

    /// The threshold, in hours (0 = never).
    var freshTopicAfterHours: Int {
        get { FreshTopic.parseAfter(UserDefaults.standard.string(forKey: FreshTopic.afterKey)) }
        set { UserDefaults.standard.set(String(newValue), forKey: FreshTopic.afterKey) }
    }

    /// Coming back to `chat`'s thread: a fresh topic over it when the rule
    /// says so. `force` is the app coming back with the chat on screen: it
    /// only ever adds a draft, never clears a New topic the person started.
    func landOnBot(_ chat: Chat, force: Bool = false, now: Date = Date()) {
        guard case let .bot(bot) = chat else { return }
        // a notification or a link being opened shows what it names
        if force, notificationChat != nil || pendingChat != nil { return }
        // The same bot picked again while its fresh draft is on screen (the
        // iPad's sidebar: the person never left it), or while the draft's
        // first message is on its way: the draft stays. Clearing it here
        // drew the topic under it for a moment, before the new topic came.
        // A draft whose topic was already made (its first message failed or
        // is still on its way) stays too, so a retry never lands in the
        // topic under it.
        if !force, freshTopics[bot.id] == bot.threadId, !SidebarPrefsModel.shared.showThreads,
           freshTopicLeftAt(bot.id) == nil || createdFreshTopics[bot.id] != nil { return }
        guard !SidebarPrefsModel.shared.showThreads,
              let task = (state.bot(bot.id) ?? bot).tasks?.first(where: { $0.threadId == bot.threadId }),
              FreshTopic.isSegment(task)
        else {
            if !force { freshTopics[bot.id] = nil }
            return
        }
        let decision = FreshTopic.onReturn(
            topic: FreshTopic.Topic(task),
            now: now.timeIntervalSince1970 * 1000,
            afterMs: FreshTopic.afterMs(hours: freshTopicAfterHours),
            leftAt: freshTopicLeftAt(bot.id),
            queued: state.queuedThreadIds.contains(bot.threadId)
        )
        if decision.fresh { freshTopics[bot.id] = bot.threadId }
        else if !force { freshTopics[bot.id] = nil }
    }

    /// The topic under the draft again ("Earlier topics").
    func showTopicUnderFresh(_ botId: String) {
        freshTopics[botId] = nil
        createdFreshTopics[botId] = nil
    }

    func isFreshTopic(_ chat: Chat) -> Bool {
        guard case let .bot(bot) = chat else { return false }
        return freshTopics[bot.id] == bot.threadId
    }

    func consumeStartedTopic(_ botId: String) { startedTopics[botId] = nil }

    // MARK: When the person left

    func freshTopicLeftAt(_ botId: String) -> Double? {
        (UserDefaults.standard.dictionary(forKey: freshTopicLeftKey) as? [String: Double])?[botId]
    }

    func noteLeftBot(_ botId: String, at date: Date = Date()) {
        var left = (UserDefaults.standard.dictionary(forKey: freshTopicLeftKey) as? [String: Double]) ?? [:]
        left[botId] = date.timeIntervalSince1970 * 1000
        if left.count > 200 {
            left = Dictionary(uniqueKeysWithValues: left.sorted { $0.value > $1.value }.prefix(200).map { ($0.key, $0.value) })
        }
        UserDefaults.standard.set(left, forKey: freshTopicLeftKey)
    }

    func noteBackAtBot(_ botId: String) {
        guard var left = UserDefaults.standard.dictionary(forKey: freshTopicLeftKey) as? [String: Double], left[botId] != nil else { return }
        left[botId] = nil
        UserDefaults.standard.set(left, forKey: freshTopicLeftKey)
    }
}
