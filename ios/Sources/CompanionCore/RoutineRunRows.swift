// #4066: the routine run rows the chat leaves out, the desktop's rule
// (shared/routine-repeat.ts `routineRunRowOutOfChat`, #3990) rule for rule,
// so the phone's transcript and the desktop's draw the same rows.
//
// Left out: a row that only says how a run went (completed with problems,
// works again, nothing to report, blocked, cancelled, the same problem
// again), and a wake's row that carries nothing for the person, whatever
// its topic. Drawn as before: a live or waiting run, a result, items for
// the person, a run the person started, the streak's one summary (and its
// works again), a team goal's card, a routine that paused itself, and a
// failure (a passing banner, `TransientNotices`). Every run stays in its
// routine's run log (Automations).
import Foundation

public enum RoutineRunRows {
    /// Whether the chat leaves this row out.
    /// `counted` (#4201, `counted(_:)`): the first runs a stored count names.
    public static func outOfChat(_ message: Message, counted: Set<String> = []) -> Bool {
        guard message.kind == .routineRun, let run = message.routineRun, !run.status.isEmpty,
              !alwaysDrawn(message, run, counted) else { return false }
        switch run.status {
        case "queued", "running", "waiting", "failed", "missed":
            return false
        case "completed":
            // an empty text says nothing, as on the desktop (a falsy string).
            // #3990: a summary that is only a nothing phrase leaves too
            // (shared/routine-result.ts routineSaysNothing), brief excluded.
            return run.problems?.isEmpty == false || run.recovered != nil
                || (run.wakeTopic?.isEmpty == false && !run.forPerson)
                || Self.saysNothing(run.summary)
        default:
            return true
        }
    }

    /// A row every filter draws, whatever else it says.
    private static func alwaysDrawn(_ message: Message, _ run: RoutineRunCard, _ counted: Set<String>) -> Bool {
        message.attention != nil || run.goalStatus != nil || startedByPerson(run, counted)
            || run.repeat?.streak == true || run.recovered?.streak == true
            || (run.autoPausedAfter ?? 0) > 0
    }

    /// #4201: a run the person started. A row with a streak's count that is
    /// not its summary was stored for a run another bot, the bot's own
    /// routine or a wake asked for, which older servers took for the person's.
    /// Nor is the first run such a count names (`counted`).
    private static func startedByPerson(_ run: RoutineRunCard, _ counted: Set<String>) -> Bool {
        guard run.startedBy == "person" else { return false }
        guard let repeatCount = run.repeat else { return run.runId.isEmpty || !counted.contains(run.runId) }
        return repeatCount.streak
    }

    /// #4201: the first runs a stored count that is not the streak's summary
    /// names (`repeat.firstRunId`), taken only from a row stored as the
    /// person's: a count on a row of another starter can name a run the
    /// person really started, which stays. The chat leaves them out with
    /// the count (the desktop's `routineRunsCounted`).
    public static func counted(_ messages: [Message]) -> Set<String> {
        var firstRuns = Set<String>()
        for message in messages where message.kind == .routineRun {
            if let run = message.routineRun, run.startedBy == "person", let count = run.repeat, !count.streak, let first = count.firstRunId, !first.isEmpty {
                firstRuns.insert(first)
            }
        }
        return firstRuns
    }

    /// #3990: the whole summary is only a nothing phrase
    /// (shared/routine-result.ts `routineSaysNothing`). The brief is not read.
    private static func saysNothing(_ text: String?) -> Bool {
        guard let text else { return false }
        var plain = text.trimmingCharacters(in: .whitespacesAndNewlines)
        while plain.first == "*" || plain.first == "_" { plain.removeFirst() }
        while plain.last == "*" || plain.last == "_" { plain.removeLast() }
        plain = plain.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !plain.isEmpty, !plain.contains("?") else { return false }
        let range = NSRange(plain.startIndex..., in: plain)
        return nothingPhrase.firstMatch(in: plain, range: range) != nil
    }

    /// Same phrases as `ROUTINE_NOTHING_PHRASES` in shared/routine-result.ts.
    private static let nothingPhrase: NSRegularExpression = {
        let phrases = [
            "nothing (?:new |else |more )?to (?:report|do(?: on your side)?|flag|signal|bring up)",
            "no (?:action|follow[- ]up|change)s? (?:is |are )?(?:needed|required)",
            "nothing (?:found|changed|happened|new)",
            "nothing (?:for you|needs you)",
            "you have nothing to do",
            "nothing[\\s_-]to[\\s_-]report",
            "rien (?:de nouveau |d[\\u2019']autre |de plus )?à (?:signaler|faire(?: de (?:ton|votre) c(?:ô|o)t[eé])?|rapporter|remonter)",
            "rien de (?:nouveau|neuf)",
            "aucune? (?:action|suivi|changement)s? (?:n[\\u2019']est )?(?:requis|requise|nécessaire)",
            "rien (?:pour toi|pour vous)",
            "tu n[\\u2019']as rien à faire",
            "vous n[\\u2019']avez rien à faire",
            "rien n[\\u2019']est bloqué",
        ].joined(separator: "|")
        let pattern = "^(?:(?:ok(?:ay)?|done|all (?:good|clear|set|quiet))[\\s,.;:\\u2014\\u2013-]+)?(?:\(phrases))(?:[\\s,;]+(?:et |and )?(?:\(phrases)))?[\\s.!\\u2026]*$"
        return try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }()
}
