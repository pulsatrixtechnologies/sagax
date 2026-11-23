// Room info (matrix RM6, RM7, RM8, RM14-RM19; GroupPanel.tsx): the desktop
// panel's tabs (`GROUP_PANEL_TABS`) drawn as the iPhone's bot panel (#997):
// Details is the panel itself (the room's faces and name, People, Bots and
// Manage, Leave), then Instructions, Memory and Advanced (Default
// responder, Working folder) as rows, each a page of its own. Rename, Move to
// team, Copy ID and Delete are the row menu's (RoomRowMenu), as on the
// desktop. Owner items follow `RoomInfoAccess` and are never drawn disabled.
//
// `RoomInfoView` is the presentation-free body; the phone wraps it in a
// sheet (`RoomInfoSheet`), the iPad desktop shell will dock it as the
// `group-panel`.
import CompanionCore
import SwiftUI

struct RoomInfoSheet: View {
    let roomId: String
    var openThreads: () -> Void = {}
    var onDeleted: () -> Void = {}
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        // #997: the group's panel reads as the bot's (PhoneBotPanel): no
        // navigation title, a round glass Back at the top left, the faces
        // and the name as the header, and each other part a page of its own
        NavigationStack {
            RoomInfoView(roomId: roomId, openThreads: openThreads, onDeleted: onDeleted)
                .toolbar(.hidden, for: .navigationBar)
                .safeAreaInset(edge: .top, spacing: 0) { topBar }
        }
        .tint(Theme.accentText)
    }

    private var topBar: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            GlassCircleButton(
                systemImage: "chevron.left", accessibilityLabel: "Back",
                glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25)
            ) { dismiss() }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("room-info-done")
            Spacer()
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .background(Theme.bg)
    }
}

struct RoomInfoView: View {
    @Environment(\.themePalette) var themePalette
    let roomId: String
    var openThreads: () -> Void = {}
    var onDeleted: () -> Void = {}
    @EnvironmentObject private var session: Session
    @StateObject private var actions = RoomActions()
    /// Show threads off: no Threads row.
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared
    @State private var jevOn = false
    @State private var directory: OrgDirectory?
    /// The roster sheet, open on the section that opened it (#1240, #1260).
    @State private var roster: RoomRosterFocus?

    private var room: Room? { session.state.rooms.first { $0.id == roomId } }

    var body: some View {
        Group {
            if let room {
                content(room)
            } else {
                Color.clear
            }
        }
        .roomActionsPresenter(actions)
        .onValueChange(of: actions.deleted) { deleted in
            if deleted == roomId { onDeleted() }
        }
        .task(id: session.connection?.id) {
            jevOn = await session.configStatus()?.jevRoomRoutingOn ?? false
            if session.surfaceGate.organization { directory = await session.orgDirectory() }
        }
    }

