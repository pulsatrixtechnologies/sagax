// iPad I2: the desktop sidebar (`Sidebar.tsx`), measured in the DOM dumps
// desktop-<W>x<H>-03-main (comfortable), -04-main-compact, -05-main-collapsed
// (the 80 pt icon rail) and -06-main-threads: the 36 pt band, the brand row
// (mark, "Sagax", the round Search and New buttons), the pinned tiles, the
// collapsible sections and their rows, the places (Team map, Automations;
// Templates once Experimental features turns it on), the account row with its
// gamertag and menu, and the edge (I2b: the sidebar as the desktop redrew it
// in October 2026).
//
// Built from the phone's own state: `SidebarPrefsModel` (the person's
// sections, folds, order, hidden entries and the thread switch, WP6), the
// session's summaries, the WP5 thread and folder actions and the WP11 room
// prompts. Only the presentation is the desktop's.
//
// Sub-trees are type-erased (`AnyView`) at each column and list boundary:
// build 6 crashed at launch on iPad resolving one deep SwiftUI type.
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import CompanionCore

/// The desktop's sidebar densities (`SidebarDensity`).
enum DesktopSidebarDensity: String, CaseIterable, Identifiable {
    case comfortable, compact, icons
    var id: String { rawValue }
}

/// What every sidebar view reads the same way.
@MainActor
enum DesktopSidebarState {
    /// The thread tree under each bot row: Settings > Appearance > Show
    /// threads with Threads location "In the sidebar" (#210), or the parity
    /// surface's preset.
    static func showThreads(model: DesktopShellModel, prefs: SidebarPrefsModel) -> Bool {
        #if DEBUG
        if let preset = model.parityShowThreads { return preset }
        #endif
        return prefs.threadsPlacement.inSidebar
    }

    /// Settings > Appearance > Show threads alone (the compose picker's New
    /// thread, wherever the threads live).
    static func threadsOn(model: DesktopShellModel, prefs: SidebarPrefsModel) -> Bool {
        #if DEBUG
        if let preset = model.parityShowThreads { return preset }
        #endif
        return prefs.showThreads
    }

    /// The chat header's thread picker: threads on, location "In the chat
    /// header" (the default). Never both with the sidebar tree.
    static func headerThreads(model: DesktopShellModel, prefs: SidebarPrefsModel) -> Bool {
        #if DEBUG
        if let preset = model.parityShowThreads { return preset }
        #endif
        return prefs.threadsPlacement.inHeader
    }
}

/// The shell's coordinate space, for menus anchored to a row.
let desktopShellSpace = "desktop-shell"

struct DesktopSidebar: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    var body: some View {
        let layout = prefs.layout(session)
        let icons = model.density == .icons
        return VStack(spacing: 0) {
            Color.clear.frame(height: DesktopShellRules.topBand)
            if icons {
                AnyView(DesktopRailHead())
            } else {
                AnyView(DesktopSidebarHead())
            }
            AnyView(DesktopSidebarList(layout: layout))
                .frame(maxHeight: .infinity)
            AnyView(DesktopSidebarFooter())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.sidebar)
        .overlay(alignment: .trailing) {
            // border-r-[0.5px] border-hairline-weak
            Rectangle().fill(theme.sidebarInk.opacity(0.10)).frame(width: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bots and navigation"))
        .accessibilityIdentifier(icons ? "desktop-sidebar-rail" : "desktop-sidebar-full")
    }
}

// MARK: - Head

/// The head (`SIDEBAR_TITLE_ROW`, `h-12 pr-4`): the round Search and New
/// buttons, 36 pt circles 8 apart ending 16 pt from the edge. The desktop
/// draws no logo unless Settings > Appearance > Sidebar logo turns it on,
/// and the iPad follows the same switch. There is no search field and no
/// collapse button any more: the palette opens from the round button (⌘K)
/// and the sidebar's edge collapses it (drag, double tap, ⌘\).
struct DesktopSidebarHead: View {
    @Environment(\.desktopTheme) private var theme
    @AppStorage(SidebarLogoPreference.key) private var showSidebarLogo = SidebarLogoPreference.defaultEnabled

