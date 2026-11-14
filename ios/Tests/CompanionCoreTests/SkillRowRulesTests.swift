// #4165: the iPad Skills page (PersonaSkillsPage) drew the old big skill
// row: a switch on the row, a source disclosure, a "Shared with" line and
// the blocked line with Review changes. The desktop profile's compact row
// (#4148, #4166) is now the iPad's too: glyph, name, one grey line with
// "Needs review" or "Off", the shared glyph whose label lists the bots, the
// more menu with Turn on / Turn off and Review changes, the rest behind the
// open. Learn from use is the page's switch row with its glyph and help.
import Foundation
import XCTest
@testable import CompanionCore

final class SkillRowRulesTests: XCTestCase {
    private let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    private let blocked = "stored SKILL.md changed after review - enablement is blocked"

    private func source(_ path: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    private func slice(_ text: String, from start: String, to end: String) throws -> String {
        let from = try XCTUnwrap(text.range(of: start), "\(start) is in the file")
        let rest = text[from.upperBound...]
        let to = rest.range(of: end)?.lowerBound ?? rest.endIndex
        return String(text[from.lowerBound..<to])
    }

    func testTheGreyLineStateFollowsTheDesktop() {
        let on = ManagedSkill(name: "a", description: "Does a", enabled: true)
        let off = ManagedSkill(name: "b", enabled: false)
        let warned = ManagedSkill(name: "c", enabled: false, warnings: [blocked])
        XCTAssertEqual(SkillRowRules.state(on, origin: .private), .on)
        XCTAssertEqual(SkillRowRules.state(off, origin: nil), .off)
        XCTAssertEqual(SkillRowRules.state(warned, origin: .private), .needsPerson, "Needs review wins over Off")
        XCTAssertEqual(SkillRowRules.state(off, origin: .native), .on, "an engine's own skill is never Off")
        XCTAssertTrue(SkillRowRules.changedAfterReview(warned))
        XCTAssertTrue(SkillRowRules.detailWarnings(warned).isEmpty, "the open view says changed after review itself")
        XCTAssertEqual(SkillRowRules.detailWarnings(ManagedSkill(name: "d", enabled: true, warnings: ["x"])), ["x"])
    }

    func testTheMenuCarriesTurnOnOffAndReviewChanges() {
        let warned = ManagedSkill(name: "c", enabled: true, warnings: [blocked])
        XCTAssertEqual(SkillRowRules.actions(warned, origin: .private, libraryOn: true, canWrite: true),
                       [.open, .review, .edit, .turnOff, .share, .remove])
        let off = ManagedSkill(name: "b", enabled: false)
        XCTAssertEqual(SkillRowRules.actions(off, origin: .me, libraryOn: true, canWrite: true),
                       [.open, .turnOn, .unshare, .remove], "a shared copy is read, not edited, here")
        XCTAssertEqual(SkillRowRules.actions(off, origin: nil, libraryOn: false, canWrite: true), [.open, .edit, .turnOn, .remove])
        XCTAssertEqual(SkillRowRules.actions(off, origin: .private, libraryOn: true, canWrite: false), [.open])
        XCTAssertEqual(SkillRowRules.actions(off, origin: .native, libraryOn: true, canWrite: true), [.open])
        XCTAssertEqual(SkillRowRules.detailActions(warned, origin: .private, libraryOn: true, canWrite: true), [.turnOff, .share, .remove])
    }

    func testSharedBotsAndOrder() throws {
        let info = SkillOriginInfo(name: "a", origin: .me, assignedBots: [.init(id: "1", name: "Helios"), .init(id: "2", name: "Ara")])
        XCTAssertEqual(SkillRowRules.sharedBots(info, libraryOn: true), ["Helios", "Ara"])
        XCTAssertNil(SkillRowRules.sharedBots(info, libraryOn: false))
        XCTAssertNil(SkillRowRules.sharedBots(SkillOriginInfo(name: "a", origin: .private), libraryOn: true))
        let list = [ManagedSkill(name: "a", enabled: true), ManagedSkill(name: "b", enabled: true, warnings: ["w"]),
                    ManagedSkill(name: "c", enabled: false), ManagedSkill(name: "d", enabled: true, warnings: [blocked])]
        XCTAssertEqual(SkillRowRules.ordered(list).map(\.name), ["b", "d", "a", "c"], "a skill that needs the person stays first")
        let listing = try JSONDecoder().decode(SkillsLibraryListing.self, from: Data(#"{"skills":[{"name":"n","origin":"native"}]}"#.utf8))
        XCTAssertEqual(listing.origin(of: "n")?.origin, .native)
    }

    func testLearnFromUseIsTheBotsOwnField() throws {
        let bot = try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"b1","threadId":"t1","name":"Ara","title":"Ops","description":"","notifications":true,"color":"blue",
        "unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":1,"skillLearning":false}
        """#.utf8))
        XCTAssertEqual(bot.skillLearning, false)
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(BotAccessPatch(skillLearning: true))) as? [String: Any]
        XCTAssertEqual(body?["skillLearning"] as? Bool, true)
        XCTAssertEqual(body?.count, 1)
    }

    /// The iPad page draws the compact row: no switch, no source disclosure,
    /// no "Shared with" or blocked line on the row; the menu and the open
    /// carry them.
    func testTheIPadRowIsTheCompactRow() throws {
        let page = try source("App/Desktop/PersonaPagesInstructions.swift")
        let row = try slice(page, from: "private func row(_ skill: ManagedSkill)", to: "\n    }\n")
        for gone in ["PanelSwitch(", "DisclosureGroup", "DesktopText(verbatim: instructionsText(\"botPanel.skills.sharedWith\"", "enablement is blocked"] {
            XCTAssertFalse(row.contains(gone), "the row no longer draws \(gone)")
        }
        for kept in ["DesktopIconView(icon: .bookOpen", "stateLine(", "PersonaSkillSharedGlyph(",
                     "SkillRowRules.actions(", "desktop-skills.menu.", "desktop-skills.open.", "minHeight: 56"] {
            XCTAssertTrue(row.contains(kept), "the row draws \(kept)")
        }
        let line = try slice(page, from: "private func stateLine(", to: "\n    }\n")
        XCTAssertTrue(line.contains("\"Needs review\"") && line.contains("theme.warning"), "a short orange Needs review")
        XCTAssertTrue(line.contains("\"Off\""))
        let glyph = try slice(page, from: "private struct PersonaSkillSharedGlyph", to: "\n}\n")
        XCTAssertTrue(glyph.contains("DesktopIconView(icon: .users") && glyph.contains("accessibilityLabel"), "the shared glyph names the bots")
        // the list puts the skills that need the person first, folded after
        // four rows with the shared "Show N more" / "Show less" line
        XCTAssertTrue(page.contains("SkillRowRules.fold(model.skills"))
        XCTAssertTrue(page.contains("\"Show %lld more\"") && page.contains("\"Show less\""))
        XCTAssertTrue(page.contains("desktop-skills.fold"))
        // what the row no longer shows is behind the open
        let details = try slice(page, from: "struct PersonaSkillDetails", to: "\n}\n")
        for kept in ["SkillRowRules.detailActions(", "SkillRowRules.detailWarnings(", "SkillSourceLabel.of(", "botPanel.skills.sharedWith",
                     "Private to this bot"] {
            XCTAssertTrue(details.contains(kept), "the opened skill shows \(kept)")
        }
        // the opened skill says its source and warnings once (in the details)
        let sheet = try slice(page, from: "private func reviewSheet(", to: "\n    }\n")
        XCTAssertTrue(sheet.contains("if reviewing {\n                        DesktopText(verbatim: instructionsText(\"Source: %@\""), "Source once")
        XCTAssertTrue(sheet.contains("if reviewing, !skill.warnings.isEmpty"), "the warnings once")
        // Learn from use: the page's switch row, its glyph and its help
        let learning = try slice(page, from: "private var learnFromUse", to: "\n    }\n")
        XCTAssertTrue(learning.contains("DesktopDescribedRow("))
        XCTAssertTrue(learning.contains("icon: .graduationCap"))
        XCTAssertTrue(learning.contains("help:"))
        XCTAssertTrue(learning.contains("DesktopSwitch("))
        XCTAssertTrue(learning.contains("skillLearning"))
    }

    /// The desktop card folds after four rows (#4104, SKILLS_SHOWN, ShowMoreFold
    /// `keep`): a skill that needs the person or was just added is never
    /// behind the fold, it comes first and the shown part grows to hold it.
    func testTheListFoldsAfterFourAndKeepsWhatNeedsThePerson() {
        let plain = (1...7).map { ManagedSkill(name: "s\($0)", enabled: true) }
        let short = SkillRowRules.fold(Array(plain.prefix(4)))
        XCTAssertEqual(short.head.map(\.name), ["s1", "s2", "s3", "s4"])
        XCTAssertTrue(short.rest.isEmpty, "four skills: no Show more line")
        XCTAssertEqual(SkillRowRules.shown, 4)

        let warned = [ManagedSkill(name: "w1", enabled: false, warnings: [blocked]), ManagedSkill(name: "w2", enabled: false, warnings: ["x"])]
        let mixed = SkillRowRules.fold([plain[0], warned[0], plain[1], plain[2], warned[1], plain[3], plain[4]])
        XCTAssertEqual(mixed.head.map(\.name), ["w1", "w2", "s1", "s2"], "needs review first, then the others up to four")
        XCTAssertEqual(mixed.rest.map(\.name), ["s3", "s4", "s5"])

        let many = (1...5).map { ManagedSkill(name: "w\($0)", enabled: false, warnings: ["x"]) }
        let grown = SkillRowRules.fold(many + plain)
        XCTAssertEqual(grown.head.map(\.name), many.map(\.name), "the shown part grows to hold every skill that needs the person")
        XCTAssertEqual(grown.rest.count, plain.count)

        let added = SkillRowRules.fold(plain, added: ["s7"])
        XCTAssertEqual(added.head.map(\.name), ["s7", "s1", "s2", "s3"], "a skill just added stays in view")
        XCTAssertEqual(SkillRowRules.freshlyAdded(seen: nil, now: ["a"]), [], "the first list is the bot's own")
        XCTAssertEqual(SkillRowRules.freshlyAdded(seen: [], now: ["a"]), [])
        XCTAssertEqual(SkillRowRules.freshlyAdded(seen: ["a"], now: ["a", "b"]), ["b"])
    }

    /// A shared skill (origin me or library) changed after its review keeps
    /// its warning in the opened skill, and Review changes opens the review
    /// where the skill lives, as the desktop's reviewSkill does for every
    /// origin (SkillsSection.tsx `startReview`, SkillEditorPage.tsx).
    func testASharedSkillChangedAfterReviewKeepsItsWarningAndItsReview() throws {
        let changed = "stored skill files changed after review"
        let shared = ManagedSkill(name: "shared-check", enabled: false, warnings: [changed, "x"])
        for origin in [SkillOrigin.library, .me] {
            XCTAssertEqual(SkillRowRules.state(shared, origin: origin), .needsPerson)
            XCTAssertTrue(SkillRowRules.actions(shared, origin: origin, libraryOn: true, canWrite: true).contains(.review))
        }
        XCTAssertEqual(SkillRowRules.changedAfterReviewLine(shared), changed)
        XCTAssertNil(SkillRowRules.changedAfterReviewLine(ManagedSkill(name: "a", enabled: true, warnings: ["x"])))
        XCTAssertEqual(Set(SkillRowRules.detailWarnings(shared) + [SkillRowRules.changedAfterReviewLine(shared)].compactMap { $0 }),
                       Set(shared.warnings), "the opened skill says every warning")

        let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "paired-token")
        XCTAssertEqual(try client.skillEditorRequest(botId: "bot_1", name: "check", origin: .library).url?.path, "/api/skills-library/check")
        XCTAssertEqual(try client.skillEditorRequest(botId: "bot_1", name: "check", origin: .me).url?.path, "/api/me/skills-library/check")
        XCTAssertEqual(try client.skillEditorRequest(botId: "bot_1", name: "check", origin: nil).url?.path, "/api/bots/bot_1/skills/check")
        XCTAssertEqual(try client.reviewSkillRequest(botId: "bot_1", name: "check", origin: .library, action: "accept").url?.path,
                       "/api/skills-library/check/review")
        XCTAssertEqual(try client.reviewSkillRequest(botId: "bot_1", name: "check", origin: .me, action: "revert").url?.path,
                       "/api/me/skills-library/check/review")
        XCTAssertEqual(try client.reviewSkillRequest(botId: "bot_1", name: "check", origin: .private, action: "accept").url?.path,
                       "/api/bots/bot_1/skills/check/review")

        let page = try source("App/Desktop/PersonaPagesInstructions.swift")
        let perform = try slice(page, from: "private func perform(_ action: SkillRowRules.Action", to: "private func reviewSheet(")
        let review = try slice(perform, from: "case .review:", to: "case .turnOn")
        XCTAssertFalse(review.contains("extras.read("), "Review changes is a review, not a plain read")
        XCTAssertTrue(review.contains("startReview: true, origin: extras.origin(skill)"))
        let reading = try slice(page, from: "private func reviewSheet(", to: "// MARK: Actions")
        XCTAssertTrue(reading.contains("SkillRowRules.changedAfterReviewLine(skill)"), "the read view keeps the changed after review line")
        let viewer = try source("App/Features/BotAdvanced/SkillsSection.swift")
        XCTAssertTrue(viewer.contains("origin: sheet.origin"), "the opened skill reads and reviews where it lives")
    }
}
