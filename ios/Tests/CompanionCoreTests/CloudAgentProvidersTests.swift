import XCTest
@testable import CompanionCore

final class CloudAgentProvidersTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")

    func testTheRoutesAreThePersonsOwnAndRefuseAnUnknownProvider() throws {
        XCTAssertEqual(try client.cloudAgentProvidersRequest().url?.path, "/api/me/cloud-agent-providers")
        let save = try client.saveCloudAgentProviderRequest("cursor", token: "secret")
        XCTAssertEqual(save.httpMethod, "PUT")
        XCTAssertEqual(save.url?.path, "/api/me/cloud-agent-providers/cursor")
        XCTAssertThrowsError(try client.saveCloudAgentProviderRequest("../x", token: "a"))
    }

    func testASavedKeyIsTestedWithoutSendingItAgain() throws {
        let saved = try client.testCloudAgentProviderRequest("codex", token: nil)
        XCTAssertEqual(saved.url?.path, "/api/me/cloud-agent-providers/codex/test")
        let body = try JSONSerialization.jsonObject(with: saved.httpBody ?? Data("{}".utf8)) as? [String: Any]
        XCTAssertNil(body?["token"])
        XCTAssertTrue(CloudAgentProviderRow.anyConfigured([.init(provider: "cursor", label: "Cursor", configured: true)]))
        XCTAssertFalse(CloudAgentProviderRow.anyConfigured([.init(provider: "cursor", label: "Cursor", configured: false)]))
    }
}
