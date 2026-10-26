// The standard home (reference 01): the person's photo and two glass
// buttons, pinned bots as large mascots in three columns, then collapsible
// sections of two-line rows. Every value is measured in
// docs/superpowers/specs/assets/ios-visual-parity/measure-home.md (pt).
//
// The parts live here; `ChatListView` assembles them and owns navigation.
import SwiftUI
import CompanionCore

/// The measured home geometry.
enum HomeMetrics {
    /// Header controls sit this far below the safe area (y 68 on a 62 pt top).
    static let headerTop: CGFloat = 6
    static let headerHeight: CGFloat = 44
    /// From the safe-area top to the first pinned mascot (y 149.3).
    static let pinnedTop: CGFloat = 87.3
    static let pinnedColumn: CGFloat = 134
    static let pinnedMascot: CGFloat = 85
    /// One pinned row, mascot top to the next block (149.3 to 281.7).
    static let pinnedRowHeight: CGFloat = 132.4
    static let pinnedLabelGap: CGFloat = 12
    // Grok Bot iOS 1.14 (an iPhone capture of 2026-10-18, 602x1308 px for
    // 402x874 pt, 1.4975 px/pt). A lone Primary Bot is centred on the screen
    // (shape centre x 200.3, y 191.7) and its shape spans 92x89 pt; the name
    // and the next header did not move (cap top 248.4, header cap 303.8).
    // Sagax shapes fill about 0.9 of their frame (the hexagon shape is 76 pt
    // wide in an 85 pt frame), so the frame is 102 pt for the same ink
    // (measured after: the fixture's owl spans 92 pt tall). It
    // is drawn over the 85 pt slot, so the label and sections keep their
    // measured places.
    static let pinnedSoloMascot: CGFloat = 102
    /// How far that mascot rises above the 85 pt slot. The cell makes room
    /// for it (the pin swipe clips each cell) and the pinned block is lifted
    /// as much. The large mascot is the Primary Bot (alone on its centred
    /// row, other pins under it) or the one pinned chat.
    static var pinnedSoloOverflow: CGFloat { (pinnedSoloMascot - pinnedMascot) / 2 }
    /// The Primary Bot's star, on the avatar's lower right corner: an orange
    /// disc of 20.7 pt in a 2.7 pt ring of the background, centred 34.4 pt
    /// right of and below the shape's centre (measured on the 102 pt frame;
    /// every other size scales from it).
    static let primaryBadge: CGFloat = 20.7
    static let primaryBadgeRing: CGFloat = 2.7
    static let primaryBadgeOffset: CGFloat = 34.4
    static let unreadDot: CGFloat = 10
    /// 7.7 pt of ink between the label and the dot.
    static let unreadGap: CGFloat = 5.4

    static let sectionHeaderHeight: CGFloat = 41
    /// Header text line top inside its block (baseline 31.3).
    static let sectionHeaderTextTop: CGFloat = 19.87
    static let sectionLeading: CGFloat = 20.5

    static let rowHeight: CGFloat = 80
    /// The row's layout slot (x 23-65, measured on reference 01): the text
    /// column and the vertical centre hang on it.
    static let rowMascot: CGFloat = 42
    /// What the row draws in that slot. Grok Bot iOS 1.14 draws its row
    /// shapes 46.5 pt on average (40.7 to 49.4, centre x 44, unchanged); our
    /// shapes fill about 0.83 of their frame, hence 56 pt, centred on the
    /// same point so the name, chip and preview stay where they were.
    static let rowMascotDrawn: CGFloat = 56
    static let rowLeading: CGFloat = 23
    static let textColumn: CGFloat = 81.8
    static let rowTrailing: CGFloat = 21.7
    /// A long role truncates inside its chip ("Department Man...").
    static let chipMaxWidth: CGFloat = 118
    /// Name line top inside the row (baseline at 35).
    static let nameTop: CGFloat = 21.67
    static let nameLine: CGFloat = 16.7
    /// Name line bottom to preview line top (preview baseline 55.7).
    static let previewGap: CGFloat = 5.43
    static let previewLine: CGFloat = 14.9
    static let previewIconBox: CGFloat = 12
    static let previewIconGap: CGFloat = 8

    static var font12: Font { Theme.font(12) }
    static var name: Font { Theme.font(14, .medium) }
    static var chevron: Color { Theme.parity(Color(hex: 0x3C3C3D), Theme.chevron) }
}

