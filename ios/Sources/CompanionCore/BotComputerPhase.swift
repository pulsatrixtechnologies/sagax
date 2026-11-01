import Foundation

/// The bot panel's Computer tab, as Grok Bot shows it (2026-11-01): the
/// computer asleep (the mascot dozing), waking up, or running (the live
/// screen alone). Off when the bot works without a computer.
public enum BotComputerPhase: String, Equatable, Sendable {
    case off, asleep, waking, running

    /// How long "Waking up..." shows after the person wakes it.
    public static let wakeWindow: TimeInterval = 3

    public static func of(computer: String?, busy: Bool, wakeRequestedAt: Date?, now: Date) -> BotComputerPhase {
        if computer == "off" { return .off }
        if busy { return .running }
        guard let wakeRequestedAt else { return .asleep }
        return now.timeIntervalSince(wakeRequestedAt) < wakeWindow ? .waking : .running
    }
}
