// iPad I-sync: the sidebar's places as the desktop draws them, pages in the
// main column (the sidebar stays, its place row selected), not sheets:
// Team map (`TeamMapPage.tsx`, `TeamCanvas.tsx`) and Automations
// (`RoutineCalendarPage.tsx` RoutinesPage).
//
// Sizes from desktop-1366x1024-56-team-map.json and -53-routines-calendar.json:
// the header (`content-topbar`, px 24 py 16, a 0.5 pt hairline under it,
// 79 tall): the 18 pt icon, the title 17/24 semibold, the count 11, the
// subtitle 12/18; the canvas below on `bg-app` with a 24 pt dot grid at
// the view's scale; each team a `bg-panel/90` tile (radius 16) of 236x126
// cards (radius 12, `bg-card`), fitted to the page (TeamCanvasLayout); the
// hint at the bottom left and the zoom controls at the bottom right.
//
// Each sub-tree is type-erased (`AnyView`).
import SwiftUI
import UIKit
import CompanionCore

/// A page the main column shows in place of the conversation.
enum DesktopPage: String, Identifiable {
    case teamMap, automations
    /// Lot 4: Memory, a full page of the main column (2026-11-02).
    case memory
    var id: String { rawValue }
}

/// The page's header (`content-topbar`).
struct DesktopPageHeader<Trailing: View>: View {
    @Environment(\.desktopTheme) private var theme
    let icon: DesktopIcon
    let title: LocalizedStringKey
    var count: String?
    var subtitle: LocalizedStringKey?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    DesktopIconView(icon: icon, size: 18, strokeWidth: 1.75)
                        .foregroundStyle(theme.inkSecondary)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
                    Text(title)
                        .font(theme.font(17, .semibold))
                        .tracking(-0.14)
                        .foregroundStyle(theme.ink)
                    if let count {
                        Text(verbatim: count)
                            .font(theme.font(11))
                            .foregroundStyle(theme.inkSecondary)
                            .padding(.leading, 4)
                    }
                }
                .frame(height: 24)
                if let subtitle {
                    Text(subtitle)
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(height: 18)
                }
            }
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
    }
}

// MARK: - Team map

struct DesktopTeamMapPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @StateObject private var model = TeamMapModel()
    @State private var boatComputer = false
    /// The Computers shelf (CanvasComputers.tsx) at the right of the canvas.
    @State private var computersOpen = false
    @State private var computerDrop: (id: String, section: String)?
    @State private var createComputer = 0
    @State private var creating = false
    @State private var teamName = ""

    /// `canManageTeamMap` (an owner or an admin, never the remote client).
    private var manageTeams: Bool { session.surfaceGate.allows(.teamMapMove) }

    private var visibleBots: [Bot] { session.state.bots.filter { $0.hidden != true } }

    var body: some View {
        let count = visibleBots.count
        VStack(spacing: 0) {
            AnyView(DesktopPageHeader(
                icon: .network,
                title: "Team map",
                count: count == 1 ? String(localized: "1 bot") : String(localized: "\(count) bots"),
                subtitle: "Your bots, their teams, and how they work together."
            ) { AnyView(headerControls) })
            HStack(spacing: 0) {
                AnyView(DesktopTeamCanvas(model: model, onComputerDrop: { id, section in
                    guard manageTeams else { return }
                    computersOpen = true
                    computerDrop = (id, section)
                }))
                if manageTeams && computersOpen {
                    DesktopTeamComputers(
                        sections: TeamMap.pageSections(state: session.state).map { ($0.key, $0.key.isEmpty ? String(localized: "General") : $0.name) },
                        drop: $computerDrop, createRequest: createComputer, close: { computersOpen = false })
                    .transition(.move(edge: .trailing))
                }
            }
        }
        .background(theme.app)
        .task(id: session.connection?.id) { await model.poll(session) }
        .task(id: session.connection?.id) { boatComputer = (await session.configStatus())?.features?.boatComputer == true }
        .alert(String(localized: "Create team"), isPresented: $creating) {
            TextField(String(localized: "Team name"), text: $teamName)
            Button(String(localized: "Cancel"), role: .cancel) { teamName = "" }
            Button(String(localized: "Create team")) {
                let name = teamName.trimmingCharacters(in: .whitespacesAndNewlines)
                teamName = ""
                guard !name.isEmpty else { return }
                Task { await session.assignSection(name: name, botIds: []) }
            }
        }
        .alert(
            model.pendingMove.map { String(localized: "Move \($0.bot.name) to \($0.destinationName)?") } ?? "",
            isPresented: Binding(get: { model.pendingMove != nil }, set: { if !$0, model.pendingMove != nil { model.cancelMove() } }),
            presenting: model.pendingMove
        ) { _ in
            Button(String(localized: "Cancel"), role: .cancel) { model.cancelMove() }
            Button(String(localized: "Move bot")) { model.confirmMove(session) }
        } message: { _ in
            Text(String(localized: "This changes the bot's home team and shared instructions, not just its position. Its conversations and model stay with it. To arrange visually, drag within the same team."))
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-team-map")
    }
}

