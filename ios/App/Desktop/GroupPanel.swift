// The group's docked panel in the iPad desktop shell (GroupPanel.tsx, with
// the Details and Advanced bodies GroupView.tsx hands it): the bot panel's
// shell adapted to a room. The top bar holds the room's "..." export menu
// (ExportTranscriptMenu, isGroup) and Close; then the 144 pt GroupAvatarStack,
// the name edited where it shows with its (i) for the group instructions
// (DescriptionInfo), "3 bots", and the Details / Instructions / Memory /
// Advanced tabs. Details is People and Bots (ChannelMembers.tsx) and Manage
// members; Instructions the markdown brief; Memory GroupMemoryTab.tsx;
// Advanced the default responder, @all mentions, the turn limit and the
// working folder.
//
// Every write goes through the room paths the phone's Room info uses
// (Session+Room.swift `patchRoom`, `roomMemory`, `saveRoomMemory`,
// `setRoomFolder`, the turn limit's client call, RoomActions' Leave, the
// roster sheet). Who may do what is `RoomInfoAccess`, as on the phone.
//
// Opened by the room chat's header pill (DesktopChat.swift) into the slot the
// bot panel docks in (DesktopShell.swift).
import SwiftUI
import UIKit
import CompanionCore

extension Chat {
    /// A room with its own panel: a group of bots, not a direct conversation
    /// with a person (that one opens the person's sheet).
    var opensGroupPanel: Bool {
        guard case let .room(room) = self else { return false }
        return room.dm != true && room.peopleDm != true
    }
}

/// `GROUP_PANEL_TABS`.
private enum GroupPanelTab: String, CaseIterable, Identifiable {
    case details, members, library, instructions, memory, advanced
    var id: String { rawValue }

    /// `GROUP_PANEL_HIDDEN_TABS` (desktop 46d28805db): Instructions and
    /// Memory are hidden for now, their code kept; empty this set to bring
    /// them back. The instructions stay editable from the (i) beside the
    /// group's name, and the group memory stays on unless switched off.
    static let hidden: Set<GroupPanelTab> = [.instructions, .memory]

    var title: LocalizedStringKey {
        switch self {
        // desktop #2333: Details reads Activity, the roster sits under Members
        case .details: "Activity"
        case .members: "Members"
        case .library: "Library"
        case .instructions: "Instructions"
        case .memory: "Memory"
        case .advanced: "Advanced"
        }
    }
}

struct DesktopGroupPanel: View {
    let room: Room
    let docked: Bool

    var body: some View {
        // one panel per room: its drafts and loads start over
        AnyView(DesktopGroupPanelContent(roomId: room.id, fallback: room, docked: docked)).id(room.id)
    }
}

