// #2729: Settings > Developer rights, server rows and OpenTelemetry, as the
// desktop's DeveloperSettings.tsx, ExperimentalSettings.tsx and
// TelemetrySettings.tsx do them.
import Foundation
import XCTest
@testable import CompanionCore

final class DeveloperParityTests: XCTestCase {
    private let client = CompanionClient(
        connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
        token: "paired-token"
    )

    private func config(_ json: String) throws -> DesktopSettingsConfig {
        try JSONDecoder().decode(DesktopSettingsConfig.self, from: Data(json.utf8))
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    // MARK: Rights

    func testAnOwnerManagesEveryRowAndWritesTheServer() throws {
        let owner = try config(#"{"viewer":{"role":"owner"}}"#)
        XCTAssertTrue(owner.canEditConfig)
        XCTAssertTrue(owner.mayToggleExperimental("meetingNotetaker", served: .unknown))
        XCTAssertEqual(owner.experimentalChange("dataWindow", true, served: .no), .feature("dataWindow", true))
        XCTAssertTrue(owner.canSetSkillReview)
        XCTAssertTrue(try config("{}").canEditConfig, "no viewer: a single-user server")
    }

    func testAMemberWithPersonalSettingsFlipsOnlyTheirOwnRows() throws {
        let member = try config(#"{"personalSettings":true,"viewer":{"role":"member","permissions":[],"capabilities":{"editConfig":false}}}"#)
        XCTAssertFalse(member.canEditConfig)
        XCTAssertFalse(member.canManageExperimental)
        XCTAssertTrue(member.showsExperimental)
        XCTAssertTrue(member.mayToggleExperimental("skillAuthoring", served: .yes))
        XCTAssertFalse(member.mayToggleExperimental("meetingNotetaker", served: .unknown), "a server switch: hidden, not greyed")
        XCTAssertFalse(member.canSetSkillReview)
        XCTAssertEqual(member.experimentalChange("llmThreadTitles", true, served: .unknown), .myFeature("llmThreadTitles", true))
    }

    func testAMemberWithoutPersonalSettingsSeesNoExperimentalCard() throws {
        let member = try config(#"{"viewer":{"role":"member"}}"#)
        XCTAssertFalse(member.canEditConfig)
        XCTAssertFalse(member.showsExperimental)
        XCTAssertFalse(member.mayToggleExperimental("skillAuthoring", served: .yes))
    }

    func testAnOlderServerWithoutPersonalSettingsHidesTheMembersSwitchesBehindTheNote() throws {
        // ExperimentalSettings.tsx: personal = personalSettings && useServerFeature("memberPersonSettings") !== "no".
        let member = try config(#"{"personalSettings":true,"viewer":{"role":"member","permissions":[]}}"#)
        XCTAssertTrue(member.showsExperimental, "the card stays for the note")
        XCTAssertFalse(member.mayToggleExperimental("skillAuthoring", served: .no), "hidden, never greyed")
        XCTAssertNil(member.experimentalChange("skillAuthoring", true, served: .no))
        XCTAssertTrue(member.personalMissing(.no))
        XCTAssertFalse(member.personalMissing(.unknown), "unknown counts as served, as on the desktop")
        XCTAssertFalse(member.personalMissing(.yes))
        XCTAssertTrue(member.mayToggleExperimental("skillAuthoring", served: .unknown))

        let owner = try config(#"{"personalSettings":true,"viewer":{"role":"owner"}}"#)
        XCTAssertFalse(owner.personalMissing(.no), "a manager writes the server's switch: no note")
        XCTAssertEqual(owner.experimentalChange("skillAuthoring", true, served: .no), .feature("skillAuthoring", true))
    }

    func testTheServedStateReadsEvidenceThenTheDescriptorList() throws {
        XCTAssertEqual(ServerFeatureState.of("memberPersonSettings", listed: nil, evidence: nil), .unknown)
        XCTAssertEqual(ServerFeatureState.of("memberPersonSettings", listed: ["memberPersonSettings"], evidence: nil), .yes)
        XCTAssertEqual(ServerFeatureState.of("memberPersonSettings", listed: ["routineFolders"], evidence: nil), .no)
        XCTAssertEqual(ServerFeatureState.of("memberPersonSettings", listed: ["memberPersonSettings"], evidence: false), .no)
        XCTAssertEqual(ServerFeatureState.of("memberPersonSettings", listed: nil, evidence: true), .yes)
        XCTAssertTrue(ServerFeatureState.routeMissing(APIError.status(code: 404, message: "no route: PATCH /api/me/experimental")))
        XCTAssertFalse(ServerFeatureState.routeMissing(APIError.status(code: 500, message: "boom")))

        let env = try JSONDecoder().decode(ServerEnvironment.self, from: Data(#"{"environmentId":"e","label":"L","capabilities":{"remoteSessions":true,"selfUpdate":"operator","features":["memberPersonSettings"]}}"#.utf8))
        XCTAssertEqual(env.capabilities?.features, ["memberPersonSettings"])
        let odd = try JSONDecoder().decode(ServerEnvironment.self, from: Data(#"{"environmentId":"e","label":"L","capabilities":{"features":"all"}}"#.utf8))
        XCTAssertNil(odd.capabilities?.features, "an odd list never fails the descriptor")
        let old = try JSONDecoder().decode(ServerEnvironment.self, from: Data(#"{"environmentId":"e","label":"L"}"#.utf8))
        XCTAssertNil(old.capabilities)
    }

    func testTheServerCapabilityWinsOverTheRole() throws {
        XCTAssertTrue(try config(#"{"viewer":{"role":"member","capabilities":{"editConfig":true}}}"#).canEditConfig)
        XCTAssertFalse(try config(#"{"viewer":{"role":"admin","capabilities":{}}}"#).canEditConfig)
        let granted = try config(#"{"viewer":{"role":"member","permissions":["server.experimental"]}}"#)
        XCTAssertTrue(granted.canManageExperimental)
    }

    // MARK: Server rows

    func testServerRowsDecodeAndBuildTheDesktopBodies() throws {
        let loaded = try config(#"{"mcp":{"callTimeoutMinutes":20},"loopGuard":{"enabled":false},"threads":{"eventLogMaxBytes":52428800},"features":{"skillReviewSteps":12}}"#)
        XCTAssertEqual(loaded.mcp?.callTimeoutMinutes, 20)
        XCTAssertEqual(loaded.loopGuard?.enabled, false)
        XCTAssertEqual(loaded.threads?.eventLogMaxBytes, 52_428_800)
        XCTAssertEqual(loaded.features?.skillReviewSteps, 12)

        let mcp = try client.desktopSettingsRequest(.mcpCallTimeout(30))
        XCTAssertEqual(mcp.httpMethod, "PUT")
        XCTAssertEqual((try body(mcp)["mcp"] as? [String: Int])?["callTimeoutMinutes"], 30)
        let guardOff = try client.desktopSettingsRequest(.loopGuard(false))
        XCTAssertEqual(guardOff.httpMethod, "PATCH")
        XCTAssertEqual((try body(guardOff)["loopGuard"] as? [String: Bool])?["enabled"], false)
        let review = try client.desktopSettingsRequest(.skillReviewSteps(15))
        XCTAssertEqual((try body(review)["features"] as? [String: Int])?["skillReviewSteps"], 15)
        let cap = try client.desktopSettingsRequest(.eventLogMaxBytes(nil))
        XCTAssertEqual(cap.httpMethod, "PATCH")
        XCTAssertTrue((try body(cap)["threads"] as? [String: Any])?["eventLogMaxBytes"] is NSNull)

        XCTAssertNil(DesktopConfigChange.mcpCallTimeout(61).body)
        XCTAssertNil(DesktopConfigChange.skillReviewSteps(2).body)
        XCTAssertNil(DesktopConfigChange.eventLogMaxBytes(1_000).body)
    }

    func testAPersonalSwitchPatchesTheirOwnSettings() throws {
        let request = try client.desktopSettingsRequest(.myFeature("dataWindow", true))
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/me/experimental")
        XCTAssertEqual((try body(request)["features"] as? [String: Bool])?["dataWindow"], true)
        XCTAssertNil(DesktopConfigChange.myFeature("meetingNotetaker", true).body, "a server switch is not personal")
    }

    func testCapMiBParsesQuarterStepsAndPrintsLikeTheDesktop() {
        XCTAssertEqual(DesktopConfigChange.capBytes(fromMiB: "50"), 52_428_800)
        XCTAssertEqual(DesktopConfigChange.capBytes(fromMiB: "0,25"), 262_144)
        XCTAssertNil(DesktopConfigChange.capBytes(fromMiB: "0.3"))
        XCTAssertNil(DesktopConfigChange.capBytes(fromMiB: "5000"))
        XCTAssertEqual(DesktopConfigChange.mibText(52_428_800), "50")
        XCTAssertEqual(DesktopConfigChange.mibText(262_144), "0.25")
        XCTAssertEqual(DesktopConfigChange.mibText(1_310_720), "1.25")
    }

    // MARK: OpenTelemetry

    func testTelemetryRequestsAndSummary() throws {
        let save = try client.saveTelemetryRequest(endpoint: " https://otel.example.org ", headers: ["Authorization": ""], serviceName: " ")
        XCTAssertEqual(save.httpMethod, "PUT")
        XCTAssertEqual(save.url?.path, "/api/telemetry")
        let saved = try body(save)
        XCTAssertEqual(saved["endpoint"] as? String, "https://otel.example.org")
        XCTAssertTrue(saved["serviceName"] is NSNull)
        XCTAssertEqual((saved["headers"] as? [String: String])?["Authorization"], "")

        let savedTest = try client.testTelemetryRequest(endpoint: "", headers: ["X": "y"])
        XCTAssertEqual(savedTest.url?.path, "/api/telemetry/test")
        XCTAssertTrue(try body(savedTest).isEmpty, "the saved collector: an empty body")
        XCTAssertEqual(try body(client.testTelemetryRequest(endpoint: "http://c", headers: [:]))["endpoint"] as? String, "http://c")

        let view = try JSONDecoder().decode(TelemetrySettingsView.self, from: Data(#"{"endpoint":"http://c","headerNames":["Authorization"],"enabled":true,"stats":{"exported":4,"failed":1}}"#.utf8))
        XCTAssertEqual(view.summary.format, "Sending to %@: %@ spans sent, %@ not accepted")
        XCTAssertEqual(view.summary.arguments, ["http://c", "4", "1"])
        XCTAssertEqual(TelemetrySettingsView().summary.format, "Off: enter a collector address to send traces.")
    }

    func testHeaderRowsKeepSavedValuesAndDropEmptyNewOnes() {
        let rows = [
            TelemetryHeaderDraft(name: " Authorization ", value: "", saved: true),
            TelemetryHeaderDraft(name: "X-New", value: ""),
            TelemetryHeaderDraft(name: "", value: "orphan"),
            TelemetryHeaderDraft(name: "X-Key", value: " k "),
        ]
        XCTAssertEqual(TelemetryHeaderDraft.object(rows), ["Authorization": "", "X-Key": "k"])
    }
}
