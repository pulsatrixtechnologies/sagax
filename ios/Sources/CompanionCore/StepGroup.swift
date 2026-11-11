// One stretch of a bot's work as a single row: "Worked 2m 53s", the
// duration only, like "Thought 2s" in Grok (the count of tools and failures
// is read by VoiceOver and seen by opening the row). Opened, the steps in order, with the same step repeated back
// to back read once with a count ("Read a file ×3"). While the bot still
// works, the row says what it is doing now. The desktop's
// src/lib/step-group.ts, rule for rule.
import Foundation

/// A stretch of work in the transcript: tool steps and a settled turn's
/// narration, in order (`transcriptRows`).
public struct StepRun: Hashable, Sendable {
    public let messages: [Message]
    /// How long the bot worked, in milliseconds, when it is known.
    public let elapsed: Double?
    /// The turn whose narration the run folds, if any.
    public let turnId: String?
    /// #3581: false while the turn has no final message (it may still run).
    public let settled: Bool

    public init(messages: [Message], elapsed: Double? = nil, turnId: String? = nil, settled: Bool = true) {
        self.messages = messages
        self.elapsed = elapsed
        self.turnId = turnId
        self.settled = settled
    }

    public var id: String { turnId.map { "turn.\($0)" } ?? "run.\(messages[0].id)" }
    /// The bot's own words in the run (a settled turn's narration).
    public var narrated: Bool { messages.contains { !StepGroup.isStep($0) } }
    public var steps: [Message] { messages.filter(StepGroup.isStep) }

    /// The roster's English line ("Worked for 15s"), as the narration fold said it.
    public var englishLabel: String {
        guard let elapsed, elapsed >= 1_000 else { return "Worked" }
        let seconds = Int(elapsed / 1_000)
        let duration = seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(String(format: "%02d", seconds % 60))s"
        return "Worked for \(duration)"
    }
}

/// One entry of an opened run.
public enum StepEntry: Hashable, Sendable, Identifiable {
    /// One tool step, or the same step repeated back to back.
    case steps(id: String, messages: [Message], label: String, target: String?, phase: StepPhase, durationMs: Double?)
    /// Anything else in the run (a settled turn's narration), as it is.
    case message(Message)

    public var id: String {
        switch self {
        case let .steps(id, _, _, _, _, _): id
        case let .message(message): message.id
        }
    }
}

public struct StepGroupSummary: Hashable, Sendable {
    /// Tool steps in the run.
    public var tools = 0
    /// Of which failed.
    public var failed = 0
    /// The step running now, when the bot still works.
    public var running: Message?
}

/// The run's one line, in the person's language.
public struct StepGroupWords: Hashable, Sendable {
    /// "Worked 2m 53s", or the step running now.
    public var label: String
    /// What the running step acts on.
    public var target: String?
    /// "12 tools": not drawn on the row, only spoken.
    public var tools: String?
    /// "5 failed": not drawn on the row, only spoken.
    public var failed: String?
    /// The whole count for VoiceOver: "Worked 2m 53s, 12 tools, 5 failed,
    /// press to see the detail".
    public var accessibility: String
    public var phase: StepPhase
}

public enum StepGroup {
    /// A tool step inside a run (the rest is narration).
    public static func isStep(_ message: Message) -> Bool {
        message.kind == .activity && message.tool != nil && message.tool?.roleNotice == nil
    }

    /// The steps in order, consecutive identical steps (same words, same
    /// state) merged. A step still running is never merged.
    public static func merge(_ messages: [Message], words: StepWords, nameOf: StepNameOf? = nil) -> [StepEntry] {
        var entries: [StepEntry] = []
        for message in messages {
            guard isStep(message), let tool = message.tool else {
                entries.append(.message(message))
                continue
            }
            let reading = StepLabel.read(tool, words: words, nameOf: nameOf)
            let phase = StepPhase.of(tool)
            if case let .steps(id, merged, label, target, lastPhase, duration)? = entries.last,
               label == reading.label, lastPhase == phase, phase != .running,
               // a step under another role keeps its own row (and chip)
               merged.last?.tool?.role == tool.role {
                let total: Double? = duration.flatMap { sum in tool.durationMs.map { sum + $0 } }
                entries[entries.count - 1] = .steps(
                    id: id, messages: merged + [message], label: label,
                    target: target == reading.target ? target : nil, phase: phase, durationMs: total
                )
                continue
            }
            entries.append(.steps(
                id: message.id, messages: [message], label: reading.label,
                target: reading.target, phase: phase, durationMs: tool.durationMs
            ))
        }
        return entries
    }

    public static func summarize(_ messages: [Message]) -> StepGroupSummary {
        var summary = StepGroupSummary()
        for message in messages where isStep(message) {
            summary.tools += 1
            if message.tool?.ok == false { summary.failed += 1 }
            if message.tool?.ok == nil { summary.running = message }
        }
        return summary
    }

    /// #3581 (one state told once): while the turn runs the row says
    /// "Working" and nothing more; the working line under the transcript is
    /// the one place that names the step in progress. `live`: the turn still
    /// runs, even between two steps (a turn writing a note has no running step).
    public static func words(_ summary: StepGroupSummary, elapsed: Double?, words: StepWords, nameOf: StepNameOf? = nil, live: Bool = false) -> StepGroupWords {
        let tools = summary.tools > 0
            ? words.t(summary.tools == 1 ? "step.turn.tools.one" : "step.turn.tools.many", ["count": String(summary.tools)])
            : nil
        let failed = summary.failed > 0
            ? words.t(summary.failed == 1 ? "step.turn.failed.one" : "step.turn.failed.many", ["count": String(summary.failed)])
            : nil
        func spoken(_ parts: String?...) -> String {
            let summary = parts.compactMap { $0 }.joined(separator: ", ")
            let sentence = words.t("step.turn.a11y", ["summary": summary])
            // a catalog without the key (an older one) reads the parts alone
            return sentence == "step.turn.a11y" ? summary : sentence
        }
        if live || summary.running != nil {
            let label = words.t("chat.activity.working")
            return StepGroupWords(
                label: label, target: nil, tools: tools, failed: failed,
                accessibility: spoken(label, tools, failed), phase: .running
            )
        }
        let duration = elapsed.flatMap { $0 >= 1_000 ? StepLabel.duration($0, words: words) : nil }
        let label = duration.map { words.t("step.turn.workedFor", ["elapsed": $0]) } ?? words.t("step.turn.worked")
        return StepGroupWords(label: label, tools: tools, failed: failed, accessibility: spoken(label, tools, failed), phase: .done)
    }

    /// How long a stretch of steps ran: from the first start to the last
    /// end. Nil while a step still runs or when nothing says.
    public static func span(_ messages: [Message]) -> Double? {
        let steps = messages.filter(isStep)
        guard !steps.isEmpty, !steps.contains(where: { $0.tool?.ok == nil }) else { return nil }
        let start = steps.map(\.at).min() ?? 0
        let end = steps.map { $0.at + ($0.tool?.durationMs ?? 0) }.max() ?? 0
        let span = end - start
        if span >= 1_000 { return span }
        // steps stamped at the same moment: their own durations, added up
        var total = 0.0
        for step in steps {
            guard let ms = step.tool?.durationMs else { return span > 0 ? span : nil }
            total += ms
        }
        return total
    }
}
