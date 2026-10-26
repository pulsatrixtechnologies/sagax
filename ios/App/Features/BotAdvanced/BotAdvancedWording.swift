// The advanced panel's sentences (WP16), built from CompanionCore's
// structured rules with the same words the desktop renders
// (src/lib/memory.ts journalSummary, journalSource, tidySummary,
// relativeTime; HistorySection's row line), localized.
import CompanionCore
import Foundation

enum BotAdvancedWording {
    /// `relativeTime`.
    static func ago(_ at: Double, now: Date = Date()) -> String {
        switch MemoryRules.ago(at, now: now) {
        case .justNow: String(localized: "just now")
        case let .minutes(count): String(localized: "\(count) min ago")
        case let .hours(count): String(localized: "\(count) hr ago")
        case .yesterday: String(localized: "yesterday")
        case let .days(count): String(localized: "\(count) days ago")
        case let .date(date): date.formatted(.dateTime.month(.abbreviated).day())
        }
    }

    /// The last capture's receipt, as MemoryUpkeepCard words it: what it
    /// noticed, then what memory already held (parity M3). Empty when it
    /// found nothing at all.
    static func captureReceipt(_ capture: CaptureReport) -> String {
        let known = capture.known ?? 0
        let knownText = known == 0 ? "" : " " + (known == 1
            ? String(localized: "1 was already known.")
            : String(localized: "\(known) were already known."))
        if capture.noticed > 0 {
            return (capture.noticed == 1
                ? String(localized: "Last noticed 1 fact \(ago(capture.at)).")
                : String(localized: "Last noticed \(capture.noticed) facts \(ago(capture.at)).")) + knownText
        }
        return known > 0 ? String(localized: "Last capture \(ago(capture.at)): nothing new.") + knownText : ""
    }

    /// `journalSummary`: "Ara added 2 lines to MEMORY.md".
    static func journalSummary(_ row: MemoryJournalRow, botName: String) -> String {
        let who: String = switch row.who {
        case .bot: botName
        case .anImport: String(localized: "An import")
        case .upkeep: String(localized: "Memory upkeep")
        case .you: String(localized: "You")
        }
        let file: String = switch row.target {
        case .index: "MEMORY.md"
        case let .log(day): String(localized: "the \(day) log")
        case let .topic(name): String(localized: "the \(name) topic")
        }
        switch row.change {
        case let .created(lines):
            return lines > 0
                ? String(localized: "\(who) created \(file) with \(lines) lines")
                : String(localized: "\(who) created \(file)")
        case .deleted:
            return String(localized: "\(who) deleted \(file)")
        case let .added(lines):
            return String(localized: "\(who) added \(lines) lines to \(file)")
        case let .removed(lines):
            return String(localized: "\(who) removed \(lines) lines from \(file)")
        case let .rewrote(lines):
            return String(localized: "\(who) rewrote \(lines) lines in \(file)")
        }
    }

    /// `journalSource`.
    static func journalSource(_ row: MemoryJournalRow) -> String? {
        switch row.source {
        case .undo: String(localized: "undo")
        case .outside: String(localized: "changed outside the app")
        case .tidy: String(localized: "tidy-up")
        case .organize: String(localized: "filed into topics")
        case let .noticed(title):
            title.map { String(localized: "noticed in chat “\($0)”") } ?? String(localized: "noticed in a chat")
        case let .chat(title): String(localized: "from chat “\(title)”")
        case .task: String(localized: "during a task")
        case .settings: String(localized: "in Settings")
        case .api: String(localized: "through the API")
        case nil: nil
        }
    }

    /// `tidySummary`: "Archived 1 expired note, merged 2 duplicates".
    static func tidySummary(_ report: TidyReport) -> String {
        let parts = report.parts.map { part -> String in
            switch part {
            case let .expired(count): String(localized: "archived \(count) expired notes")
            case let .duplicates(count): String(localized: "merged \(count) duplicates")
            case let .superseded(count): String(localized: "crossed out \(count) contradicted notes")
            case let .organized(count): String(localized: "filed \(count) notes into topics")
            }
        }
        let head = parts.isEmpty ? String(localized: "nothing to tidy") : parts.joined(separator: ", ")
        return head.prefix(1).uppercased() + head.dropFirst()
    }

    /// The history row's line: "3 min ago · You via phone · Renamed".
    static func historyLine(_ row: BotHistoryRow) -> String {
        "\(when(row.at)) · " + String(localized: "\(row.actor) via \(row.via)") + " · \(row.summary)"
    }

    /// `whenLabel`: the time today, the day otherwise.
    static func when(_ at: Double) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        return Calendar.current.isDateInToday(date)
            ? date.formatted(date: .omitted, time: .shortened)
            : date.formatted(.dateTime.month(.abbreviated).day())
    }
}
