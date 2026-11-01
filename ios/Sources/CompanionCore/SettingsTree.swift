// The phone's Settings as one tree (2026-10-26, the Grok Bot layout): a
// short root of grouped cards (the profile with Usage, the bots and apps,
// this device, privacy and security, help), and the detail one level in.
// The root, Bots, Privacy and security and About pages draw their cards
// from here, the search opens a page through its parents, and a test checks
// that every setting the phone had before this layout still has a place.
import Foundation

/// A page of the tree that lists rows.
public enum SettingsPageID: String, CaseIterable, Hashable, Sendable {
    case root, account, bots, privacySecurity, about
}

/// A row of the tree. Rows that open a page name it in `opens`.
public enum SettingsItem: String, CaseIterable, Hashable, Sendable {
    // Root
    case profile, usage, organization
    case bots, connectApps, publishedPages
    case notifications, appearance, language, haptics
    case privacySecurity
    case helpCenter, sendFeedback, about
    case signOut
    // Bots
    case autoReview, autoReviewRules, approvalRules, actionJournal, timeZoneAuto, timeZone, botComputer
    /// "Reach me" (#1187): how each bot reaches the person outside the app.
    case reachMe
    /// "My engines" (#1098): the person's own subscription sign-in on each
    /// engine the organization offers them.
    case myEngines
    case quickReplies, callVoice, experimental
    // Privacy and security
    case securityKeys, vault, presence, readReceipts
    // About
    case version, privacyPolicy, termsOfService, sagaxTerms
    // Account (its own page, listed for the tree's completeness)
    case accountPhoto, switchAccount, addAccount, accountSignOut, deleteAccount, connectionDetails

    /// The tree page this row opens, if it opens one.
    public var opens: SettingsPageID? {
        switch self {
        case .profile: .account
        case .bots: .bots
        case .privacySecurity: .privacySecurity
        case .about: .about
        default: nil
        }
    }
}

/// What decides which rows show: the pairing, its gate and the server.
public struct SettingsContext: Equatable, Sendable {
    public var connected: Bool
    public var usage: Bool
    public var organization: Bool
    public var plugins: Bool
    public var computer: Bool
    public var experimental: Bool
    /// Presence and read receipts: an organization server's people.
    public var privacy: Bool
    public var ownPhoto: Bool
    /// My engines (#1098): an organization server's person, signed in.
    public var myEngines: Bool

    public init(connected: Bool, usage: Bool = false, organization: Bool = false, plugins: Bool = false,
                computer: Bool = false, experimental: Bool = false, privacy: Bool = false, ownPhoto: Bool = false,
                myEngines: Bool = false) {
        self.connected = connected
        self.usage = usage
        self.organization = organization
        self.plugins = plugins
        self.computer = computer
        self.experimental = experimental
        self.privacy = privacy
        self.ownPhoto = ownPhoto
        self.myEngines = myEngines
    }

    /// The context `NavigationMenus.settings` describes for a pairing.
    public init(gate: SurfaceGate, connected: Bool, ownPhoto: Bool = false) {
        let sections = NavigationMenus.settings(gate: gate, connected: connected, achievementsAvailable: false)
        self.init(
            connected: connected,
            usage: sections.contains(.usage),
            organization: sections.contains(.organization),
            plugins: sections.contains(.plugins),
            computer: sections.contains(.computer),
            experimental: sections.contains(.experimental),
            privacy: NavigationMenus.showsPrivacy(gate: gate, connected: connected),
            ownPhoto: ownPhoto,
            myEngines: connected && gate.allows(.myEngines)
        )
    }

    /// Everything on: the tree at its fullest.
    public static let everything = SettingsContext(
        connected: true, usage: true, organization: true, plugins: true, computer: true,
        experimental: true, privacy: true, ownPhoto: true, myEngines: true
    )
}

public enum SettingsTree {
    /// A page's cards, top to bottom, each a list of rows; empty cards are dropped.
    public static func cards(_ page: SettingsPageID, _ c: SettingsContext) -> [[SettingsItem]] {
        let all: [[(SettingsItem, Bool)]]
        switch page {
        case .root:
            all = [
                // Grok Bot's account sheet (2026-11-01): the profile with
                // Usage and the Vault, Connect apps, then the Bot card
                [(.profile, true), (.usage, c.usage), (.organization, c.organization), (.vault, c.connected)],
                [(.connectApps, c.plugins), (.publishedPages, c.connected)],
                [(.bots, true)],
                [(.notifications, true), (.appearance, true), (.language, true), (.haptics, true)],
                [(.privacySecurity, c.connected)],
                [(.helpCenter, true), (.sendFeedback, true), (.about, true)],
                [(.signOut, c.connected)],
            ]
        case .bots:
            all = [
                [(.autoReview, c.connected), (.autoReviewRules, c.connected), (.approvalRules, c.connected), (.actionJournal, c.connected)],
                [(.reachMe, c.connected)],
                [(.myEngines, c.connected && c.myEngines)],
                [(.timeZoneAuto, c.connected), (.timeZone, c.connected)],
                [(.botComputer, c.connected && c.computer)],
                [(.quickReplies, true), (.callVoice, true)],
                [(.experimental, c.connected && c.experimental)],
            ]
        case .privacySecurity:
            all = [
                [(.securityKeys, c.connected)],
                [(.presence, c.privacy)],
                [(.readReceipts, c.privacy)],
            ]
        case .about:
            all = [
                [(.version, true)],
                [(.privacyPolicy, true), (.termsOfService, true), (.sagaxTerms, true)],
            ]
        case .account:
            all = [
                [(.accountPhoto, c.ownPhoto)],
                [(.switchAccount, true), (.addAccount, true)],
                [(.accountSignOut, true)],
                [(.deleteAccount, true)],
                [(.connectionDetails, c.connected)],
            ]
        }
        return all.map { $0.filter(\.1).map(\.0) }.filter { !$0.isEmpty }
    }

    /// Every row reachable from the root in this context, with the pages
    /// that lead to it (root excluded), in drawing order.
    public static func reachable(_ c: SettingsContext) -> [(item: SettingsItem, path: [SettingsPageID])] {
        var out: [(SettingsItem, [SettingsPageID])] = []
        func walk(_ page: SettingsPageID, _ path: [SettingsPageID]) {
            for item in cards(page, c).joined() {
                out.append((item, path))
                if let next = item.opens, !path.contains(next) { walk(next, path + [next]) }
            }
        }
        walk(.root, [])
        return out
    }

    /// The pages to open, outermost first, to show `item` (empty: the root).
    public static func path(to item: SettingsItem, _ c: SettingsContext = .everything) -> [SettingsPageID]? {
        reachable(c).first { $0.item == item }?.path
    }
}
