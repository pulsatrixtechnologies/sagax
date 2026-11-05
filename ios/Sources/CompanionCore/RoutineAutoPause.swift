import Foundation

/// A routine pauses itself after N failed runs in a row (2026-10-26, the
/// desktop's shared/routine-auto-pause.ts). N is the routine's own setting,
/// chosen in the routine editor by the person, no admin: absent is the
/// default (5), 0 never pauses. Resume (the passing notice, the switch)
/// turns it back on and starts the count again from zero; its failed runs
/// stay in the history.
public enum RoutineAutoPause {
    public static let defaultAfter = 5
    public static let maxAfter = 100
    /// The editor's choices (0 = never), as on the desktop.
    public static let choices = [0, 1, 2, 3, 5, 10, 20]

    /// How many failures in a row pause this routine; 0 never.
    public static func after(_ routine: Routine) -> Int {
        guard let value = routine.autoPauseAfter, (0...maxAfter).contains(value) else { return defaultAfter }
        return value
    }

    /// The choices, the routine's own other count kept.
    public static func choices(keeping current: Int) -> [Int] {
        var list = choices
        if !list.contains(current) { list.append(current) }
        return list.sorted { $0 == 0 ? true : $1 == 0 ? false : $0 < $1 }
    }

    /// The editor's words for a choice (English; Localizable.xcstrings
    /// translates the app's strings).
    public static func optionText(_ count: Int) -> String {
        if count == 0 { return "Never" }
        return count == 1 ? "After 1 failed run" : "After \(count) failed runs in a row"
    }

    /// The notice's, the list's and the history's words (Localizable.xcstrings;
    /// desktop `routines.autoPause.pausedAfter` / `pausedAfterOne`).
    public static func pausedText(_ failures: Int) -> String {
        failures == 1
            ? String(localized: "Paused after a failure")
            : String(localized: "Paused after \(failures) failures in a row")
    }

    /// Paused by itself and not turned back on since.
    public static func isAutoPaused(_ routine: Routine) -> Bool {
        !routine.enabled && routine.autoPaused != nil
    }
}

/// `Routine.autoPaused`: when and after how many failures it paused itself.
public struct RoutineAutoPauseState: Codable, Hashable, Sendable {
    public var at: Double?
    public var failures: Int?
    public var runId: String?
}

/// `RoutineRun.autoPaused`: this failure paused its routine.
public struct RoutineRunAutoPause: Codable, Hashable, Sendable {
    public var failures: Int?
}