extension DesktopTeamMapPage {
    /// The page's top right: the Computer button (a 36 pt square) and Add
    /// (`TeamMapPage.tsx`: Create team, Boat computer, Local VM...).
    @ViewBuilder
    fileprivate var headerControls: some View {
        if manageTeams {
            HStack(spacing: 8) {
                Button { withAnimation(.easeOut(duration: 0.18)) { computersOpen.toggle() } } label: {
                    DesktopIconView(icon: .monitor, size: 16, strokeWidth: 1.75)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 36, height: 36)
                        .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Computers"))
                .accessibilityValue(computersOpen ? Text("Expanded") : Text("Collapsed"))
                .accessibilityIdentifier("team-map-computers")
                Menu {
                    Button { creating = true } label: { Label(String(localized: "Create team"), systemImage: "person.2") }
                    if boatComputer {
                        Button { computersOpen = true; createComputer += 1 } label: { Label(String(localized: "Boat computer"), systemImage: "shippingbox") }
                    }
                    Button { shell.settingsSection = .computer; shell.modal = .settings } label: { Label(String(localized: "Local VM…"), systemImage: "display") }
                } label: {
                    HStack(spacing: 6) {
                        DesktopIconView(icon: .plus, size: 15, strokeWidth: 1.75)
                        Text("Add").font(theme.font(12, .medium))
                    }
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("Add to team map"))
                .accessibilityIdentifier("team-map-add")
            }
        }
    }
}