    var body: some View {
        HStack(spacing: 0) {
            if SidebarLogoRuntime.isBrandVisible(showSidebarLogo) {
                HStack(spacing: 0) {
                    Image(theme.sidebarIsDark ? "PulsatrixMark-dark" : "PulsatrixMark-light")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(width: 22, height: 17)
                        .padding(.leading, 16)
                        .accessibilityHidden(true)
                    DesktopLineText(text: "Sagax", size: 16, weight: .semibold, color: theme.sidebarInk, lineHeight: 20, tracking: -0.16)
                        .padding(.leading, 8)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("Sagax"))
                .accessibilityIdentifier("desktop-sidebar-brand")
                Spacer(minLength: 8)
            } else {
                Spacer(minLength: 16)
            }
            DesktopSearchButton()
            DesktopNewButton()
                .padding(.leading, 8)
                // pr-4 inside the 1 pt border
                .padding(.trailing, 17)
        }
        .frame(height: 48)
    }
}

/// The rail's head (`flex-col gap-2 px-2 pb-2 pt-1`): Search and New, the
/// same 36 pt circles, one above the other.
struct DesktopRailHead: View {
    var body: some View {
        VStack(spacing: 8) {
            DesktopSearchButton()
            DesktopNewButton()
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }
}

/// `SIDEBAR_HEAD_BUTTON` (`CIRCLE_BUTTON`): a 36 pt circle, 1 pt
/// hairline-weak border on the elevated fill, a 16 pt icon at stroke 1.75
/// in the secondary ink (the ink on hover).
struct DesktopHeadButton: View {
    @Environment(\.desktopTheme) private var theme
    let icon: DesktopIcon
    let label: LocalizedStringKey
    let id: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 16, strokeWidth: 1.75)
                .foregroundStyle(hovering ? theme.sidebarInk : theme.sidebarInkSecondary)
                .frame(width: 36, height: 36)
                .background(hovering ? theme.elevatedHover : theme.elevated, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }
}

/// Search: the command palette (⌘K).
struct DesktopSearchButton: View {
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        DesktopHeadButton(icon: .search, label: "Search bots and messages", id: "desktop-sidebar-search") {
            model.menu = nil
            model.modal = .search
        }
        .accessibilityHint(Text("Command K"))
    }
}

/// New: the desktop's compose-to picker (create a bot, a group chat, or
/// open one of the first nine bots), anchored under the button. ⌘N.
struct DesktopNewButton: View {
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        GeometryReader { geometry in
            DesktopHeadButton(icon: .plus, label: "New", id: "desktop-sidebar-new") {
                let frame = geometry.frame(in: .named(desktopShellSpace))
                model.menu = model.menu?.kind == .new
                    ? nil
                    : DesktopMenuRequest(kind: .new, anchor: CGPoint(x: frame.minX, y: frame.maxY + 4))
            }
        }
        .frame(width: 36, height: 36)
    }
}

// MARK: - List

