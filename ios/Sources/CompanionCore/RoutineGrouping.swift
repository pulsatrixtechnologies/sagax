import Foundation

// The Automations list grouped (src/lib/routine-grouping.ts, 2026-11-03):
// by bot (the default), each bot with its own routine folders inside; by
// folder across the bots; or none, the flat list. Which way and which
// sections are folded are per-person conveniences kept on the device.

public enum RoutineGroupBy: String, CaseIterable, Sendable {
    case bot, folder, none
}

public struct RoutineBotGroup: Identifiable, Hashable, Sendable {
    public var botId: String
    public var routines: [Routine]
    public var id: String { botId }
}

public enum RoutineGrouping {
    public static let groupByKey = "sagax.routines.groupBy.v1"
    public static let collapsedKey = "sagax.routines.groupsCollapsed.v1"

    public static func botKey(_ botId: String) -> String { "bot:\(botId)" }
    public static func folderKey(_ folder: String?) -> String {
        folder.map { "folder:\(RoutineFolders.key($0))" } ?? "folder:"
    }

    /// One section per bot that has a routine here, in `botOrder` (the
    /// sidebar's: the Primary Bot, the pinned bots, the others as kept); a bot
    /// the list does not know after them, in the order its routines come.
    public static func byBot(_ routines: [Routine], botOrder: [String]) -> [RoutineBotGroup] {
        var buckets: [String: [Routine]] = [:]
        var arrival: [String] = []
        for routine in routines {
            if buckets[routine.botId] == nil { arrival.append(routine.botId) }
            buckets[routine.botId, default: []].append(routine)
        }
        var out: [RoutineBotGroup] = []
        for id in botOrder {
            if let items = buckets.removeValue(forKey: id) { out.append(RoutineBotGroup(botId: id, routines: items)) }
        }
        for id in arrival {
            if let items = buckets.removeValue(forKey: id) { out.append(RoutineBotGroup(botId: id, routines: items)) }
        }
        return out
    }

    /// The bots in the sidebar's order: pinned first, then the others as
    /// they come (the chief of staff leads).
    public static func sidebarOrder(_ bots: [Bot]) -> [String] {
        func rank(_ bot: Bot) -> Int { bot.chiefOfStaff == true ? 0 : bot.pinned == true ? 1 : 2 }
        return bots.enumerated().sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }.map(\.element.id)
    }

    /// Group by Folder: one section per folder name (any case) across the
    /// bots; the routines in no folder first. Only folders with a routine.
    public static func byFolder(_ routines: [Routine], folders: [String: [String]], botOrder: [String]) -> [RoutineFolderGroup] {
        var names: [String] = []
        var seen = Set<String>()
        for group in byBot(routines, botOrder: botOrder) {
            for name in RoutineFolders.ordered(folders[group.botId] ?? [], routines: group.routines)
            where seen.insert(RoutineFolders.key(name)).inserted { names.append(name) }
        }
        var buckets: [String: [Routine]] = [:]
        var loose: [Routine] = []
        for routine in routines {
            if let folder = routine.folder, !folder.isEmpty, seen.contains(RoutineFolders.key(folder)) {
                buckets[RoutineFolders.key(folder), default: []].append(routine)
            } else { loose.append(routine) }
        }
        return (loose.isEmpty ? [] : [RoutineFolderGroup(folder: nil, routines: loose)])
            + names.compactMap { name in
                buckets[RoutineFolders.key(name)].map { RoutineFolderGroup(folder: name, routines: $0) }
            }
    }

    /// A bot section's live summary: how many routines run right now, how
    /// many fail (a failure streak, or paused after failures).
    public static func health(_ routines: [Routine], runs: [RoutineRun]) -> (running: Int, failing: Int) {
        var running = 0, failing = 0
        for routine in routines {
            if runs.contains(where: { $0.routineId == routine.id && $0.status == "running" }) { running += 1 }
            else if (routine.failureStreak ?? 0) > 0 || (!routine.enabled && routine.autoPaused != nil) { failing += 1 }
        }
        return (running, failing)
    }
}
