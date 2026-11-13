// The composer's power state (feature parity package WP3), one object per
// chat screen so the composer's views stay layout-agnostic (the iPhone
// composer today, the iPad composer pill later): failed sends kept for
// Retry, long pastes held as chips, the busy-send choice, Steer in flight,
// and what the "/" menu lists. Every field is keyed by thread, so switching
// threads in a chat never shows one thread's state in another.
import SwiftUI
import CompanionCore

@MainActor
final class ComposerModel: ObservableObject {
    /// Sends that failed, per thread (Retry, Dismiss).
    @Published var failed: [String: [FailedSend]] = [:]
    /// Long pastes waiting to go with the next send, per thread.
    @Published var pastes: [String: [PastedText]] = [:]
    /// Threads whose held sends are being steered.
    @Published var steering: Set<String> = []
    /// A Retry in flight, so it cannot be tapped twice.
    @Published var retrying: Set<UUID> = []
    /// The "/" menu opened from the "+" sheet on a draft that does not start
    /// with "/": it then inserts at the start of the draft.
    @Published var commandMenuForced = false
    /// The "/" menu put away for this draft (the strip's ×).
    @Published var commandMenuDismissed = false
    /// The next draft change was made by the app (a chip's words moved back,
    /// a held send pulled back, a thread's draft restored), not a paste.
    var pasteCheckSuppressed = false

    /// Engine command lists, by bot, thread and room (`loadHarnessCommands`).
    @Published private(set) var commandLists: [String: HarnessCommandsAnswer] = [:]
    @Published private(set) var loadingCommands = false
    /// What the engines can do (`/learn`, `/setup`, live steer) and whether
    /// skill authoring is on. Nil until read.
    @Published private(set) var engines: [String: EngineAbilities]?
    @Published private(set) var skillAuthoring = true
    /// Teach a task and `/learn` are offered (`features.teachTask`, #4209).
    @Published private(set) var teachTask = false
    /// Each bot's enabled skills (`useSlashSkills`), read again each time the
    /// menu opens so a skill switched on or off in settings shows the right way.
    @Published private(set) var skillLists: [String: [SlashSkill]] = [:]
    private var loadedAt: [String: Date] = [:]

    /// `TTL_MS`: an engine list is kept a few minutes.
    static let commandListLifetime: TimeInterval = 5 * 60

    func failedSends(_ threadId: String) -> [FailedSend] { failed[threadId] ?? [] }
    func pastes(_ threadId: String) -> [PastedText] { pastes[threadId] ?? [] }

    func remember(_ failure: FailedSend) {
        failed[failure.threadId, default: []].append(failure)
    }

    func forget(_ failure: FailedSend) {
        failed[failure.threadId]?.removeAll { $0.id == failure.id }
        if failed[failure.threadId]?.isEmpty == true { failed[failure.threadId] = nil }
    }

    func add(_ paste: PastedText, threadId: String) {
        pastes[threadId, default: []].append(paste)
    }

    func remove(_ paste: PastedText, threadId: String) {
        pastes[threadId]?.removeAll { $0.id == paste.id }
        if pastes[threadId]?.isEmpty == true { pastes[threadId] = nil }
    }

    func clearPastes(_ ids: [UUID], threadId: String) {
        pastes[threadId]?.removeAll { ids.contains($0.id) }
        if pastes[threadId]?.isEmpty == true { pastes[threadId] = nil }
    }

    // MARK: The "/" menu

    static func listKey(botId: String, threadId: String?, groupId: String?) -> String {
        "\(botId):\(threadId ?? ""):\(groupId ?? "")"
    }

    func commands(botId: String, threadId: String?, groupId: String? = nil) -> HarnessCommandsAnswer? {
        commandLists[Self.listKey(botId: botId, threadId: threadId, groupId: groupId)]
    }

    /// Read the lists the menu needs (cached), and the engines once.
    func load(botIds: [String], threadId: String?, groupId: String?, refresh: Bool = false, session: Session) async {
        let now = Date()
        let wanted = botIds.filter { botId in
            let key = Self.listKey(botId: botId, threadId: threadId, groupId: groupId)
            guard !refresh, let at = loadedAt[key], commandLists[key] != nil else { return true }
            return now.timeIntervalSince(at) >= Self.commandListLifetime
        }
        let needsEngines = engines == nil
        guard !wanted.isEmpty || needsEngines else { return }
        loadingCommands = true
        defer { loadingCommands = false }
        if needsEngines, let abilities = await session.composerAbilities() {
            engines = abilities.engines
            skillAuthoring = abilities.skillAuthoring
            teachTask = abilities.teachTask
        }
        for botId in wanted {
            let answer = await session.harnessCommands(botId: botId, threadId: threadId, groupId: groupId, refresh: refresh)
            let key = Self.listKey(botId: botId, threadId: threadId, groupId: groupId)
            // a failed read keeps the last good list, as the desktop's cache does
            if answer.available || commandLists[key] == nil { commandLists[key] = answer }
            loadedAt[key] = Date()
        }
    }

    func skills(botId: String) -> [SlashSkill] { skillLists[botId] ?? [] }

    /// Read a bot's skills for the menu. A failed read lists none.
    func loadSkills(botId: String, session: Session) async {
        skillLists[botId] = await session.slashSkills(botId: botId) ?? []
    }

    /// The engine instance's abilities, when known.
    func abilities(_ instanceId: String?) -> EngineAbilities? {
        guard let instanceId else { return nil }
        return engines?[instanceId]
    }
}
