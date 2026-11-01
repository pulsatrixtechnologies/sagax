// Live Activity push token registration (CompanionCore, no ActivityKit).
import Foundation
import XCTest
@testable import CompanionCore

final class LiveActivityPushTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Example", host: "bot.example.test", port: 443),
        token: "t"
    )
    private let token = String(repeating: "ab", count: 32)

    func testUpdateRegistrationIsWhatTheServerExpects() throws {
        let registration = LiveActivityTokenRegistration(
            token: token,
            kind: .update,
            environment: .production,
            botId: "scout",
            activityId: "act-1",
            deviceToken: String(repeating: "cd", count: 32),
            frequentUpdates: true,
            appVersion: "0.5.0 (1)",
            deviceName: "Phone"
        )
        XCTAssertTrue(registration.isValid)
        let request = try client.registerLiveActivityTokenRequest(registration)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/push/activities")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
        XCTAssertEqual(json["token"] as? String, token)
        XCTAssertEqual(json["kind"] as? String, "update")
        XCTAssertEqual(json["environment"] as? String, "production")
        XCTAssertEqual(json["botId"] as? String, "scout")
        XCTAssertEqual(json["activityId"] as? String, "act-1")
        XCTAssertEqual(json["deviceToken"] as? String, String(repeating: "cd", count: 32))
        XCTAssertEqual(json["frequentUpdates"] as? Bool, true)
        XCTAssertEqual(json["appVersion"] as? String, "0.5.0 (1)")
        XCTAssertEqual(json["deviceName"] as? String, "Phone")
    }

    func testPushToStartRegistrationOmitsBotId() throws {
        let registration = LiveActivityTokenRegistration(
            token: token,
            kind: .start,
            environment: .sandbox,
            appVersion: "1",
            deviceName: "Pad"
        )
        XCTAssertTrue(registration.isValid)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(
            with: XCTUnwrap(try client.registerLiveActivityTokenRequest(registration).httpBody)
        ) as? [String: Any])
        XCTAssertEqual(json["kind"] as? String, "start")
        XCTAssertNil(json["botId"])
    }

    func testUpdateWithoutBotIdIsInvalid() {
        let registration = LiveActivityTokenRegistration(
            token: token, kind: .update, environment: .production, appVersion: "1", deviceName: "x"
        )
        XCTAssertFalse(registration.isValid)
        XCTAssertNil(LiveActivityTokenPlan.registration(
            want: .init(kind: .update, token: token),
            environment: .production, deviceToken: nil, frequentUpdates: nil,
            appVersion: "1", deviceName: "x"
        ))
    }

    func testNeedsRegisterSkipsDuplicates() {
        let want = LiveActivityTokenPlan.Want(kind: .update, token: token, botId: "scout", activityId: "a1")
        let body = LiveActivityTokenPlan.registration(
            want: want, environment: .production, deviceToken: nil, frequentUpdates: true,
            appVersion: "1", deviceName: "Phone"
        )!
        XCTAssertFalse(LiveActivityTokenPlan.needsRegister(want: want, lastRegistered: [token: body]))
        XCTAssertTrue(LiveActivityTokenPlan.needsRegister(
            want: .init(kind: .update, token: token, botId: "mira"),
            lastRegistered: [token: body]
        ))
        XCTAssertTrue(LiveActivityTokenPlan.needsRegister(want: want, lastRegistered: [:]))
    }

    func testUnregisterRequest() throws {
        let removal = try client.unregisterLiveActivityTokenRequest(token: "ABCD")
        XCTAssertEqual(removal.httpMethod, "DELETE")
        XCTAssertEqual(removal.url?.path, "/api/push/activities")
        XCTAssertEqual(
            try JSONSerialization.jsonObject(with: XCTUnwrap(removal.httpBody)) as? [String: String],
            ["token": "abcd"]
        )
    }

    func testHexTokenValidation() {
        XCTAssertTrue(LiveActivityPushToken.isHexToken(token))
        XCTAssertTrue(LiveActivityPushToken.isHexToken(token.uppercased()))
        XCTAssertFalse(LiveActivityPushToken.isHexToken("short"))
        XCTAssertFalse(LiveActivityPushToken.isHexToken(String(repeating: "zz", count: 32)))
        XCTAssertEqual(LiveActivityPushToken.hex(Data([0x00, 0xAB])), "00ab")
    }

    func testContentStateDateMatchesServerCocoaReferenceEncoding() throws {
        // Server cocoaSince(1_800_000_000_000) == 821_692_800. Swift's default
        // JSONEncoder must emit the same number for ActivityKit content-state.
        let content = BotActivityContent(
            face: "working", kind: "working", headline: "Scout is working", line: "Reading",
            threadId: "t1", card: nil, since: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let data = try JSONEncoder().encode(content)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["since"] as? Double, 821_692_800)
        XCTAssertEqual(json["kind"] as? String, "working")
        XCTAssertEqual(json["options"] as? [String], [])
        XCTAssertEqual(json["isPermission"] as? Bool, false)
    }
}
