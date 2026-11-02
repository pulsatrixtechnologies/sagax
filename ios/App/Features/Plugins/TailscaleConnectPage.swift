// Connect apps > Tailscale on the phone: same states as the desktop
// TailscaleConnectView (setup → join → waiting → connected). Sagax words only.
import CompanionCore
import SwiftUI

@MainActor
final class TailscaleConnectModel: ObservableObject {
    @Published private(set) var view: BotTailscaleView?
    @Published private(set) var loading = true
    @Published var busy = false
    @Published var message: String?
    @Published var mode: BotTailscaleCredKind = .authKey
    @Published var authKey = ""
    @Published var clientId = ""
    @Published var clientSecret = ""
    @Published var computerId = ""
    @Published var keyKind: BotTailscaleKeyKind = .ephemeral

    private var pollTask: Task<Void, Never>?

    func load(_ session: Session) async {
        guard let client = session.settingsClient else {
            loading = false
            message = String(localized: "This connection cannot manage Tailscale right now.")
            return
        }
        do {
            apply(try await client.botTailscale())
        } catch {
            message = error.localizedDescription
        }
        loading = false
        syncPolling(session)
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func apply(_ next: BotTailscaleView) {
        view = next
        if computerId.isEmpty, let first = next.computers.first {
            computerId = first.id
        }
    }

    private func syncPolling(_ session: Session) {
        pollTask?.cancel()
        guard let view, view.shouldPoll, let client = session.settingsClient else {
            pollTask = nil
            return
        }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                guard !Task.isCancelled else { return }
                if let next = try? await client.refreshBotTailscale() {
                    await MainActor.run {
                        self?.apply(next)
                        if !(self?.view?.shouldPoll ?? false) {
                            self?.pollTask?.cancel()
                        }
                    }
                }
            }
        }
    }

    private func run(_ session: Session, _ work: (CompanionClient) async throws -> BotTailscaleView) async {
        guard let client = session.settingsClient else { return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            apply(try await work(client))
            authKey = ""
            clientSecret = ""
            syncPolling(session)
        } catch {
            message = error.localizedDescription
        }
    }

    func save(_ session: Session) async {
        let setup: BotTailscaleSetup
        switch mode {
        case .authKey:
            setup = .authKey(authKey)
        case .oauth:
            setup = .oauth(clientId: clientId, clientSecret: clientSecret)
        }
        await run(session) { try await $0.setupBotTailscale(setup) }
    }

    func join(_ session: Session) async {
        let id = computerId.isEmpty ? (view?.computers.first?.id ?? "") : computerId
        guard !id.isEmpty else { return }
        await run(session) { try await $0.joinBotTailscale(computerId: id, keyKind: keyKind) }
    }

    func disconnect(_ session: Session) async {
        await run(session) { try await $0.disconnectBotTailscale() }
    }

    func forget(_ session: Session) async {
        await run(session) { try await $0.clearBotTailscale() }
    }

    var canSave: Bool {
        switch mode {
        case .authKey: authKey.trimmingCharacters(in: .whitespacesAndNewlines).count > 12
        case .oauth:
            !clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !clientSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

struct TailscaleConnectPage: View {
    var onLeave: () -> Void = {}
    @EnvironmentObject private var session: Session
    @StateObject private var model = TailscaleConnectModel()

    var body: some View {
        List {
            if model.loading && model.view == nil {
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                }
            }
            if let message = model.message {
                Section {
                    Text(verbatim: message)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("tailscale-message")
                }
            }
            if let view = model.view {
                subtitle(view)
                switch view.phase {
                case .disconnected:
                    setupCard
                case .ready, .error:
                    joinCard(view)
                case .pendingApproval, .joining:
                    waitingCard(view)
                case .connected:
                    connectedCard(view)
                }
                if let error = view.error, view.phase == .error {
                    Section {
                        Text(verbatim: error)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(String(localized: "Tailscale"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("tailscale-connect-page")
        .task {
            await model.load(session)
        }
        .onDisappear {
            model.stop()
            onLeave()
        }
    }

    @ViewBuilder
    private func subtitle(_ view: BotTailscaleView) -> some View {
        Section {
            Text(verbatim: phaseSubtitle(view))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("tailscale-subtitle")
        }
    }

    private var setupCard: some View {
        Section {
            Picker(String(localized: "How to connect"), selection: $model.mode) {
                Text(String(localized: "Auth key")).tag(BotTailscaleCredKind.authKey)
                Text(String(localized: "OAuth client")).tag(BotTailscaleCredKind.oauth)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("tailscale-mode")

            if model.mode == .authKey {
                SecureField(String(localized: "Auth key"), text: $model.authKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("tailscale-auth-key")
                Text(String(localized: "Prefer a tagged key for tag:sagax. Ephemeral keys leave the tailnet when the computer stops."))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                TextField(String(localized: "Client ID"), text: $model.clientId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("tailscale-client-id")
                SecureField(String(localized: "Client secret"), text: $model.clientSecret)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("tailscale-client-secret")
                Text(String(localized: "The OAuth client must be allowed to create auth keys with tag:sagax."))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }

            Button {
                Task { await model.save(session) }
            } label: {
                HStack {
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                    else { Text(String(localized: "Save and continue")) }
                    Spacer()
                }
            }
            .disabled(model.busy || !model.canSave)
            .accessibilityIdentifier("tailscale-save")
        } header: {
            Text(String(localized: "Connect Tailscale"))
        } footer: {
            Text(String(localized: "Paste an auth key, or an OAuth client that can mint tagged keys. Sagax keeps them sealed in your vault."))
        }
    }

    private func joinCard(_ view: BotTailscaleView) -> some View {
        Section {
            if !view.computers.isEmpty {
                Picker(String(localized: "Bot computer"), selection: $model.computerId) {
                    ForEach(view.computers) { computer in
                        Text(verbatim: computer.label).tag(computer.id)
                    }
                }
                .accessibilityIdentifier("tailscale-computer")
            }
            Picker(String(localized: "Auth request"), selection: $model.keyKind) {
                Text(String(localized: "Ephemeral")).tag(BotTailscaleKeyKind.ephemeral)
                Text(String(localized: "Reusable")).tag(BotTailscaleKeyKind.reusable)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("tailscale-key-kind")

            Button {
                Task { await model.join(session) }
            } label: {
                HStack {
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                    else { Text(String(localized: "Join tailnet")) }
                    Spacer()
                }
            }
            .disabled(model.busy || (model.computerId.isEmpty && view.computers.isEmpty))
            .accessibilityIdentifier("tailscale-join")

            Button(String(localized: "Forget credentials"), role: .destructive) {
                Task { await model.forget(session) }
            }
            .disabled(model.busy)
            .accessibilityIdentifier("tailscale-forget")
        } header: {
            Text(String(localized: "Choose a bot computer"))
        } footer: {
            Text(String(localized: "Pick which computer joins your tailnet, and whether the auth request is ephemeral or reusable."))
        }
    }

    private func waitingCard(_ view: BotTailscaleView) -> some View {
        Section {
            HStack(spacing: 10) {
                ProgressView()
                Text(String(localized: "Waiting for admin approval"))
                    .font(.body.weight(.semibold))
            }
            Text(String(localized: "Approve this device in the Tailscale admin console. Sagax will update when it is on the tailnet."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            if let device = view.device {
                LabeledContent(String(localized: "Device"), value: device.name)
                    .accessibilityIdentifier("tailscale-waiting-device")
            }
            Button(String(localized: "Disconnect"), role: .destructive) {
                Task { await model.disconnect(session) }
            }
            .disabled(model.busy)
            .accessibilityIdentifier("tailscale-disconnect")
        }
    }

    private func connectedCard(_ view: BotTailscaleView) -> some View {
        Section {
            if let device = view.device {
                LabeledContent(String(localized: "Device"), value: device.name)
                    .accessibilityIdentifier("tailscale-device-name")
                LabeledContent(
                    String(localized: "Tailnet IPs"),
                    value: device.addresses.isEmpty
                        ? String(localized: "No address yet")
                        : device.addresses.joined(separator: ", ")
                )
                .accessibilityIdentifier("tailscale-device-ips")
            }
            if let computer = view.computer {
                LabeledContent(String(localized: "Bot computer"), value: computer.label)
            }
            Button(String(localized: "Disconnect"), role: .destructive) {
                Task { await model.disconnect(session) }
            }
            .disabled(model.busy)
            .accessibilityIdentifier("tailscale-disconnect")
        } header: {
            Label(String(localized: "Connected"), systemImage: "checkmark.circle.fill")
                .foregroundStyle(Theme.success)
        }
    }

    private func phaseSubtitle(_ view: BotTailscaleView) -> String {
        switch view.phase {
        case .connected:
            if let device = view.device {
                let ips = device.addresses.joined(separator: " · ")
                if ips.isEmpty {
                    return String(format: String(localized: "%@ is on your tailnet."), device.name)
                }
                return String(format: String(localized: "%@ is on your tailnet · %@"), device.name, ips)
            }
            return String(localized: "Connected")
        case .pendingApproval, .joining:
            return String(localized: "Waiting for a tailnet admin to approve this device.")
        case .ready:
            let kind = view.credentials?.kind == .oauth
                ? String(localized: "OAuth client")
                : String(localized: "Auth key")
            let hint = view.credentials?.hint ?? "saved"
            return String(
                format: String(localized: "Ready with %@ (%@). Choose which bot computer joins, then wait for a tailnet admin to approve it."),
                kind,
                hint
            )
        case .error:
            return String(localized: "Something went wrong. Fix the issue below, or disconnect and try again.")
        case .disconnected:
            return String(localized: "Store a Tailscale auth key or OAuth client so your bot computer can join your tailnet. Secrets stay sealed and are never shown again.")
        }
    }
}