/// The scrolling list: pinned tiles, then each section. Its edges fade like
/// the desktop's (`useScrollFade`: the top 28 once scrolled, the bottom 48
/// while more is below).
struct DesktopSidebarList: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @AppStorage(PrefKey.activityDetail) private var activityDetail = ActivityDetail.full.rawValue
    let layout: SidebarLayout
    @State private var contentFrame: CGRect = .zero
    @State private var viewport: CGFloat = 0

    var body: some View {
        let icons = model.density == .icons
        let previews = previewMap()
        let sections = DesktopSidebarSections.visible(layout, session: session)
        let fadeTop = contentFrame.minY < -1
        let fadeBottom = contentFrame.maxY > viewport + 1
        return GeometryReader { outer in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AnyView(DesktopPinnedTiles(chats: pinnedChats))
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                            AnyView(DesktopSidebarSection(
                                section: section,
                                first: index == 0,
                                previews: previews,
                                reorderable: sections.count > 1
                            ))
                        }
                        if !icons, !layout.hiddenRows.isEmpty {
                            AnyView(DesktopHiddenEntries(rows: layout.hiddenRows))
                        }
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 24)
                .padding(.leading, 8)
                .padding(.trailing, icons ? 9 : 13)
                .background(GeometryReader { inner in
                    let frame = inner.frame(in: .named("desktop-sidebar-list"))
                    Color.clear
                        .onAppear { contentFrame = frame }
                        .onValueChange(of: frame) { contentFrame = $0 }
                })
            }
            .scrollIndicators(.never)
            .onAppear { viewport = outer.size.height }
            .onValueChange(of: outer.size.height) { viewport = $0 }
            .mask(
                LinearGradient(stops: [
                    .init(color: fadeTop ? .clear : .black, location: 0),
                    .init(color: .black, location: fadeTop ? min(0.5, 28 / max(outer.size.height, 1)) : 0),
                    .init(color: .black, location: fadeBottom ? max(0.5, 1 - 48 / max(outer.size.height, 1)) : 1),
                    .init(color: fadeBottom ? .clear : .black, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            )
        }
        .coordinateSpace(name: "desktop-sidebar-list")
    }

    /// Pinned bots (`Sidebar.tsx` `pinnedBots`: every shown bot that is
    /// pinned, the Primary Bot included; a pinned group stays in its
    /// section), in the roster's order. The sections leave them out.
    private var pinnedChats: [Chat] {
        layout.pinnedBots.map(Chat.bot)
    }

    private func previewMap() -> [String: String] {
        let activity = ActivityDetail(rawValue: activityDetail) ?? .full
        var map: [String: String] = [:]
        for summary in session.state.chatSummaries(activity: activity) { map[summary.chat.id] = summary.preview }
        return map
    }
}

/// One sidebar section's rows, in the desktop's order (chiefs, groups, then
/// members).
struct DesktopSidebarSectionData: Identifiable {
    var id: String
    var title: String
    var rows: [Chat]
    /// The server or personal section name ("" for General).
    var name: String
}

enum DesktopSidebarSections {
    @MainActor
    static func visible(_ layout: SidebarLayout, session: Session) -> [DesktopSidebarSectionData] {
        layout.sectionIds.compactMap { id in
            let rows = chats(for: id, in: layout)
            guard !rows.isEmpty else { return nil }
            return DesktopSidebarSectionData(id: id, title: title(for: id), rows: rows, name: SidebarSectionID.userName(id) ?? "")
        }
    }

    static func chats(for id: String, in layout: SidebarLayout) -> [Chat] {
        if id == SidebarSectionID.general {
            let chief = layout.unsectionedChief.flatMap { $0.pinned == true ? nil : Chat.bot($0) }
            return (chief.map { [$0] } ?? [])
                + layout.unsectionedChannels.map(Chat.room)
                + layout.unsectionedBots.filter { $0.pinned != true }.map(Chat.bot)
        }
        if id == SidebarSectionID.botChats {
            return layout.botChats.map(Chat.room)
        }
        guard let name = SidebarSectionID.userName(id),
              let section = layout.sections.first(where: { $0.name == name })
        else { return [] }
        return section.chiefs.filter { $0.pinned != true }.map(Chat.bot)
            + section.channels.map(Chat.room)
            + section.bots.filter { $0.pinned != true }.map(Chat.bot)
    }

    static func title(for id: String) -> String {
        if id == SidebarSectionID.general { return String(localized: "Unassigned") }
        if id == SidebarSectionID.botChats { return String(localized: "Bot threads") }
        return SidebarSectionID.userName(id) ?? id
    }
}

// MARK: - Section

