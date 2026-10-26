// Other computers (O5): the desktop's Settings > Computer > Other computers.
// Rename and remove call POST /api/me/desktop-bridge/computers/rename|remove.
// Remove stays disabled while the computer is online.
import CompanionCore
import SwiftUI

struct OtherComputersSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var computers: [PersonDesktop] = []
    @State private var loaded = false
    @State private var renaming: PersonDesktop?
    @State private var draft = ""
    @State private var removing: PersonDesktop?
    @State private var busy = false
    @State private var failure: String?

    var body: some View {
        Group {
            if loaded, !computers.isEmpty {
                computersCard
            }
        }
        .task { await reload() }
    }

    private var computersCard: some View {
        SettingsCard {
            ForEach(Array(computers.enumerated()), id: \.element.id) { index, desktop in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                row(desktop)
            }
        }
        .accessibilityIdentifier("other-computers")
        .alert("Rename this computer", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(String(localized: "Name"), text: $draft)
            Button(String(localized: "Save")) { Task { await rename() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        }
        .confirmationDialog(
            String(localized: "Remove \(removing?.name ?? "")?"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) { Task { await remove() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "It leaves your list of computers. This cannot be done while it is online."))
        }
        .alert(String(localized: "Other computers"), isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button(String(localized: "OK"), role: .cancel) {}
        } message: {
            Text(verbatim: failure ?? "")
        }
    }

    private func row(_ desktop: PersonDesktop) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: desktop.name?.isEmpty == false ? desktop.name! : String(localized: "Computer"))
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: seen(desktop))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 8)
                Button(String(localized: "Rename")) {
                    draft = desktop.name ?? ""
                    renaming = desktop
                }
                .disabled(busy)
                .accessibilityIdentifier("computer-rename.\(desktop.id ?? "")")
                Button(String(localized: "Remove"), role: .destructive) { removing = desktop }
                    .disabled(busy || desktop.online)
                    .accessibilityIdentifier("computer-remove.\(desktop.id ?? "")")
            }
            .buttonStyle(.borderless)
            .font(.footnote)
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("other-computer.\(desktop.id ?? "")")
    }

    private func seen(_ desktop: PersonDesktop) -> String {
        if desktop.online { return String(localized: "Connected") }
        let seconds = desktop.lastSeenAt > 10_000_000_000 ? desktop.lastSeenAt / 1000 : desktop.lastSeenAt
        let date = Date(timeIntervalSince1970: seconds)
        return String(localized: "Last seen \(date.formatted(date: .abbreviated, time: .shortened))")
    }

    func reload() async {
        guard let client = session.settingsClient else { loaded = true; return }
        if let bridge = try? await client.personDesktopBridge() {
            computers = OtherComputers.list(bridge.desktops)
        }
        loaded = true
    }

    private func rename() async {
        guard let desktop = renaming, let id = desktop.id, let client = session.settingsClient else { return }
        let next = draft
        renaming = nil
        guard OtherComputers.name(next) != nil else {
            failure = String(localized: "A computer's name is 1 to 120 characters.")
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await client.renameDesktopComputer(id: id, name: next)
            await reload()
        } catch let error as ComputerChangeFailure {
            failure = message(error.refusal)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func remove() async {
        guard let desktop = removing, let id = desktop.id, let client = session.settingsClient else { return }
        removing = nil
        busy = true
        defer { busy = false }
        do {
            try await client.removeDesktopComputer(id: id)
            await reload()
        } catch let error as ComputerChangeFailure {
            failure = message(error.refusal)
        } catch {
            failure = error.localizedDescription
        }
    }

    private func message(_ refusal: OtherComputerRefusal) -> String {
        switch refusal {
        case .online: String(localized: "A computer cannot be removed while it is online.")
        case .rate: String(localized: "Too many removals. Try again in a minute.")
        case .failed: String(localized: "That computer could not be changed.")
        }
    }
}
