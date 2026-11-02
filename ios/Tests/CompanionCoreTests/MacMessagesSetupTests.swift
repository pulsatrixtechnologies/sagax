import XCTest
@testable import CompanionCore

final class MacMessagesSetupTests: XCTestCase {
    func testStepStateWalksPermissionsTestAndEnable() {
        let denied = MessagesSetupPermissions(fullDiskAccess: .denied, automation: .notAsked)
        XCTAssertEqual(
            messagesStepState(step: .fullDiskAccess, permissions: denied, useMessages: false, tested: false, testOk: false),
            .blocked
        )
        XCTAssertEqual(
            messagesStepState(step: .test, permissions: denied, useMessages: false, tested: false, testOk: false),
            .blocked
        )

        let ready = MessagesSetupPermissions(fullDiskAccess: .granted, automation: .granted)
        XCTAssertEqual(
            messagesStepState(step: .fullDiskAccess, permissions: ready, useMessages: false, tested: false, testOk: false),
            .done
        )
        XCTAssertEqual(
            messagesStepState(step: .automation, permissions: ready, useMessages: false, tested: false, testOk: false),
            .done
        )
        XCTAssertEqual(
            messagesStepState(step: .test, permissions: ready, useMessages: false, tested: false, testOk: false),
            .todo
        )
        XCTAssertEqual(
            messagesStepState(step: .test, permissions: ready, useMessages: false, tested: true, testOk: true),
            .done
        )
        XCTAssertEqual(
            messagesStepState(step: .enable, permissions: ready, useMessages: false, tested: true, testOk: true),
            .todo
        )
        XCTAssertEqual(
            messagesStepState(step: .enable, permissions: ready, useMessages: true, tested: true, testOk: true),
            .done
        )
    }

    func testTestNamesViewCapsAndCountsWithoutBodies() {
        let view = messagesTestNamesView([" Ada ", "", "Bea", "Cara", "Dee"], limit: 3)
        XCTAssertEqual(view.conversationCount, 4)
        XCTAssertEqual(view.names, ["Ada", "Bea", "Cara"])
    }

    func testMacRowState() {
        XCTAssertEqual(messagesMacRowState(nil), .unknown)
        XCTAssertEqual(
            messagesMacRowState(MessagesSetupStatus(available: false, onThisMac: false, reason: .organizationServer)),
            .unavailable
        )
        XCTAssertEqual(
            messagesMacRowState(MessagesSetupStatus(available: true, onThisMac: true, useMessages: false)),
            .off
        )
        XCTAssertEqual(
            messagesMacRowState(MessagesSetupStatus(available: true, onThisMac: true, useMessages: true)),
            .on
        )
    }

    func testStatusDecodesFromWireShape() throws {
        let json = """
        {
          "available": true,
          "onThisMac": true,
          "useMessages": false,
          "permissions": { "fullDiskAccess": "granted", "automation": "notAsked" }
        }
        """.data(using: .utf8)!
        let status = try JSONDecoder().decode(MessagesSetupStatus.self, from: json)
        XCTAssertTrue(status.available)
        XCTAssertEqual(status.permissions.fullDiskAccess, .granted)
        XCTAssertEqual(status.permissions.automation, .notAsked)
        XCTAssertFalse(status.useMessages)
    }

    func testUnavailableReasonDecodesSnakeCase() throws {
        let json = """
        {
          "available": false,
          "onThisMac": false,
          "reason": "organization_server",
          "useMessages": false,
          "permissions": { "fullDiskAccess": "unsupported", "automation": "unsupported" }
        }
        """.data(using: .utf8)!
        let status = try JSONDecoder().decode(MessagesSetupStatus.self, from: json)
        XCTAssertEqual(status.reason, .organizationServer)
        XCTAssertEqual(messagesMacRowState(status), .unavailable)
    }
}