/// A section: its header (12/16 regular, sentence case, no chevron, the
/// count at the right while folded, like SidebarSectionHeader.tsx) and,
/// unless folded, its rows. The rail draws rows only. A row
/// dropped here files it in this section, a header dropped here moves that
/// section before or after this one (DD1).
struct DesktopSidebarSection: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let section: DesktopSidebarSectionData
    let first: Bool
    let previews: [String: String]
    let reorderable: Bool
    @State private var height: CGFloat = 0

    var body: some View {
        let icons = model.density == .icons
        let collapsed = !icons && prefs.isCollapsed(section.id)
        let targeted = model.dropTarget == section.id
        VStack(alignment: .leading, spacing: 4) {
            if !icons {
                AnyView(DesktopSectionHeader(section: section, collapsed: collapsed, reorderable: reorderable))
                    .padding(.bottom, 2)
            }
            if !collapsed {
                VStack(alignment: .leading, spacing: icons ? 4 : 2) {
                    ForEach(section.rows, id: \.id) { chat in
                        AnyView(DesktopSidebarRowGroup(chat: chat, preview: previews[chat.id] ?? "", sectionId: section.id))
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: section.title))
            }
        }
        .padding(.top, icons || first ? 0 : 10)
        .background(
            RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                .fill(targeted ? theme.sidebarHover.opacity(0.7) : .clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                .strokeBorder(targeted ? theme.accent.opacity(0.5) : .clear, lineWidth: 1)
        )
        .background(GeometryReader { proxy in
            Color.clear.onAppear { height = proxy.size.height }
                .onValueChange(of: proxy.size.height) { height = $0 }
        })
        .onDrop(of: [.plainText, .utf8PlainText, .text], isTargeted: Binding(
            get: { model.dropTarget == section.id },
            set: { inside in
                if inside { model.dropTarget = section.id } else if model.dropTarget == section.id { model.dropTarget = nil }
            }
        )) { providers, location in
            guard let provider = providers.first, provider.canLoadObject(ofClass: NSString.self) else { return false }
            let after = location.y > height / 2
            _ = provider.loadObject(ofClass: NSString.self) { object, _ in
                guard let item = object as? NSString else { return }
                let payload = item as String
                Task { @MainActor in
                    DesktopSidebarDrop.drop([payload], on: section, after: after, session: session, model: model, prefs: prefs)
                }
            }
            return true
        }
    }
}

