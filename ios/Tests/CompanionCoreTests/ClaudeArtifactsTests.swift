// claude.ai artifact links, consent fence and thread decoding (#2018),
// cases from `shared/claude-chat-blocks.test.ts`.
import XCTest
@testable import CompanionCore

final class ClaudeArtifactsTests: XCTestCase {
    func testCanonicalUrl() {
        XCTAssertEqual(ClaudeArtifacts.canonicalUrl("https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9?x=1#y"), "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9")
        XCTAssertEqual(ClaudeArtifacts.canonicalUrl("https://www.claude.ai/code/artifact/abcdef12-3456/"), "https://claude.ai/code/artifact/abcdef12-3456")
        XCTAssertNil(ClaudeArtifacts.canonicalUrl("http://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9"))
        XCTAssertNil(ClaudeArtifacts.canonicalUrl("https://evil.test/artifact/HBXTc3TAqqC5odi1H6Bgu9"))
        XCTAssertNil(ClaudeArtifacts.canonicalUrl("https://claude.ai/artifact/short"))
        XCTAssertNil(ClaudeArtifacts.canonicalUrl("https://u:p@claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9"))
    }

    func testLinksInText() {
        let url = "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9"
        XCTAssertEqual(ClaudeArtifacts.urls(in: "voir \(url)."), [url])
        XCTAssertTrue(ClaudeArtifacts.isStandaloneParagraph("[page](\(url))", url: url))
        XCTAssertTrue(ClaudeArtifacts.isStandaloneParagraph(url, url: url))
        XCTAssertFalse(ClaudeArtifacts.isStandaloneParagraph("voir \(url)", url: url))
    }

    func testConsentFence() {
        let fence = "{\"blocked\":\"other_account\",\"url\":\"https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9\",\"account\":\"a@b.test\"}"
        XCTAssertEqual(ClaudeArtifacts.parseConsent(fence), ClaudeArtifactConsent(url: "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9", account: "a@b.test"))
        XCTAssertNil(ClaudeArtifacts.parseConsent("{\"title\":\"x\",\"url\":\"https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9\"}"))
        XCTAssertEqual(
            ClaudeArtifacts.copyMessage(url: "U"),
            "Publie une copie de U depuis ton compte avec claude_artifact. Tu ne peux pas lire cette page (autre compte claude.ai) : publie depuis un fichier HTML de ton workspace (ou un collage), puis donne la nouvelle URL pour mettre à jour les références."
        )
    }

    func testPublishFenceCarriesOwned() {
        let page = RichBlocks.parseArtifactPage("{\"title\":\"Deck\",\"url\":\"https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9\",\"owned\":true}")
        XCTAssertEqual(page?.owned, true)
    }

    func testThreadsDecode() throws {
        let json = "{\"threads\":[{\"id\":\"t1\",\"status\":\"open\",\"text\":\"Hi\",\"replies\":[{\"text\":\"Yo\"}]},{\"id\":\"t2\",\"status\":\"resolved\",\"text\":\"Done\",\"replies\":[]}]}"
        struct Box: Decodable { var threads: [ClaudeArtifactThread] }
        let box = try JSONDecoder().decode(Box.self, from: Data(json.utf8))
        XCTAssertEqual(box.threads.map(\.isOpen), [true, false])
        XCTAssertEqual(box.threads[0].replies.first?.text, "Yo")
    }
}
