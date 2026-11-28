// Threads and folders (matrix package WP5: TH2, TH3, TH5, TH6, SB14, SB19,
// SB20, SB23): what the desktop's thread row menu, folder menu and folder
// dialog offer, as pure values the phone's context menus and the iPad's
// sidebar both draw from.
//
// The desktop sources each piece mirrors are named beside it:
// src/components/SidebarThreadRow.tsx (the thread menu), BotProjects.tsx
// (FolderActions, BotProjectDialog), src/lib/folder-order.ts,
// src/lib/folder-read.ts and src/lib/thread-refs.ts.
import Foundation

// MARK: - Thread link (TH6)

/// The desktop's thread link (`threadRefUrl` in src/lib/thread-refs.ts):
/// `sagax://thread/<thread>?bot=<owner>`. Pasted into any chat, the
/// desktop turns it into a thread chip; the owner is the bot or the room.
public enum ThreadLink {
    public static let prefix = "sagax://thread/"

    public static func url(ownerId: String, threadId: String) -> String {
        prefix + encodeURIComponent(threadId) + "?bot=" + encodeURIComponent(ownerId)
    }

    /// The link to a bot's current conversation (`botRefUrl` in
    /// src/lib/thread-refs.ts), what a bot row's Copy link makes.
    public static func botUrl(botId: String) -> String {
        "sagax://bot/" + encodeURIComponent(botId)
    }

