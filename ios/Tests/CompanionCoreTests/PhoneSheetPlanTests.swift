import XCTest
@testable import CompanionCore

/// The phone's sheets as the reference draws them (#4103): the Connect apps
/// pills and chips, a plugin sheet's sections, and the measures the sheets
/// share with the bot panel (#4101).
final class PhoneSheetPlanTests: XCTestCase {
    private func item(_ key: String, kind: ConnectAppKind = .mcp, category: ConnectAppCategory = .other,
                      status: ConnectAppStatus, action: ConnectAppAction?) -> ConnectAppItem {
        ConnectAppItem(key: key, kind: kind, id: key, name: key, description: "", category: category,
                       installed: action == nil, status: status, action: action, source: "manual")
    }

    private func server(_ json: String) throws -> MCPServerListing {
        try JSONDecoder().decode(MCPServerListing.self, from: Data(json.utf8))
    }

    func testThePillSaysWhatTheRowCanDoOrWhereItStands() {
        XCTAssertEqual(ConnectAppPill.of(item("a", kind: .featured, status: .available, action: .connect)), .connect)
        XCTAssertEqual(ConnectAppPill.of(item("b", kind: .plugin, status: .available, action: .add)), .add)
        // an installed server whose sign-in lapsed: Authorize, in blue
        XCTAssertEqual(ConnectAppPill.of(item("c", status: .needsAuth, action: nil)), .authorize)
        XCTAssertEqual(ConnectAppPill.of(item("d", status: .connected, action: nil)), .status(.connected))
        XCTAssertTrue(ConnectAppPill.authorize.acts)
        XCTAssertFalse(ConnectAppPill.status(.connected).acts, "Connected is shown, not pressed")
    }

    func testTheChipsStartWithAllAndListOnlyCategoriesWithApps() {
        let items = [item("x", category: .productivity, status: .available, action: .connect),
                     item("y", category: .code, status: .available, action: .connect)]
        let chips = ConnectAppsChip.chips(items: items, marketplaces: ["team"], bots: true, sources: false)
        XCTAssertEqual(chips.first, .all)
        XCTAssertEqual(Array(chips[1...2]), [.category(.productivity), .category(.code)])
        XCTAssertFalse(chips.contains(.category(.design)), "no chip for an empty category")
        XCTAssertTrue(chips.contains(.type(.source("team"))))
        XCTAssertTrue(chips.contains(.bots))
        XCTAssertTrue(chips.contains(.pages), "published pages keep a place in Connect apps")
        XCTAssertFalse(chips.contains(.sources))
        XCTAssertEqual(ConnectAppsChip.category(.code).key, "category.code", "the id does not follow the language")
    }

    /// The desktop's #4154 on the phone: no "No sign-in needed" account and
    /// no "0 of 0 enabled" tools section.
    func testAPluginSheetDrawsOnlySectionsWithContent() throws {
        XCTAssertFalse(PluginSheetSections.showsAccount(try server(#"{"name":"plain","command":"run"}"#)))
        XCTAssertFalse(PluginSheetSections.showsAccount(try server(#"{"name":"open","url":"https://x.test","auth":"none"}"#)))
        XCTAssertTrue(PluginSheetSections.showsAccount(try server(#"{"name":"oauth","url":"https://x.test","auth":"required"}"#)))
        XCTAssertTrue(PluginSheetSections.showsAccount(try server(#"{"name":"keyed","command":"run","envKeys":["TOKEN"]}"#)))

        let none = try JSONDecoder().decode(MCPProbe.self, from: Data(#"{"ok":true,"tools":[]}"#.utf8))
        let some = try JSONDecoder().decode(MCPProbe.self, from: Data(#"{"ok":true,"tools":[{"name":"read"}]}"#.utf8))
        let failed = try JSONDecoder().decode(MCPProbe.self, from: Data(#"{"ok":false,"tools":[],"error":"down"}"#.utf8))
        XCTAssertTrue(PluginSheetSections.showsTools(nil), "not asked yet: the section stays")
        XCTAssertFalse(PluginSheetSections.showsTools(none))
        XCTAssertTrue(PluginSheetSections.showsTools(some))
        XCTAssertTrue(PluginSheetSections.showsTools(failed), "the error has its place")
    }

    /// One sign-in per plugin sheet: when the foot pill says Authorize, the
    /// Accounts row has no Sign in button of its own.
    func testAPluginSheetOffersOneSignIn() throws {
        let lapsed = try server(#"{"name":"oauth","url":"https://x.test","auth":"expired"}"#)
        XCTAssertFalse(PluginSheetSections.accountSignsIn(lapsed, pill: .authorize))
        // a server turned off shows Off at the foot: the row keeps the sign-in
        XCTAssertTrue(PluginSheetSections.accountSignsIn(lapsed, pill: .status(.off)))
        let signedIn = try server(#"{"name":"oauth","url":"https://x.test","auth":"connected"}"#)
        XCTAssertFalse(PluginSheetSections.accountSignsIn(signedIn, pill: .status(.connected)))
    }

    /// #4510: the Settings sheet follows the 402 pt references
    /// (measure-settings.md), not the bot panel's 430 pt measures: a row is
    /// 44.5 pt with 13.5 pt words and 11 pt notes.
    func testTheSettingsSheetFollowsTheReferenceMeasures() {
        XCTAssertEqual(PhoneSheetMetrics.row, 44.5)
        XCTAssertGreaterThanOrEqual(PhoneSheetMetrics.row, 44, "a row stays a 44 pt touch target")
        XCTAssertEqual(PhoneSheetMetrics.rowSize, 13.5)
        XCTAssertEqual(PhoneSheetMetrics.subtitleSize, 11)
        XCTAssertEqual(PhoneSheetMetrics.groupTitleSize, 11)
        XCTAssertEqual(PhoneSheetMetrics.cardGap, 27)
        XCTAssertEqual(PhoneSheetMetrics.labelledGap, 48.6, accuracy: 0.05)
        XCTAssertEqual(PhoneSheetMetrics.personRow, 65.5)
        XCTAssertEqual(PhoneSheetMetrics.avatar, 38.5)
        XCTAssertEqual(PhoneSheetMetrics.textInset, 17.5)
        XCTAssertEqual(PhoneSheetMetrics.chevronTrailing, 21)
        // a one-line note row: title and one note line in the 61 pt row
        XCTAssertEqual(2 * PhoneSheetMetrics.twoLinePadding + 13.5 * 1.19 + PhoneSheetMetrics.lineGap + 11 * 1.19, 61, accuracy: 3)
        // a Connect apps row: 38.5 pt tile and 30.5 pt of air, 69 pt pitch
        XCTAssertEqual(2 * PhoneSheetMetrics.rowPadding + PhoneSheetMetrics.icon, 69)
        XCTAssertEqual(PhoneSheetMetrics.appsMargin, 21)
    }
}
