// The phone's sheets as the reference app draws them (#4103): the settings
// sheet and its Account page, the Connect apps sheet and a plugin's half
// sheet. The grouped cards, rows, hairlines, group titles and switches are
// the bot panel's (`PhonePanelMetrics`, #4101): one card, one row style for
// the whole phone app. What is only the sheets' lives here, measured on a
// 430 pt wide phone.
import Foundation

public enum PhoneSheetMetrics {
    // MARK: Settings sheet and Account

    // The round close or back control is the app's large glass button
    // (44 pt), inset `PhonePanelMetrics.margin` from the sheet's edges.
    /// The first card's top, from the sheet's top edge.
    public static let firstCard: Double = 102
    /// Space between two cards, and from a card to the next group title's
    /// line box (the title then sits `PhonePanelMetrics.titleToCard` above
    /// its card).
    public static let cardGap: Double = 31
    public static let titledGap: Double = 32.4
    /// The person's row: 89 pt, a 42 pt round avatar 20 pt into the card,
    /// the name and its lines 12 pt after it.
    public static let personRow: Double = 89
    public static let avatar: Double = 42
    public static let avatarGap: Double = 12
    /// A one-line row (Usage, Time Zone, Sign Out) is `PhonePanelMetrics.row`;
    /// a two-line row keeps 15.5 pt above its title and under its second
    /// line, 3 pt between them (70 pt with one line of 13 pt text).
    public static let twoLinePadding: Double = 15.5
    public static let lineGap: Double = 3
    public static let subtitleSize: Double = 13
    /// A trailing value stops 15 pt before its chevron.
    public static let valueGap: Double = 15
    // The page title beside or between the controls is the panel's title
    // bar font (`PhonePanelMetrics.rowSize`, medium).

    // MARK: Connect apps

    /// The list's side margin: chips, section titles, rows.
    public static let appsMargin: Double = 24
    /// The title starts 13 pt after the close control; the count pill sits
    /// at the trailing margin, as tall as the control, its words 19 pt.
    public static let appsTitleGap: Double = 13
    public static let countSize: Double = 19
    public static let countPadding: Double = 17
    /// The filter chips are the Library's (`PhonePanelMetrics.chipHeight`
    /// and the rest), their top 60 pt under the control's centre (38 pt
    /// under a 44 pt control).
    public static let chipsTop: Double = 38
    /// A section's title (16 pt) and its chevron, 14 pt above the first row.
    public static let sectionSize: Double = 16
    public static let sectionTop: Double = 22
    /// A row: a 42 pt icon (the tile's corners, 30% of its side), the name 15 pt after it, a
    /// muted line of two lines at most, the pill at the trailing margin;
    /// 13 pt of air above and under.
    public static let icon: Double = 42
    public static let iconGap: Double = 15
    public static let nameSize: Double = 16
    public static let lineSize: Double = 14
    public static let lineLimit = 2
    public static let rowPadding: Double = 13
    /// The row's pill button: 35 pt high, 16 pt in, 13 pt medium words.
    public static let pillHeight: Double = 35
    public static let pillPadding: Double = 16
    public static let pillTextSize: Double = 13
    /// The floating search: 50 pt, 31 pt from the sides, 12 pt above the
    /// home indicator's area; its words 17 pt.
    public static let searchHeight: Double = 50
    public static let searchMargin: Double = 31
    public static let searchBottom: Double = 12
    public static let searchTextSize: Double = 17

    // MARK: A plugin's half sheet

    /// The system's half sheet with 40 pt corners; its controls 16 pt in
    /// from its edges.
    public static let sheetRadius: Double = 40
    public static let sheetControlInset: Double = 16
    /// The icon in a 56 pt tile with 14 pt corners, 39 pt under the top.
    public static let tile: Double = 56
    public static let tileRadius: Double = 14
    public static let tileTop: Double = 39
    /// The name: 20 pt bold, centred, 16 pt under the tile.
    public static let titleTop: Double = 16
    public static let sheetNameSize: Double = 20
    /// The description: 16 pt muted on a 20 pt pitch, 18 pt from the
    /// sheet's sides, 18 pt under the name.
    public static let descriptionSize: Double = 16
    public static let descriptionPitch: Double = 20
    public static let descriptionInset: Double = 18
    public static let descriptionTop: Double = 18
    /// The state pill: 48 pt high, at least 135 pt wide, centred, 33 pt
    /// above the sheet's lower edge, 15 pt medium words.
    public static let statePillHeight: Double = 48
    public static let statePillWidth: Double = 135
    public static let statePillBottom: Double = 33
    public static let statePillTextSize: Double = 15
}