    @ViewBuilder
    private func content(_ room: Room) -> some View {
        let access = session.roomAccess(room)
        AnyView(details(room, access: access))
            .background(Theme.bg)
            // the desktop's other tabs, each a page over the details, as the
            // bot panel's Coding, Routines, Library and Computer
            .navigationDestination(for: RoomInfoTab.self) { tab in
                AnyView(page(tab, room: room, access: access))
                    .navigationTitle(tab.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .background(Theme.bg)
            }
    }

    @ViewBuilder
    private func page(_ tab: RoomInfoTab, room: Room, access: RoomInfoAccess) -> some View {
        switch tab {
        case .details: details(room, access: access)
        case .instructions: RoomInstructionsView(roomId: roomId, editable: access.editable)
        case .memory: RoomMemoryView(room: room)
        case .advanced: advanced(room, access: access)
        }
    }

    /// Instructions, Memory and Advanced as one grouped list of rows.
    @ViewBuilder
    private func overview(_ room: Room, access: RoomInfoAccess) -> some View {
        let pages = RoomInfoTab.available(access: access, gate: session.surfaceGate).filter { $0 != .details }
        if !pages.isEmpty {
            Section {
                ForEach(pages, id: \.self) { tab in
                    NavigationLink(value: tab) {
                        row(tab.title, systemImage: tab.systemImage, value: "")
                    }
                    .accessibilityIdentifier("room-page.\(tab.rawValue)")
                }
            }
        }
    }

    private func advanced(_ room: Room, access: RoomInfoAccess) -> some View {
        ThemedList {
            RoomResponderSection(room: room, jevOn: jevOn)
                .disabled(!access.editable)
            // #216: the turn limit lives here, not in the chat header
            RoomTurnLimitSection(room: room)
                .disabled(!access.editable)
            if session.surfaceGate.scope == .serverAdmin {
                RoomFolderSection(room: room, editable: access.editable)
            }
        }
        .accessibilityIdentifier("room-advanced")
    }

    @ViewBuilder
    private func details(_ room: Room, access: RoomInfoAccess) -> some View {
        let members = room.memberIds.compactMap { session.state.bot($0) }
        ThemedList {
            Section {
                header(room, members: members, access: access)
                    .listRowBackground(Color.clear)
            }
            if access.readOnlyNote {
                Section {
                    Text(String(localized: "Only the group's owner can change these settings."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("room-owner-only")
                }
            }

            RoomPeopleSection(
                room: room, access: access, directory: directory,
                addPeople: { roster = .people }
            )
            RoomBotsSection(room: room, access: access, addBots: { roster = .bots }, manageMembers: { roster = .people })
            overview(room, access: access)

            if sidebarPrefs.threads.allows(.roomThreads) {
                Section {
                    // the phone's way into the room's threads (the header's tap)
                    Button(action: openThreads) {
                        row(String(localized: "Threads"), systemImage: "square.stack", value: "\(room.tasks?.count ?? 1)")
                    }
                    .accessibilityIdentifier("room-threads")
                }
            }

            if access.canLeave {
                Section {
                    Button(String(localized: "Leave group"), role: .destructive) {
                        // #1480: confirmed by the host's RoomActionsPresenter,
                        // then POST /leave
                        actions.leaving = room
                    }
                    .accessibilityIdentifier("room-leave")
                }
            }
        }
        .accessibilityIdentifier("room-info")
        .sheet(item: $roster) { focus in
            RoomManageMembersSheet(room: room, access: access, directory: directory, focus: focus).environmentObject(session)
        }
    }

    private func header(_ room: Room, members: [Bot], access: RoomInfoAccess) -> some View {
        VStack(spacing: 6) {
            // the bot panel's 112 pt face, its name type and its gap
            ChatAvatarView(chat: .room(room), size: 112, background: Theme.bg)
                .frame(width: 112, height: 112)
                .accessibilityHidden(true)
            Button {
                if access.editable { actions.startRename(room) }
            } label: {
                HStack(spacing: 6) {
                    Text(verbatim: room.name)
                        .font(Theme.Font.profileName)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    if access.editable {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(!access.editable)
            .accessibilityIdentifier("room-info-name")
            .accessibilityHint(access.editable ? Text(String(localized: "Rename group chat")) : Text(verbatim: ""))
            Text(members.count == 1 ? String(localized: "1 bot") : String(localized: "\(members.count) bots"))
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
        .padding(.bottom, 6)
    }

    private func row(_ title: String, systemImage: String, value: String) -> some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            if !value.isEmpty {
                Text(verbatim: value)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Who answers a plain message (DefaultResponderSelect, RM19): the owner's,
/// in the desktop's Advanced tab.
struct RoomResponderSection: View {
    let room: Room
    let jevOn: Bool
    @EnvironmentObject private var session: Session

    var body: some View {
        let members = room.memberIds.compactMap { session.state.bot($0) }
        let selection = Binding<RoomResponder.Choice>(
            get: { RoomResponder.choice(room) },
            set: { choice in
                let next = RoomResponder.value(for: choice, in: room)
                guard next != room.defaultResponder else { return }
                Task { await session.patchRoom(room, RoomPatch(defaultResponder: next)) }
            }
        )
        Section {
            Picker(String(localized: "Default responder"), selection: selection) {
                Section(String(localized: "Group lead")) {
                    ForEach(members) { bot in
                        Text(String(localized: "Lead: \(bot.name)")).tag(RoomResponder.Choice.lead(botId: bot.id))
                    }
                }
                Section(String(localized: "Group behavior")) {
                    Text(String(localized: "Auto")).tag(RoomResponder.Choice.auto)
                    Text(String(localized: "Everyone responds")).tag(RoomResponder.Choice.everyone)
                    Text(String(localized: "Only when mentioned")).tag(RoomResponder.Choice.mentions)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("room-responder")
        } header: {
            Text(String(localized: "Default responder"))
        } footer: {
            Text(explanation(members: members))
        }
    }

    /// The select's title on the desktop: what a plain message does.
    private func explanation(members: [Bot]) -> String {
        let lead = RoomResponder.answeringBotId(room).flatMap { id in members.first { $0.id == id }?.name }
            ?? String(localized: "the lead bot")
        switch RoomResponder.choice(room) {
        case .everyone: return String(localized: "Plain messages go to every group member; @mentions override this")
        case .mentions: return String(localized: "Only explicitly @mentioned bots respond")
        case .auto:
            return jevOn
                ? String(localized: "The decision model picks who answers each plain message; @mentions override this")
                : String(localized: "The decision model is off, so plain messages go to \(lead); @mentions override this")
        case .lead: return String(localized: "Plain messages go to \(lead); @mentions override this")
        }
    }
}

/// The desktop panel's tabs (GroupPanel.tsx `GROUP_PANEL_TABS`): Memory for
/// a pairing that reaches it, Advanced off the remote client.
enum RoomInfoTab: String, Hashable, CaseIterable {
    case details, instructions, memory, advanced

    var title: String {
        switch self {
        case .details: String(localized: "Details")
        case .instructions: String(localized: "Instructions")
        case .memory: String(localized: "Memory")
        case .advanced: String(localized: "Advanced")
        }
    }

    var systemImage: String {
        switch self {
        case .details: "info.circle"
        case .instructions: "text.alignleft"
        case .memory: "brain"
        case .advanced: "slider.horizontal.3"
        }
    }

    static func available(access: RoomInfoAccess, gate: SurfaceGate) -> [RoomInfoTab] {
        var tabs: [RoomInfoTab] = [.details, .instructions]
        if access.memory { tabs.append(.memory) }
        if access.manages, gate.scope != .sidecar { tabs.append(.advanced) }
        return tabs
    }
}

/// Working folder (`RoomWorkingFolder`): where every bot in the group runs
/// its shell and file tools. Fixed once the room pinned it on a first turn.
struct RoomFolderSection: View {
    let room: Room
    let editable: Bool
    @EnvironmentObject private var session: Session
    @State private var draft: String?
    @State private var saving = false

    var body: some View {
        let locked = room.pinnedCwd != nil
        Section {
            if locked || !editable {
                Text(verbatim: (locked ? room.pinnedCwd : room.cwd) ?? String(localized: "Each bot’s own folder"))
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("room-folder-value")
            } else {
                TextField(String(localized: "Each bot’s own folder, or an absolute path"), text: Binding(
                    get: { draft ?? room.cwd ?? "" },
                    set: { draft = $0 }
                ))
                .font(.footnote.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(save)
                .accessibilityIdentifier("room-folder-field")
                Button(String(localized: "Save"), action: save)
                    .disabled(saving || draft == nil)
                    .accessibilityIdentifier("room-folder-save")
            }
        } header: {
            Text(String(localized: "Working folder"))
        } footer: {
            Text(locked
                 ? String(localized: "Fixed for this thread after its first turn. Start a new thread to work somewhere else.")
                 : String(localized: "Where every bot in this group runs its shell and file tools."))
        }
    }

    private func save() {
        guard let value = draft else { return }
        saving = true
        Task {
            if await session.setRoomFolder(room, cwd: value) { draft = nil }
            saving = false
        }
    }
}

/// The room's turn limit (#216, ConversationTurnLimit.tsx): left the chat
/// header for the room settings' Advanced tab. Default (the server's), 30,
/// 60 or 120 minutes, and a value set elsewhere stays listed.
struct RoomTurnLimitSection: View {
    let room: Room
    @EnvironmentObject private var session: Session
    @State private var globalMinutes = 5
    @State private var saved: Int?

    static let presets = [30, 60, 120]

    private var current: Int? {
        if room.dm == true { return room.turnTimeoutMinutes }
        return room.tasks?.first { $0.threadId == room.threadId }?.turnTimeoutMinutes
    }

    var body: some View {
        let value = saved ?? current
        let options = Self.presets + (value.map { Self.presets.contains($0) ? [] : [$0] } ?? [])
        Section {
            Picker(String(localized: "Turn limit"), selection: Binding<Int>(
                get: { value ?? 0 },
                set: { minutes in
                    let next = minutes == 0 ? nil : minutes
                    saved = next
                    Task {
                        do { try await session.settingsClient?.setRoomTurnLimit(room: room, minutes: next) }
                        catch { session.actionError = error.localizedDescription }
                    }
                }
            )) {
                Text(String(localized: "Default (\(globalMinutes) min)")).tag(0)
                ForEach(options, id: \.self) { minutes in
                    Text(String(localized: "\(minutes) min")).tag(minutes)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("room-turn-limit")
        } header: {
            Text(String(localized: "Turn limit"))
        } footer: {
            Text(String(localized: "How long a bot may keep working in this conversation before the turn stops. Default uses the group turn limit in Settings. A new choice applies to the next turn."))
        }
        .task {
            if let minutes = try? await session.settingsClient?.desktopSettingsConfig().rooms?.turnTimeoutMinutes { globalMinutes = minutes }
        }
    }
}
