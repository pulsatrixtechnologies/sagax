// APNs on the phone (docs/ios-push.md): what it registers with the server,
// what it reads out of a push, and the collapse id it shares with
// server/push/payload.ts.
import Foundation
import XCTest
@testable import CompanionCore

final class PushTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Example", host: "bot.example.test", port: 443), token: "t")

    func testTheRegistrationIsWhatTheServerExpects() throws {
        let token = PushToken.hex(Data([0x00, 0xAB, 0x10, 0xFF]))
        XCTAssertEqual(token, "00ab10ff")
        let registration = PushRegistration(
            token: String(repeating: "ab", count: 32), environment: .production,
            appVersion: "0.4.15 (15)", deviceName: "Phone",
            settings: PushDeviceSettings(AttentionSettings(sound: false, badge: true, nudgeSound: false, nudgeHaptic: true))
        )
        let request = try client.registerPushDeviceRequest(registration)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/push/devices")
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["token"] as? String, String(repeating: "ab", count: 32))
        XCTAssertEqual(json["platform"] as? String, "ios")
        XCTAssertEqual(json["environment"] as? String, "production")
        XCTAssertEqual(json["appVersion"] as? String, "0.4.15 (15)")
        XCTAssertEqual(json["deviceName"] as? String, "Phone")
        XCTAssertEqual(json["settings"] as? [String: Bool], ["sound": false, "badge": true, "nudgeSound": false, "approvalChime": true])
        XCTAssertEqual(Set(json.keys), ["token", "platform", "environment", "appVersion", "deviceName", "settings"])

        let removal = try client.unregisterPushDeviceRequest(token: "abcd")
        XCTAssertEqual(removal.httpMethod, "DELETE")
        XCTAssertEqual(removal.url?.path, "/api/push/devices")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: XCTUnwrap(removal.httpBody)) as? [String: String], ["token": "abcd"])
    }

    func testTheEnvironmentComesFromTheBuild() {
        func profile(_ aps: String) -> Data {
            Data("garbage<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Entitlements</key><dict><key>aps-environment</key><string>\(aps)</string></dict></dict></plist>more".utf8)
        }
        XCTAssertEqual(APNsEnvironment.detect(provisioningProfile: profile("development"), isSimulator: false), .sandbox)
        XCTAssertEqual(APNsEnvironment.detect(provisioningProfile: profile("production"), isSimulator: false), .production)
        // TestFlight and the App Store ship no embedded profile: production
        XCTAssertEqual(APNsEnvironment.detect(provisioningProfile: nil, isSimulator: false), .production)
        XCTAssertEqual(APNsEnvironment.detect(provisioningProfile: nil, isSimulator: true), .sandbox)
    }

    func testAMessagePushOpensItsConversation() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Alice", "body": "Hi"], "thread-id": "t_people_1"],
            "kind": "message", "threadId": "t_people_1", "botId": "g_people_1", "groupId": "g_people_1", "at": 1_000,
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        XCTAssertEqual(payload.kind, .message)
        XCTAssertEqual(payload.target, NotificationTarget(botId: "g_people_1", threadId: "t_people_1"))
        XCTAssertNil(payload.nudgeKey)
        XCTAssertNil(payload.senderIdentity)
        XCTAssertFalse(payload.needsKey)
    }

    func testAnApprovalPushCarriesTheRequestAndTheKeyFlag() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Scout"], "category": "SAGAX_APPROVAL_KEY", "sound": "approval.caf"],
            "kind": "approval", "threadId": "t1", "botId": "b1", "requestId": "r1",
            "prompt": "approval", "needsKey": true,
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        XCTAssertEqual(payload.kind, .approval)
        XCTAssertEqual(payload.requestId, "r1")
        XCTAssertEqual(payload.prompt, "approval")
        XCTAssertTrue(payload.needsKey)
        XCTAssertEqual(payload.target, NotificationTarget(botId: "b1", threadId: "t1"))
    }

    func testABotPushCarriesTheSenderTheExtensionShows() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": [
                "alert": ["title": "Scout", "body": "Pushed the branch."],
                "thread-id": "t_scout",
                "mutable-content": 1,
            ],
            "kind": "message",
            "threadId": "t_scout",
            "botId": "scout",
            "senderName": "Scout",
            "senderId": "scout",
            "avatarUrl": "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp",
            "at": 1_000,
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        let sender = try XCTUnwrap(payload.senderIdentity)
        XCTAssertEqual(sender.id, "scout")
        XCTAssertEqual(sender.displayName, "Scout")
        XCTAssertEqual(sender.conversationId, "t_scout")
        XCTAssertEqual(sender.avatarUrl, "/api/attachments/123e4567-e89b-12d3-a456-426614174000.webp")
        XCTAssertNotNil(AccountAvatar(sender.avatarUrl))
    }

    func testABotPushWithoutAnAvatarStillNamesTheBot() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Scout", "body": "Done"], "mutable-content": 1],
            "kind": "message", "threadId": "t_scout", "botId": "scout", "senderName": "Scout",
        ]
        let sender = try XCTUnwrap(PushPayload(userInfo: userInfo)?.senderIdentity)
        XCTAssertEqual(sender.displayName, "Scout")
        XCTAssertEqual(sender.id, "scout")
        XCTAssertNil(sender.avatarUrl)
        XCTAssertNil(AccountAvatar(sender.avatarUrl))
    }

    func testATrackingPixelIsNotAnAvatar() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Scout"]],
            "kind": "message", "botId": "scout", "senderName": "Scout",
            "avatarUrl": "https://tracker.example.test/pixel.png",
        ]
        let sender = try XCTUnwrap(PushPayload(userInfo: userInfo)?.senderIdentity)
        XCTAssertEqual(sender.displayName, "Scout")
        XCTAssertNil(sender.avatarUrl)
    }

    func testANudgePushSharesItsKeyWithTheStreamFrame() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title-loc-key": "%@ sent you a nudge"], "sound": "nudge.caf"],
            "kind": "nudge", "threadId": "t1", "groupId": "g1", "fromId": "PR_Alice", "id": "n1", "at": NSNumber(value: 1_760_000_000_123.0),
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        XCTAssertEqual(payload.kind, .nudge)
        XCTAssertEqual(payload.id, "n1")
        // no botId: the group opens it
        XCTAssertEqual(payload.target, NotificationTarget(botId: "g1", threadId: "t1"))
        let frame = NudgeFrame(fromId: "pr_alice", fromName: "Alice", at: 1_760_000_000_123, open: .init(groupId: "g1", threadId: "t1"))
        XCTAssertEqual(payload.nudgeKey, frame.dedupKey)
    }

    func testOtherNotificationsAreNotPushes() {
        XCTAssertNil(PushPayload(userInfo: ["kind": "message", "threadId": "t"]), "no aps: a local notification")
        XCTAssertNil(PushPayload(userInfo: ["aps": [:], "kind": "spend"]), "unknown kind")
    }

    func testTheCollapseIdMatchesTheServer() {
        XCTAssertEqual(PushCollapse.identifier(threadId: "t_people_1", kind: "message"), "sagax.t.t_people_1")
        XCTAssertEqual(PushCollapse.identifier(threadId: nil, kind: "achievement"), "sagax.achievement")
        let long = PushCollapse.identifier(threadId: String(repeating: "x", count: 120), kind: "message")
        XCTAssertTrue(long.hasPrefix("sagax.h."))
        XCTAssertLessThanOrEqual(long.utf8.count, 64)
    }
}
