// The composer's actions (feature parity package WP3): Steer on a held send,
// Stop in a room, Compact, and what the "/" menu reads. Each one is the
// desktop renderer's (store.tsx `steerQueued`, `steerGroupQueued`,
// `interruptGroup`; src/lib/harness-commands.ts); the requests live in
// CompanionCore (Client+Composer.swift), the rules in ComposerSend.swift.
import Foundation
import CompanionCore

extension Session {
    /// Steer the held sends of a thread into its running turn. An engine
    /// that cannot steer live ends the turn instead, so the queue starts
    /// next (the desktop's Steer on such an engine). True when the words
    /// joined the turn or the turn was stopped.
    @discardableResult
    func steerQueued(_ send: QueuedSend, threadId: String, in chat: Chat, canSteer: Bool?) async -> Bool {
        let connectionID = settingsClient?.connection.id
        switch QueueSteer.action(canSteer: canSteer) {
        case .interrupt:
            var stopped = false
            await perform {
                switch chat {
                case let .bot(bot): try await $0.interrupt(botId: bot.id, threadId: threadId)
                case let .room(room): try await $0.interruptRoom(groupId: room.id, threadId: threadId)
                }
                stopped = true
            }
            return stopped
        case .steerRoute:
            let destination: MessageDestination
            switch chat {
            case let .bot(bot): destination = .bot(id: bot.id, threadId: threadId)
            case let .room(room): destination = .room(id: room.id, threadId: threadId)
            }
            var result: QueueSteerResult?
            await perform { result = try await $0.steerQueued(queueId: send.queueId, to: destination) }
            guard let result, settingsClient?.connection.id == connectionID else { return false }
            if result.steered == true {
                retireQueued(result.queueIds ?? [send.queueId], threadId: result.threadId ?? threadId)
                return true
            }
            return false
        }
    }

    /// Stop the room's running turn on this thread ("+" > Interrupt).
    func interrupt(room: Room, threadId: String) async {
        await perform { try await $0.interruptRoom(groupId: room.id, threadId: threadId) }
    }

    /// Summarize this conversation's context ("+" > Compact conversation).
    /// The receipt arrives on the stream like any turn's.
    @discardableResult
    func compact(bot: Bot) async -> Bool {
        var started = false
        await perform {
            try await $0.compact(botId: bot.id, threadId: bot.threadId)
            started = true
        }
        return started
    }

    /// The bot's enabled skills for the "/" menu (`useSlashSkills`). Nil
    /// when unreadable: the menu then lists none.
    func slashSkills(botId: String) async -> [SlashSkill]? {
        var skills: [SlashSkill]?
        await perform(quietly: true) { skills = SlashSkill.menu(try await $0.botSkills(botId: botId).skills) }
        return skills
    }

    /// The engine's commands for the "/" menu. A refused or failed read is
    /// an unavailable list: Sagax's own commands still show.
    func harnessCommands(botId: String, threadId: String?, groupId: String? = nil, refresh: Bool = false) async -> HarnessCommandsAnswer {
        var answer = HarnessCommandsAnswer.unavailable
        await perform(quietly: true) {
            answer = try await $0.harnessCommands(botId: botId, threadId: threadId, groupId: groupId, refresh: refresh)
        }
        return answer
    }

    /// What the engines can do, whether skill authoring is on and whether
    /// Teach a task is offered, read once per "/" menu (`/learn`, `/setup`,
    /// live steer). Nil when unreadable.
    func composerAbilities() async -> (engines: [String: EngineAbilities], skillAuthoring: Bool, teachTask: Bool)? {
        var engines: [String: EngineAbilities]?
        var features = (skillAuthoring: true, teachTask: false)
        await perform(quietly: true) { engines = try await $0.engineAbilities() }
        await perform(quietly: true) { features = try await $0.composerFeatures() }
        return engines.map { ($0, features.skillAuthoring, features.teachTask) }
    }

    /// Teach a task and `/learn` are offered on this server (#4209).
    func teachTaskOffered() async -> Bool {
        var offered = false
        await perform(quietly: true) { offered = try await $0.composerFeatures().teachTask }
        return offered
    }

    /// Visible threads, as "#" completes and a send links them.
    var threadRefCandidates: [ThreadRefCandidate] {
        ThreadRefCandidate.collect(bots: state.bots.filter { $0.hidden != true }, rooms: state.rooms)
    }
}
