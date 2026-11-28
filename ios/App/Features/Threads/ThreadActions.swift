// Threads and folders (matrix package WP5): one model behind every thread
// and folder menu, whatever draws it. The phone mounts the menus in its
// context menus, swipe actions and the Threads sheet; the iPad desktop
// sidebar mounts the same items in its row menus. Writes go through
// `Session+Threads.swift`; what the pairing may do comes from `SurfaceGate`.
import CompanionCore
import SwiftUI
import UIKit

/// What one thread menu entry asks for.
enum ThreadMenuAction: Equatable {
    case copyLink
    case rename
    case regenerateTitle
    case move(folderId: String?)
    case pin(Bool)
    case archive(Bool)
    case snooze(until: Double)
    case stopSnoozing
    case delete
    /// Opens the permanent-confidentiality confirmation; never a write.
    case makeConfidential
}

/// What one folder menu entry asks for.
enum FolderMenuAction: Equatable {
    case newThread
    case settings
    case markRead
    case move(direction: Int)
}

/// A thread and the bot or room that owns it.
struct ThreadTarget: Identifiable, Equatable {
    let task: BotTask
    let owner: Chat
    var id: String { task.threadId }
}

/// The folder dialog: a new folder for a bot, or an existing one.
struct FolderEditTarget: Identifiable, Equatable {
    let botId: String
    let folder: BotProject?
    var id: String { "\(botId):\(folder?.id ?? "new")" }
}

/// The folder order sheet for one bot.
struct FolderOrderTarget: Identifiable, Equatable {
    let botId: String
    var id: String { botId }
}

@MainActor
final class ThreadActions: ObservableObject {
    /// The rename prompt, with its draft.
    @Published var renaming: ThreadTarget?
    @Published var renameDraft = ""
    /// The delete confirmation.
    @Published var deleting: ThreadTarget?
    /// The "make confidential" confirmation: permanent, so always asked.
    @Published var makingConfidential: ThreadTarget?
    @Published var editingFolder: FolderEditTarget?
    @Published var orderingFolders: FolderOrderTarget?
    /// Threads whose title is being generated: their menu says so.
    @Published private(set) var regenerating = Set<String>()
    /// A write is in flight from this surface.
    @Published private(set) var busy = false
    /// The last failure, in the computer's words when it gave some.
    @Published var error: String?
    /// A short confirmation ("Link copied").
    @Published private(set) var notice: String?
    /// The computer generates thread titles (`features.llmThreadTitles`).
    @Published private(set) var generatedTitles = false
    /// A thread created from a folder menu, for the host to open.
    @Published var created: Bot?

    private var noticeTask: Task<Void, Never>?

    // MARK: Plans

    /// The live bot or room for a target's owner.
    func liveOwner(_ owner: Chat, in session: Session) -> Chat {
        switch owner {
        case let .bot(bot): return session.state.bot(bot.id).map(Chat.bot) ?? owner
        case let .room(room): return session.state.rooms.first { $0.id == room.id }.map(Chat.room) ?? owner
        }
    }

    func plan(for task: BotTask, owner: Chat, in session: Session) -> ThreadMenuPlan {
        let live = liveOwner(owner, in: session)
        let threads: [BotTask]
        let folders: [BotProject]
        switch live {
        case let .bot(bot):
            let workThreads = SidebarPrefsModel.shared.prefs.personWorkThreads
            let botThreads = SidebarPrefsModel.shared.prefs.showBotThreads
            threads = bot.visibleTasks(personWorkThreads: workThreads, botThreads: botThreads)
            folders = bot.folders
        case let .room(room):
            threads = room.tasks ?? []
            folders = []
        }
        // The phone keeps its own rule beside the desktop's: never the last
        // thread, and a room's only while nothing answers there.
        let canDelete = threads.count > 1 && (live.isBot || !live.busy)
        var personThreads = false
        if case let .room(room) = live { personThreads = room.peopleDm == true }
        return ThreadMenuPlan(
            task: task, ownerIsBot: live.isBot, folders: folders,
            generatedTitles: generatedTitles, canDelete: canDelete, personThreads: personThreads
        )
    }

    func folderPlan(_ folder: BotProject, of bot: Bot, in session: Session) -> FolderMenuPlan {
        FolderMenuPlan(bot: session.state.bot(bot.id) ?? bot, folder: folder,
                       canManage: session.surfaceGate.allows(.threadFolders, bot: bot))
    }

    func loadFeatures(_ session: Session) async {
        generatedTitles = await session.threadTitlesEnabled()
    }

    // MARK: Thread actions

    /// Run one thread menu entry. Rename and delete open their prompts
    /// (hosts that draw their own can intercept them first).
    func perform(_ action: ThreadMenuAction, on target: ThreadTarget, session: Session) {
        switch action {
        case .copyLink:
            UIPasteboard.general.string = ThreadLink.url(ownerId: target.owner.id, threadId: target.task.threadId)
            show("Link copied")
        case .rename:
            renameDraft = target.task.title
            renaming = target
        case .delete:
            deleting = target
        case .makeConfidential:
            guard target.owner.isBot, !target.task.isConfidential else { return }
            makingConfidential = target
        case .regenerateTitle:
            guard case let .bot(bot) = target.owner, !regenerating.contains(target.id) else { return }
            regenerating.insert(target.id)
            Task {
                let ok = await session.regenerateTitle(target.task, for: bot)
                regenerating.remove(target.id)
                if !ok { report(session, fallback: "Couldn't generate a title. Try again, or rename the thread.") }
            }
        default:
            run(session) { await self.write(action, on: target, session: session) }
        }
    }