// MARK: - Collapsed sections

/// Which home sections are folded, per device. Stored as one string so a
/// section name with any characters round-trips.
struct CollapsedSections {
    static let key = "companion.home.collapsedSections"

    static func decode(_ raw: String) -> Set<String> {
        guard let data = raw.data(using: .utf8),
              let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return Set(list)
    }

    static func encode(_ set: Set<String>) -> String {
        guard let data = try? JSONEncoder().encode(set.sorted()) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - Header

/// The person's photo in a 44 pt glass ring (38 pt photo inset 3 pt). A tap
/// opens the account menu (the desktop's `SidebarProfileMenu`).
struct HomeAccountButton: View {
    @Environment(\.themePalette) var themePalette
    let select: (AccountMenuItem) -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    @ObservedObject private var approvals = OrgApprovalsCenter.shared

    var body: some View {
        Menu {
            HomeAccountMenuItems(select: select)
        } label: {
            ZStack {
                if let photo = session.accountPhoto {
                    Image(uiImage: photo).resizable().scaledToFill()
                } else if let chief = fallbackBot {
                    Theme.card
                    MascotCharacterView(bot: chief, size: 30)
                } else {
                    ProfileAvatar(name: displayName, size: 38)
                }
            }
            .frame(width: 38, height: 38)
            .clipShape(Circle())
            .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle())
        .accessibilityLabel(Text("Account"))
        .accessibilityIdentifier("home-account")
        // "photo" once the person's own picture shows (UI tests wait on it).
        .accessibilityValue(Text(verbatim: session.accountPhoto == nil ? "" : "photo"))
        // after the button's own identifier, so the badges stay their own
        // elements (the menu button is "home-account" alone)
        // the person's own presence dot (#167)
        .overlay(alignment: .bottomTrailing) {
            if let id = session.account?.principalId, let entry = people.presence.entry(id) {
                PresenceDot(entry: entry, size: 11)
                    .offset(x: -2, y: -2)
            }
        }
        // commands waiting for an admin (#213): opens Settings
        .overlay(alignment: .bottomLeading) {
            if approvals.count > 0 {
                Button { select(.settings) } label: {
                    Text(verbatim: "\(approvals.count)")
                        .font(.system(size: 11, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.accentInk)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Theme.accent, in: Capsule())
                }
                .buttonStyle(.plain)
                .offset(x: -4, y: 4)
                .accessibilityLabel(Text(String(localized: "\(approvals.count) commands wait for an admin")))
                .accessibilityIdentifier("admin-approvals-badge")
            }
        }
        // No routines badge on the photo (JC, 2026-10-18: Grok Bot puts
        // nothing there). The account menu's Automations entry keeps the
        // count (HomeAccountMenuItems).
    }

    /// Without a photo or a name, the paired computer's own mascot: its
    /// Primary Bot when it has one.
    private var fallbackBot: Bot? {
        guard session.account?.name == nil, session.account?.email == nil else { return nil }
        return session.state.bots.first { $0.chiefOfStaff == true && $0.hidden != true }
    }

    private var displayName: String {
        session.account?.name ?? session.account?.email ?? session.connection?.name ?? "You"
    }
}

// MARK: - Pinned

/// A pinned bot or group: an 85 pt mascot (102 pt for the lead: the Primary
/// Bot, or a lone pinned chat), its name centred
/// beneath with the unread dot after it. The Primary Bot's star sits on the
/// mascot's corner, as in Grok Bot iOS 1.14, not after the name.
struct HomePinnedCell: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    var state: MausState = .idle
    /// The drawn mascot: 85 pt in the grid, `pinnedSoloMascot` for the lead
    /// on its own centred row (Grok Bot's primary bot).
    var mascot: CGFloat = HomeMetrics.pinnedMascot

    private var overflow: CGFloat { max(0, (mascot - HomeMetrics.pinnedMascot) / 2) }

    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                switch chat {
                case let .bot(bot):
                    BotMascotView(bot: bot, size: mascot, state: state, animated: state.showsActivity)
                case let .room(room):
                    if let peer = people.peer(room, session: session) {
                        PersonAvatar(initials: peer.initials, size: mascot, presenceId: peer.id)
                    } else {
                        GroupMascotView(
                            members: room.memberIds.compactMap { session.state.bot($0) },
                            size: mascot,
                            background: Theme.bg
                        )
                    }
                }
            }
            .frame(width: mascot, height: mascot)
            .overlay {
                if case let .bot(bot) = chat, bot.chiefOfStaff == true {
                    HomePrimaryBadge(mascot: mascot)
                }
            }
            // drawn larger than the slot, centred on it: the label below
            // keeps its measured place
            .frame(width: HomeMetrics.pinnedMascot, height: HomeMetrics.pinnedMascot)