    /// JavaScript's `encodeURIComponent`: everything but A-Z a-z 0-9 and
    /// `-_.!~*'()` is percent-encoded, so both sides write the same link.
    static func encodeURIComponent(_ value: String) -> String {
        var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

// MARK: - Folder order (SB20)

/// src/lib/folder-order.ts: Move up and Move down step through the saved
/// order; a drop places one folder before or after another.
public enum FolderOrder {
    public enum Place: Sendable { case before, after }

    public static func place(_ ids: [String], moving from: String, to target: String, _ place: Place) -> [String] {
        guard from != target, ids.contains(from), ids.contains(target) else { return ids }
        var next = ids.filter { $0 != from }
        let index = next.firstIndex(of: target)! + (place == .after ? 1 : 0)
        next.insert(from, at: index)
        return next
    }

    /// `direction` is -1 (up) or 1 (down). Out of range leaves the order.
    public static func move(_ ids: [String], id: String, direction: Int) -> [String] {
        guard let index = ids.firstIndex(of: id), direction == -1 || direction == 1 else { return ids }
        let targetIndex = index + direction
        guard ids.indices.contains(targetIndex) else { return ids }
        return place(ids, moving: id, to: ids[targetIndex], direction < 0 ? .before : .after)
    }

    /// SwiftUI's `onMove` offsets, applied to the saved order.
    public static func move(_ ids: [String], fromOffsets source: IndexSet, toOffset destination: Int) -> [String] {
        let moving = source.sorted().filter { ids.indices.contains($0) }.map { ids[$0] }
        guard !moving.isEmpty else { return ids }
        var remaining = ids.enumerated().filter { !source.contains($0.offset) }.map(\.element)
        // The destination counts the moved rows still in place above it.
        let insertAt = destination - source.filter { $0 < destination }.count
        remaining.insert(contentsOf: moving, at: max(0, min(insertAt, remaining.count)))
        return remaining
    }
}

// MARK: - Folder fields (SB19)

/// The folder dialog's rules (BotProjectDialog, and the server's checks in
/// the projects route): a name of 1 to 80 characters after trimming, and an
/// optional emoji; an empty emoji means the default folder icon.
public enum FolderFields {
    public static let maxNameLength = 80
    /// The dialog's presets, in its order.
    public static let emojiPresets = ["📁", "💼", "🏠", "📬", "💡", "🚀", "🎨", "🧪", "📚", "🌱", "⭐", "🛠️"]

    /// The name to send, or nil when it cannot be saved.
    public static func name(_ draft: String) -> String? {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maxNameLength else { return nil }
        return trimmed
    }

    /// The emoji to send: nil resets to the default icon (JSON null).
    public static func emoji(_ draft: String) -> String? {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension Bot {
    /// The folders in their saved order, without duplicate ids.
    public var folders: [BotProject] {
        var seen = Set<String>()
        return (projects ?? []).filter { seen.insert($0.id).inserted }
    }

    /// src/lib/folder-read.ts `folderUnreadThreadIds`: a thread's own flag,
    /// or the bot's for its current thread on computers that send no
    /// per-thread flag.
    public func folderUnreadThreadIds(_ projectId: String, personWorkThreads: Bool = false, botThreads: Bool = false) -> [String] {
        visibleTasks(personWorkThreads: personWorkThreads, botThreads: botThreads)
            .filter { task in
                task.projectId == projectId && (task.unread ?? (task.threadId == threadId && unread))
            }
            .map(\.threadId)
    }

    /// A folder's threads, every one of them (closed and archived too), as
    /// the desktop counts them beside the folder's name.
    public func folderThreads(_ projectId: String, personWorkThreads: Bool = false, botThreads: Bool = false) -> [BotTask] {
        visibleTasks(personWorkThreads: personWorkThreads, botThreads: botThreads).filter { $0.projectId == projectId }
    }
}

/// What a closed folder shows after its name on the desktop: one quiet
/// status for everything inside, in this order of precedence.
public enum FolderStatus: Equatable, Sendable {
    case waiting, working, unread

    public init?(_ tasks: [BotTask]) {
        if tasks.contains(where: { $0.activity == "waiting-on-you" }) { self = .waiting }
        else if tasks.contains(where: { $0.isWorking }) { self = .working }
        else if tasks.contains(where: { $0.unread == true }) { self = .unread }
        else { return nil }
    }
}

// MARK: - The thread menu (TH2-TH6)

/// One entry of the thread menu. The desktop's one thread menu
/// (`ThreadMenu.tsx`, 2026-10-14, shared by the sidebar and "All threads")
/// keeps the everyday actions on its first level (Rename, Pin, Archive,
/// Snooze ›, More ›) and the rare ones one step down under More (Move ›,
/// Copy link, Regenerate title, Delete). Stop snoozing sits in Snooze.
public enum ThreadMenuItem: Hashable, Sendable {
    case copyLink
    case rename
    case regenerateTitle
    case moveToFolder
    case pin
    case archive
    case snooze
    case stopSnoozing
    case delete
    /// Make an ordinary bot thread confidential (permanent, confirmed).
    case makeConfidential
    /// The submenu that holds `ThreadMenuPlan.more`.
    case more
}

/// Which items a thread's menu shows, on which level, and which of them are
/// disabled. Bots get every item the desktop's bot thread list passes;
/// rooms get what the room thread list passes (rename, pin, copy link,
/// delete); a person's conversation archives and snoozes like a bot (#262).
public struct ThreadMenuPlan: Equatable, Sendable {
    /// The first level, in order; `.more` opens `more`.
    public var items: [ThreadMenuItem]
    /// Under More, in order (Delete last).
    public var more: [ThreadMenuItem]
    /// Inside Snooze, before the presets: the thread is snoozed now.
    public var stopsSnoozing: Bool
    public var disabled: Set<ThreadMenuItem>

    public init(
        task: BotTask,
        ownerIsBot: Bool,
        folders: [BotProject],
        generatedTitles: Bool,
        canDelete: Bool,
        personThreads: Bool = false,
        now: Date = Date()
    ) {
        let archives = ownerIsBot || personThreads
        var items: [ThreadMenuItem] = [.rename, .pin]
        if archives { items += [.archive, .snooze] }
        items.append(.more)
        self.items = items

        var more: [ThreadMenuItem] = []
        if ownerIsBot, !folders.isEmpty { more.append(.moveToFolder) }
        more.append(.copyLink)
        if ownerIsBot, generatedTitles { more.append(.regenerateTitle) }
        // One way only: a confidential thread never offers a way back.
        if ownerIsBot, !task.isConfidential { more.append(.makeConfidential) }
        more.append(.delete)
        self.more = more
        stopsSnoozing = archives && task.isSnoozed(now: now)

        // The desktop disables archive, the snooze presets and delete while
        // the thread works; stop snoozing stays.
        var disabled = Set<ThreadMenuItem>()
        let working = task.isWorking || task.busy == true || task.activity == "working"
        if working {
            disabled.formUnion([.archive, .snooze])
        }
        if working || !canDelete { disabled.insert(.delete) }
        self.disabled = disabled
    }

    public func shows(_ item: ThreadMenuItem) -> Bool {
        items.contains(item) || more.contains(item) || (item == .stopSnoozing && stopsSnoozing)
    }

    public func enables(_ item: ThreadMenuItem) -> Bool { shows(item) && !disabled.contains(item) }
}

// MARK: - The folder menu (SB19, SB20)

/// FolderActions in BotProjects.tsx, plus the folder row's "+": New thread
/// in the folder, Folder settings, Mark folder as read, Move up, Move down.
public enum FolderMenuItem: Hashable, Sendable {
    case newThread
    case settings
    case markRead
    case moveUp
    case moveDown
}

public struct FolderMenuPlan: Equatable, Sendable {
    public var items: [FolderMenuItem]
    public var disabled: Set<FolderMenuItem>

    /// `canManage` is the pairing's folder gate (`SurfaceFeature
    /// .threadFolders`): without it only "New thread" stays, which every
    /// pairing may do.
    public init(bot: Bot, folder: BotProject, canManage: Bool) {
        let ids = bot.folders.map(\.id)
        let index = ids.firstIndex(of: folder.id) ?? 0
        var items: [FolderMenuItem] = [.newThread]
        if canManage { items += [.settings] }
        items.append(.markRead)
        if canManage { items += [.moveUp, .moveDown] }
        self.items = items
        var disabled = Set<FolderMenuItem>()
        if bot.folderUnreadThreadIds(folder.id).isEmpty { disabled.insert(.markRead) }
        if index == 0 { disabled.insert(.moveUp) }
        if index >= ids.count - 1 { disabled.insert(.moveDown) }
        self.disabled = disabled
    }

    public func shows(_ item: FolderMenuItem) -> Bool { items.contains(item) }
    public func enables(_ item: FolderMenuItem) -> Bool { items.contains(item) && !disabled.contains(item) }
}
