// iPad I4 and I4b: the docked bot panel's tabs (Details, Library, Computer;
// no More tab), the persona editor's sections and search, against
// bot-settings/panel-tabs.ts, lib/persona-sections.ts and
// bot-settings/sections.ts as the current desktop draws them, gated by
// SurfaceGate.
import XCTest
@testable import CompanionCore

final class DesktopBotPanelTests: XCTestCase {
    func testAdminSeesEveryTabAndTheDesktopSectionOrder() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertEqual(DesktopPanelTab.visible(gate: admin), [.activity, .library])
        XCTAssertTrue(DesktopPersonaEditor.offered(gate: admin))
        // a served page that is not an organization's adds "Who can see it"
        XCTAssertEqual(
            DesktopPanelSection.visible(gate: admin),
            [.overview, .soul, .skills, .memory, .access, .model, .permissions, .voice, .visibility, .history, .usage]
        )
    }

    func testOrganizationServerSwapsVisibilityForSharingWithoutProfileConfiguration() throws {
        let org = SurfaceGate(scope: .serverAdmin, organization: true)
        let sections = DesktopPanelSection.visible(gate: org, slack: true)
        XCTAssertFalse(sections.contains(.visibility))
        XCTAssertTrue(sections.contains(.sharing))
        XCTAssertFalse(sections.contains { $0.rawValue == "perspicax" })
        XCTAssertEqual(sections[1], .slack)
        // Works on is its own item there, right after Access
        let access = try XCTUnwrap(sections.firstIndex(of: .access))
        XCTAssertEqual(sections[access + 1], .worksOn)
    }

    func testSlackNeedsTheServersLink() {
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertFalse(DesktopPanelSection.visible(gate: admin, slack: false).contains(.slack))
        XCTAssertTrue(DesktopPanelSection.visible(gate: admin, slack: true).contains(.slack))
        // the sidecar has no Slack route, link or not
        XCTAssertFalse(DesktopPanelSection.visible(gate: SurfaceGate(scope: .sidecar), slack: true).contains(.slack))
    }

    func testSidecarOwnerGetsTheAdvancedPanelOnlyWithTheRoute() {
        // D1: the advanced panel on the sidecar for the owner
        let current = SurfaceGate(scope: .sidecar)
        XCTAssertTrue(DesktopPanelSection.visible(gate: current).contains(.soul))
        let older = SurfaceGate(scope: .sidecar, sidecarRoutes: [])
        let sections = DesktopPanelSection.visible(gate: older)
        XCTAssertFalse(sections.contains(.soul))
        XCTAssertFalse(sections.contains(.memory))
        // what the remote client itself shows stays
        XCTAssertTrue(sections.contains(.voice))
        XCTAssertTrue(sections.contains(.overview))
    }

    func testClientSessionSeesNoAdminSections() {
        let client = SurfaceGate(scope: .serverClient)
        let sections = DesktopPanelSection.visible(gate: client)
        XCTAssertEqual(sections, [.voice, .usage])
        // no More tab: Voice and Usage open from Edit persona
        XCTAssertEqual(DesktopPanelTab.visible(gate: client), [.activity, .library])
        XCTAssertTrue(DesktopPersonaEditor.offered(gate: client))
    }

    func testSearchMatchesLabelAndKeywords() {
        XCTAssertTrue(DesktopPanelSection.memory.matches("", label: "Memory"))
        XCTAssertTrue(DesktopPanelSection.memory.matches("  MEM ", label: "Memory"))
        XCTAssertTrue(DesktopPanelSection.voice.matches("alerts", label: "Voice & alerts"))
        XCTAssertTrue(DesktopPanelSection.access.matches("vps", label: "Access"))
        // the label in the person's language counts too
        XCTAssertTrue(DesktopPanelSection.voice.matches("voix", label: "Voix et alertes"))
        XCTAssertFalse(DesktopPanelSection.usage.matches("soul", label: "Usage"))
    }

    func testThereIsNoMoreTab() {
        // Activity + Library shown; computer kept for deep-link resolve only (#2127).
        XCTAssertEqual(DesktopPanelTab.allCases.map(\.rawValue), ["activity", "library", "computer"])
        XCTAssertEqual(DesktopPanelTab.visible(gate: SurfaceGate(scope: .serverAdmin)), [.activity, .library])
    }

    func testWorksOnIsListedOnlyOnAnOrganizationServer() {
        XCTAssertFalse(DesktopPanelSection.visible(gate: SurfaceGate(scope: .serverAdmin)).contains(.worksOn))
        XCTAssertFalse(DesktopPanelSection.visible(gate: SurfaceGate(scope: .sidecar)).contains(.worksOn))
        XCTAssertTrue(DesktopPanelSection.worksOn.matches("where it works", label: "Computer"))
    }

    func testInlineEditSavesOnlyAChange() {
        XCTAssertNil(DesktopInlineEdit.commit(draft: " Ara ", current: "Ara", required: true))
        XCTAssertNil(DesktopInlineEdit.commit(draft: "   ", current: "Ara", required: true))
        XCTAssertEqual(DesktopInlineEdit.commit(draft: " Lux ", current: "Ara", required: true), "Lux")
        // an optional label may be cleared
        XCTAssertEqual(DesktopInlineEdit.commit(draft: "", current: "Admin", required: false), "")
        XCTAssertNil(DesktopInlineEdit.commit(draft: "", current: "", required: false))
    }

    /// Edit bot's Description (several lines, optional): a change is saved
    /// trimmed, an emptied blurb clears, an unchanged one saves nothing.
    func testInlineEditDescriptionKeepsLinesAndMayClear() {
        XCTAssertEqual(DesktopInlineEdit.commit(draft: "Line 1\nLine 2\n", current: "Line 1", required: false), "Line 1\nLine 2")
        XCTAssertEqual(DesktopInlineEdit.commit(draft: "  ", current: "Does things", required: false), "")
        XCTAssertNil(DesktopInlineEdit.commit(draft: "Does things ", current: "Does things", required: false))
        XCTAssertEqual(NewBotRules.descriptionLimit, 4_000)
    }

    // MARK: More > Access, Works on

    private func config(_ json: String) throws -> ConfigStatus {
        try JSONDecoder().decode(ConfigStatus.self, from: Data(json.utf8))
    }

    func testWorksOnNeverOffersOff() throws {
        // Off is gone from every menu: Auto and the places the
        // server offers, and a saved Off reads as Auto.
        let plain = try config("{}")
        let boat = try config(#"{"features":{"boatComputer":true}}"#)
        let home = try config(#"{"cloudHome":true}"#)
        XCTAssertEqual(DesktopWorksOnRules.choices(config: plain, organization: false), [.auto, .local])
        XCTAssertEqual(DesktopWorksOnRules.choices(config: boat, organization: false), [.auto, .local, .cloud])
        XCTAssertEqual(DesktopWorksOnRules.choices(config: home, organization: false), [.auto, .cloud])
        XCTAssertEqual(DesktopWorksOnRules.choices(config: plain, organization: true), [.auto, .local, .cloud])
        for (cfg, organization) in [(plain, false), (boat, false), (home, false), (plain, true)] {
            XCTAssertFalse(DesktopWorksOnRules.choices(config: cfg, organization: organization).contains(.off))
        }
        XCTAssertEqual(DesktopWorksOnRules.selected(.off), .auto)
        XCTAssertTrue(DesktopWorksOnRules.showsCloudBackend(worksOn: .auto, config: boat, organization: false))
        XCTAssertFalse(DesktopWorksOnRules.showsCloudBackend(worksOn: .auto, config: plain, organization: false))
    }

    func testBrowserBlockSaysWhy() throws {
        let missing = try config(#"{"browserEngine":{"kind":"unavailable","installable":true},"features":{"browser":true}}"#)
        XCTAssertEqual(DesktopWorksOnRules.browserBlock(config: missing), .notInstalled)
        XCTAssertFalse(DesktopWorksOnRules.browserSelectable(config: missing, modelCanBrowse: true))
        XCTAssertEqual(DesktopWorksOnRules.browserBlock(config: try config("{}")), .noEngine)
        let off = try config(#"{"browserEngine":{"kind":"engine"}}"#)
        XCTAssertEqual(DesktopWorksOnRules.browserBlock(config: off), .featureOff)
        let on = try config(#"{"browserEngine":{"kind":"engine"},"features":{"browser":true}}"#)
        XCTAssertTrue(DesktopWorksOnRules.browserSelectable(config: on, modelCanBrowse: true))
        XCTAssertEqual(DesktopWorksOnRules.browserBlock(config: on), .model)
    }

    func testOddFeatureValuesReadAsOff() throws {
        let odd = try config(#"{"features":{"browser":"yes","boatComputer":1,"templates":true}}"#)
        XCTAssertNil(odd.features?.browser)
        XCTAssertEqual(odd.features?.templates, true)
    }

    func testWebhooksListKeepsOneBotsTriggers() throws {
        let json = #"{"webhooks":[{"id":"w1","endpointId":"e","name":"Build","prompt":"p","botId":"b1","runOn":"maus","enabled":true,"createdAt":1,"updatedAt":2,"deliveryCount":3},{"id":"w2","name":"Other","botId":"b2","enabled":false,"deliveryCount":0}],"attempts":[]}"#
        let list = try JSONDecoder().decode(WebhooksResponse.self, from: Data(json.utf8))
        XCTAssertEqual(list.of(botId: "b1"), [WebhookListing(id: "w1", name: "Build", botId: "b1", enabled: true, deliveryCount: 3, endpointId: "e")])
    }

    func testPlacementDocksFrom1024() {
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 834), .overlay)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1023.5), .overlay)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1024), .docked)
        XCTAssertEqual(DesktopPanelPlacement.at(windowWidth: 1366), .docked)
    }

    func testWidthIsHeldToTheDesktopRange() {
        // Bot panel 308 like the reference app (#2141 / BOT_PANEL_BOUNDS).
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(nil), 308)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(.nan), 308)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(100), 308)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(900), 720)
        XCTAssertEqual(DesktopPanelPlacement.clampedWidth(480), 480)
        XCTAssertEqual(DesktopPanelPlacement.defaultWidth, 308)
        XCTAssertEqual(DesktopPanelPlacement.minWidth, 308)
    }

    // MARK: Details > Routines

    private func routine(_ id: String, name: String, bot: String = "b1", enabled: Bool, next: Double?, schedule: String = #"{"type":"daily","time":"09:00"}"#) throws -> Routine {
        let next = next.map { String(format: "%.0f", $0) } ?? "null"
        let json = """
        {"id":"\(id)","name":"\(name)","prompt":"p","botId":"\(bot)","runOn":"maus","enabled":\(enabled),
         "schedule":\(schedule),"durationMinutes":30,"nextRunAt":\(next),"createdAt":1,"updatedAt":2}
        """
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    func testRoutinesSortActiveFirstThenSoonestThenName() throws {
        let list = [
            try routine("a", name: "Zed", enabled: false, next: nil),
            try routine("b", name: "Later", enabled: true, next: 2_000),
            try routine("c", name: "Beta", enabled: true, next: 1_000),
            try routine("d", name: "Alpha", enabled: true, next: 1_000),
            try routine("e", name: "Other bot", bot: "b2", enabled: true, next: 1),
        ]
        XCTAssertEqual(DesktopRoutineList.of(botId: "b1", in: list).map(\.id), ["d", "c", "b", "a"])
    }

    func testRoutineStateSaysFinishedForASpentOneShot() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let spent = try routine("o", name: "Once", enabled: true, next: nil, schedule: #"{"type":"once","at":500000}"#)
        XCTAssertEqual(DesktopRoutineList.state(spent, now: now), .finished)
        let coming = try routine("o2", name: "Once", enabled: true, next: 2_000_000, schedule: #"{"type":"once","at":2000000}"#)
        XCTAssertEqual(DesktopRoutineList.state(coming, now: now), .active)
        XCTAssertEqual(DesktopRoutineList.state(try routine("p", name: "P", enabled: false, next: nil), now: now), .paused)
    }

    func testFileSizesReadAsTheDesktopWritesThem() {
        XCTAssertEqual(DesktopFileSize.format(14), "14 B")
        XCTAssertEqual(DesktopFileSize.format(1023), "1023 B")
        XCTAssertEqual(DesktopFileSize.format(1536), "1.5 KB")
        XCTAssertEqual(DesktopFileSize.format(1_887), "1.8 KB")
        XCTAssertEqual(DesktopFileSize.format(5 * 1024 * 1024), "5.0 MB")
    }

    // MARK: Settings patch

    private func body(_ request: URLRequest) -> [String: Any] {
        (request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    func testSettingsPatchSendsOnlyItsFields() throws {
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t")
        let request = try client.patchBotSettingsRequest(botId: "b1", patch: BotPanelPatch(approvePeerComms: true, cwd: "/work"))
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/bots/b1")
        let sent = body(request)
        XCTAssertEqual(Set(sent.keys), ["approvePeerComms", "cwd"])
        XCTAssertEqual(sent["approvePeerComms"] as? Bool, true)
        XCTAssertThrowsError(try client.patchBotSettingsRequest(botId: "b1", patch: BotPanelPatch()))
        XCTAssertThrowsError(try client.patchBotSettingsRequest(botId: "../x", patch: BotPanelPatch(chiefOfStaff: true)))
    }

    func testFullAccessCarriesItsConfirmation() throws {
        XCTAssertEqual(BotPanelPatch.approval(.ask), BotPanelPatch(approvalMode: "ask"))
        let full = BotPanelPatch.approval(.full, allThreads: false)
        XCTAssertEqual(full.confirmFullAccess, true)
        XCTAssertEqual(full.applyToAllThreads, false)
    }

    func testWorksOnReadsTheBotsComputer() throws {
        func bot(_ computer: String?) throws -> Bot {
            let field = computer.map { #","computer":"\#($0)""# } ?? ""
            let json = #"{"id":"b1","threadId":"t1","name":"Ara","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"i","model":"m"},"createdAt":1"# + field + "}"
            return try JSONDecoder().decode(Bot.self, from: Data(json.utf8))
        }
        XCTAssertEqual(DesktopWorksOn.of(try bot(nil)), .auto)
        XCTAssertEqual(DesktopWorksOn.of(try bot("vm")), .vm)
        XCTAssertEqual(DesktopWorksOn.of(try bot("mystery")), .auto)
        XCTAssertEqual(DesktopWorksOn.of(try bot("off")), .auto)
        XCTAssertNil(try bot(nil).approvePeerComms)
    }

    func testComputerPhaseNeverWakesAnAutoComputer() {
        XCTAssertEqual(DesktopComputerPhase.of(worksOn: .auto, hasPicture: false), .off)
        XCTAssertEqual(DesktopComputerPhase.of(worksOn: .auto, hasPicture: true), .picture)
        XCTAssertEqual(DesktopComputerPhase.of(worksOn: .off, hasPicture: true), .off)
        XCTAssertEqual(DesktopComputerPhase.of(worksOn: .browser, hasPicture: false), .browser)
        XCTAssertEqual(DesktopComputerPhase.of(worksOn: .cloud, hasPicture: false), .waiting)
        XCTAssertFalse(DesktopComputerPhase.polls(.auto))
        XCTAssertTrue(DesktopComputerPhase.polls(.vm))
    }

    func testGrokVoicesRoundTrip() throws {
        XCTAssertEqual(VoiceProvider.xai.wireValue, "xai")
        let config = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"tts":{"configured":true,"provider":"xai"}}"#.utf8))
        XCTAssertEqual(config.voiceProvider, .xai)
    }

    func testWhenLabelIsTheTimeTodayElseTheDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        let locale = Locale(identifier: "en_US")
        let now = Date(timeIntervalSince1970: 1_790_000_000) // 2026-09-21 local
        let today = (now.timeIntervalSince1970 - 3600) * 1000
        let label = DesktopWhenLabel.label(today, now: now, calendar: calendar, locale: locale)
        XCTAssertTrue(label.contains(":"), label)
        let older = (now.timeIntervalSince1970 - 3 * 86_400) * 1000
        XCTAssertFalse(DesktopWhenLabel.label(older, now: now, calendar: calendar, locale: locale).contains(":"))
        XCTAssertTrue(DesktopWhenLabel.label(older, now: now, calendar: calendar, locale: locale).hasPrefix("Sep"))
    }
}