private struct DesktopGroupPanelContent: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let roomId: String
    let fallback: Room
    let docked: Bool

    @State private var tab: GroupPanelTab = .details
    @State private var menuOpen = false
    @State private var exportOpen = false
    @State private var editingName = false
    @State private var sharedFile: ShareFile?
    @State private var directory: OrgDirectory?
    @State private var roster: RoomRosterFocus?
    @State private var jevOn = false
    /// The server's profile (`config.profile`): the viewer's name and email.
    @State private var profile: Profile?
    /// A team goal written inline over the panel (New team goal, Add to meeting, Duplicate).
    @State private var goalDraft: GroupPanelGoalDraft?
    @StateObject private var actions = RoomActions()

    private var room: Room { session.state.rooms.first { $0.id == roomId } ?? fallback }
    private var members: [Bot] { room.memberIds.compactMap { session.state.bot($0) } }

    var body: some View {
        let access = session.roomAccess(room)
        let tabs = Self.tabs(access: access, gate: session.surfaceGate)
        let shown = tabs.contains(tab) ? tab : .details
        VStack(spacing: 0) {
            AnyView(topBar)
            ScrollView {
                VStack(spacing: 0) {
                    AnyView(hero(access: access))
                    AnyView(tabRow(tabs, selected: shown))
                        .padding(.top, 16)
                        .padding(.bottom, 12)
                    if access.readOnlyNote {
                        DesktopText(verbatim: AppStrings.localized("Only the group's owner can change these settings."), size: 12.5, color: \.inkSecondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                            .accessibilityIdentifier("group-panel-owner-only")
                    }
                    AnyView(tabBody(shown, access: access))
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .scrollIndicators(.automatic)
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .overlay(alignment: docked ? .leading : .trailing) {
            Rectangle().fill(theme.hairlineWeak).frame(width: 1)
        }
        .sheet(item: $sharedFile) { file in ActivityShareSheet(items: [file.url]) }
        .sheet(item: $roster) { focus in
            RoomManageMembersSheet(room: room, access: access, directory: directory, focus: focus)
                .environmentObject(session)
        }
        .roomActionsPresenter(actions)
        // A routine of Upcoming opens its page over the whole panel, as on a bot
        .overlay {
            if let routineId = model.panelRoutineId {
                BotPanelRoutinePage(routineId: routineId)
                    .transition(.move(edge: .trailing))
            }
        }
        // desktop GroupDetailsTab: the routine editor stays inside the group panel
        .overlay {
            if let draft = goalDraft {
                GroupPanelRoutineEditor(room: room, draft: draft, bots: session.state.bots) {
                    withAnimation(.easeOut(duration: 0.2)) { goalDraft = nil }
                }
                .id(draft.id)
                .transition(.move(edge: .trailing))
            }
        }
        .onValueChange(of: model.panelOpen) { open in
            if !open {
                model.panelRoutineId = nil
                goalDraft = nil
            }
        }
        .task(id: session.connection?.id) {
            let config = await session.configStatus()
            jevOn = config?.jevRoomRoutingOn ?? false
            profile = config?.profile
            if session.surfaceGate.organization { directory = await session.orgDirectory() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Group panel"))
        .accessibilityIdentifier("desktop-group-panel")
    }

    /// Memory for a pairing that reaches it, Advanced off the remote client
    /// (`RoomInfoTab.available`).
    /// Desktop #2333: Activity, then Members; Advanced is no tab, it folds
    /// at the bottom of Members (`AdvancedDisclosure`).
    private static func tabs(access: RoomInfoAccess, gate: SurfaceGate) -> [GroupPanelTab] {
        var out = RoomInfoTab.available(access: access, gate: gate)
            .compactMap { GroupPanelTab(rawValue: $0.rawValue) }
            .filter { !GroupPanelTab.hidden.contains($0) && $0 != .advanced }
        out.insert(.members, at: min(1, out.count))
        // desktop GroupPanel: the group's files and pages after Members
        out.insert(.library, at: min(2, out.count))
        return out
    }

    private static func showsAdvanced(access: RoomInfoAccess, gate: SurfaceGate) -> Bool {
        RoomInfoTab.available(access: access, gate: gate).contains(.advanced)
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            DesktopRoundButton(systemImage: "ellipsis", label: "More options", active: menuOpen, icon: .ellipsis) {
                exportOpen = false
                menuOpen.toggle()
            }
            .overlay(alignment: .topTrailing) {
                if menuOpen { exportMenu }
            }
            .zIndex(1)
            .accessibilityIdentifier("group-panel-menu")
            DesktopRoundButton(systemImage: "sidebar.right", label: "Close", icon: .panelRight) { model.togglePanel() }
                .keyboardShortcut(editingName ? KeyboardShortcut("w", modifiers: [.command, .control, .option, .shift]) : KeyboardShortcut(.escape, modifiers: []))
                .accessibilityIdentifier("group-panel-close")
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .zIndex(2)
    }

    /// `ExportTranscriptMenu` for a group: Copy as Markdown, Export ›
    /// (Download as .md), then Split right and Split down.
    private var exportMenu: some View {
        VStack(alignment: .leading, spacing: 2) {
            menuRow(DesktopLucide.copy, Text("Copy as Markdown")) {
                menuOpen = false
                let threadId = room.threadId
                Task {
                    if let url = await session.export(threadId: threadId, format: "markdown"),
                       let text = try? String(contentsOf: url, encoding: .utf8) {
                        PlatformBridge.copyToPasteboard(text)
                    }
                }
            }
            .accessibilityIdentifier("group-panel-export.copy")
            menuRow(DesktopLucide.share, Text("Export"), chevron: true, active: exportOpen) { exportOpen.toggle() }
                .accessibilityIdentifier("group-panel-export.export")
                .overlay(alignment: .topLeading) {
                    if exportOpen {
                        VStack(alignment: .leading, spacing: 0) {
                            menuRow(nil, Text("Download as .md")) {
                                menuOpen = false
                                exportOpen = false
                                let threadId = room.threadId
                                Task {
                                    if let url = await session.export(threadId: threadId, format: "markdown") { sharedFile = ShareFile(url: url) }
                                }
                            }
                        }
                        .padding(4)
                        .frame(width: 200, alignment: .leading)
                        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
                        .fixedSize()
                        .offset(x: -(200 + 8), y: -4)
                    }
                }
                .zIndex(1)
            if DesktopConversationWindow.supportsScenes {
                Rectangle().fill(theme.border).frame(height: 0.5).padding(.horizontal, 8).padding(.vertical, 4)
                menuRow(DesktopLucide.columns2, Text("Split right")) {
                    menuOpen = false
                    DesktopConversationWindow.open(.room(room), edge: .right, openWindow: openWindow)
                }
                menuRow(DesktopLucide.rows2, Text("Split down")) {
                    menuOpen = false
                    DesktopConversationWindow.open(.room(room), edge: .bottom, openWindow: openWindow)
                }
            }
        }
        .padding(4)
        .frame(width: 218, alignment: .leading)
        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 8)
        .fixedSize()
        .alignmentGuide(.top) { d in d[.top] - 40 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel-export-menu")
    }

    private func menuRow(_ glyph: [String]?, _ title: Text, chevron: Bool = false, active: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let glyph { DesktopLucideGlyph(paths: glyph, size: 16) }
                title.font(theme.font(13)).lineLimit(1)
                Spacer(minLength: 0)
                if chevron { DesktopIconView(icon: .chevronRight, size: 14).foregroundStyle(theme.inkTertiary) }
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 8)
            .frame(height: 30)
            .background(active ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    // MARK: Hero

    /// The 144 pt faces (pt-5, as the bot's mascot), the name with its (i),
    /// then "3 bots".
    private func hero(access: RoomInfoAccess) -> some View {
        VStack(spacing: 0) {
            DesktopGroupAvatarStack(members: members, size: 144)
                .padding(.top, 24)
                .accessibilityIdentifier("group-panel-avatar")
            HStack(spacing: 2) {
                if access.editable {
                    PanelInlineText(value: room.name, placeholder: nil, label: "Edit name", size: 17, lineHeight: 24, weight: .medium,
                                    limit: 100, required: true, isEditing: $editingName) { next in
                        guard let name = RoomPatch.rename(room.name, to: next) else { return }
                        let target = room
                        Task { await session.patchRoom(target, RoomPatch(name: name)) }
                    }
                } else {
                    DesktopText(verbatim: room.name, size: 17, weight: .medium, line: 24)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                }
                GroupInstructionsInfo(room: room, editable: access.editable)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("group-panel-name")
            DesktopText(verbatim: members.count == 1 ? AppStrings.localized("1 bot") : String(localized: "\(String(members.count)) bots"),
                        size: 12.5, line: 16, color: \.inkSecondary)
                .lineLimit(1)
                .padding(.top, 2)
                .accessibilityIdentifier("group-panel-count")
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
    }

    private func tabRow(_ tabs: [GroupPanelTab], selected: GroupPanelTab) -> some View {
        HStack(spacing: 2) {
            ForEach(tabs) { item in
                let on = selected == item
                Button { tab = item } label: {
                    Text(item.title)
                        .font(theme.font(13))
                        .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 6)
                        .frame(height: 28)
                        .background(on ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("group-panel-tab.\(item.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func tabBody(_ tab: GroupPanelTab, access: RoomInfoAccess) -> some View {
        switch tab {
        case .details:
            GroupPanelDetails(part: .activity, room: room, access: access, directory: directory, profile: profile, roster: $roster, leave: { actions.leaving = room },
                              docked: docked, openMembers: { self.tab = .members }, newGoal: { source in withAnimation(.easeOut(duration: 0.2)) { goalDraft = GroupPanelGoalDraft(copyOf: source) } })
        case .members:
            VStack(alignment: .leading, spacing: 0) {
                GroupPanelDetails(part: .members, room: room, access: access, directory: directory, profile: profile, roster: $roster, leave: { actions.leaving = room },
                                  docked: docked, openMembers: { self.tab = .members }, newGoal: { source in withAnimation(.easeOut(duration: 0.2)) { goalDraft = GroupPanelGoalDraft(copyOf: source) } })
                if Self.showsAdvanced(access: access, gate: session.surfaceGate) {
                    GroupAdvancedDisclosure {
                        GroupPanelAdvanced(room: room, members: members, access: access, jevOn: jevOn)
                    }
                }
            }
        case .library:
            GroupPanelLibrary(room: room, docked: docked)
        case .instructions:
            GroupPanelInstructions(room: room, editable: access.editable)
        case .memory:
            GroupPanelMemory(room: room)
        case .advanced:
            GroupPanelAdvanced(room: room, members: members, access: access, jevOn: jevOn)
        }
    }
}

// MARK: - (i) beside the name

/// `DescriptionInfo` for the group instructions: a 24 pt (i) whose popover
/// reads them, and lets their owner edit them in place.
private struct GroupInstructionsInfo: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    let editable: Bool
    @State private var open = false
    @State private var editing = false
    @State private var draft = ""

    var body: some View {
        Button { open.toggle() } label: {
            DesktopIconView(icon: .info, size: 14, strokeWidth: 1.75)
                .foregroundStyle(open ? theme.ink : theme.inkSecondary)
                .frame(width: 24, height: 24)
                .background(open ? theme.hover : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Group instructions"))
        .accessibilityIdentifier("group-panel-instructions-info")
        .popover(isPresented: $open, arrowEdge: .top) {
            popover
                .onDisappear { editing = false }
        }
    }

    private var popover: some View {
        let text = room.bulletin.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 6) {
            Text("Group instructions")
                .font(theme.font(11.5, .medium))
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(theme.inkSecondary)
            if editing {
                TextEditor(text: $draft)
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.ink)
                    .scrollContentBackground(.hidden)
                    .frame(height: 96)
                    .padding(6)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityIdentifier("group-panel-instructions-info-field")
                HStack(spacing: 6) {
                    Spacer(minLength: 0)
                    Button("Cancel") { editing = false; draft = room.bulletin }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12, height: 26, horizontal: 8, radius: 6))
                    Button("Save") {
                        editing = false
                        let target = room
                        let next = draft
                        Task { await session.patchRoom(target, RoomPatch(bulletin: next)) }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12, weight: .medium, height: 26, horizontal: 10, radius: 6))
                }
            } else {
                ScrollView {
                    Text(text.isEmpty ? AppStrings.localized("No group instructions yet.") : text)
                        .font(theme.font(12.5))
                        .foregroundStyle(text.isEmpty ? theme.inkSecondary : theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 192)
                .fixedSize(horizontal: false, vertical: true)
                if editable {
                    HStack {
                        Spacer(minLength: 0)
                        Button("Edit") { draft = room.bulletin; editing = true }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12, weight: .medium, height: 26, horizontal: 8, radius: 6))
                            .foregroundStyle(theme.accentText)
                            .accessibilityIdentifier("group-panel-instructions-info-edit")
                    }
                }
            }
        }
        .padding(12)
        .frame(width: 280, alignment: .leading)
        .background(theme.elevated)
        .desktopPopoverOnCompact()
    }
}

// MARK: - Details

/// `PanelSection`: the quiet 13/18 heading, then its body (`gap-2`).
private struct GroupPanelSection<Content: View>: View {
    let title: Text
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            DesktopText(title, size: 13, line: 18, color: \.inkSecondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `ChannelMembers` rows: `rounded-xl bg-card`, each row px-3 py-2 with a
/// 32 pt face, 14 medium name, 12 grey detail, a hairline between rows.
private struct GroupMembersCard<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .frame(maxWidth: .infinity)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct GroupMemberRow<Face: View>: View {
    @Environment(\.desktopTheme) private var theme
    let name: String
    let detail: String?
    var divider = true
    var remove: (() -> Void)? = nil
    var removeLabel = ""
    var removeIdentifier = ""
    @ViewBuilder let face: () -> Face

    var body: some View {
        HStack(spacing: 12) {
            face().frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 0) {
                DesktopText(verbatim: name, size: 14, weight: .medium, line: 21)
                    .lineLimit(1)
                if let detail, !detail.isEmpty {
                    DesktopText(verbatim: detail, size: 12, line: 18, color: \.inkSecondary)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let remove {
                Button(action: remove) {
                    DesktopIconView(icon: .x, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 6))
                .accessibilityLabel(Text(verbatim: removeLabel))
                .accessibilityIdentifier(removeIdentifier)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            if divider { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 0.5) }
        }
        .accessibilityElement(children: .contain)
    }
}

/// The card's last row: the dashed 32 pt circle with its plus, then the label.
private struct GroupAddRow: View {
    @Environment(\.desktopTheme) private var theme
    let title: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                DesktopIconView(icon: .plus, size: 14)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 32, height: 32)
                    .overlay(Circle().strokeBorder(theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
                DesktopText(verbatim: title, size: 14, line: 20)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier(identifier)
    }
}

private struct GroupPanelDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    /// Activity (Upcoming, Computer) or Members (People, Bots, Leave).
    enum Part { case activity, members }
    let part: Part
    let room: Room
    let access: RoomInfoAccess
    let directory: OrgDirectory?
    let profile: Profile?
    @Binding var roster: RoomRosterFocus?
    let leave: () -> Void
    let docked: Bool
    /// Members tab (the Add a second bot suggestion).
    let openMembers: () -> Void
    /// The inline team goal editor: a new one (nil) or a copy (Duplicate).
    let newGoal: (Routine?) -> Void

    private struct Person: Identifiable {
        let id: String
        let label: String
        let detail: String?
        let removable: Bool
    }

    /// The viewer first (their name and email), then the room's people.
    private var people: [Person] {
        let viewer = session.roomViewer
        let profileEmail = profile?.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let email = (profileEmail?.isEmpty == false ? profileEmail : nil) ?? viewer.normalizedEmail
        let profileName = profile?.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = (profileName?.isEmpty == false ? profileName : nil) ?? session.account?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let me = (name?.isEmpty == false ? name : nil) ?? email ?? AppStrings.localized("You")
        var out = [Person(id: viewer.actorId, label: me, detail: email != me ? email : nil, removable: false)]
        for raw in room.humanIds ?? [] {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !id.isEmpty, id != viewer.actorId, id != email else { continue }
            out.append(Person(id: id, label: directory?.label(for: id) ?? id, detail: nil, removable: access.canRemoveHumans))
        }
        return out
    }

    /// The viewer's own bots in the group: the computer the panel may show.
    private var ownBots: [Bot] {
        let own = Set(session.state.bots.map(\.id))
        return room.memberIds.compactMap { id in own.contains(id) ? session.state.bot(id) : nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            // Desktop GroupDetailsTab: the bot's Upcoming, then its Computer
            if part == .activity {
                // desktop GroupDetailsTab: Upcoming, Suggested, Computer, Tasks
                GroupPanelUpcoming(room: room, docked: docked, newGoal: newGoal)
                GroupPanelSuggestions(room: room, access: access, ownBots: ownBots, openMembers: openMembers, newGoal: { newGoal(nil) })
                GroupPanelComputer(bots: ownBots.filter { $0.computer != "off" }, leadBotId: room.defaultResponder.botId)
                if !ownBots.isEmpty {
                    GroupPanelTasks(room: room, ownBots: ownBots, docked: docked)
                }
            } else {
                memberSections
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }

    @ViewBuilder
    private var memberSections: some View {
            GroupPanelSection(title: Text("People")) {
                GroupMembersCard {
                    let rows = people
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, person in
                        GroupMemberRow(
                            name: person.label, detail: person.detail,
                            divider: index < rows.count - 1 || access.canAddHuman,
                            remove: person.removable ? removePerson(person.id) : nil,
                            removeLabel: String(localized: "Remove \(person.label)"),
                            removeIdentifier: "group-panel-remove-person-\(person.id)"
                        ) {
                            DesktopText(verbatim: Self.initials(person.label), size: 12, weight: .medium, line: 16, color: \.inkSecondary)
                                .frame(width: 32, height: 32)
                                .background(theme.raised, in: Circle())
                        }
                        .accessibilityIdentifier("group-panel-person-\(person.id)")
                    }
                    if access.canAddHuman {
                        GroupAddRow(title: AppStrings.localized("Add"), identifier: "group-panel-add-person") { roster = .people }
                    }
                }
            }
            GroupPanelSection(title: Text("Bots")) {
                GroupMembersCard {
                    let ids = room.memberIds
                    ForEach(Array(ids.enumerated()), id: \.element) { index, id in
                        let bot = session.state.bot(id)
                        GroupMemberRow(
                            name: bot?.name ?? id, detail: bot?.title,
                            divider: index < ids.count - 1 || access.canAddBot,
                            remove: access.removableBotIds.contains(id) ? removeBot(id) : nil,
                            removeLabel: String(localized: "Remove \(bot?.name ?? id)"),
                            removeIdentifier: "group-panel-remove-bot-\(id)"
                        ) {
                            if let bot {
                                BotMascotView(bot: bot, size: 32, state: .idle, animated: false)
                            } else {
                                Circle().fill(theme.raised)
                            }
                        }
                        .accessibilityIdentifier("group-panel-bot-\(id)")
                    }
                    if access.canAddBot {
                        GroupAddRow(title: access.owns ? AppStrings.localized("Add") : AppStrings.localized("Add my bot"),
                                    identifier: "group-panel-add-bot") { roster = .bots }
                    }
                }
                if access.canManageRoster {
                    Button { roster = access.canAddHuman ? .people : .bots } label: {
                        Text(access.canAddHuman ? "Manage members" : "Manage bots")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GroupRaisedButtonStyle())
                    .padding(.top, 8)
                    .accessibilityIdentifier("group-panel-manage-members")
                }
            }
            // desktop GroupPanel #3690: what a group costs, under its roster
            if DesktopRoomBanners.showsCostNotice(room) {
                Text("Group conversations use more: every bot in the group reads the whole thread. For a simple question, chat with a single bot instead.")
                    .font(theme.font(12))
                    .lineSpacing(max(0, 17 - theme.uiFont(12).lineHeight))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .padding(.top, -12)
                    .accessibilityIdentifier("group-panel-cost-hint")
            }
            if access.canLeave {
                Button("Leave group", action: leave)
                    .buttonStyle(GroupLeaveButtonStyle())
                    .padding(.top, -12)
                    .accessibilityIdentifier("group-panel-leave")
            }
    }

    private func removePerson(_ id: String) -> () -> Void {
        let target = room
        return { Task { await session.patchRoom(target, RoomPatch(humanIds: RoomOwnership.humanIdsRemoving(id, from: target))) } }
    }

    private func removeBot(_ id: String) -> () -> Void {
        let target = room
        return { Task { await session.patchRoom(target, RoomPatch(memberIds: target.memberIds.filter { $0 != id })) } }
    }

    static func initials(_ label: String) -> String {
        let parts = label.split(whereSeparator: { " @._-".contains($0) })
        let letters = String(parts.first?.prefix(1) ?? "") + String(parts.dropFirst().first?.prefix(1) ?? "")
        return (letters.isEmpty ? String(label.prefix(2)) : letters).uppercased()
    }
}

/// `rounded-lg bg-raised px-3 py-2 text-[13px]` (Manage members, Choose…).
private struct GroupRaisedButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(configuration.isPressed ? theme.raisedHover : theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Rectangle())
    }
}

/// `rounded-lg px-3 py-2 text-[13px] text-danger hover:bg-hover`.
private struct GroupLeaveButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(13))
            .foregroundStyle(theme.danger)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(configuration.isPressed ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
    }
}

// MARK: - Instructions

/// The grey heading with its (?) outside the editor; the markdown editor
/// saves when it gives up focus (`onBlur`), read-only for everyone else.
private struct GroupPanelInstructions: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    let editable: Bool
    @State private var draft: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                DesktopText(Text("Group instructions"), size: 13, line: 18, color: \.inkSecondary)
                DesktopHelpTip(help: Text("A shared brief every member sees on each turn. You can edit it later."))
            }
            .padding(.horizontal, 4)
            if editable {
                MarkdownEditor(
                    text: Binding(get: { draft ?? room.bulletin }, set: { draft = $0 }),
                    placeholder: AppStrings.localized("Goals, tone, ownership, constraints…"), minHeight: 220,
                    accessibilityLabel: AppStrings.localized("Group instructions"), identifier: "group-panel-instructions-editor",
                    onEndEditing: save
                )
            } else {
                let text = room.bulletin.trimmingCharacters(in: .whitespacesAndNewlines)
                Text(text.isEmpty ? AppStrings.localized("No group instructions yet.") : room.bulletin)
                    .font(theme.font(13))
                    .foregroundStyle(text.isEmpty ? theme.inkSecondary : theme.ink)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityIdentifier("group-panel-instructions-text")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .onDisappear(perform: save)
    }

    private func save() {
        guard editable, let text = draft, text != room.bulletin else { return }
        let target = room
        Task { if await session.patchRoom(target, RoomPatch(bulletin: text)) { draft = nil } }
    }
}

// MARK: - Memory

/// `GroupMemoryTab`: the title and detail with the switch at the right, the
/// read-only and off notes, the gauge, the editor, the conflict box and the
/// Cancel / Save pills.
private struct GroupPanelMemory: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    @State private var view: GroupMemoryView?
    @State private var draft = ""
    @State private var error: String?
    @State private var conflict = false
    @State private var saving = false

    var body: some View {
        Group {
            if let view {
                content(view)
            } else {
                DesktopText(verbatim: error ?? AppStrings.localized("Loading the group memory…"), size: 13, color: \.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
            }
        }
        .task(id: room.id) { await load() }
    }

    private func content(_ view: GroupMemoryView) -> some View {
        let dirty = draft != view.text
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText(Text("Group memory"), size: 13, weight: .medium, line: 18)
                    DesktopText(Text("Notes every bot of this group reads at each turn here, and writes when it learns something the whole group should keep. A bot's own memory stays private and never lands here on its own."),
                                size: 12.5, line: 20, color: \.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if view.canEdit {
                    PanelSwitch(label: "Let the bots of this group use its memory", isOn: view.enabled, disabled: saving) { _ in
                        save(enabled: !view.enabled)
                    }
                    .accessibilityIdentifier("group-panel-memory-switch")
                }
            }
            if !view.canEdit {
                DesktopText(Text("Only the owner of this group can change its memory."), size: 12, line: 16, color: \.inkSecondary)
            }
            if !view.enabled {
                DesktopText(Text("Off: the bots neither read nor write it. The notes stay here."), size: 12, line: 16, color: \.inkSecondary)
            }
            RoomMemoryGauge(capacity: view.capacity)
            if view.canEdit {
                MarkdownEditor(
                    text: $draft, placeholder: AppStrings.localized("- A fact the whole group should keep"), minHeight: 240,
                    accessibilityLabel: AppStrings.localized("Group memory"), identifier: "group-panel-memory-editor"
                )
            } else {
                Text(view.text.isEmpty ? AppStrings.localized("Nothing yet.") : view.text)
                    .font(theme.font(13))
                    .foregroundStyle(view.text.isEmpty ? theme.inkSecondary : theme.ink)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 240, alignment: .topLeading)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityIdentifier("group-panel-memory-text")
            }
            if conflict {
                VStack(alignment: .leading, spacing: 8) {
                    DesktopText(Text("A bot changed the group memory while you were editing. Nothing was saved."), size: 12.5, weight: .medium, line: 20)
                    HStack(spacing: 8) {
                        pill("Reload") { conflict = false; Task { await load() } }
                        if view.canEdit { pill("Overwrite with mine") { save(text: draft, expectedHash: nil) } }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.warning.opacity(0.25), lineWidth: 1))
                .accessibilityIdentifier("group-panel-memory-conflict")
            }
            if let error {
                DesktopText(verbatim: error, size: 12, line: 16, color: \.danger)
            }
            if view.canEdit {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    pill("Cancel") { draft = view.text }.disabled(!dirty || saving)
                    pill("Save") { save(text: draft, expectedHash: view.hash) }
                        .disabled(!dirty || saving)
                        .accessibilityIdentifier("group-panel-memory-save")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel-memory")
    }

    /// `rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px]`.
    private func pill(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
        }
        .buttonStyle(GroupPillButtonStyle())
        .disabled(saving)
    }

    private func load() async {
        do {
            let next = try await session.roomMemory(room)
            view = next
            draft = next.text
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save(text: String? = nil, expectedHash: String? = nil, enabled: Bool? = nil) {
        saving = true
        Task {
            defer { saving = false }
            do {
                let next = try await session.saveRoomMemory(room, text: text, expectedHash: expectedHash, enabled: enabled)
                view = next
                if text != nil { draft = next.text }
                conflict = false
                error = nil
            } catch is GroupMemoryConflict {
                conflict = true
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct GroupPillButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(12.5))
            .foregroundStyle(configuration.isPressed ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 26)
            .background(configuration.isPressed ? theme.raised : theme.panel, in: Capsule())
            .overlay(Capsule().strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            .opacity(enabled ? 1 : 0.5)
            .contentShape(Capsule())
    }
}

// MARK: - Advanced

/// Default responder, Mentions (with people in the room), the turn limit and
/// the working folder, each a `PanelSection` over its own `bg-card` box.
/// Desktop `AdvancedDisclosure`: Members > Advanced, every setting that is
/// not the roster, folded by default under a quiet 13 pt toggle.
private struct GroupAdvancedDisclosure<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    @ViewBuilder let content: () -> Content
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button { open.toggle() } label: {
                HStack(spacing: 4) {
                    Text("Advanced")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .accessibilityAddTraits(open ? [.isSelected, .isButton] : .isButton)
            .accessibilityIdentifier("group-panel-advanced-toggle")
            if open { content() }
        }
    }
}

private struct GroupPanelAdvanced: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let room: Room
    let members: [Bot]
    let access: RoomInfoAccess
    let jevOn: Bool

    @State private var globalMinutes = 5
    @State private var savedMinutes: Int??
    @State private var customOpen = false
    @State private var customDraft = ""
    @State private var folderDraft: String?
    @State private var folderSaving = false

    private var owns: Bool { access.owns }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            GroupPanelSection(title: Text("Default responder")) { responder }
            if !(room.humanIds ?? []).isEmpty {
                GroupPanelSection(title: Text("Mentions")) { mentionAll }
            }
            GroupPanelSection(title: Text("Turn limit for this conversation")) { turnLimit }
            GroupPanelSection(title: Text("Working folder")) { folder }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel-advanced")
        .task(id: session.connection?.id) {
            if let minutes = try? await session.settingsClient?.desktopSettingsConfig().rooms?.turnTimeoutMinutes { globalMinutes = minutes }
        }
        .alert("Turn limit for this conversation", isPresented: $customOpen) {
            TextField("30", text: $customDraft)
                .keyboardType(.numberPad)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                if let minutes = Int(customDraft.trimmingCharacters(in: .whitespaces)), (1...1440).contains(minutes) {
                    saveTurnLimit(minutes)
                }
            }
        }
    }

    /// `DefaultResponderSelect`: the lead options, then the group behaviours.
    private var responder: some View {
        let options: [(RoomResponder.Choice, String)] =
            members.map { (RoomResponder.Choice.lead(botId: $0.id), String(localized: "Lead: \($0.name)")) }
            + [(.auto, jevOn ? AppStrings.localized("Auto (Jev)") : AppStrings.localized("Auto")),
               (.everyone, AppStrings.localized("Everyone responds")),
               (.mentions, AppStrings.localized("Only when mentioned"))]
        return VStack(alignment: .leading, spacing: 0) {
            DesktopPillSelect(
                options: options, selection: RoomResponder.choice(room),
                label: Text("Default responder"), identifier: "group-panel-responder",
                disabled: !owns, fill: true
            ) { choice in
                let next = RoomResponder.value(for: choice, in: room)
                guard next != room.defaultResponder else { return }
                let target = room
                Task { await session.patchRoom(target, RoomPatch(defaultResponder: next)) }
            }
            .accessibilityHint(Text(verbatim: responderExplanation))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    /// The select's title: what a plain message does.
    private var responderExplanation: String {
        let lead = RoomResponder.answeringBotId(room).flatMap { id in members.first { $0.id == id }?.name }
            ?? AppStrings.localized("the lead bot")
        switch RoomResponder.choice(room) {
        case .everyone: return AppStrings.localized("Plain messages go to every group member; @mentions override this")
        case .mentions: return AppStrings.localized("Only explicitly @mentioned bots respond")
        case .auto:
            return jevOn
                ? AppStrings.localized("Jev picks who answers each plain message; @mentions override this")
                : String(localized: "Jev is off, so plain messages go to \(lead); @mentions override this")
        case .lead: return String(localized: "Plain messages go to \(lead); @mentions override this")
        }
    }

    /// `RoomMentionAll`.
    private var mentionAll: some View {
        let on = room.mentionAll == true
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                DesktopText(Text("@all notifies everyone"), size: 12.5, weight: .medium, line: 18)
                DesktopText(on
                            ? Text("@all sends a notification to every person in this group chat. A person tagged by name is always notified.")
                            : Text("@all notifies nobody. A person tagged by name is always notified."),
                            size: 12, line: 19, color: \.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            PanelSwitch(label: "@all notifies everyone", isOn: on, disabled: !owns) { next in
                let target = room
                Task { await session.patchRoom(target, RoomPatch(mentionAll: next)) }
            }
            .accessibilityIdentifier("group-panel-mention-all")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var currentMinutes: Int? {
        if let savedMinutes { return savedMinutes }
        if room.dm == true { return room.turnTimeoutMinutes }
        return room.tasks?.first { $0.threadId == room.threadId }?.turnTimeoutMinutes
    }

    /// `ConversationTurnLimit`: Default, 30, 60, 120, a value set elsewhere,
    /// Custom… (a number from 1 to 1440).
    private var turnLimit: some View {
        let value = currentMinutes
        let presets = [30, 60, 120]
        var options: [(Int, String)] = [(0, String(localized: "Default (\(String(globalMinutes)) min)"))]
        options += presets.map { ($0, String(localized: "\(String($0)) minutes")) }
        if let value, !presets.contains(value) { options.append((value, String(localized: "\(String(value)) minutes"))) }
        options.append((-1, AppStrings.localized("Custom…")))
        return HStack {
            DesktopPillSelect(
                options: options, selection: value ?? 0,
                label: Text("Turn limit for this conversation"), identifier: "group-panel-turn-limit"
            ) { minutes in
                if minutes == -1 {
                    customDraft = String(value ?? 30)
                    customOpen = true
                } else {
                    saveTurnLimit(minutes == 0 ? nil : minutes)
                }
            }
            .accessibilityHint(Text("How long a bot may keep working in this conversation before the turn stops. Default uses the group turn limit in Settings. A new choice applies to the next turn."))
            Spacer(minLength: 0)
        }
    }

    private func saveTurnLimit(_ minutes: Int?) {
        savedMinutes = .some(minutes)
        let target = room
        Task {
            do { try await session.settingsClient?.setRoomTurnLimit(room: target, minutes: minutes) }
            catch { session.actionError = error.localizedDescription }
        }
    }

    /// Who may set the folder (`roomFolderEditable`): a solo server's room,
    /// or an admin; the panel still asks that they own the room.
    private var folderEditable: Bool { room.ownerId == nil || session.canAdminister }

    /// `RoomWorkingFolder`: the title and detail, then the path (fixed once
    /// the room pinned it) or the field and Save.
    private var folder: some View {
        let locked = room.pinnedCwd != nil
        let disabled = !owns || !folderEditable
        let shown = locked ? room.pinnedCwd : room.cwd
        return VStack(alignment: .leading, spacing: 0) {
            DesktopText(Text("Working folder"), size: 15, weight: .medium, line: 20)
            DesktopText(Text("Where every bot in this group runs its shell and file tools."), size: 13, line: 18, color: \.inkSecondary)
                .padding(.top, 2)
            if locked || disabled {
                Group {
                    if let shown, !shown.isEmpty {
                        Text(verbatim: shown).foregroundStyle(theme.ink)
                    } else {
                        Text("Each bot’s own folder").foregroundStyle(theme.inkSecondary)
                    }
                }
                .font(.system(size: 12.5, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .padding(.top, 12)
                .accessibilityIdentifier("group-panel-folder-value")
                if !locked && owns && !folderEditable {
                    DesktopText(Text("Only an organization admin can change the working folder."), size: 12, line: 16, color: \.inkSecondary)
                        .padding(.top, 8)
                }
                if locked {
                    DesktopText(Text("Fixed for this thread after its first turn. Start a new thread to work somewhere else."), size: 12, line: 16, color: \.inkSecondary)
                        .padding(.top, 8)
                }
            } else {
                HStack(spacing: 8) {
                    TextField(AppStrings.localized("Each bot’s own folder, or an absolute path"), text: Binding(
                        get: { folderDraft ?? room.cwd ?? "" },
                        set: { folderDraft = $0 }
                    ))
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(theme.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit(saveFolder)
                    .padding(.horizontal, 12)
                    .frame(height: 38)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                    .accessibilityIdentifier("group-panel-folder-field")
                    Button("Save", action: saveFolder)
                        .buttonStyle(GroupRaisedButtonStyle())
                        .disabled(folderSaving || folderDraft == nil)
                        .accessibilityIdentifier("group-panel-folder-save")
                }
                .padding(.top, 12)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func saveFolder() {
        guard let value = folderDraft else { return }
        folderSaving = true
        let target = room
        Task {
            // an emptied field is each bot's own folder (null)
            if await session.setRoomFolder(target, cwd: value) { folderDraft = nil }
            folderSaving = false
        }
    }
}

// MARK: - Details > Upcoming (desktop GroupRoutinesSection)

/// The group's routines as the bot panel's Upcoming: the plain grey label,
/// a ... menu (New team goal), one card, Show more after 5; each row wears
/// its bot's face. A row opens the routine's page over the whole panel.
private struct GroupPanelUpcoming: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let room: Room
    let docked: Bool
    /// The inline team goal editor: a new one (nil) or a copy (Duplicate).
    let newGoal: (Routine?) -> Void

    @State private var routines: [Routine] = []
    @State private var runs: [RoutineRun] = []
    @State private var loaded = false
    @State private var toggling: Set<String> = []
    @State private var working: Set<String> = []
    @State private var expanded = false
    @State private var renaming: Routine?
    @State private var renameText = ""
    @State private var deleting: Routine?

    /// `groupRoutines`: its team goals and the routines posting in one of
    /// its conversations.
    static func of(_ routines: [Routine], room: Room) -> [Routine] {
        var threads: Set<String> = [room.threadId]
        for task in room.tasks ?? [] where !task.threadId.isEmpty { threads.insert(task.threadId) }
        return routines.filter { routine in
            routine.groupId == room.id || (routine.resultsThreadId.map { threads.contains($0) } ?? false)
        }
    }

    private var mine: [Routine] { Self.of(routines, room: room) }
    private var shown: [Routine] {
        expanded || mine.count <= PanelRoutinePreview.limit ? mine : Array(mine.prefix(PanelRoutinePreview.limit))
    }
    /// A new team goal runs on the lead when it is the viewer's, else their first bot.
    private var newGoalBot: String? {
        let own = Set(session.state.bots.map(\.id))
        let mineIds = room.memberIds.filter { own.contains($0) }
        if let lead = room.defaultResponder.botId, mineIds.contains(lead) { return lead }
        return mineIds.first
    }

    /// The routine's run still going (queued, running or waiting), if any.
    private func activeRun(_ routine: Routine) -> RoutineRun? {
        runs.first { $0.routineId == routine.id && ["queued", "running", "waiting"].contains($0.status) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Upcoming")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 2)
                if newGoalBot != nil, room.dm != true {
                    Menu {
                        Button(String(localized: "New team goal"), systemImage: "plus") { newGoal(nil) }
                    } label: {
                        DesktopIconView(icon: .ellipsis, size: 15)
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text("More options"))
                    .accessibilityIdentifier("group-panel-routines-more")
                }
            }
            .frame(height: 28)
            if loaded && mine.isEmpty {
                Text("No routine for this group yet. Team goals and routines that post here show up in this list.")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkTertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 8)
                    .accessibilityIdentifier("group-panel-routines-hint")
            } else if !loaded {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(shown.enumerated()), id: \.element.id) { index, routine in
                        row(routine)
                        if index < shown.count - 1 {
                            Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                        }
                    }
                }
                .padding(1)
                .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                if !expanded && mine.count > PanelRoutinePreview.limit {
                    Button { expanded = true } label: {
                        Text("Show more")
                            .font(theme.font(13, .medium))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("group-panel-upcoming-show-more")
                }
            }
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .groupPanelRoutinesChanged)) { _ in
            Task { await load() }
        }
        .onValueChange(of: model.panelRoutineId) { id in
            // back from a routine's page: what it changed shows here
            if id == nil { Task { await load() } }
        }
        .alert(Text("Rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(String(localized: "Name"), text: $renameText)
                .accessibilityIdentifier("group-panel.routine-rename-field")
            Button(String(localized: "Rename")) {
                if let routine = renaming { Task { await rename(routine) } }
            }
            .accessibilityIdentifier("group-panel.routine-rename-save")
            Button(String(localized: "Cancel"), role: .cancel) {}
        }
        .confirmationDialog(Text("Delete this routine?"), isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }
        ), titleVisibility: .visible, presenting: deleting) { routine in
            Button(String(localized: "Delete"), role: .destructive) {
                Task { await delete(routine) }
            }
            .accessibilityIdentifier("group-panel.routine-delete-confirm")
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: { routine in
            Text(verbatim: routine.name)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("group-panel-routines")
    }

    private func row(_ routine: Routine) -> some View {
        let bot = session.state.bot(routine.botId)
        let busy = working.contains(routine.id)
        return HStack(spacing: 10) {
            Button { model.panelRoutineId = routine.id } label: {
                HStack(spacing: 10) {
                    if let bot {
                        BotMascotView(bot: bot, size: 24, state: .idle, animated: false)
                            .frame(width: 24, height: 24)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: routine.name)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                            .frame(height: 18)
                        Text(verbatim: BotPanelRoutines.scheduleLine(routine))
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                            .frame(height: 17)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("group-panel-routine.\(routine.name)")
            if busy {
                ProgressView().controlSize(.mini).frame(width: 28, height: 28)
            } else {
                Menu { menuItems(routine) } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.inkTertiary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("More actions for \(routine.name)"))
                .accessibilityIdentifier("group-panel.routine-menu.\(routine.name)")
            }
            PanelSwitch(label: routine.enabled ? "Pause" : "Resume", isOn: routine.enabled,
                        disabled: toggling.contains(routine.id) || routine.schedule.type == .unknown,
                        onColor: bot.flatMap { BubbleColors.user(botColor: $0.color)?.fill.color }) { on in
                Task { await toggle(routine, on: on) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .hoverEffect(.highlight)
        .contextMenu { menuItems(routine) }
    }

    /// The desktop routine row menu: run or stop, pause or resume, rename,
    /// open, duplicate, delete.
    @ViewBuilder
    private func menuItems(_ routine: Routine) -> some View {
        if let run = activeRun(routine) {
            Button(String(localized: "Stop"), systemImage: "stop.circle") { Task { await stop(routine, run: run) } }
                .accessibilityIdentifier("group-panel.routine-action.stop")
        } else {
            Button(String(localized: "Run now"), systemImage: "play") { Task { await runNow(routine) } }
                .accessibilityIdentifier("group-panel.routine-action.run")
        }
        if routine.schedule.type != .unknown {
            if routine.enabled {
                Button(String(localized: "Pause"), systemImage: "pause") { Task { await toggle(routine, on: false) } }
                    .accessibilityIdentifier("group-panel.routine-action.pause")
            } else {
                Button(String(localized: "Resume"), systemImage: "play.circle") { Task { await toggle(routine, on: true) } }
                    .accessibilityIdentifier("group-panel.routine-action.resume")
            }
        }
        Button(String(localized: "Rename"), systemImage: "pencil") {
            renameText = routine.name
            renaming = routine
        }
        .accessibilityIdentifier("group-panel.routine-action.rename")
        Button(String(localized: "Open"), systemImage: "arrow.up.right") { model.panelRoutineId = routine.id }
            .accessibilityIdentifier("group-panel.routine-action.open")
        Button(String(localized: "Duplicate"), systemImage: "plus.square.on.square") { newGoal(routine) }
            .accessibilityIdentifier("group-panel.routine-action.duplicate")
        Divider()
        Button(String(localized: "Delete"), systemImage: "trash", role: .destructive) { deleting = routine }
            .accessibilityIdentifier("group-panel.routine-action.delete")
    }

    private func toggle(_ routine: Routine, on: Bool) async {
        toggling.insert(routine.id)
        defer { toggling.remove(routine.id) }
        if let saved = await session.setRoutineEnabled(routine, enabled: on),
           let index = routines.firstIndex(where: { $0.id == saved.id }) {
            routines[index] = saved
        }
    }

    private func runNow(_ routine: Routine) async {
        working.insert(routine.id)
        defer { working.remove(routine.id) }
        if let run = await session.runRoutine(routine) {
            Haptics.success()
            runs.removeAll { $0.id == run.id }
            runs.insert(run, at: 0)
        }
    }

    private func stop(_ routine: Routine, run: RoutineRun) async {
        working.insert(routine.id)
        defer { working.remove(routine.id) }
        if let stopped = await session.cancelRoutineRun(run),
           let index = runs.firstIndex(where: { $0.id == stopped.id }) {
            runs[index] = stopped
        }
    }

    private func rename(_ routine: Routine) async {
        let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        guard !name.isEmpty, name != routine.name else { return }
        working.insert(routine.id)
        defer { working.remove(routine.id) }
        if let saved = await session.renameRoutine(routine, name: String(name.prefix(80))),
           let index = routines.firstIndex(where: { $0.id == saved.id }) {
            routines[index] = saved
        }
    }

    private func delete(_ routine: Routine) async {
        working.insert(routine.id)
        defer { working.remove(routine.id) }
        if await session.deleteRoutine(routine) {
            Haptics.success()
            routines.removeAll { $0.id == routine.id }
            if model.panelRoutineId == routine.id { model.panelRoutineId = nil }
        }
    }

    private func load() async {
        let loaded = await session.loadRoutines()
        routines = loaded.routines
        runs = loaded.runs
        self.loaded = true
    }
}

// MARK: - Details > Computer (desktop GroupComputerSection)

/// The bot panel's Computer card for one of the viewer's bots in the group
/// (the lead's by default); with several, a picker on the label row.
private struct GroupPanelComputer: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openWindow) private var openWindow
    @EnvironmentObject private var model: DesktopShellModel
    let bots: [Bot]
    let leadBotId: String?

    @State private var picked: String?

    private var bot: Bot? {
        bots.first { $0.id == picked } ?? bots.first { $0.id == leadBotId } ?? bots.first
    }

    var body: some View {
        if let bot {
            BotPanelComputerCard(bot: bot) {
                DesktopComputerWindow.open(botId: bot.id, openWindow: openWindow, model: model)
            }
            .id(bot.id)
            .overlay(alignment: .topTrailing) {
                if bots.count > 1 {
                    Menu {
                        Picker(String(localized: "Computer of"), selection: Binding(get: { bot.id }, set: { picked = $0 })) {
                            ForEach(bots) { candidate in Text(verbatim: candidate.name).tag(candidate.id) }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(verbatim: bot.name).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                        }
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(height: 18)
                    }
                    .accessibilityLabel(Text("Computer of"))
                    .accessibilityIdentifier("group-panel-computer-of")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("group-panel-computer")
        }
    }
}
