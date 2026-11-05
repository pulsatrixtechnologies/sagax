// iPad final sweep (2026-11-03): the Team map's Computers shelf, the
// desktop's CanvasComputers.tsx: a 300 pt column at the right of the canvas
// (the Computers button toggles it): the intro, Connect Boat when no Boat
// account is connected, New cloud computer (its name, the cost note), then
// a card per computer: its state, the team it serves (assigning asks first),
// Start / retry, Sleep, Open desktop (bot control paused while you use it)
// and Return to bots, Local VM and other computers… at the foot. A card is
// dragged onto a team card of the canvas, as on the desktop.
import SwiftUI
import CompanionCore

struct DesktopTeamComputers: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    let sections: [(key: String, name: String)]
    /// A computer dropped on a team card of the canvas.
    @Binding var drop: (id: String, section: String)?
    /// New cloud computer from the page's Add menu.
    var createRequest: Int
    let close: () -> Void

    @State private var inventory: TeamComputers?
    @State private var loading = false
    @State private var error = ""
    @State private var busy: String?
    @State private var creating = false
    @State private var name = ""
    @State private var requestId = UUID().uuidString
    @State private var assignment: (computer: TeamComputer, section: String?)?
    @State private var viewer: (id: String, url: URL)?
    @State private var heldHere: String?
    private let leaseId = UUID().uuidString

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                DesktopIconView(icon: .monitor, size: 16).foregroundStyle(theme.inkSecondary)
                Text("Computers").font(theme.font(13, .semibold)).foregroundStyle(theme.ink)
                Spacer()
                iconButton("arrow.clockwise", Text("Refresh computers")) { error = ""; Task { await refresh() } }
                    .disabled(loading || busy != nil)
                    .rotationEffect(.degrees(loading ? 360 : 0))
                iconButton("xmark", Text("Close computers"), action: close)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Drag a computer onto a team, or choose its team below. Bots on Auto will use it.")
                        .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    if let problem = error.isEmpty ? inventory?.problem : error {
                        Text(verbatim: problem).font(theme.font(12)).foregroundStyle(theme.danger)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    if let inventory, !inventory.configured {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Connect your Boat account before creating a cloud computer.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                            control(Text("Connect Boat"), bordered: true, action: settings)
                        }
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    }
                    if creating { createForm } else {
                        Button { creating = true } label: {
                            HStack(spacing: 8) { Image(systemName: "plus").font(.system(size: 12)); Text("New cloud computer") }
                                .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                                .frame(maxWidth: .infinity).frame(height: 44)
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        }
                        .buttonStyle(.plain)
                        .disabled(busy != nil)
                        .accessibilityIdentifier("team-computers.new")
                    }
                    ForEach(inventory?.computers ?? []) { computer in card(computer) }
                }
                .padding(16)
            }
            Button(action: settings) {
                Text("Local VM and other computers…").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).frame(height: 36)
            }
            .buttonStyle(.plain)
            .padding(12)
            .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
        }
        .frame(width: 300)
        .background(theme.panel)
        .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.5)).frame(width: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Team computers"))
        .accessibilityIdentifier("team-computers")
        .task {
            await refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if busy == nil { await refresh() }
            }
        }
        .onValueChange(of: createRequest) { _ in creating = true }
        .onValueChange(of: drop?.id ?? "") { _ in
            guard let drop, let computer = inventory?.computers.first(where: { $0.id == drop.id }) else { return }
            request(computer, section: drop.section)
            self.drop = nil
        }
        .confirmationDialog(assignTitle, isPresented: Binding(get: { assignment != nil }, set: { if !$0 { assignment = nil } }), titleVisibility: .visible) {
            Button(assignment?.section == nil ? String(localized: "Unassign computer") : String(localized: "Assign computer")) {
                guard let target = assignment else { return }
                assignment = nil
                viewer = nil
                mutate(target.computer.id) { try await $0.assignTeamComputer(id: target.computer.id, section: target.section) }
            }
        } message: {
            Text(assignment?.section == nil
                 ? "This removes the team default. It does not stop or delete the machine, its files, or its logins. Review the bots' Auto routing before their next task."
                 : "Bots on Auto in this team will share this computer's files and signed-in accounts. Explicit bot computer settings stay unchanged. Only one bot can use the desktop at a time.")
        }
        .onDisappear {
            // a control lease this shelf took must not outlive it
            if let held = heldHere, let client = session.settingsClient {
                Task { try? await client.teamComputerAction(id: held, "control", body: ["action": "release", "controlLeaseId": leaseId]) }
            }
        }
    }

    private var assignTitle: String {
        guard let assignment else { return "" }
        let name = assignment.computer.name
        guard let section = assignment.section else { return String(format: String(localized: "Unassign %@?"), name) }
        return String(format: String(localized: "Assign %@ to %@?"), name, section.isEmpty ? String(localized: "General") : section)
    }

    private var createForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("New cloud computer").font(theme.font(12, .medium)).foregroundStyle(theme.ink)
            TextField(text: $name, prompt: Text("e.g. Engineering desktop").foregroundColor(theme.inkTertiary)) { Text("New cloud computer") }
                .font(theme.font(12)).padding(.horizontal, 12).frame(height: 34)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                .disabled(busy != nil)
                .accessibilityIdentifier("team-computers.name")
            Text("Creates a cloud computer in your connected boat.dev account. Your Boat plan and usage charges apply. It stays unassigned until you choose a team.")
                .font(theme.font(11)).foregroundStyle(theme.inkSecondary)
            HStack(spacing: 4) {
                Spacer()
                control(Text("Cancel")) { creating = false }.disabled(busy != nil)
                Button {
                    let value = String(name.trimmingCharacters(in: .whitespaces).prefix(60))
                    guard !value.isEmpty else { return }
                    mutate("create", { try await $0.createTeamComputer(name: value, requestId: requestId) }) {
                        name = ""; creating = false; requestId = UUID().uuidString
                    }
                } label: {
                    HStack(spacing: 6) {
                        if busy == "create" { ProgressView().controlSize(.mini) }
                        Text("Create cloud computer")
                    }
                    .font(theme.font(12, .medium)).foregroundStyle(theme.accentInk)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(inventory?.configured != true || name.trimmingCharacters(in: .whitespaces).isEmpty || busy != nil)
                .opacity(inventory?.configured != true || name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.4 : 1)
            }
        }
        .padding(12)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
    }

    private func card(_ computer: TeamComputer) -> some View {
        let heldNow = heldHere == computer.id
        let held = computer.held || heldNow
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "shippingbox").font(.system(size: 16)).foregroundStyle(theme.inkSecondary)
                    .frame(width: 36, height: 36).background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: computer.name).font(theme.font(13, .medium)).foregroundStyle(theme.ink).lineLimit(1)
                    Text("Cloud computer · \(busy == computer.id ? String(localized: "Updating…") : computer.state)")
                        .font(theme.font(11)).foregroundStyle(theme.inkSecondary)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .draggable(TeamComputerDrag.payload(computer.id))
            .accessibilityLabel(Text("Drag \(computer.name) to a team"))
            if let problem = computer.problem { Text(verbatim: problem).font(theme.font(11)).foregroundStyle(theme.danger) }
            Menu {
                Button { request(computer, section: nil) } label: { Text("Not assigned") }
                ForEach(sections.filter { computer.section == nil || $0.key == computer.section }, id: \.key) { section in
                    Button { request(computer, section: section.key) } label: { Text(verbatim: section.name) }
                }
            } label: {
                HStack {
                    Text(verbatim: computer.section.map { key in sections.first { $0.key == key }?.name ?? key } ?? String(localized: "Not assigned"))
                        .font(theme.font(12)).foregroundStyle(theme.ink)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9)).foregroundStyle(theme.inkTertiary)
                }
                .padding(.horizontal, 12).frame(height: 34)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
            }
            .disabled(busy != nil)
            .accessibilityLabel(Text("Team for \(computer.name)"))
            .accessibilityIdentifier("team-computers.team.\(computer.id)")
            if computer.section != nil {
                Text("Unassign to move to another team.").font(theme.font(10)).foregroundStyle(theme.inkSecondary)
            }
            HStack(spacing: 4) {
                if !computer.ready && !computer.starting {
                    control(Text("Start / retry")) { mutate(computer.id) { try await $0.teamComputerAction(id: computer.id, "provision", body: ["acknowledgeCost": true]) } }
                        .disabled(busy != nil || held)
                        .accessibilityHint(Text("Starts this cloud computer; your provider's usage charges apply"))
                }
                if computer.ready && !held {
                    control(Text("Sleep")) { mutate(computer.id) { try await $0.teamComputerAction(id: computer.id, "sleep") } }.disabled(busy != nil)
                }
                if computer.ready {
                    control(Text("Open desktop"), icon: "arrow.up.right") {
                        mutate(computer.id, {
                            try await $0.teamComputerAction(id: computer.id, "control", body: ["action": "take", "controlLeaseId": leaseId])
                            heldHere = computer.id
                            let join = try await $0.teamComputerAction(id: computer.id, "join")
                            if let raw = join.joinUrl, raw.hasPrefix("https://"), let url = URL(string: raw) { viewer = (computer.id, url) }
                        })
                    }
                    .disabled(busy != nil)
                    .accessibilityHint(Text("Pauses bot control while you use the desktop"))
                }
                if heldNow {
                    control(Text("Return to bots"), tint: theme.accent) {
                        mutate(computer.id, { try await $0.teamComputerAction(id: computer.id, "control", body: ["action": "release", "controlLeaseId": leaseId]) }) {
                            heldHere = nil; viewer = nil
                        }
                    }
                    .disabled(busy != nil)
                }
                if computer.held && !heldNow {
                    control(Text("In use")) {}.disabled(true).accessibilityHint(Text("Another viewer has paused bot control on this desktop"))
                }
            }
            if let viewer, viewer.id == computer.id {
                Link(destination: viewer.url) {
                    Text("Open secure desktop ↗").font(theme.font(12)).foregroundStyle(theme.accent)
                }
            }
        }
        .padding(12)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .accessibilityIdentifier("team-computers.card.\(computer.id)")
    }

    private func control(_ label: Text, icon: String? = nil, bordered: Bool = false, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                label
                if let icon { Image(systemName: icon).font(.system(size: 9, weight: .semibold)) }
            }
            .font(theme.font(12)).foregroundStyle(tint ?? theme.inkSecondary)
            .padding(.horizontal, 12).frame(height: 32)
            .overlay { if bordered { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1) } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    private func iconButton(_ symbol: String, _ label: Text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(theme.inkSecondary).frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func settings() {
        close()
        shell.settingsSection = .computer
        shell.modal = .settings
    }

    /// `requestAssignment`: a computer on a team leaves it before another.
    private func request(_ computer: TeamComputer, section: String?) {
        guard busy == nil, computer.section != section else { return }
        if let current = computer.section, section != nil {
            error = String(format: String(localized: "Unassign %@ from %@ before moving it to another team. Its files and signed-in accounts stay on the computer."),
                           computer.name, current.isEmpty ? String(localized: "General") : current)
            return
        }
        error = ""
        assignment = (computer, section)
    }

    private func refresh() async {
        guard let client = session.settingsClient else { return }
        loading = true
        defer { loading = false }
        do { inventory = try await client.teamComputers(); if busy == nil { error = "" } }
        catch { self.error = error.localizedDescription }
    }

    private func mutate(_ key: String, _ action: @escaping (CompanionClient) async throws -> Void, then: (() -> Void)? = nil) {
        guard busy == nil, let client = session.settingsClient else { return }
        busy = key
        error = ""
        Task {
            do { try await action(client); then?() } catch { self.error = error.localizedDescription }
            busy = nil
            await refresh()
        }
    }
}

/// A computer card dragged onto a team card (`data-computer-drag-id`): a
/// plain string payload the canvas recognises by its prefix.
enum TeamComputerDrag {
    static let prefix = "sagax-team-computer:"
    static func payload(_ id: String) -> String { prefix + id }
    static func id(_ payload: String) -> String? { payload.hasPrefix(prefix) ? String(payload.dropFirst(prefix.count)) : nil }
}
