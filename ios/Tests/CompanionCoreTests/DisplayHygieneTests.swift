// iOS bot-edit lot 8: history phrases, path folding and skill titles never
// put a UUID in the text a person reads.
import XCTest
@testable import CompanionCore

final class DisplayHygieneTests: XCTestCase {
    private let uuid = "b4e7adda-5775-4806-8b66-7db747ab0fea"
    private let botId = "a8c8b33e-e843-447e-b7e9-a17037c30c36"

    func testContainsUuidFindsWholeAndFragment() {
        XCTAssertTrue(DisplayHygiene.containsUuid(uuid))
        XCTAssertTrue(DisplayHygiene.containsUuid("card:\(uuid)"))
        XCTAssertTrue(DisplayHygiene.containsUuid("prefix \(uuid) suffix"))
        XCTAssertTrue(DisplayHygiene.containsUuid(String(uuid.prefix(23))))
        XCTAssertFalse(DisplayHygiene.containsUuid("Instructions changed by Katarina, approval card, Oct 21"))
        XCTAssertFalse(DisplayHygiene.containsUuid("connectwise-ticket-handling"))
    }

    func testHistoryPhraseHidesCardUuidAndByteSizes() {
        let row = BotHistoryRow(
            id: uuid,
            at: Date(timeIntervalSince1970: 1_729_526_400).timeIntervalSince1970 * 1000,
            actor: "bot",
            via: "card:\(uuid)",
            field: "soul",
            summary: "soul: 1640 → 1650 bytes",
            canRestore: true
        )
        let phrase = DisplayHygiene.historyPhrase(row, botName: "Katarina",
                                                  now: Date(timeIntervalSince1970: 1_730_000_000))
        XCTAssertFalse(DisplayHygiene.containsUuid(phrase), phrase)
        XCTAssertFalse(phrase.localizedCaseInsensitiveContains("bytes"), phrase)
        XCTAssertFalse(phrase.localizedCaseInsensitiveContains("1640"), phrase)
        XCTAssertTrue(phrase.localizedCaseInsensitiveContains("Instructions"), phrase)
        XCTAssertTrue(phrase.localizedCaseInsensitiveContains("Katarina"), phrase)
        XCTAssertTrue(phrase.localizedCaseInsensitiveContains("approval card")
                      || phrase.localizedCaseInsensitiveContains("carte"), phrase)
    }

    func testHistoryPhraseMapsUserAndApi() {
        let row = BotHistoryRow(
            id: "h1",
            at: Date().timeIntervalSince1970 * 1000,
            actor: "user",
            via: "api",
            field: "name",
            summary: "name: \"Ara\" → \"Aria\""
        )
        let phrase = DisplayHygiene.historyPhrase(row, botName: "Ara")
        XCTAssertFalse(DisplayHygiene.containsUuid(phrase), phrase)
        XCTAssertTrue(phrase.localizedCaseInsensitiveContains("Name")
                      || phrase.localizedCaseInsensitiveContains("Nom"), phrase)
        XCTAssertTrue(phrase.localizedCaseInsensitiveContains("You")
                      || phrase.localizedCaseInsensitiveContains("Vous"), phrase)
        XCTAssertTrue(phrase.contains("API"), phrase)
    }

    func testHistoryDetailsKeepIdAndSummaryBehindTheFold() {
        let row = BotHistoryRow(
            id: uuid,
            at: 1,
            actor: "bot",
            via: "card:\(uuid)",
            field: "soul",
            summary: "soul: 10 → 20 bytes"
        )
        let details = DisplayHygiene.historyDetails(row)
        XCTAssertEqual(details.map(\.value).contains(uuid), true)
        XCTAssertTrue(details.contains { $0.value == "card:\(uuid)" })
        XCTAssertTrue(details.contains { $0.value.contains("bytes") })
    }

    func testWorkspacePathFoldsBotFolderUuid() {
        let path = "/data/.openmausbot/workspaces/\(botId)"
        let shown = DisplayHygiene.displayWorkspacePath(path)
        XCTAssertFalse(DisplayHygiene.containsUuid(shown), shown)
        XCTAssertFalse(shown.contains(botId), shown)
        XCTAssertFalse(shown.isEmpty)
    }

    func testWorkspacePathKeepsTopicUnderBotFolder() {
        let path = "/data/.openmausbot/workspaces/\(botId)/memory/clients.md"
        let shown = DisplayHygiene.displayWorkspacePath(path)
        XCTAssertFalse(DisplayHygiene.containsUuid(shown), shown)
        XCTAssertTrue(shown.contains("clients.md"), shown)
    }

    func testSkillTitlePrefersDescriptionAndKeepsSlugSeparate() {
        let skill = ManagedSkill(
            name: "connectwise-ticket-handling",
            description: "How Katarina reads ConnectWise tickets.",
            enabled: true,
            source: "learn:conversation"
        )
        XCTAssertEqual(DisplayHygiene.skillTitle(skill), "How Katarina reads ConnectWise tickets.")
        XCTAssertEqual(DisplayHygiene.skillSlug(skill), "connectwise-ticket-handling")
        let bare = ManagedSkill(name: "deploy-check", description: "", enabled: false)
        XCTAssertEqual(DisplayHygiene.skillTitle(bare), "deploy check")
        XCTAssertFalse(DisplayHygiene.containsUuid(DisplayHygiene.skillTitle(skill)))
    }

    /// Acceptance: every open-surface string the bot pages read (history
    /// phrase, folded path, skill title) stays free of UUID format.
    func testOpenSurfaceStringsNeverContainUuidFormat() {
        let row = BotHistoryRow(
            id: uuid,
            at: 1_729_526_400_000,
            actor: "bot",
            via: "card:\(uuid)",
            field: "soul",
            summary: "soul: 1640 → 1650 bytes",
            canRestore: true
        )
        let path = "/Users/demo/.openmausbot/workspaces/\(botId)/memory/MEMORY.md"
        let skill = ManagedSkill(
            name: "fixture-check",
            description: "A fixture skill for Ara.",
            enabled: false,
            source: "import:\(uuid)"
        )
        let open: [String] = [
            DisplayHygiene.historyPhrase(row, botName: "Katarina",
                                         now: Date(timeIntervalSince1970: 1_730_000_000)),
            DisplayHygiene.historyVia(row.via),
            DisplayHygiene.historyWho(row.actor, botName: "Katarina"),
            DisplayHygiene.displayWorkspacePath(path),
            DisplayHygiene.skillTitle(skill),
        ]
        for text in open {
            XCTAssertFalse(DisplayHygiene.containsUuid(text), text)
            XCTAssertFalse(text.contains(uuid), text)
            XCTAssertFalse(text.contains(botId), text)
        }
        // Folded details may keep the id; that is intentional.
        let details = DisplayHygiene.historyDetails(row).map(\.value).joined(separator: "\n")
        XCTAssertTrue(DisplayHygiene.containsUuid(details), details)
    }
}
