import Foundation

/// A routine run read as a bot-to-bot exchange (2026-11-01): the
/// instruction the routine hands its bot, trimmed for its bubble.
public enum RoutineRunExchange {
    public static let instructionLimit = 600

    public static func instructionPreview(_ prompt: String) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > instructionLimit else { return trimmed }
        return String(trimmed.prefix(instructionLimit)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }
}