/// The canvas: drag to pan, pinch to zoom, − / % / + at the bottom right
/// (the % fits the teams to the view again).
private struct DesktopTeamCanvas: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @ObservedObject var model: TeamMapModel
    /// A computer card of the Computers shelf dropped on a team (its id, the team).
    var onComputerDrop: (String, String) -> Void = { _, _ in }

    @State private var view: TeamCanvasLayout.View?
    @State private var dragStart: TeamCanvasLayout.View?
    @State private var pinchStart: TeamCanvasLayout.View?
    @State private var modelLabels: [String: String] = [:]
    /// The engine behind each bot's model: its provider mark on the card.
    @State private var modelInstances: [String: Instance] = [:]
    @State private var renaming: String?
    /// The team ⋯ menu's editor open now (Move bots, Shared instructions, Team memory).
    @State private var teamEditor: TeamEditor?

    struct TeamEditor: Identifiable {
        enum Kind { case bots, instructions, memory }
        let kind: Kind
        let section: String
        let label: String
        var id: String { "\(kind)|\(section)" }
    }
    @State private var renameText = ""
    @State private var deleting: String?

    private var sections: [TeamMapSection] { TeamMap.pageSections(state: session.state) }

    var body: some View {
        GeometryReader { geometry in
            let sections = self.sections
            let tiles = TeamCanvasLayout.layout(sections)
            let fitted = TeamCanvasLayout.fit(tiles, width: geometry.size.width, height: geometry.size.height)
            let current = view ?? fitted
            ZStack(alignment: .topLeading) {
                AnyView(dotGrid(current))
                ZStack(alignment: .topLeading) {
                    ForEach(Array(zip(sections, tiles)), id: \.0.key) { section, tile in
                        AnyView(teamTile(section, tile: tile, sections: sections))
                            .offset(x: tile.x, y: tile.y)
                    }
                }
                .scaleEffect(current.scale, anchor: .topLeading)
                .offset(x: current.x, y: current.y)
                AnyView(controls(current, fitted: fitted, size: geometry.size))
            }
            .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 4)
                    .onChanged { value in
                        let start = dragStart ?? current
                        if dragStart == nil { dragStart = start }
                        view = TeamCanvasLayout.View(x: start.x + value.translation.width, y: start.y + value.translation.height, scale: start.scale)
                    }
                    .onEnded { _ in dragStart = nil }
            )
            .simultaneousGesture(
                // iOS 16: MagnificationGesture (no location): zoom about the centre
                MagnificationGesture()
                    .onChanged { value in
                        let start = pinchStart ?? current
                        if pinchStart == nil { pinchStart = start }
                        view = TeamCanvasLayout.zoom(start, to: start.scale * value, at: (geometry.size.width / 2, geometry.size.height / 2))
                    }
                    .onEnded { _ in pinchStart = nil }
            )
        }
        .task(id: session.connection?.id) { await loadModelLabels() }
        .sheet(item: $teamEditor) { editor in
            Group {
                switch editor.kind {
                case .bots: DesktopTeamBotsSheet(section: editor.section, label: editor.label) { teamEditor = nil }
                case .instructions: DesktopSectionContextSheet(section: editor.section, label: editor.label) { teamEditor = nil }
                case .memory: DesktopTeamMemorySheet(section: editor.section, label: editor.label) { teamEditor = nil }
                }
            }
            .environmentObject(session)
            .environment(\.desktopTheme, theme)
            .presentationDetents([.large])
        }
        .alert(String(localized: "Rename team"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(String(localized: "Team name"), text: $renameText)
            Button(String(localized: "Cancel"), role: .cancel) { renaming = nil }
            Button(String(localized: "Save name")) {
                let old = renaming, name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                renaming = nil
                guard let old, !name.isEmpty, name != old else { return }
                Task { _ = await session.renameServerSection(old, to: name) }
            }
        }
        .alert(
            String(localized: "Delete \(deleting ?? "") team?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
        ) {
            Button(String(localized: "Cancel"), role: .cancel) { deleting = nil }
            Button(String(localized: "Delete team"), role: .destructive) {
                let name = deleting
                deleting = nil
                if let name { Task { _ = await session.deleteServerSection(name) } }
            }
        } message: {
            Text("Bots and group chats move to Unassigned with their conversations intact. The team and its shared instructions are deleted. This cannot be undone.")
        }
    }

    /// `radial-gradient(circle, ink-secondary 18 %, 1px)` every 24 pt at the view's scale.
    private func dotGrid(_ view: TeamCanvasLayout.View) -> some View {
        Canvas { context, size in
            let step = max(6, 24 * view.scale)
            let color = theme.inkSecondary.opacity(0.18)
            var x = view.x.truncatingRemainder(dividingBy: step)
            if x < 0 { x += step }
            while x < size.width {
                var y = view.y.truncatingRemainder(dividingBy: step)
                if y < 0 { y += step }
                while y < size.height {
                    context.fill(Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)), with: .color(color))
                    y += step
                }
                x += step
            }
        }
        .allowsHitTesting(false)
    }

    private func teamTile(_ section: TeamMapSection, tile: TeamCanvasLayout.Tile, sections: [TeamMapSection]) -> some View {
        let hierarchy = TeamCanvasLayout.hierarchy(section)
        let chiefs = model.lane(section.chiefs, in: section)
        let members = model.lane(section.members, in: section)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(section.key.isEmpty ? String(localized: "Unassigned") : section.name)
                    .font(theme.font(13, .semibold))
                    .tracking(-0.3)
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: "\(section.count)")
                    .font(theme.font(11))
                    .monospacedDigit()
                    .foregroundStyle(theme.inkSecondary)
                if session.surfaceGate.allows(.teamMapMove) {
                    Menu {
                        // TeamCanvas.tsx: Move bots to, Shared instructions, Team memory, then Rename and Delete
                        let label = section.key.isEmpty ? String(localized: "Unassigned") : section.name
                        Button { teamEditor = TeamEditor(kind: .bots, section: section.key, label: label) } label: {
                            Label(String(format: String(localized: "Move bots to %@"), label), systemImage: "person.2")
                        }
                        Button { teamEditor = TeamEditor(kind: .instructions, section: section.key, label: label) } label: {
                            Label(String(localized: "Shared instructions"), systemImage: "book")
                        }
                        Button { teamEditor = TeamEditor(kind: .memory, section: section.key, label: label) } label: {
                            Label(String(localized: "Team memory"), systemImage: "brain")
                        }
                        if !section.key.isEmpty {
                            Button { renameText = section.name; renaming = section.key } label: { Label(String(localized: "Rename team"), systemImage: "pencil") }
                            Button(role: .destructive) { deleting = section.key } label: { Label(String(localized: "Delete team"), systemImage: "trash") }
                        }
                    } label: {
                        DesktopIconView(icon: .ellipsis, size: 17, strokeWidth: 2)
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .opacity(section.key.isEmpty ? 0.35 : 1)
                    .disabled(section.key.isEmpty)
                    .accessibilityLabel(Text("Manage \(section.key.isEmpty ? String(localized: "Unassigned") : section.name) team"))
                }
            }
            .padding(.horizontal, 20)
            .frame(height: 64)
            HStack(alignment: .top, spacing: 0) {
                if !chiefs.isEmpty {
                    VStack(spacing: 16) { ForEach(chiefs) { AnyView(card($0, sections: sections)) } }
                }
                if hierarchy {
                    DesktopIconView(icon: .chevronRight, size: 22, strokeWidth: 1)
                        .foregroundStyle(theme.inkSecondary.opacity(0.35))
                        .frame(width: 40, height: 126)
                }
                if !members.isEmpty {
                    VStack(spacing: 16) { ForEach(members) { AnyView(card($0, sections: sections)) } }
                }
                if section.count == 0 {
                    Text("Drag bots here, or add existing bots from the team menu.")
                        .font(theme.font(12))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 24)
                        .frame(width: 236, height: 126)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(theme.hairline.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(width: tile.width, height: tile.height, alignment: .topLeading)
        .background(theme.panel.opacity(0.9), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.compactMap(TeamComputerDrag.id).first else { return false }
            onComputerDrop(id, section.key)
            return true
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(section.key.isEmpty ? String(localized: "Unassigned") : section.name) team"))
    }

    /// `BotCard`: the 82 pt identity (mascot 38, name 14 semibold, title 11),
    /// then the 43 pt foot (chat, status, the model).
    private func card(_ bot: Bot, sections: [TeamMapSection]) -> some View {
        let status = TeamMap.status(bot)
        let selected = shell.selected?.id == bot.id && shell.panelOpen
        return VStack(spacing: 0) {
            Button { open(bot, panel: true) } label: {
                HStack(spacing: 12) {
                    BotMascotView(bot: bot, size: 38).frame(width: 38, height: 38)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: bot.name)
                            .font(theme.font(14, .semibold))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                        Text(verbatim: bot.title.isEmpty ? (bot.chiefOfStaff == true ? String(localized: "Primary Bot") : String(localized: "Bot")) : bot.title)
                            .font(theme.font(11))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .frame(height: 82)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Edit \(bot.name)"))
            HStack(spacing: 4) {
                Button { open(bot, panel: false) } label: {
                    DesktopIconView(icon: .messageCircle, size: 13, strokeWidth: 2)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Open chat with \(bot.name)"))
                if status.tone != .idle {
                    HStack(spacing: 6) {
                        Circle().fill(tone(status.tone)).frame(width: 6, height: 6)
                        Text(statusLabel(status)).font(theme.font(10)).foregroundStyle(theme.inkSecondary)
                    }
                }
                Spacer(minLength: 4)
                if let label = modelLabels[bot.id] {
                    // TeamCanvas.tsx: the provider's mark (13) in front of the model
                    HStack(spacing: 4) {
                        if let instance = modelInstances[bot.id] {
                            ProviderMarkView(instance: instance, size: 13)
                        } else {
                            ProviderMarkView(driverKind: "", size: 13)
                        }
                        Text(verbatim: label)
                            .font(theme.font(10))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: 130, alignment: .trailing)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("team-map-model.\(bot.id)")
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 43)
            .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
        }
        .frame(width: 236, height: 126)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(selected ? theme.accent.opacity(0.6) : theme.hairline.opacity(0.5), lineWidth: 1))
        .opacity(model.moving == bot.id ? 0.35 : 1)
        .contextMenu { AnyView(menu(bot, sections: sections)) }
    }

    @ViewBuilder
    private func menu(_ bot: Bot, sections: [TeamMapSection]) -> some View {
        Button { open(bot, panel: false) } label: { Label(String(localized: "Open chat"), systemImage: "bubble.left") }
        if model.canArrange(bot, by: -1, in: sections) {
            Button { model.arrange(bot, by: -1, in: sections) } label: { Label(String(localized: "Move up"), systemImage: "arrow.up") }
        }
        if model.canArrange(bot, by: 1, in: sections) {
            Button { model.arrange(bot, by: 1, in: sections) } label: { Label(String(localized: "Move down"), systemImage: "arrow.down") }
        }
        if session.surfaceGate.allows(.teamMapMove) {
            let here = TeamMap.teamKey(of: bot)
            let others = sections.filter { $0.key != here }
            if !others.isEmpty {
                Menu {
                    ForEach(others) { section in
                        Button(section.key.isEmpty ? String(localized: "Unassigned") : section.name) { model.requestMove(bot, to: section.key) }
                    }
                } label: { Label(String(localized: "Move to team"), systemImage: "person.2") }
            }
        }
    }

    private func controls(_ current: TeamCanvasLayout.View, fitted: TeamCanvasLayout.View, size: CGSize) -> some View {
        VStack {
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 12) {
                Text("Drag within a team to arrange · Drop in another team to move · Wheel zooms · Trackpad or Shift+wheel pans")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(theme.app.opacity(0.9), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .allowsHitTesting(false)
                Spacer(minLength: 0)
                HStack(spacing: 2) {
                    zoomButton(.minus, label: "Zoom out") { zoom(current, by: 1 / 1.2, size: size) }
                    Button { view = fitted } label: {
                        Text(verbatim: "\(Int((current.scale * 100).rounded()))%")
                            .font(theme.font(11))
                            .monospacedDigit()
                            .foregroundStyle(theme.inkSecondary)
                            .frame(minWidth: 48, minHeight: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Fit teams to view"))
                    .accessibilityValue(Text(verbatim: "\(Int((current.scale * 100).rounded()))%"))
                    zoomButton(.plus, label: "Zoom in") { zoom(current, by: 1.2, size: size) }
                }
                .padding(4)
                .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
            }
            .padding(20)
        }
        // the size of the view, not of the (larger) world the ZStack holds
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func zoomButton(_ icon: DesktopIcon, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 15, strokeWidth: 2)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    private func zoom(_ current: TeamCanvasLayout.View, by factor: Double, size: CGSize) {
        withAnimation(.easeOut(duration: 0.15)) {
            view = TeamCanvasLayout.zoom(current, to: current.scale * factor, at: (size.width / 2, size.height / 2))
        }
    }

    /// A card opens the bot's panel over its chat (the desktop opens its
    /// settings); the chat button opens the chat.
    private func open(_ bot: Bot, panel: Bool) {
        shell.open(session.returning(to: .bot(bot)))
        if panel { shell.showPanel(.details) }
    }

    private func loadModelLabels() async {
        // an organization member reads the server's engines too (/api/instances, a member's copy)
        guard session.canAdminister || session.surfaceGate.isOrgMemberSession else { return }
        let instances = await DesktopModelCatalog.shared.instances(session)
        var labels: [String: String] = [:]
        var engines: [String: Instance] = [:]
        for bot in session.state.bots {
            let selection = bot.modelSelection
            let instance = instances.first { $0.instanceId == selection.instanceId }
            let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
            let label = instance?.models.options.first { $0.id == id }?.label ?? id
            if !label.isEmpty { labels[bot.id] = label }
            if let instance { engines[bot.id] = instance }
        }
        modelLabels = labels
        modelInstances = engines
    }

    private func statusLabel(_ status: TeamMapStatus) -> String {
        switch status.label {
        case "Waiting for you": String(localized: "Waiting for you")
        case "No signal": String(localized: "No signal")
        case "Working": String(localized: "Working")
        default: String(localized: "Ready")
        }
    }

    private func tone(_ tone: TeamMapStatus.Tone) -> Color {
        switch tone {
        case .success: theme.success
        case .warning: theme.warning
        case .danger: theme.danger
        case .idle: theme.inkSecondary.opacity(0.35)
        }
    }
}

// MARK: - Automations

/// The Automations page: the routines, their
/// calendar, logs and editor (TasksRoutinesView in its Automations form).
/// The desktop's week grid and its right column (the mini month and My
/// bots) are not drawn yet: the calendar is the phone's day agenda.
struct DesktopAutomationsPage: View {
    @Environment(\.desktopTheme) private var theme

    var body: some View {
        // its navigation bar is the page's header: the title and the
        // routines' own actions (New, the view pickers)
        NavigationStack {
            TasksRoutinesView(page: .automations)
                .navigationBarTitleDisplayMode(.inline)
                // the desktop's week, not the phone's day
                .environment(\.automationsGridDays, 7)
                // lot 4: the desktop's header and right column
                .environment(\.automationsDesktop, true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.app)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-automations")
    }
}

extension IPadParityScreen {
    /// The page surfaces (desktop-*-53 to -56): the page in the main column.
    var parityPage: DesktopPage? {
        switch self {
        case .routinesCalendar, .routinesList, .routinesLogs, .routineEdit: .automations
        case .teamMap: .teamMap
        case .memoryPage, .memoryMap, .memoryTags, .memoryQuality, .memoryMapRadial, .memoryMapColumns: .memory
        default: nil
        }
    }
}