            HStack(spacing: HomeMetrics.unreadGap) {
                Text(verbatim: people.name(chat, session: session))
                    .font(.system(size: 11.65))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .lineLimit(1)
                if chat.unread && !chat.busy {
                    Circle()
                        .fill(Theme.unreadDot)
                        .frame(width: HomeMetrics.unreadDot, height: HomeMetrics.unreadDot)
                        .accessibilityLabel(Text("Unread"))
                }
            }
            .padding(.top, HomeMetrics.pinnedLabelGap)
            .padding(.horizontal, 6)
            Spacer(minLength: 0)
        }
        .padding(.top, overflow)
        .frame(width: HomeMetrics.pinnedColumn, height: HomeMetrics.pinnedRowHeight + overflow, alignment: .top)
        .contentShape(Rectangle())
    }
}

/// The Primary Bot's star on a home mascot's lower right corner (Grok Bot
/// iOS 1.14): an orange disc ringed with the background, scaled from the
/// lone pinned mascot's measures. Same orange and star as `PrimaryBotBadge`.
struct HomePrimaryBadge: View {
    @Environment(\.themePalette) var themePalette
    let mascot: CGFloat

    var body: some View {
        let scale = mascot / HomeMetrics.pinnedSoloMascot
        let disc = HomeMetrics.primaryBadge * scale
        let offset = HomeMetrics.primaryBadgeOffset * scale
        ZStack {
            Circle().fill(Theme.bg)
                .frame(width: disc + 2 * HomeMetrics.primaryBadgeRing * scale, height: disc + 2 * HomeMetrics.primaryBadgeRing * scale)
            Circle().fill(Color.orange)
                .frame(width: disc, height: disc)
            Image(systemName: "star.fill")
                .font(.system(size: disc * 0.4, weight: .bold))
                .foregroundStyle(.white)
        }
        .offset(x: offset, y: offset)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Primary Bot"))
        .accessibilityIdentifier("primary-bot-badge")
    }
}

/// A home section's title. "My team" is the name Grok Bot and earlier
/// imports give the person's default team: it reads in the app's language
/// ("My Team", as Grok Bot and our "Group Chats" write it; "Mon équipe"),
/// as on the desktop (`isMyTeamSectionName`, src/lib/sidebar-layout.ts).
/// Any other name stays exactly as typed.
enum HomeSectionTitle {
    static func display(_ name: String) -> String {
        isMyTeamSectionName(name) ? String(localized: "My Team") : name
    }
}

// MARK: - Section header