/// The pill at the end of a Connect apps row, and centred at the foot of a
/// plugin's sheet (#4103): what the row can do, or where it stands.
public enum ConnectAppPill: Equatable, Sendable {
    /// A catalog app or a marketplace plugin to install.
    case add
    /// An app that signs in on install.
    case connect
    /// An installed server whose sign-in is missing or expired: blue.
    case authorize
    /// Where the row stands, muted, nothing to press.
    case status(ConnectAppStatus)

    public static func of(_ item: ConnectAppItem) -> ConnectAppPill {
        if let action = item.action { return action == .add ? .add : .connect }
        if item.kind == .mcp, item.status == .needsAuth { return .authorize }
        return .status(item.status)
    }

    /// The pill does something when pressed.
    public var acts: Bool {
        if case .status = self { return false }
        return true
    }
}

/// One chip of the Connect apps row that scrolls sideways (#4103). All and
/// the categories filter the catalog; the type chips narrow it to MCP
/// servers, skills or one marketplace; the last chips open the lists that
/// were tabs (the person's bots catalogue, their published pages, the
/// sources). Installed is the count pill's, so it is no chip.
public enum ConnectAppsChip: Hashable, Sendable {
    case all
    case category(ConnectAppCategory)
    case type(ConnectAppTypeFilter)
    case bots, pages, sources

    /// A key that does not change with the language (accessibility ids).
    public var key: String {
        switch self {
        case .all: "all"
        case let .category(category): "category.\(category.rawValue)"
        case .type(.any): "type.any"
        case .type(.mcp): "type.mcp"
        case .type(.skills): "type.skills"
        case let .type(.source(name)): "type.source.\(name)"
        case .bots: "bots"
        case .pages: "pages"
        case .sources: "sources"
        }
    }

    /// The chips in screen order: a category only when an app is in it,
    /// a marketplace only when there is one.
    public static func chips(items: [ConnectAppItem], marketplaces: [String], bots: Bool, sources: Bool) -> [ConnectAppsChip] {
        var out: [ConnectAppsChip] = [.all]
        for category in ConnectAppCategory.order where items.contains(where: { $0.category == category }) {
            out.append(.category(category))
        }
        out.append(.type(.mcp))
        out.append(.type(.skills))
        out += marketplaces.map { .type(.source($0)) }
        if bots { out.append(.bots) }
        out.append(.pages)
        if sources { out.append(.sources) }
        return out
    }
}

/// Which sections a plugin's sheet draws (#4103, the desktop's #4154): the
/// Accounts section only when an account applies to the server (a sign-in,
/// saved keys or headers), the Tools section unless the server answered
/// that it has no tool. A section comes back as soon as it has content.
public enum PluginSheetSections {
    public static func showsAccount(_ server: MCPServerListing) -> Bool {
        if let auth = server.auth, ["connected", "required", "expired", "error", "pending"].contains(auth) { return true }
        if let error = server.authError, !error.isEmpty { return true }
        let keys = (server.isRemote ? server.headerKeys : server.envKeys) ?? []
        return !keys.isEmpty
    }

    /// The Accounts row offers Sign in only when the sheet's foot pill does
    /// not already say Authorize: one sign-in per sheet.
    public static func accountSignsIn(_ server: MCPServerListing, pill: ConnectAppPill) -> Bool {
        guard ["required", "expired", "error"].contains(server.auth ?? "") else { return false }
        return pill != .authorize
    }

    /// nil: the tools were not asked for yet, the section stays.
    public static func showsTools(_ probe: MCPProbe?) -> Bool {
        guard let probe, probe.ok else { return true }
        return !probe.tools.isEmpty
    }
}
