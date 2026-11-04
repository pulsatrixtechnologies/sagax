// What a routine edit sends: only the fields the person changed.
//
// A desktop routine carries more than any one editor may show: an interval's
// days, run-between window and end date, overlap, attachments, a results
// thread, a room-goal target. Resending a whole form on every save once wrote
// the phone's partial view over the desktop's full one (matrix AU13), so an
// edit is a diff against the routine it started from: a field the editor did
// not change (or does not know) is never sent, and the server keeps it (S3).
import Foundation

public enum RoutinePatch {
    /// The PATCH body: each top-level field only when it differs from
    /// `original`. The schedule, when it changed, is sent whole (the server
    /// validates a schedule as a unit) with the interval restrictions the
    /// editor does not show carried over from `original`.
    public static func body(original: Routine, input: RoutineInput) -> [String: Any] {
        var body: [String: Any] = [:]
        if input.name != original.name { body["name"] = input.name }
        if input.prompt != original.prompt { body["prompt"] = input.prompt }
        if input.botId != original.botId { body["botId"] = input.botId }
        if input.runOn != original.runOn { body["runOn"] = input.runOn }
        if let enabled = input.enabled, enabled != original.enabled { body["enabled"] = enabled }
        let schedule = input.completeSchedule
            ? input.schedule
            : input.schedule.keepingIntervalRestrictions(of: original.schedule)
        if !sameSchedule(schedule, original.schedule) {
            body["schedule"] = scheduleBody(schedule, clearingAbsent: input.completeSchedule)
        }
        if input.durationMinutes != original.durationMinutes { body["durationMinutes"] = input.durationMinutes }
        let timeout = input.timeoutMinutes ?? (input.clearTimeout ? nil : original.timeoutMinutes)
        if timeout != original.timeoutMinutes { body["timeoutMinutes"] = timeout.map { $0 as Any } ?? NSNull() }
        if let target = input.target {
            if target != (original.target ?? "bot") { body["target"] = target }
            let groupId = target == "room-goal" ? input.groupId : nil
            if groupId != original.groupId { body["groupId"] = groupId.map { $0 as Any } ?? NSNull() }
        }
        if let overlap = input.overlap, overlap != (original.overlap ?? "skip") { body["overlap"] = overlap }
        if let attachments = input.attachments, attachments != (original.attachments ?? []) {
            body["attachments"] = attachments.map(attachmentBody)
        }
        switch input.results {
        case .keep: break
        case .newThread: body["resultsThreadId"] = NSNull()
        case let .thread(id): if id != original.resultsThreadId { body["resultsThreadId"] = id }
        }
        if let runAs = input.runAs, !runAs.isEmpty, runAs != original.runAs?.principalId { body["runAs"] = runAs }
        if let onlyWhenPresent = input.onlyWhenPresent, onlyWhenPresent != (original.onlyWhenPresent == true) {
            body["onlyWhenPresent"] = onlyWhenPresent
        }
        if let postResults = input.postResults, postResults != (original.postResults == true) {
            body["postResults"] = postResults
        }
        if let deleteWhenFinished = input.deleteWhenFinished, deleteWhenFinished != (original.deleteWhenFinished == true) {
            body["deleteWhenFinished"] = deleteWhenFinished
        }
        if let after = input.autoPauseAfter, after != RoutineAutoPause.after(original) {
            body["autoPauseAfter"] = after
        }
        switch input.watch {
        case .keep: break
        case let .set(watch): if watch != original.precheck { body["precheck"] = watch.bodyValue }
        case .remove: if RoutineWatchRules.watch(original.precheck) != nil { body["precheck"] = NSNull() }
        }
        if let continuity = input.continuity, continuity != (original.continuity == true) { body["continuity"] = continuity }
        if let alias = input.mailAlias.map(RoutineMailTag.clean), alias != (original.mailAlias ?? "") {
            body["mailAlias"] = alias.isEmpty ? NSNull() : alias
        }
        return body
    }

