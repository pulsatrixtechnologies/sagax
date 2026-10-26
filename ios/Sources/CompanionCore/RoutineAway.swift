// Routines that run only while the person is here (server/routine-away.ts,
// the desktop's RoutineAwayBanner). The phone shows the same report and
// can pause or resume every routine it is allowed to change.
import Foundation

public enum RoutineAway {
    /// The routines to report: skipped runs, and the person is back.
    /// Same rule as `awayReports` in RoutineAwayBanner.tsx.
    public static func reports(_ routines: [Routine]) -> [Routine] {
        routines.filter { skips in
            guard let away = skips.awaySkips, let count = away.count, count > 0 else { return false }
            return away.reportedAt != nil
        }
    }
}

/// Which routines a global pause or resume may touch: the person can edit
/// them, and a toggle still means something (`canToggle`).
public enum RoutinePauseAll {
    public static func pausable(_ routines: [Routine], now: Date = Date()) -> [Routine] {
        routines.filter { $0.mayEdit && $0.enabled && $0.canToggle(at: now) }
    }

    public static func resumable(_ routines: [Routine], now: Date = Date()) -> [Routine] {
        routines.filter { $0.mayEdit && !$0.enabled && $0.canToggle(at: now) }
    }
}
