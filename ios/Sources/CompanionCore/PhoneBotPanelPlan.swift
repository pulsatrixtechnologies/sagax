// The iPhone bot panel as the reference app draws it (#4101): a round back
// control at the top left, share and more at the top right, the mascot, the
// name and an Edit pill, then grouped cards that all share one left and one
// right edge at the page margin. Library, Computer and Routines are rows that
// push their own page; nothing of the former Activity / Library switch is
// dropped: the activity (suggestions, tasks, coding work) is a row with its
// own page, the upcoming routines live on the Routines page, the voice chat
// settings on theirs.
import Foundation

/// One row of the panel's grouped cards.
public enum PhoneBotPanelRow: String, CaseIterable, Hashable, Sendable {
    case library, computer, activity
    /// Channels the bot is reachable on: Slack, its own email address.
    case slack, email
    case voiceChat
    case routines
}

/// Which rows the panel shows, in which card (`PhoneBotPanelPlan.make`).
public struct PhoneBotPanelPlan: Equatable, Sendable {
    /// The first card: Library, Computer (its state), Activity.
    public var top: [PhoneBotPanelRow]
    /// Under the "Configure bot" title: the channel rows this pairing has,
    /// Voice chat, then Routines ("N on").
    public var configure: [PhoneBotPanelRow]

    /// A row the bot cannot use is left out, never shown greyed: no Slack
    /// row without a Slack link, no email row without the bot's address.
    public static func make(slack: Bool, email: Bool) -> PhoneBotPanelPlan {
        var configure: [PhoneBotPanelRow] = []
        if slack { configure.append(.slack) }
        if email { configure.append(.email) }
        configure.append(.voiceChat)
        configure.append(.routines)
        return PhoneBotPanelPlan(top: [.library, .computer, .activity], configure: configure)
    }

    /// Every row once, in screen order.
    public var rows: [PhoneBotPanelRow] { top + configure }

    /// The Routines row's value: how many of this bot's routines are on.
    public static func routinesOn(botId: String, in routines: [Routine]) -> Int {
        DesktopRoutineList.of(botId: botId, in: routines).filter(\.enabled).count
    }
}

/// The panel's measures, in points, from the reference app on a 430 pt wide
/// phone (#4101). Every card, group title, footnote and top control sits on
/// the same side margin; a card never adds its own.
public enum PhonePanelMetrics {
    /// The page's side margin: cards, chips and the top controls.
    public static let margin: Double = 17
    /// The top controls' centre, under the safe area.
    public static let barCentre: Double = 31
    /// Two trailing controls (share, more) sit this far apart.
    public static let barGap: Double = 13
    /// The mascot's frame and the space above it, under the bar.
    public static let mascot: Double = 104
    public static let mascotTop: Double = 14
    /// The name: 20 pt semibold, one line; the Edit pill under it.
    public static let nameSize: Double = 20
    public static let nameTop: Double = 14
    public static let pillTop: Double = 14
    public static let pillHeight: Double = 40
    public static let pillPadding: Double = 11
    /// The first card under the pill, and the gap between two groups.
    public static let headerToCard: Double = 26
    public static let groupGap: Double = 26
    /// Row: 52 pt high; the outline icon centred 33 pt into the card; the
    /// label (and the hairline under it) 57 pt in; the chevron's ink ends
    /// 24 pt from the card's trailing edge.
    public static let row: Double = 52
    public static let iconCentre: Double = 33
    public static let textColumn: Double = 57
    public static let chevronTrailing: Double = 24
    /// A row without an icon (Notifications, a routine): its text and its
    /// switch 20 pt from the card's edges; the group title and the
    /// footnote start at the same inset.
    public static let textInset: Double = 20
    public static let switchRow: Double = 61
    public static let titleToCard: Double = 8.7
    public static let footnoteTop: Double = 10
    /// Type: row label and value 16, group title and footnote 13.
    public static let rowSize: Double = 16
    public static let titleSize: Double = 13
    /// The switch: 66 x 30.
    public static let switchWidth: Double = 66
    public static let switchHeight: Double = 30
    /// Library page: chips 35 pt high, 8 pt apart, their words 12 pt
    /// medium 14 pt in; rows 69 pt with a 26 pt thumbnail 19 pt into the
    /// card and the name 55 pt in.
    public static let chipHeight: Double = 35
    public static let chipTextSize: Double = 12
    public static let chipGap: Double = 8
    public static let chipPadding: Double = 14
    public static let listRow: Double = 69
    public static let thumbnail: Double = 26
    public static let thumbnailLeading: Double = 19
    public static let listTextColumn: Double = 55
    public static let subtitleSize: Double = 14
    /// "Show more" centred 48 pt under the card's lower edge.
    public static let showMoreGap: Double = 36
    /// Routines page: the routine's schedule and state on two lines at most.
    public static let routineSubtitleLines = 2
    /// Every card on the panel and its pages: a faint hairline outline.
    public static let cardOutline: Double = 0.75
    /// The Library row's drawn folder with books: 21 pt, 1.2 pt stroke.
    public static let glyph: Double = 21
}

