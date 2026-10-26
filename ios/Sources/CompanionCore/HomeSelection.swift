// Pure rules of the home list's bulk selection and its "more unread" pills
// (the desktop's Sidebar multi-select and `offscreenUnread`, #911).
import Foundation

/// One row's place in the scrolling list, in the list's own coordinate space.
public struct UnreadRowBox: Hashable, Sendable {
    public var id: String
    public var top: Double
    public var bottom: Double
    public var unread: Bool

    public init(id: String, top: Double, bottom: Double, unread: Bool) {
        self.id = id
        self.top = top
        self.bottom = bottom
        self.unread = unread
    }
}

/// Unread rows scrolled out of view: how many above and below, and the
/// nearest one each way to jump to. A row cut by an edge counts as seen
/// once at least half of it shows.
public struct OffscreenUnread: Equatable, Sendable {
    public var above: Int
    public var below: Int
    public var nearestAbove: String?
    public var nearestBelow: String?

    public init(above: Int, below: Int, nearestAbove: String?, nearestBelow: String?) {
        self.above = above
        self.below = below
        self.nearestAbove = nearestAbove
        self.nearestBelow = nearestBelow
    }

    public static func compute(rows: [UnreadRowBox], viewportTop: Double, viewportBottom: Double) -> OffscreenUnread {
        var result = OffscreenUnread(above: 0, below: 0, nearestAbove: nil, nearestBelow: nil)
        for row in rows.sorted(by: { $0.top < $1.top }) where row.unread {
            let middle = (row.top + row.bottom) / 2
            if middle < viewportTop {
                result.above += 1
                result.nearestAbove = row.id
            } else if middle > viewportBottom {
                result.below += 1
                if result.nearestBelow == nil { result.nearestBelow = row.id }
            }
        }
        return result
    }
}

/// What a bulk action does to a selection of bots.
public enum BulkBotSelection {
    /// Pin when any selected bot is not pinned; otherwise unpin them all.
    public static func shouldPin(_ bots: [Bot]) -> Bool {
        bots.contains { $0.pinned != true }
    }

    /// The bots a bulk Archive may take: never the Primary Bot, and never
    /// the last active one (the same rules as a single Archive).
    public static func archivable(_ selected: [Bot], activeBotCount: Int) -> [Bot] {
        let candidates = selected.filter { $0.chiefOfStaff != true && $0.hidden != true }
        let allowed = max(0, activeBotCount - 1)
        return Array(candidates.prefix(allowed))
    }
}
