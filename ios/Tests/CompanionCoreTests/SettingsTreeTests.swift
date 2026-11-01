import XCTest
@testable import CompanionCore

/// The Grok Bot layout (2026-10-26) moves rows, never drops one.
final class SettingsTreeTests: XCTestCase {
    /// Every row the phone's Settings had before the layout, by its old
    /// place: the root (account card, Connect apps card, Bot card, phone
    /// card, more card, links, feedback, sign out), Notifications > Privacy,
    /// the About sheet and the Account page.
    private let before: [SettingsItem] = [
        .profile, .securityKeys, .vault, .usage,
        .connectApps, .publishedPages,
        .autoReview, .autoReviewRules, .approvalRules, .timeZoneAuto, .timeZone, .botComputer,
        .notifications, .appearance, .language, .haptics, .quickReplies, .callVoice,
        .organization, .experimental,
        .helpCenter, .privacyPolicy, .termsOfService, .sagaxTerms,
        .sendFeedback, .signOut,
        .presence, .readReceipts,
        .about,
        .accountPhoto, .switchAccount, .addAccount, .accountSignOut, .deleteAccount, .connectionDetails,
    ]

    func testEverySettingFromBeforeStillHasAPlace() {
        let reachable = Set(SettingsTree.reachable(.everything).map(\.item))
        for item in before {
            XCTAssertTrue(reachable.contains(item), "\(item) lost its place")
        }
    }

    func testEveryRowOfTheTreeIsReachable() {
        let reachable = Set(SettingsTree.reachable(.everything).map(\.item))
        XCTAssertEqual(reachable, Set(SettingsItem.allCases))
    }

    func testEachRowHasOnePlace() {
        let items = SettingsTree.reachable(.everything).map(\.item)
        XCTAssertEqual(items.count, Set(items).count, "a row shows in two places")
    }

    func testTheRootIsShortAndOneLevelDeep() {
        let root = SettingsTree.cards(.root, .everything)
        XCTAssertEqual(root.first?.first, .profile, "the profile heads the list")
        XCTAssertLessThanOrEqual(root.joined().count, 16)
        XCTAssertEqual(SettingsTree.path(to: .autoReview), [.bots])
        XCTAssertEqual(SettingsTree.path(to: .reachMe), [.bots], "Reach me sits with the bots' settings")
        // Grok Bot's sheet lists the Vault with the profile (2026-11-01)
        XCTAssertEqual(SettingsTree.path(to: .vault), [])
        XCTAssertEqual(SettingsTree.cards(.root, .everything).first, [.profile, .usage, .organization, .vault])
        XCTAssertEqual(SettingsTree.path(to: .termsOfService), [.about])
        XCTAssertEqual(SettingsTree.path(to: .switchAccount), [.account])
        XCTAssertEqual(SettingsTree.path(to: .notifications), [])
    }

    /// Before pairing (onboarding) the phone's own settings stay reachable.
    func testUnpairedKeepsThePhonesOwnSettings() {
        let reachable = Set(SettingsTree.reachable(SettingsContext(connected: false)).map(\.item))
        for item: SettingsItem in [.notifications, .appearance, .language, .haptics, .quickReplies, .callVoice, .helpCenter, .about] {
            XCTAssertTrue(reachable.contains(item), "\(item) needs a pairing")
        }
        XCTAssertFalse(reachable.contains(.signOut))
        XCTAssertFalse(reachable.contains(.vault))
    }

    func testTheGateDecidesTheOptionalRows() {
        let member = SettingsContext(gate: SurfaceGate(scope: .serverClient, organization: true), connected: true)
        let rows = Set(SettingsTree.reachable(member).map(\.item))
        XCTAssertTrue(rows.contains(.bots))
        XCTAssertTrue(rows.contains(.reachMe), "a member sets Reach me without an admin")
        XCTAssertTrue(rows.contains(.securityKeys))
        XCTAssertTrue(rows.contains(.presence), "an organization server shows presence")
    }

    func testSearchFindsTheNewPages() {
        let all = SettingsDestination.allCases
        let label: (SettingsDestination) -> String = { $0.rawValue }
        XCTAssertTrue(SettingsSearch.results("security", available: all, label: label).contains(.privacySecurity))
        XCTAssertTrue(SettingsSearch.results("fuseau", available: all, label: label).contains(.bots))
        XCTAssertTrue(SettingsSearch.results("telegram", available: all, label: label).contains(.bots))
        XCTAssertTrue(SettingsSearch.results("me joindre", available: all, label: label).contains(.bots))
        XCTAssertTrue(SettingsSearch.results("terms", available: all, label: label).contains(.about))
    }
}

/// The iPad nav keeps every section, grouped as the phone's tree.
final class DesktopSettingsNavGroupTests: XCTestCase {
    func testAdminSectionsAllShowInGroupOrder() {
        let sections = DesktopSettingsSection.available(for: SurfaceGate(scope: .serverAdmin))
        let grouped = DesktopSettingsNavGroup.grouped(sections)
        XCTAssertEqual(Set(grouped.flatMap(\.sections)), Set(sections), "no section lost")
        XCTAssertEqual(grouped.map(\.group), [.account, .bots, .appearance, .privacySecurity])
        XCTAssertEqual(grouped.first?.sections, [.general, .organization, .usage])
    }

    func testMemberSections() {
        let sections = DesktopSettingsSection.available(for: SurfaceGate(scope: .serverClient, organization: true))
        XCTAssertEqual(Set(DesktopSettingsNavGroup.grouped(sections).flatMap(\.sections)), Set(sections))
    }
}
