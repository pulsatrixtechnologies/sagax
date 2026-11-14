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

    /// Measured on the reference (a 430 pt phone): the sheets take the bot
    /// panel's margin and row, and keep their own gaps.
    func testTheSheetsShareThePanelsMeasures() {
        XCTAssertEqual(PhoneSheetMetrics.cardGap, 31)
        // card bottom to the next card top with a group title between
        XCTAssertEqual(PhoneSheetMetrics.titledGap + 14.3 + PhonePanelMetrics.titleToCard, 55.4, accuracy: 0.05)
        XCTAssertEqual(PhoneSheetMetrics.personRow, 89)
        // a Connect apps row: 13 pt of air around a 42 pt icon, 68 pt pitch
        XCTAssertEqual(2 * PhoneSheetMetrics.rowPadding + PhoneSheetMetrics.icon, 68)
        XCTAssertEqual(PhoneSheetMetrics.appsMargin, 24)
    }
}