    /// A new routine (`POST /api/routines`): every field the editor holds.
    public static func createBody(_ input: RoutineInput) -> [String: Any] {
        var body: [String: Any] = [
            "name": input.name, "prompt": input.prompt, "botId": input.botId,
            "runOn": input.runOn, "schedule": scheduleBody(input.schedule),
            "durationMinutes": input.durationMinutes,
        ]
        if let timeoutMinutes = input.timeoutMinutes { body["timeoutMinutes"] = timeoutMinutes }
        else if input.clearTimeout { body["timeoutMinutes"] = NSNull() }
        if let enabled = input.enabled { body["enabled"] = enabled }
        if let target = input.target {
            body["target"] = target
            if target == "room-goal" { body["groupId"] = input.groupId.map { $0 as Any } ?? NSNull() }
        } else if let groupId = input.groupId {
            // a room's /loop: the routine posts in that room (useComposerCommands.ts)
            body["groupId"] = groupId
        }
        if let overlap = input.overlap { body["overlap"] = overlap }
        if let attachments = input.attachments { body["attachments"] = attachments.map(attachmentBody) }
        switch input.results {
        case .keep: break
        case .newThread: body["resultsThreadId"] = NSNull()
        case let .thread(id): body["resultsThreadId"] = id
        }
        if let runAs = input.runAs, !runAs.isEmpty { body["runAs"] = runAs }
        if input.onlyWhenPresent == true { body["onlyWhenPresent"] = true }
        if let postResults = input.postResults { body["postResults"] = postResults }
        if input.deleteWhenFinished == true { body["deleteWhenFinished"] = true }
        if let after = input.autoPauseAfter, after != RoutineAutoPause.defaultAfter { body["autoPauseAfter"] = after }
        if case let .set(watch) = input.watch { body["precheck"] = watch.bodyValue }
        if input.continuity == true { body["continuity"] = true }
        if let alias = input.mailAlias.map(RoutineMailTag.clean), !alias.isEmpty { body["mailAlias"] = alias }
        return body
    }

    static func attachmentBody(_ attachment: RoutineAttachment) -> [String: Any] {
        ["id": attachment.id, "kind": attachment.kind, "name": attachment.name, "path": attachment.path, "size": attachment.size]
    }

    /// One schedule as the wire takes it (`RoutineScheduleInput`), every
    /// field the schedule carries and nothing it does not.
    /// `clearingAbsent`: an interval without days, window or end date says
    /// so with null, which the server reads as "every day, all day, never".
    public static func scheduleBody(_ schedule: RoutineSchedule, clearingAbsent: Bool = false) -> [String: Any] {
        var body: [String: Any] = ["type": schedule.type.rawValue]
        if let at = schedule.at { body["at"] = at }
        if let time = schedule.time { body["time"] = time }
        if let weekdays = schedule.weekdays { body["weekdays"] = weekdays }
        if let everyMinutes = schedule.everyMinutes { body["everyMinutes"] = everyMinutes }
        if let anchorAt = schedule.anchorAt { body["anchorAt"] = anchorAt }
        if let expression = schedule.expression { body["expression"] = expression }
        if let timeZone = schedule.timeZone { body["timeZone"] = timeZone }
        if let window = schedule.window { body["window"] = ["start": window.start, "end": window.end] }
        if let endsAt = schedule.endsAt { body["endsAt"] = endsAt }
        if let source = schedule.source { body["source"] = source }
        if clearingAbsent && schedule.type == .interval {
            if schedule.weekdays == nil { body["weekdays"] = NSNull() }
            if schedule.window == nil { body["window"] = NSNull() }
            if schedule.endsAt == nil { body["endsAt"] = NSNull() }
        }
        return body
    }

    /// Equal as the server reads them: `at` to the millisecond (a Date
    /// round trip leaves float dust), weekdays as a set.
    static func sameSchedule(_ a: RoutineSchedule, _ b: RoutineSchedule) -> Bool {
        a.type == b.type
            && a.at.map { Int64($0.rounded()) } == b.at.map { Int64($0.rounded()) }
            && a.time == b.time
            && a.weekdays.map(Set.init) == b.weekdays.map(Set.init)
            && a.everyMinutes == b.everyMinutes
            && a.anchorAt == b.anchorAt
            && a.expression == b.expression
            && a.timeZone == b.timeZone
            && a.window == b.window
            && a.endsAt == b.endsAt
            && a.source == b.source
            && sameTiming(a, b)
    }

    /// No timing reads as exact; a flexible window is part of the schedule.
    static func sameTiming(_ a: RoutineSchedule, _ b: RoutineSchedule) -> Bool {
        let modeA = a.timing ?? "exact", modeB = b.timing ?? "exact"
        guard modeA == modeB else { return false }
        guard modeA == "flexible" else { return true }
        return a.windowEarlyMinutes == b.windowEarlyMinutes && a.windowLateMinutes == b.windowLateMinutes
    }
}

/// A routine's mail tag (`shared/routine-mail-alias.ts`): letters and
/// digits only, lowercase, 32 at most, so it cannot change the domain or
/// add a recipient.
public enum RoutineMailTag {
    public static func clean(_ text: String) -> String {
        String(text.lowercased().filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }.prefix(32))
    }
}
