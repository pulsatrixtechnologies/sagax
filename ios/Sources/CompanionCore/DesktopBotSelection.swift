// iPad lot 6: the sidebar's multi-select of bots (Sidebar.tsx
// `useSidebarMultiSelect`, `SidebarMultiSelectBar`, src/lib/bot-unread.ts
// `toggleSelected`). "Select" in a bot row's menu starts it with that bot; a
// tap on a row then joins or leaves it; the bar stays up while `active`, even
// at zero chosen; Escape or the bar's X clears it. The rail has no bar, so a
// selection ends when the sidebar collapses.
import Foundation

public struct DesktopBotSelection: Equatable, Sendable {
    public private(set) var active = false
    public private(set) var ids: [String] = []

    public init() {}

    /// The row menu's Select: the mode opens with this bot chosen.
    public mutating func start(with id: String) {
        active = true
        if !ids.contains(id) { ids.append(id) }
    }

    /// A row's tap: opens the mode if needed, adds or removes the bot,
    /// keeping the order of the choices.
    public mutating func toggle(_ id: String) {
        active = true
        if let index = ids.firstIndex(of: id) { ids.remove(at: index) } else { ids.append(id) }
    }

    public mutating func clear() {
        active = false
        ids = []
    }

    public func contains(_ id: String) -> Bool { ids.contains(id) }

    /// The chosen bots that still exist, in the order they were chosen.
    public func chosen(in bots: [Bot]) -> [Bot] {
        ids.flatMap { id in bots.filter { $0.id == id } }
    }

    /// The bar's Pin turns into Unpin once every chosen bot is pinned.
    public static func allPinned(_ chosen: [Bot]) -> Bool {
        !chosen.isEmpty && chosen.allSatisfy { $0.pinned == true }
    }

    /// The bots Archive takes: the ones the viewer may archive and that are
    /// not the Primary Bot, never leaving the sidebar without an active bot
    /// (the desktop caps at the active count minus one).
    public static func archivable(_ chosen: [Bot], in bots: [Bot], mayArchive: (Bot) -> Bool) -> [Bot] {
        let allowed = chosen.filter { mayArchive($0) && $0.chiefOfStaff != true }
        let keep = max(0, bots.filter { $0.hidden != true }.count - 1)
        return Array(allowed.prefix(keep))
    }
}

/// Edit N bots (BulkEditBotsDialog): what one run did to each bot, counted
/// for the summary line ("{ok} changed, {failed} refused, {skipped} already set").
public enum DesktopBulkOutcome: Equatable, Sendable {
    case changed, skipped
    case refused(String)

    public static func counts(_ outcomes: [DesktopBulkOutcome]) -> (ok: Int, failed: Int, skipped: Int) {
        var ok = 0, failed = 0, skipped = 0
        for outcome in outcomes {
            switch outcome {
            case .changed: ok += 1
            case .skipped: skipped += 1
            case .refused: failed += 1
            }
        }
        return (ok, failed, skipped)
    }
}
