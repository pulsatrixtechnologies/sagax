import XCTest
@testable import CompanionCore

final class SecurityKeysSettingsTests: XCTestCase {
    func testTheServersSignInAgainAnswerIsAStateNotAnError() throws {
        XCTAssertTrue(SecurityKeyStart.isReauth(Data(#"{"error":"Sign in again","code":"reauth_required"}"#.utf8)))
        XCTAssertFalse(SecurityKeyStart.isReauth(Data(#"{"error":"nope","code":"step_up_required"}"#.utf8)))
        let list = try JSONDecoder().decode(SecurityKeysList.self, from: Data(#"{"keys":[],"classes":[],"needsSignIn":true,"rpId":"example.test"}"#.utf8))
        XCTAssertEqual(list.needsSignIn, true)
    }

    func testAKeyForAnotherAddressIsNotAKeyHere() throws {
        let list = try JSONDecoder().decode(SecurityKeysList.self, from: Data(#"""
        {"keys":[{"id":"k","name":"Mine","createdAt":1,"rpId":"other.test","deviceType":"multiDevice"}],"classes":["money"],"rpId":"example.test"}
        """#.utf8))
        XCTAssertFalse(list.keyHere)
        XCTAssertEqual(list.keys.first?.deviceType, "multiDevice")
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let request = try client.beginSecurityKeyRequest(name: "iPad")
        XCTAssertEqual(request.url?.path, "/api/security-keys/register")
    }
}