    /// The writes behind the menu, for hosts with their own busy lock.
    func write(_ action: ThreadMenuAction, on target: ThreadTarget, session: Session) async -> Bool {
        let task = target.task
        switch (action, target.owner) {
        case let (.move(folderId), .bot(bot)):
            return await session.moveTask(task, for: bot, toFolder: folderId)
        case let (.pin(pinned), owner):
            return await session.setTaskPinned(task, pinned: pinned, in: owner)
        case let (.archive(archive), .bot(bot)):
            // Recheck after the menu: an event may have started work there.
            if archive, session.state.bot(bot.id)?.visibleTasks.first(where: { $0.threadId == task.threadId })?.isWorking == true {
                session.actionError = String(localized: "This thread can't be archived while it's working.")
                return false
            }
            // The desktop sends Date.now(); the server takes any epoch number.
            let stamp = archive ? (Date().timeIntervalSince1970 * 1000).rounded() : nil
            return await session.setTaskArchived(task, for: bot, archivedAt: stamp)
        case let (.snooze(until), .bot(bot)):
            return await session.snoozeTask(task, for: bot, snoozedUntil: until)
        case let (.stopSnoozing, .bot(bot)):
            return await session.snoozeTask(task, for: bot, snoozedUntil: nil)
        case let (.archive(archive), .room(room)):
            return await session.setPersonThreadArchived(task, in: room, archived: archive)
        case let (.snooze(until), .room(room)):
            return await session.snoozePersonThread(task, in: room, until: until)
        case let (.stopSnoozing, .room(room)):
            return await session.snoozePersonThread(task, in: room, until: nil)
        default:
            return false
        }
    }

    func commitRename(_ session: Session) {
        guard let target = renaming else { return }
        let title = renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        guard !title.isEmpty, title != target.task.title else { return }
        run(session) {
            switch target.owner {
            case let .bot(bot): return await session.renameTask(target.task, for: bot, title: title)
            case let .room(room): return await session.renameTask(target.task, for: room, title: title)
            }
        }
    }

    func confirmDelete(_ session: Session) {
        guard let target = deleting else { return }
        deleting = nil
        run(session) {
            let live = self.liveOwner(target.owner, in: session)
            let plan = self.plan(for: target.task, owner: live, in: session)
            guard plan.enables(.delete) else {
                session.actionError = String(localized: "This thread can't be deleted while it's working or if it's the last thread.")
                return false
            }
            switch live {
            case let .bot(bot): return await session.deleteTask(target.task, for: bot) != nil
            case let .room(room): return await session.deleteTask(target.task, for: room)
            }
        }
    }

    /// The person confirmed: the thread becomes confidential for good.
    func confirmMakeConfidential(_ session: Session) {
        guard let target = makingConfidential else { return }
        makingConfidential = nil
        guard case let .bot(bot) = target.owner else { return }
        run(session) { await session.makeTaskConfidential(target.task, for: bot) }
    }

    // MARK: Folder actions

    func perform(_ action: FolderMenuAction, folder: BotProject, of bot: Bot, session: Session) {
        switch action {
        case .newThread:
            run(session) {
                guard let created = await session.createTask(for: bot, inFolder: folder) else { return false }
                self.created = created
                return true
            }
        case .settings:
            editingFolder = FolderEditTarget(botId: bot.id, folder: folder)
        case .markRead:
            run(session) { await session.markFolderRead(folder, for: bot) }
        case let .move(direction):
            let live = session.state.bot(bot.id) ?? bot
            let ids = FolderOrder.move(live.folders.map(\.id), id: folder.id, direction: direction)
            run(session) { await session.reorderFolders(for: live, ids: ids) }
        }
    }

    func newFolder(for bot: Bot) {
        editingFolder = FolderEditTarget(botId: bot.id, folder: nil)
    }

    func reorderFolders(of bot: Bot) {
        orderingFolders = FolderOrderTarget(botId: bot.id)
    }

    // MARK: Bot row actions

    /// SB23: the thread open with this bot, as the desktop copies it.
    func copyConversationId(_ bot: Bot) {
        UIPasteboard.general.string = bot.threadId
        show("Conversation ID copied")
    }

    /// The app's own link to this bot's conversation (the desktop's Copy link,
    /// `botRefUrl`): `sagax://bot/<bot-id>`, opened by the same chat-link route.
    func copyLink(_ bot: Bot) {
        UIPasteboard.general.string = ThreadLink.botUrl(botId: bot.id)
        show("Link copied")
    }

    func markUnread(_ bot: Bot, session: Session) {
        run(session) { await session.markUnread(bot) }
    }

    // MARK: Plumbing

    /// One write at a time from a surface; a failure lands in `error`.
    func run(_ session: Session, _ operation: @escaping @MainActor () async -> Bool) {
        guard !busy else { return }
        busy = true
        error = nil
        session.actionError = nil
        Task { @MainActor in
            let ok = await operation()
            busy = false
            if !ok { report(session, fallback: "Couldn't update the thread. Try again.") }
        }
    }

    func report(_ session: Session, fallback: String.LocalizationValue) {
        error = session.actionError ?? String(localized: fallback)
        session.actionError = nil
    }

    /// How long a confirmation stays up. Long enough to read after the
    /// context menu has folded away (two seconds was mostly spent on the
    /// menu's own dismissal).
    private static let noticeSeconds: UInt64 = 3

    private func show(_ text: String.LocalizationValue) {
        let message = String(localized: text)
        Haptics.selection()
        UIAccessibility.post(notification: .announcement, argument: message)
        noticeTask?.cancel()
        withAnimation { notice = message }
        noticeTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: Self.noticeSeconds * 1_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { self.notice = nil }
        }
    }
}
