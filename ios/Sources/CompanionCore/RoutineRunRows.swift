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
    public static func outOfChat(_ message: Message) -> Bool {
        guard message.kind == .routineRun, let run = message.routineRun, !run.status.isEmpty,
              !alwaysDrawn(message, run) else { return false }
        switch run.status {
        case "queued", "running", "waiting", "failed", "missed":
            return false
        case "completed":
            // an empty text says nothing, as on the desktop (a falsy string)
            return run.problems?.isEmpty == false || run.recovered != nil
                || (run.wakeTopic?.isEmpty == false && !run.forPerson)
        default:
            return true
        }
    }

    /// A row every filter draws, whatever else it says.
    private static func alwaysDrawn(_ message: Message, _ run: RoutineRunCard) -> Bool {
        message.attention != nil || run.goalStatus != nil || run.startedBy == "person"
            || run.repeat?.streak == true || run.recovered?.streak == true
            || (run.autoPausedAfter ?? 0) > 0
    }
}
