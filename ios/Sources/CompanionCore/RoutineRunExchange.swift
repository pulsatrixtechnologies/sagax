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

/// Lot 5 phone detail: which sections the routine page shows. Instruction
/// and Schedule always; Webhook only for a webhook trigger; Run history is
/// its own page (not an inline list).
public enum RoutineDetailSections {
    public static func showsWebhook(_ schedule: RoutineSchedule) -> Bool {
        schedule.type == .webhook
    }

    /// Trimmed instruction body, or nil when the card should use its empty
    /// placeholder ("No instructions yet.").
    public static func instructionBody(_ prompt: String) -> String? {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
