import Foundation
import XCTest
@testable import CompanionCore

/// Client+InstructionsPages.swift: the written command (shared/written-skill.ts),
/// the requests of Skills > Upload, Share and the SOUL.md drift banner, and
/// the listing the Skills page reads.
final class InstructionsPagesTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
    }

    func testWrittenCommandProblemsInTheDesktopsOrder() {
        XCTAssertEqual(WrittenSkill.problem(name: "", description: "x", instructions: "y"), .name)
        XCTAssertEqual(WrittenSkill.problem(name: "Bad Name", description: "x", instructions: "y"), .name)
        XCTAssertEqual(WrittenSkill.problem(name: "a--b", description: "x", instructions: "y"), .name)
        XCTAssertEqual(WrittenSkill.problem(name: "goal", description: "x", instructions: "y"), .reserved)
        XCTAssertEqual(WrittenSkill.problem(name: "check", description: "x", instructions: "y", taken: ["check"]), .taken)
        XCTAssertEqual(WrittenSkill.problem(name: "check", description: "  ", instructions: "y"), .description)
        XCTAssertEqual(WrittenSkill.problem(name: "check", description: "x", instructions: " \n"), .instructions)
        XCTAssertNil(WrittenSkill.problem(name: "check-2", description: "x", instructions: "y"))
        XCTAssertEqual(WrittenSkill.typedName("My Check"), "my-check")
        XCTAssertEqual(WrittenSkill.description("\"two\n  lines\""), "two lines")
    }

    func testWrittenCommandMarkdownMatchesTheDesktop() throws {
        let text = try XCTUnwrap(WrittenSkill.markdown(name: "check", description: "Checks it", instructions: "Do {input}.\n"))
        XCTAssertEqual(text, "---\nname: check\ndescription: Checks it\n---\n\n# /check\n\n"
            + "A command the user wrote. When they run /check, follow these instructions. "
            + "Where they say {input}, use what the user typed after the command.\n\nDo {input}.\n")
        XCTAssertNil(WrittenSkill.markdown(name: "learn", description: "x", instructions: "y"))

        let request = try client.writtenCommandRequest(botId: "bot_1", name: "check", description: "Checks it", instructions: "Do {input}.")
        XCTAssertEqual(request.url?.path, "/api/bots/bot_1/skill-template")
        XCTAssertEqual(request.httpMethod, "POST")
        let sent = try body(request)
        XCTAssertEqual(sent["name"] as? String, "check")
        XCTAssertEqual(sent["source"] as? String, "written:bot settings")
        XCTAssertEqual(sent["enabled"] as? Bool, true)
        XCTAssertThrowsError(try client.writtenCommandRequest(botId: "bot_1", name: "Bad", description: "x", instructions: "y"))
    }

    func testUploadShareAndDriftRequests() throws {
        let upload = try client.skillUploadRequest(botId: "bot_1", install: false, files: [SkillUploadFile(name: "SKILL.md", data: "LS0t")])
        XCTAssertEqual(upload.url?.path, "/api/bots/bot_1/skill-upload")
        let sent = try body(upload)
        XCTAssertEqual(sent["mode"] as? String, "preview")
        XCTAssertEqual((sent["files"] as? [[String: String]])?.first, ["name": "SKILL.md", "data": "LS0t"])
        XCTAssertEqual(try body(client.skillUploadRequest(botId: "bot_1", install: true, files: []))["mode"] as? String, "install")
        XCTAssertTrue(SkillUploadRules.tooLarge(name: "a.md", bytes: 256 * 1024 + 1))
        XCTAssertFalse(SkillUploadRules.tooLarge(name: "a.zip", bytes: 256 * 1024 + 1))

        let share = try client.shareSkillRequest(botId: "bot_1", name: "check", scope: "me", stop: true)
        XCTAssertEqual(share.url?.path, "/api/bots/bot_1/skills/check/unshare")
        XCTAssertEqual(try body(share)["scope"] as? String, "me")
        XCTAssertThrowsError(try client.shareSkillRequest(botId: "bot_1", name: "check", scope: "all", stop: false))

        XCTAssertEqual(try client.setSkillOriginEnabledRequest(botId: "bot_1", name: "check", origin: .library, enabled: true).url?.path,
                       "/api/skills-library/check")
        XCTAssertEqual(try client.setSkillOriginEnabledRequest(botId: "bot_1", name: "check", origin: .me, enabled: true).url?.path,
                       "/api/me/skills-library/check")
        XCTAssertEqual(try client.setSkillOriginEnabledRequest(botId: "bot_1", name: "check", origin: nil, enabled: true).url?.path,
                       "/api/bots/bot_1/skills/check")

        let drift = try client.resolveSoulDriftRequest(botId: "bot_1", choice: .applyFile, fileText: "# A", expectedRevision: "r1")
        XCTAssertEqual(drift.url?.path, "/api/bots/bot_1/soul/apply-file")
        XCTAssertEqual(try body(drift) as? [String: String], ["fileText": "# A", "expectedRevision": "r1"])
    }

    func testTheListingKeepsOriginsAndTheLibraryPool() throws {
        let json = #"""
        {"skills":[{"name":"a","enabled":true,"source":"x","warnings":[],"origin":"library","assignedBots":[{"id":"b","name":"Helios"}]},
                   {"name":"b","enabled":false,"source":"","warnings":[]}],
         "library":[{"name":"c","description":"C"}],"assignedSkills":["a"],"staged":[]}
        """#
        let listing = try JSONDecoder().decode(SkillsLibraryListing.self, from: Data(json.utf8))
        XCTAssertEqual(listing.origin(of: "a")?.origin, .library)
        XCTAssertEqual(listing.origin(of: "a")?.assignedBots.first?.name, "Helios")
        XCTAssertNil(listing.origin(of: "b")?.origin)
        XCTAssertEqual(listing.library.map(\.name), ["c"])
        XCTAssertEqual(listing.assignedSkills, ["a"])
        XCTAssertEqual(SkillSourceLabel.of("github:owner/repo"), "GitHub")
        XCTAssertEqual(SkillSourceLabel.of("learn:inbox/x"), "Learned from inbox")
    }
}
