// #4101: the iPhone bot panel as the reference app draws it. The rows and
// their order, the Routines row's count, the Library chips and the measures
// that keep every card, title and footnote on one left and one right edge.
import CompanionCore
import Foundation
import XCTest

final class PhoneBotPanelPlanTests: XCTestCase {
    private func routine(_ id: String, bot: String = "b1", enabled: Bool) throws -> Routine {
        let json = """
        {"id":"\(id)","name":"\(id)","prompt":"p","botId":"\(bot)","runOn":"maus","enabled":\(enabled),
         "schedule":{"type":"daily","time":"09:00"},"durationMinutes":30,"nextRunAt":null,"createdAt":1,"updatedAt":2}
        """
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    func testThePanelGroupsItsRowsAsTheReference() {
        let plan = PhoneBotPanelPlan.make(slack: true, email: true)
        // Library and Computer first, the activity beside them (nothing of
        // the former Activity tab is dropped)
        XCTAssertEqual(plan.top, [.library, .computer, .activity])
        // "Configure bot": the channels, Voice chat, then Routines
        XCTAssertEqual(plan.configure, [.slack, .email, .voiceChat, .routines])
        XCTAssertEqual(Set(plan.rows).count, plan.rows.count, "each row once")
    }

    func testAChannelTheBotCannotUseIsLeftOut() {
        let plan = PhoneBotPanelPlan.make(slack: false, email: false)
        XCTAssertFalse(plan.rows.contains(.slack))
        XCTAssertFalse(plan.rows.contains(.email))
        XCTAssertEqual(plan.configure, [.voiceChat, .routines])
    }

    func testTheRoutinesRowCountsThisBotsRoutinesThatAreOn() throws {
        let list = [
            try routine("a", enabled: true),
            try routine("b", enabled: false),
            try routine("c", enabled: true),
            try routine("d", bot: "b2", enabled: true),
        ]
        XCTAssertEqual(PhoneBotPanelPlan.routinesOn(botId: "b1", in: list), 2)
        XCTAssertEqual(PhoneBotPanelPlan.routinesOn(botId: "b3", in: list), 0)
    }

    func testEveryGroupSharesOneEdge() {
        let m = PhonePanelMetrics.self
        // the reference's 26 px card edge on its 644 px wide photo of a 430 pt phone
        XCTAssertEqual(m.margin, 17)
        // the group title, the footnote, a switch row's text and a routine's
        // text start at one inset; the hairline starts at the label
        XCTAssertEqual(m.textInset, 20)
        XCTAssertGreaterThan(m.textColumn, m.iconCentre)
        XCTAssertLessThan(m.textColumn, m.iconCentre * 2, "the label sits beside the icon, not after its frame")
        XCTAssertEqual(m.groupGap, m.headerToCard)
        XCTAssertEqual(m.row, 52)
        XCTAssertEqual(m.routineSubtitleLines, 2)
    }

    func testTheLibraryChipsShowOnlyWhatCanBeListed() {
        let picture = LibraryEntry.file(ThreadFile(id: "p", source: .written, name: "shot.png", at: 1))
        let note = LibraryEntry.file(ThreadFile(id: "n", source: .written, name: "note.md", at: 1))
        XCTAssertTrue(PhoneLibraryChip.isMedia(picture))
        XCTAssertFalse(PhoneLibraryChip.isMedia(note))
        // nothing to choose: no chip row
        XCTAssertEqual(PhoneLibraryChip.visible(entries: [note], links: 0, selected: .all), [])
        XCTAssertEqual(PhoneLibraryChip.visible(entries: [note, picture], links: 0, selected: .all), [.all, .media])
        XCTAssertEqual(PhoneLibraryChip.visible(entries: [note], links: 3, selected: .all), [.all, .links])
        XCTAssertEqual(PhoneLibraryChip.visible(entries: [note, picture], links: 3, selected: .all), [.all, .media, .links])
        // a door that asked for a chip keeps it
        XCTAssertEqual(PhoneLibraryChip.visible(entries: [], links: 0, selected: .links), [.all, .links])
        XCTAssertEqual(PhoneLibraryChip.start(.links), .links)
        XCTAssertEqual(PhoneLibraryChip.start(.files(.image)), .media)
        XCTAssertEqual(PhoneLibraryChip.start(.files(.all)), .all)
        let groups = LibraryRules.groups(files: [ThreadFile(id: "p", source: .written, name: "shot.png", at: 1),
                                                 ThreadFile(id: "n", source: .written, name: "note.md", at: 1)],
                                         artifacts: [], now: 10 * 86_400_000)
        XCTAssertEqual(PhoneLibraryChip.filter(groups, .media).older.map(\.id), [picture.id])
        XCTAssertEqual(PhoneLibraryChip.filter(groups, .all), groups)
    }

    func testAllListsTheLinksWithTheFilesByDate() {
        let day = 86_400_000.0
        let now = 30 * day + day / 2
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let shot = ThreadFile(id: "s", source: .written, name: "shot.png", at: 10 * day)
        let older = ThreadFile(id: "o", source: .written, name: "old.png", at: 5 * day)
        let today = ThreadFile(id: "t", source: .written, name: "note.md", at: now - 1000)
        let groups = LibraryRules.groups(files: [shot, older, today], artifacts: [], now: now, calendar: utc)
        let fresh = BotLink(url: "https://example.com/today", at: now - 500)
        let old = BotLink(url: "https://docs.example.org/settings/tokens", at: 12 * day)
        let all = PhoneLibraryChip.items(groups, links: [fresh, old], chip: .all, now: now, calendar: utc)
        // the reference's All page: the link first, above the older files
        XCTAssertEqual(all.older.map(\.id), ["link:\(old.id)", LibraryEntry.file(shot).id, LibraryEntry.file(older).id])
        XCTAssertEqual(all.today.map(\.id), ["link:\(fresh.id)", LibraryEntry.file(today).id])
        XCTAssertTrue(all.pinned.isEmpty)
        if case let .link(link) = all.older[0] { XCTAssertEqual(link.domain, "docs.example.org", "a link row's second line is its host") } else { XCTFail("a link row") }
        // Media keeps pictures and videos only; no link
        let media = PhoneLibraryChip.items(groups, links: [fresh, old], chip: .media, now: now, calendar: utc)
        XCTAssertEqual(media.older.map(\.id), [LibraryEntry.file(shot).id, LibraryEntry.file(older).id])
        XCTAssertTrue(media.today.isEmpty)
        // only links: All is not empty
        let empty = LibraryRules.groups(files: [], artifacts: [], now: now, calendar: utc)
        XCTAssertFalse(PhoneLibraryChip.items(empty, links: [old], chip: .all, now: now, calendar: utc).isEmpty)
    }
}
