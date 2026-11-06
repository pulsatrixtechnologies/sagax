// Person panel Library + Achievements helpers (#2117).
import XCTest
@testable import CompanionCore

final class PersonPanelLibraryTests: XCTestCase {
    func testPersonLibraryRequestIsTheDesktopsOwn() throws {
        let client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "t"
        )
        let request = try client.personLibraryRequest(personId: "pr_sam")
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/people/pr_sam/library")
    }

    func testThreadFileDecodesPersonLibraryFields() throws {
        let data = Data("""
        {"id":"aaaaaaaaaaaaaaaaaaaaaaaa","messageId":"m1","source":"upload","name":"plan.pdf",
         "at":1,"available":true,"path":"plan.pdf","pinned":true,
         "threadId":"t-ops","groupId":"ops","groupName":"Operations"}
        """.utf8)
        let file = try JSONDecoder().decode(ThreadFile.self, from: data)
        XCTAssertEqual(file.threadId, "t-ops")
        XCTAssertEqual(file.groupId, "ops")
        XCTAssertEqual(file.groupName, "Operations")
        XCTAssertEqual(LibraryEntry.file(file).id, "file:t-ops:aaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testLibraryEntryKeepsTheSameFileIdInTwoConversationsDistinct() {
        let a = ThreadFile(id: "same", source: .upload, name: "same.txt", at: 1, threadId: "t-ops")
        let b = ThreadFile(id: "same", source: .upload, name: "same.txt", at: 1, threadId: "t-dm")
        XCTAssertNotEqual(LibraryEntry.file(a).id, LibraryEntry.file(b).id)
    }

    func testPersonPanelAchievementsCategoriesAndRecent() {
        let card = PublicAchievementCard(
            points: 220,
            level: 3,
            title: "rookie",
            unlocked: [
                AchievementUnlock(id: "first-words", points: 5, unlockedAt: 1),
                AchievementUnlock(id: "hello-bot", points: 10, unlockedAt: 20),
                AchievementUnlock(id: "unknown-id", points: 1, unlockedAt: 30),
            ]
        )
        XCTAssertFalse(card.isEmpty)
        XCTAssertEqual(card.titleName?.en, "Rookie")
        let recent = PersonPanelAchievements.recent(card)
        XCTAssertEqual(recent.map(\.id), ["hello-bot", "first-words"])
        let categories = PersonPanelAchievements.categories(card)
        XCTAssertFalse(categories.isEmpty)
        let onboarding = categories.first { $0.category == .onboarding }
        XCTAssertEqual(onboarding?.unlocked, 2)
        XCTAssertTrue(onboarding?.tiles.contains(where: { $0.id == "first-words" && $0.unlocked }) == true)
        XCTAssertTrue(onboarding?.tiles.contains(where: { $0.id == "grok-linked" && !$0.unlocked }) == true)
        // a secret that is not unlocked stays out
        let secrets = categories.first { $0.category == .secrets }
        if let secrets {
            XCTAssertFalse(secrets.tiles.contains(where: { $0.item.hidden && !$0.unlocked }))
        }
    }

    func testPublicAchievementCardDecodesUnlockedList() throws {
        let data = Data("""
        {"points":15,"level":1,"title":"rookie",
         "unlocked":[{"id":"first-words","points":5,"unlockedAt":10}]}
        """.utf8)
        let card = try JSONDecoder().decode(PublicAchievementCard.self, from: data)
        XCTAssertEqual(card.points, 15)
        XCTAssertEqual(card.unlocked.map(\.id), ["first-words"])
    }
}