/// The header button: folds the section; long press or right click opens
/// the section menu; drag reorders.
struct DesktopSectionHeader: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let section: DesktopSidebarSectionData
    let collapsed: Bool
    let reorderable: Bool
    @State private var hovering = false

    var body: some View {
        let menu = DesktopSidebarMenus(session: session, model: model, prefs: prefs).section(section.id)
        let header = Button {
            withAnimation(.snappy(duration: 0.2)) { prefs.toggleCollapsed(session, section.id) }
        } label: {
            HStack(spacing: 8) {
                DesktopLineText(text: section.title, size: 12, weight: .regular,
                             color: hovering ? theme.sidebarInk : theme.sidebarInkSecondary, lineHeight: 16)
                if collapsed { attentionMarks }
                Spacer(minLength: 0)
                // what a folded section holds, at the right
                if collapsed, !section.rows.isEmpty {
                    DesktopLineText(text: "\(section.rows.count)", size: 12,
                                 color: hovering ? theme.sidebarInk : theme.sidebarInkSecondary, lineHeight: 16)
                }
            }
            .foregroundStyle(hovering ? theme.sidebarInk : theme.sidebarInkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .frame(maxWidth: .infinity)
            .background(hovering ? theme.sidebarHover : .clear, in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(Text(collapsed ? "Collapsed" : "Expanded"))
        .accessibilityIdentifier("desktop-section-header.\(section.id)")
        let payload = reorderable ? "section:\(section.id)" : nil
        return Group {
            if menu.isEmpty {
                AnyView(header.modifier(DesktopDraggable(payload: payload)))
            } else {
                // the drag on the view that owns the menu (see the rows)
                AnyView(header.contextMenu { DesktopMenuItems(entries: menu) }.modifier(DesktopDraggable(payload: payload)))
            }
        }
    }

    /// A folded section's marks: waiting, unread and working counts.
    @ViewBuilder private var attentionMarks: some View {
        let waiting = section.rows.filter { $0.desktopStatus == .waitingOnYou }.count
        let unread = section.rows.filter { $0.unread && !$0.busy }.count
        let working = section.rows.contains { $0.desktopStatus == .working }
        if waiting > 0 { countBadge(waiting, tint: theme.warning) }
        if unread > 0 { countBadge(unread, tint: theme.accent) }
        if working {
            Circle().fill(theme.success).frame(width: 6, height: 6).frame(width: 16, height: 16)
        }
    }

    private func countBadge(_ count: Int, tint: Color) -> some View {
        Text(verbatim: "\(count)")
            .font(theme.font(9, .semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(tint.opacity(0.15), in: Capsule())
    }
}

/// A drag (the payload as plain text) when there is something to drag.
struct DesktopDraggable: ViewModifier {
    let payload: String?

    func body(content: Content) -> some View {
        if let payload {
            content.onDrag { NSItemProvider(object: payload as NSString) }
        } else {
            content
        }
    }
}

/// DD1: what a drop on a section does, through the same calls as the menus
/// (WP6): a person's own sections on an organization server, the server's
/// teams (`POST /api/sidebar-sections`, or `PUT` to take one out) for a
/// pairing that may file bots, `PATCH /api/groups/:id` for a group; a
/// dropped header reorders the sections (the synced order).
@MainActor
enum DesktopSidebarDrop {
    @discardableResult
    static func drop(
        _ items: [String], on section: DesktopSidebarSectionData, after: Bool,
        session: Session, model: DesktopShellModel, prefs: SidebarPrefsModel
    ) -> Bool {
        model.dropTarget = nil
        guard let item = items.first else { return false }
        let layout = prefs.layout(session)
        if let from = item.stripping("section:") {
            let next = SidebarSectionID.place(layout.sectionIds, from, at: section.id, after: after)
            guard next != layout.sectionIds else { return false }
            prefs.setSectionOrder(session, next)
            return true
        }
        guard section.id != SidebarSectionID.botChats else { return false }
        if let id = item.stripping("bot:"), let bot = session.state.bot(id) {
            if layout.personal {
                model.sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(bot: id), to: section.name)
                return true
            }
            let current = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard current != section.name else { return false }
            if section.name.isEmpty {
                guard session.surfaceGate.allows(.sectionManagement) else { return false }
                Task { _ = await session.setServerSectionBots(current, add: [], remove: [id]) }
            } else {
                guard session.canAdminister || session.surfaceGate.scope == .sidecar else { return false }
                Task { await session.assignSection(name: section.name, botIds: [id]) }
            }
            return true
        }
        if let id = item.stripping("room:"), let room = session.state.rooms.first(where: { $0.id == id }) {
            if layout.personal {
                model.sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(group: id), to: section.name)
                return true
            }
            guard session.roomAccess(room).canMoveSection else { return false }
            let current = room.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard current != section.name else { return false }
            model.roomActions.move(room, to: section.name, session)
            return true
        }
        return false
    }
}

private extension String {
    func stripping(_ prefix: String) -> String? {
        hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
    }
}

// MARK: - Hidden entries

/// `HiddenEntriesRow`: "Hidden (N)", opening the list with Show.
struct DesktopHiddenEntries: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let rows: [SidebarHiddenRow]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { withAnimation(.snappy(duration: 0.2)) { open.toggle() } } label: {
                HStack(spacing: 8) {
                    DesktopIconView(icon: .eyeOff, size: 14)
                    Text("Hidden (\(rows.count))")
                        .font(theme.font(12))
                    Spacer(minLength: 0)
                    DesktopIconView(icon: .chevronRight, size: 14)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .foregroundStyle(theme.sidebarInkSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-sidebar-hidden")
            if open {
                ForEach(rows) { row in
                    HStack(spacing: 8) {
                        Text(verbatim: row.name)
                            .font(theme.font(13))
                            .foregroundStyle(theme.sidebarInkSecondary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Button {
                            prefs.show(session, [row.key])
                        } label: {
                            DesktopIconView(icon: .eye, size: 14)
                                .foregroundStyle(theme.sidebarInkSecondary)
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Show \(row.name) in the sidebar"))
                        .accessibilityIdentifier("desktop-hidden-show.\(row.key)")
                    }
                    .padding(.leading, 34)
                    .padding(.trailing, 8)
                    .frame(height: 28)
                }
            }
        }
        .padding(.top, 10)
    }
}

// MARK: - Footer

/// The server's experimental switches the sidebar reads (Templates), from
/// `GET /api/config`: read when the shell appears and again when a modal
/// closes (Settings > Experimental features may have changed them).
@MainActor
final class DesktopSidebarFlags: ObservableObject {
    static let shared = DesktopSidebarFlags()
    @Published private(set) var features: ServerFeatures?
    /// Who is looking (`PrimaryBotRules.viewerId`), for the bot menu's
    /// Primary Bot item.
    @Published private(set) var viewerId = "local-owner"
    private var connectionID: String?

    func reload(_ session: Session) async {
        let id = session.connection?.id
        if id != connectionID {
            connectionID = id
            features = nil
        }
        guard id != nil, let config = await session.configStatus() else { return }
        guard session.connection?.id == id else { return }
        features = config.features
        viewerId = PrimaryBotRules.viewerId(config: config)
    }

    /// After Settings > Experimental PATCH, so Browse Bots hides at once like
    /// the desktop store's `configStatus`.
    func apply(_ features: ServerFeatures?) {
        self.features = features
    }

    func apply(_ config: DesktopSettingsConfig?) {
        guard let features = config?.features else { return }
        self.features = ServerFeatures(browser: features.browser, templates: features.templates)
    }
}

/// The places (`SidebarPlaces`: 36 pt rows 2 apart, a 20 pt icon at x 16,
/// 13/20 at x 46), the hairline (`mx-2 my-2`), and the account row (the
/// initials 28 at x 16, the name 13/20 medium at x 54, and under it the
/// gamertag: a gold trophy and the points, opening the achievements; the
/// row is 48 tall with it, 40 without) opening the account menu. The rail
/// keeps the same rows as icons at the same heights.
struct DesktopSidebarFooter: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var achievements = AchievementStore.shared
    @ObservedObject private var flags = DesktopSidebarFlags.shared

    var body: some View {
        let icons = model.density == .icons
        let places = DesktopSidebarPlaces.visible(
            connected: session.connection != nil, gate: session.surfaceGate, features: flags.features)
        return VStack(spacing: 0) {
            if icons, DesktopSettingsSection.available(for: session.surfaceGate).contains(.companion) {
                AnyView(DesktopRailPhoneButton())
            }
            if !places.isEmpty {
                VStack(spacing: 2) {
                    ForEach(places, id: \.self) { place in
                        AnyView(placeRow(place, icons: icons))
                    }
                }
                Rectangle().fill(theme.sidebarHairline).frame(height: 1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 8)
            }
            if icons { AnyView(railAccount) } else { AnyView(account) }
        }
        .padding(.leading, 8)
        .padding(.trailing, icons ? 9 : 13)
        // Chrome centres the rail's 63 pt column on the next device pixel
        .offset(x: icons ? 0.5 : 0)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .task(id: session.connection?.id) {
            await flags.reload(session)
            await loadAchievements()
        }
        .onValueChange(of: model.modal == nil) { closed in
            if closed { Task { await flags.reload(session) } }
        }
    }

    /// The parity captures and the demo do not run the achievements host's
    /// reporting; the gamertag still reads the snapshot (a GET).
    private func loadAchievements() async {
        guard session.connection != nil, session.surfaceGate.allows(.achievements), achievements.status == .idle else { return }
        if achievements.snapshot == nil, let client = session.settingsClient, !session.isDemo {
            achievements.attach(client: client, connectionID: session.connection?.id)
        }
        await achievements.reload()
    }

    private func placeRow(_ place: DesktopSidebarPlace, icons: Bool) -> some View {
        switch place {
        case .teamMap:
            DesktopPlaceRow(title: String(localized: "Team map"), icon: .network, id: place.rawValue, iconOnly: icons, selected: model.page == .teamMap) { model.show(.teamMap) }
        case .automations:
            DesktopPlaceRow(title: String(localized: "Automations"), icon: .calendarDays, id: place.rawValue, iconOnly: icons, selected: model.page == .automations) { model.show(.automations) }
        case .templates:
            DesktopPlaceRow(title: String(localized: "Browse Bots"), icon: .library, id: place.rawValue, iconOnly: icons) { model.modal = .templates }
        }
    }

    private var gamertag: String? {
        DesktopSidebarPlaces.gamertag(ready: achievements.status == .ready, snapshot: achievements.snapshot)
    }

    private var account: some View {
        let points = gamertag
        let height: CGFloat = points == nil ? 40 : 48
        return GeometryReader { geometry in
            ZStack(alignment: .bottomLeading) {
                Button {
                    let frame = geometry.frame(in: .named(desktopShellSpace))
                    model.menu = model.menu?.kind == .profile
                        ? nil
                        : DesktopMenuRequest(kind: .profile, anchor: CGPoint(x: frame.minX, y: frame.minY - 4), opensUp: true)
                } label: {
                    HStack(spacing: 10) {
                        initialsCircle
                        VStack(alignment: .leading, spacing: 0) {
                            DesktopLineText(text: displayName, size: 13, weight: .medium, color: theme.sidebarInk, lineHeight: 20)
                            if points != nil { Color.clear.frame(height: 16) }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 8)
                    .frame(height: height)
                    .background(
                        model.menu?.kind == .profile ? theme.sidebarHover : .clear,
                        in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(DesktopSidebarRowButtonStyle())
                .accessibilityLabel(Text(verbatim: displayName))
                .accessibilityHint(Text("Opens the account menu"))
                .accessibilityIdentifier("desktop-sidebar-account")
                if let points, let snapshot = achievements.snapshot {
                    DesktopGamertag(points: points, level: snapshot.level.level) { model.modal = .achievements }
                        .padding(.leading, 42)
                        .padding(.bottom, 6)
                }
            }
        }
        .frame(height: height)
    }

    private var railAccount: some View {
        Button { model.modal = .settings } label: {
            initialsCircle
                .frame(width: 44, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(DesktopSidebarRowButtonStyle())
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text("App settings"))
        .accessibilityIdentifier("desktop-sidebar-account")
    }

    private var initialsCircle: some View {
        DesktopLineText(text: initials, size: 10.64, weight: .medium, color: theme.sidebarInkSecondary, lineHeight: 15.96, centered: true)
            .frame(width: 28, height: 28)
            .background(theme.raised, in: Circle())
    }

    private var displayName: String {
        session.account?.name ?? session.account?.email ?? session.connection?.name ?? String(localized: "You")
    }

    private var initials: String {
        let words = displayName.split(whereSeparator: { $0 == " " || $0 == "@" || $0 == "." }).prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }
}

/// The rail's phone button (`SidebarPhoneButton`): a 40 pt square, an 18 pt
/// tablet-and-phone at stroke 1.8, opening Settings > Pair devices.
struct DesktopRailPhoneButton: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var model: DesktopShellModel
    @State private var hovering = false

    var body: some View {
        Button {
            model.settingsSection = .companion
            model.modal = .settings
        } label: {
            DesktopIconView(icon: .tabletSmartphone, size: 18, strokeWidth: 1.8)
                .foregroundStyle(hovering ? theme.sidebarInk : theme.sidebarInkSecondary)
                .frame(width: 40, height: 40)
                .background(hovering ? theme.sidebarHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text("Pair devices"))
        .accessibilityIdentifier("desktop-sidebar-phone")
    }
}

/// `Gamertag`: an 11 pt gold trophy (stroke 2.4) and the points 11/16 in the
/// secondary ink, 4 apart, padded 4 with a 6 pt hover pill; opens the
/// achievements.
struct DesktopGamertag: View {
    @Environment(\.desktopTheme) private var theme
    let points: String
    let level: Int
    let open: () -> Void
    @State private var hovering = false

    static let gold = Color(.sRGB, red: 0xe0 / 255, green: 0xa8 / 255, blue: 0x2e / 255, opacity: 1)

    var body: some View {
        Button(action: open) {
            HStack(spacing: 4) {
                DesktopIconView(icon: .trophy, size: 11, strokeWidth: 2.4)
                    .foregroundStyle(Self.gold)
                DesktopLineText(text: points, size: 11, color: hovering ? theme.sidebarInk : theme.sidebarInkSecondary, lineHeight: 16)
            }
            .padding(.horizontal, 4)
            .frame(height: 16)
            .background(hovering ? theme.sidebarHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text("\(points) points, level \(level). Open achievements"))
        .accessibilityIdentifier("desktop-sidebar-points")
    }
}

/// One place row (`SidebarPlaces`).
struct DesktopPlaceRow: View {
    @Environment(\.desktopTheme) private var theme
    let title: String
    let icon: DesktopIcon
    let id: String
    let iconOnly: Bool
    /// The place's page is open: `bg-accent/16`, the icon in the accent, the title medium ink.
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                DesktopIconView(icon: icon, size: 20, strokeWidth: 1.75)
                    .foregroundStyle(selected ? theme.accentText : theme.sidebarInkSecondary)
                if !iconOnly {
                    DesktopLineText(text: title, size: 13, weight: selected ? .medium : .regular,
                                    color: selected ? theme.sidebarInk : theme.sidebarInkSecondary, lineHeight: 20)
                    Spacer(minLength: 0)
                }
            }
            .foregroundStyle(theme.sidebarInkSecondary)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: iconOnly ? .center : .leading)
            .frame(height: 36)
            .background(selected ? theme.accent.opacity(0.16) : .clear, in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopSidebarRowButtonStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier("desktop-sidebar-\(id)")
    }
}

/// `hover:bg-sidebar-hover` on a sidebar button.
struct DesktopSidebarRowButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme.sidebarHover : .clear,
                in: RoundedRectangle(cornerRadius: theme.radiusLg, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

struct DesktopCompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

// MARK: - Edge

/// The sidebar's edge (`app-resize-handle`, 12 pt across it, invisible at
/// rest): drag to resize, narrower than 180 to collapse to the rail and back
/// out to expand; a double tap toggles; VoiceOver adjusts it.
struct DesktopSidebarEdgeHandle: View {
    @ObservedObject var model: DesktopShellModel
    @Environment(\.desktopTheme) private var theme
    @State private var start: CGFloat?
    @State private var hovering = false

    var body: some View {
        Rectangle()
            .fill(Color.clear)
            .frame(width: 12)
            .overlay {
                Rectangle()
                    .fill(theme.accent.opacity(start != nil || hovering ? 0.6 : 0))
                    .frame(width: 2)
            }
            .contentShape(Rectangle())
            .offset(x: 6)
            .onHover { hovering = $0 }
            .gesture(
                DragGesture(minimumDistance: 2, coordinateSpace: .named(desktopShellSpace))
                    .onChanged { value in
                        let from = start ?? model.sidebarWidth
                        if start == nil { start = from }
                        model.dragSidebarEdge(toRaw: from + value.translation.width, save: false)
                    }
                    .onEnded { value in
                        let from = start ?? model.sidebarWidth
                        start = nil
                        model.dragSidebarEdge(toRaw: from + value.translation.width, save: true)
                    }
            )
            .simultaneousGesture(TapGesture(count: 2).onEnded { model.toggleCollapsed() })
            .accessibilityElement()
            .accessibilityLabel(Text("Resize sidebar"))
            .accessibilityValue(Text(verbatim: "\(Int(model.sidebarWidth))"))
            .accessibilityIdentifier("desktop-sidebar-edge")
            .accessibilityAction(named: Text("Collapse or expand the sidebar")) { model.toggleCollapsed() }
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment:
                    if model.density == .icons { model.toggleCollapsed() } else { model.dragSidebarEdge(toRaw: model.sidebarWidth + 24, save: true) }
                case .decrement:
                    guard model.density != .icons else { return }
                    let next = model.sidebarWidth - 24
                    model.dragSidebarEdge(toRaw: next < DesktopSidebarEdge.minWidth ? 0 : next, save: true)
                @unknown default: break
                }
            }
    }
}