/// The Library page's chips as the reference draws them (#4101): All, Media
/// (pictures and videos), Links. A chip whose list would be empty is left
/// out, and the row of chips shows only when there is a choice.
public enum PhoneLibraryChip: String, CaseIterable, Hashable, Sendable {
    case all, media, links

    public static func isMedia(_ entry: LibraryEntry) -> Bool {
        guard case let .file(file) = entry else { return false }
        let kind = ThreadFileRules.kind(of: file)
        return kind == .image || kind == .video
    }

    public static func visible(entries: [LibraryEntry], links: Int, selected: PhoneLibraryChip) -> [PhoneLibraryChip] {
        var chips: [PhoneLibraryChip] = [.all]
        if selected == .media || entries.contains(where: isMedia) { chips.append(.media) }
        if selected == .links || links > 0 { chips.append(.links) }
        return chips.count > 1 ? chips : []
    }

    /// Where a door into the Library lands: a picture or video filter on
    /// Media, Links on Links, anything else on All.
    public static func start(_ chip: BotLibraryChip) -> PhoneLibraryChip {
        switch chip {
        case .links: .links
        case .files(.image), .files(.video): .media
        case .files: .all
        }
    }

    /// The dated groups with only this chip's entries (Links has its own list).
    public static func filter(_ groups: LibraryGroups, _ chip: PhoneLibraryChip) -> LibraryGroups {
        guard chip == .media else { return groups }
        return LibraryGroups(
            pinned: groups.pinned.filter(isMedia),
            today: groups.today.filter(isMedia),
            thisWeek: groups.thisWeek.filter(isMedia),
            older: groups.older.filter(isMedia)
        )
    }

    /// What the chip lists, in the dated groups. All holds everything, the
    /// bot's links with its files, artifacts and pages, each group newest
    /// first, as the reference's All page starts with a link above the files;
    /// Media holds pictures and videos only. A link is never pinned: it falls
    /// in Today, This week or Older by its day, on the same cut-offs as
    /// `LibraryRules.groups`. Links keeps its own paged list.
    public static func items(_ groups: LibraryGroups, links: [BotLink], chip: PhoneLibraryChip, now: Double, calendar: Calendar = .current) -> PhoneLibraryGroups {
        let shown = filter(groups, chip)
        func wrap(_ entries: [LibraryEntry]) -> [PhoneLibraryItem] { entries.map(PhoneLibraryItem.entry) }
        var result = PhoneLibraryGroups(pinned: wrap(shown.pinned), today: wrap(shown.today), thisWeek: wrap(shown.thisWeek), older: wrap(shown.older))
        guard chip == .all, !links.isEmpty else { return result }
        let week = 7.0 * 24 * 3_600_000
        let startOfToday = calendar.startOfDay(for: Date(timeIntervalSince1970: now / 1000)).timeIntervalSince1970 * 1000
        let linkItems: [PhoneLibraryItem] = links.map(PhoneLibraryItem.link)
        result.today = PhoneLibraryItem.newestFirst(result.today + linkItems.filter { $0.at >= startOfToday })
        result.thisWeek = PhoneLibraryItem.newestFirst(result.thisWeek + linkItems.filter { $0.at < startOfToday && now - $0.at < week })
        result.older = PhoneLibraryItem.newestFirst(result.older + linkItems.filter { $0.at < startOfToday && now - $0.at >= week })
        return result
    }
}

/// One row of the phone Library's dated groups: a file, an artifact or a
/// page (`LibraryEntry`), or one of the bot's links (#4101).
public enum PhoneLibraryItem: Identifiable, Hashable, Sendable {
    case entry(LibraryEntry)
    case link(BotLink)

    public var id: String {
        switch self {
        case let .entry(entry): entry.id
        case let .link(link): "link:\(link.id)"
        }
    }

    /// Milliseconds, as `LibraryEntry.at`.
    public var at: Double {
        switch self {
        case let .entry(entry): entry.at
        case let .link(link): link.at
        }
    }

    static func newestFirst(_ items: [PhoneLibraryItem]) -> [PhoneLibraryItem] {
        items.sorted { a, b in a.at != b.at ? a.at > b.at : a.id < b.id }
    }
}

/// The phone Library's dated groups, links included on All.
public struct PhoneLibraryGroups: Equatable, Sendable {
    public var pinned: [PhoneLibraryItem]
    public var today: [PhoneLibraryItem]
    public var thisWeek: [PhoneLibraryItem]
    public var older: [PhoneLibraryItem]

    public var isEmpty: Bool { pinned.isEmpty && today.isEmpty && thisWeek.isEmpty && older.isEmpty }
}