struct HomeSectionHeader: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    let collapsed: Bool
    let toggle: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            withAnimation(.snappy(duration: 0.22)) { toggle() }
        } label: {
            HStack(spacing: 9) {
                Text(verbatim: title)
                    .font(.system(size: 12.33))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(HomeMetrics.chevron)
                    .rotationEffect(.degrees(collapsed ? -90 : 0))
                Spacer(minLength: 0)
            }
            .frame(height: 14.32)
            .padding(.top, HomeMetrics.sectionHeaderTextTop)
            .padding(.leading, HomeMetrics.sectionLeading)
            .frame(height: HomeMetrics.sectionHeaderHeight, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(collapsed ? Text("Collapsed") : Text("Expanded"))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Rows

/// What a row's trailing side shows besides the time.
struct HomeRowStatus: Equatable {
    var waiting = false
    var working = false
    var threadCount = 0
    var unread = false
}

/// One bot or group on two lines: the mascot (56 pt drawn on the 42 pt
/// slot), name, role chip and time, then the preview with its leading icon.
struct HomeChatRow: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let preview: RosterPreviewLine
    let stamp: String
    var status = HomeRowStatus()
    var state: MausState = .idle
    /// Bulk selection: non-nil while rows can be picked.
    var selection: Selection?

    struct Selection: Equatable { var selected: Bool }

    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Group {
                switch chat {
                case let .bot(bot):
                    BotMascotView(bot: bot, size: HomeMetrics.rowMascotDrawn, state: state, animated: state.showsActivity)
                case let .room(room):
                    if let peer = people.peer(room, session: session) {
                        PersonAvatar(initials: peer.initials, size: HomeMetrics.rowMascotDrawn, presenceId: peer.id)
                    } else {
                        GroupMascotView(
                            members: room.memberIds.compactMap { session.state.bot($0) },
                            size: HomeMetrics.rowMascotDrawn,
                            background: Theme.bg
                        )
                    }
                }
            }
            .frame(width: HomeMetrics.rowMascotDrawn, height: HomeMetrics.rowMascotDrawn)
            .accessibilityHidden(true)
            // the star stays announced in the row ("Primary Bot")
            .overlay {
                if case let .bot(bot) = chat, bot.chiefOfStaff == true {
                    HomePrimaryBadge(mascot: HomeMetrics.rowMascotDrawn)
                }
            }
            .frame(width: HomeMetrics.rowMascot, height: HomeMetrics.rowMascot)
            .overlay(alignment: .bottomTrailing) {
                if let selection { HomeSelectionMark(selected: selection.selected).offset(x: 4, y: 2) }
            }
            .padding(.top, (HomeMetrics.rowHeight - HomeMetrics.rowMascot) / 2)
            .padding(.leading, HomeMetrics.rowLeading)

            VStack(alignment: .leading, spacing: HomeMetrics.previewGap) {
                nameLine.frame(height: HomeMetrics.nameLine)
                previewLine.frame(height: HomeMetrics.previewLine)
            }
            .padding(.top, HomeMetrics.nameTop)
            .padding(.leading, HomeMetrics.textColumn - HomeMetrics.rowLeading - HomeMetrics.rowMascot)
            .padding(.trailing, HomeMetrics.rowTrailing)
        }
        .frame(maxWidth: .infinity, minHeight: HomeMetrics.rowHeight, maxHeight: HomeMetrics.rowHeight, alignment: .topLeading)
        .background(selection?.selected == true ? Color.accentColor.opacity(0.12) : Color.clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selection?.selected == true ? .isSelected : [])
    }

    private var role: String {
        if case let .bot(bot) = chat { return bot.displayRole }
        return ""
    }

    private var nameLine: some View {
        HStack(spacing: 7.5) {
            Text(verbatim: people.name(chat, session: session))
                .font(HomeMetrics.name)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .layoutPriority(2)
            if !role.isEmpty {
                RoleChip(text: role, font: .system(size: 11.65, weight: .medium), horizontalPadding: 6)
                    .frame(maxWidth: HomeMetrics.chipMaxWidth, alignment: .leading)
                    .layoutPriority(0)
            } else if case let .room(room) = chat, let peer = people.peer(room, session: session) {
                // #172: a person's label, as a bot's label tag
                PersonLabelTag(personId: peer.id, font: .system(size: 11.65, weight: .medium), horizontalPadding: 6)
                    .frame(maxWidth: HomeMetrics.chipMaxWidth, alignment: .leading)
                    .layoutPriority(0)
            }
            Spacer(minLength: 8)
            trailing.layoutPriority(1)
        }
    }

    private var trailing: some View {
        HStack(spacing: 6) {
            if status.waiting {
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(MausPalette.color(chat.color))
                    .accessibilityLabel(Text("Waiting on you"))
            }
            if status.working {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel(Text("Working"))
            } else if !stamp.isEmpty {
                Text(verbatim: stamp)
                    .font(Theme.Font.time)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .fixedSize()
    }

    private var previewLine: some View {
        HStack(spacing: 0) {
            if let icon = previewIcon {
                Image(systemName: icon.name)
                    .font(.system(size: icon.size))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .frame(width: HomeMetrics.previewIconBox, alignment: .leading)
                    .padding(.trailing, HomeMetrics.previewIconGap)
            }
            Text(verbatim: previewText)
                .font(Theme.Font.preview)
                .foregroundStyle(Theme.textSecondaryHome)
                .lineLimit(1)
            Spacer(minLength: 8)
            // Sagax only (threads listed in the sidebar): the thread count.
            // Grok Bot's name line holds the time alone, so the count waits
            // at the end of the preview line, in the time's colour, and the
            // role chip keeps Grok Bot's room on the line above.
            if status.threadCount >= 2 {
                HStack(spacing: 2) {
                    Image(systemName: "square.stack")
                        .font(.system(size: 10))
                    Text(verbatim: "\(status.threadCount)")
                        .font(Theme.Font.time)
                        .monospacedDigit()
                }
                .foregroundStyle(Theme.textTertiary)
                .padding(.trailing, status.unread ? 6 : 0)
                .fixedSize()
                .accessibilityLabel(Text("\(status.threadCount) threads"))
            }
            if status.unread {
                Circle()
                    .fill(Theme.unreadDot)
                    .frame(width: HomeMetrics.unreadDot, height: HomeMetrics.unreadDot)
                    .accessibilityLabel(Text("Unread"))
            }
        }
    }

    private var previewText: String {
        if preview.text.isEmpty, preview.kind == .attachment { return String(localized: "Attachment") }
        return preview.text
    }

    private var previewIcon: (name: String, size: CGFloat)? {
        switch preview.kind {
        case .plain: nil
        case .attachment: ("paperclip", 12.5)
        case .sentToBot: ("paperplane", 11.5)
        }
    }
}

// MARK: - "+" popover

/// The glass popover that grows out of the "+" button: New, the desktop's
/// compose-to picker (Create new Bot, Create group chat, then every bot and
/// the organization's people), 14 pt rows on a 35.8 pt pitch with about
/// 10 pt of padding. A long list scrolls inside the glass.
struct HomePlusMenu: View {
    @Environment(\.themePalette) var themePalette
    let groups: [[NewMenuItem]]
    let title: (NewMenuItem) -> String
    let select: (NewMenuItem) -> Void
    let dismiss: () -> Void

    private static let row: CGFloat = 35.83
    private static let divider: CGFloat = 9

    private var contentHeight: CGFloat {
        let rows = CGFloat(groups.reduce(0) { $0 + $1.count })
        let dividers = CGFloat(max(0, groups.count - 1))
        return rows * Self.row + dividers * Self.divider + 10.08 + 9.59
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(0.001)
                .ignoresSafeArea()
                .onTapGesture(perform: dismiss)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                        if index > 0 {
                            Rectangle()
                                .fill(Theme.parity(Color(hex: 0xF9F9F9), Theme.textPrimary).opacity(0.14))
                                .frame(height: 0.5)
                                .padding(.horizontal, 20)
                                .frame(height: Self.divider)
                        }
                        ForEach(group, id: \.self) { entry in
                            item(Text(verbatim: title(entry))) { select(entry) }
                                .accessibilityIdentifier(NewMenuLabels.identifier(entry))
                        }
                    }
                }
                // item centres 28 and 63.8 pt down (reference 18, measured on
                // the text)
                .padding(.top, 10.08)
                .padding(.bottom, 9.59)
            }
            .scrollDisabled(contentHeight <= 440)
            .frame(width: 250.67, height: min(contentHeight, 440), alignment: .topLeading)
            .background(alignment: .topLeading) { searchUnderGlass }
            .themeGlass(RoundedRectangle(cornerRadius: Theme.continuous(31.5), style: .continuous), fill: Theme.parity(Color(hex: 0x323232), Theme.menuGlass), interactive: false)
            .padding(.trailing, 7.7)
            .transition(.scale(scale: 0.4, anchor: .topTrailing).combined(with: .opacity))
        }
    }

    /// The search button stays visible under the glass, softened, as in the
    /// reference: it sits 166 pt into the popover, 28 pt down.
    private var searchUnderGlass: some View {
        ZStack {
            Circle().fill(Theme.textPrimary.opacity(0.11)).frame(width: 46, height: 46).blur(radius: 4)
            Image(systemName: "magnifyingglass")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Theme.textPrimary.opacity(0.17))
                .blur(radius: 1.4)
        }
        .frame(width: 44, height: 44)
        // the glyph peaks 1.6 pt higher than the circle's centre in the reference
        .offset(x: 166.3 - 22, y: 28 - 22 - 1.6)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func item(_ title: Text, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            title
                .font(Theme.Font.body)
                .foregroundStyle(Theme.parity(Color(hex: 0xF9F9F9), Theme.textPrimary))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 28.4)
                .padding(.trailing, 18)
                .frame(height: 35.83)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
