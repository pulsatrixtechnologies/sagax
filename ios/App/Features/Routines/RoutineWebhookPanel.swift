// A webhook routine's own webhook, where the routine is (2026-10-29): in the
// editor's When section and on the routine's page. Its status and
// deliveries, the address to POST to, the key and the Authorization header
// masked until the owner shows them, Copy, a curl example and Regenerate.
// Desktop: src/components/routines/RoutineWebhookPanel.tsx; the rules are
// CompanionCore's RoutineWebhook. The key lives in this view's memory only.
import CompanionCore
import SwiftUI

struct RoutineWebhookPanel: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    /// Nil: a routine not saved yet (its webhook comes with the save).
    let routine: Routine?
    let bot: Bot?
    /// The routine after "Create its webhook".
    var onRoutineChanged: (Routine) -> Void = { _ in }

    @State private var webhooks: [WebhookListing] = []
    @State private var ingress: WebhookIngress?
    @State private var loaded = false
    /// Lot 5: list load failed (Grok Bot shows Try again + this phrase).
    @State private var loadError: String?
    @State private var token: String?
    @State private var shown = false
    @State private var working: Working?
    @State private var copied: String?
    @State private var error: String?
    @State private var confirmingRotate = false

    private enum Working { case reveal, rotate, create }

    /// Only the bot's owner sees the key, the eye and Regenerate; anyone
    /// else who sees the routine reads the address.
    private var manage: Bool {
        guard let bot else { return false }
        return !session.surfaceGate.botsReadOnly && session.surfaceGate.ownsBot(bot)
    }

    private var webhook: WebhookListing? { RoutineWebhook.webhook(for: routine?.id, in: webhooks) }

    var body: some View {
        Group {
            if routine == nil {
                note(String(localized: "The address and the key appear once the routine is saved."))
                    .accessibilityIdentifier("routine-webhook-new")
            } else if let loadError = loadError {
                // Lot 5 / Grok Bot: error + Try again when the webhook list
                // cannot be read.
                VStack(alignment: .leading, spacing: 10) {
                    Button {
                        Task { await load() }
                    } label: {
                        Text("Try again")
                            .font(Theme.Font.bodyMedium)
                            .foregroundStyle(Theme.accentText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("routine-webhook-try-again")
                    Text(verbatim: loadError)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .accessibilityIdentifier("routine-webhook-load-error")
                }
            } else if let webhook {
                panel(webhook)
            } else if loaded {
                missing
            } else {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task(id: routine?.id) { await load() }
        .confirmationDialog(String(localized: "Regenerate the key?"), isPresented: $confirmingRotate, titleVisibility: .visible) {
            Button(String(localized: "Regenerate the key"), role: .destructive) { Task { await fetchKey(.rotate) } }
        } message: {
            Text("The current key stops working immediately, so every sender using it must be updated.")
        }
    }

    // MARK: Pieces

    private func note(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var missing: some View {
        VStack(alignment: .leading, spacing: 8) {
            note(String(localized: "This routine has no webhook yet."))
            if manage {
                Button {
                    Task { await create() }
                } label: {
                    HStack(spacing: 6) {
                        if working == .create { ProgressView().controlSize(.small) } else { Image(systemName: "point.3.connected.trianglepath.dotted") }
                        Text("Create its webhook")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(working != nil)
                .accessibilityIdentifier("routine-webhook-create")
            }
            errorLine
        }
        .accessibilityIdentifier("routine-webhook-missing")
    }

    private func panel(_ webhook: WebhookListing) -> some View {
        let url = RoutineWebhook.url(baseURL: ingress?.baseUrl, webhook: webhook) ?? "/hooks/"
        let keyText = shown ? (token ?? RoutineWebhook.masked(tokenLast4: webhook.tokenLast4)) : RoutineWebhook.masked(tokenLast4: webhook.tokenLast4)
        return VStack(alignment: .leading, spacing: 10) {
            statusLine(webhook)
            VStack(spacing: 0) {
                row(String(localized: "POST to"), value: url, id: "url") {
                    copyButton("url", url, String(localized: "Copy the address"))
                }
                Divider()
                row(String(localized: "Key"), value: keyText, id: "key") {
                    if manage { eye(webhook) }
                    if manage, let token { copyButton("key", token, String(localized: "Copy the key")) }
                }
                Divider()
                row(String(localized: "Header"), value: RoutineWebhook.header(keyText), id: "header") {
                    if manage, let token { copyButton("header", RoutineWebhook.header(token), String(localized: "Copy the header")) }
                }
            }
            .padding(.horizontal, 10)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.textSecondary.opacity(0.25), lineWidth: 1))
            HStack(spacing: 12) {
                Button {
                    copy("curl", RoutineWebhook.curl(url: url, token: token))
                } label: {
                    Label(copied == "curl" ? String(localized: "Copied") : String(localized: "Copy a curl example"),
                          systemImage: copied == "curl" ? "checkmark" : "terminal")
                }
                .accessibilityIdentifier("routine-webhook-curl")
                if manage {
                    Button {
                        confirmingRotate = true
                    } label: {
                        HStack(spacing: 6) {
                            if working == .rotate { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
                            Text("Regenerate the key")
                        }
                    }
                    .foregroundStyle(Theme.textSecondary)
                    .disabled(working != nil)
                    .accessibilityIdentifier("routine-webhook-rotate")
                }
            }
            .buttonStyle(.borderless)
            .font(.footnote.weight(.medium))
            if token == nil {
                note(String(localized: "The example uses <key> until you show the key."))
            }
            if let ingress, !ingress.available {
                Text("The webhook receiver is unavailable.")
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
            }
            errorLine
        }
        .accessibilityIdentifier("routine-webhook")
    }

    private func statusLine(_ webhook: WebhookListing) -> some View {
        let status = RoutineWebhook.status(webhook)
        let on = status != .paused
        var parts = [webhook.deliveryCount == 1 ? String(localized: "1 delivery") : String(localized: "\(webhook.deliveryCount) deliveries")]
        if let at = webhook.lastReceivedAt {
            let when = Date(timeIntervalSince1970: at / 1_000).formatted(date: .abbreviated, time: .shortened)
            parts.append(String(localized: "last \(when)"))
        }
        return HStack(spacing: 6) {
            Circle().fill(on ? Theme.accent : Theme.textSecondary.opacity(0.5)).frame(width: 6, height: 6)
            Text(verbatim: Self.statusLabel(status))
                .fontWeight(.medium)
                .foregroundStyle(on ? Theme.accentText : Theme.textSecondary)
            Text(verbatim: "· " + parts.joined(separator: " · "))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("routine-webhook-status")
    }

    static func statusLabel(_ status: RoutineWebhook.Status) -> String {
        switch status {
        case .waiting: String(localized: "Waiting for test")
        case .ready: String(localized: "Ready to enable")
        case .active: String(localized: "Active")
        case .paused: String(localized: "Paused")
        }
    }

    private func row<Trailing: View>(_ label: String, value: String, id: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 8) {
            Text(verbatim: label)
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 64, alignment: .leading)
            Text(verbatim: value)
                .font(.caption.monospaced())
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
                .accessibilityIdentifier("routine-webhook-\(id)")
            trailing()
        }
        .frame(minHeight: 40)
    }

    private func eye(_ webhook: WebhookListing) -> some View {
        let open = shown && token != nil
        let label = open
            ? String(localized: "Hide the key")
            : webhook.tokenPending || token != nil ? String(localized: "Show the key") : String(localized: "Show a new key (the current one stops working)")
        return Button {
            if token != nil { shown.toggle(); return }
            switch RoutineWebhook.keyAction(webhook) {
            case .reveal: Task { await fetchKey(.reveal) }
            case .rotate: confirmingRotate = true
            }
        } label: {
            if working == .reveal { ProgressView().controlSize(.small) } else { Image(systemName: open ? "eye.slash" : "eye") }
        }
        .buttonStyle(.borderless)
        .frame(width: 32, height: 32)
        .disabled(working != nil)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityIdentifier("routine-webhook-eye")
    }

    private func copyButton(_ kind: String, _ text: String, _ label: String) -> some View {
        Button {
            copy(kind, text)
        } label: {
            Image(systemName: copied == kind ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.borderless)
        .frame(width: 32, height: 32)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityIdentifier("routine-webhook-copy-\(kind)")
    }

    @ViewBuilder
    private var errorLine: some View {
        if let error {
            Text(verbatim: error)
                .font(.footnote)
                .foregroundStyle(Theme.danger)
        }
    }

    // MARK: Actions

    private func copy(_ kind: String, _ text: String) {
        PlatformBridge.copyToPasteboard(text)
        copied = kind
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if copied == kind { copied = nil }
        }
    }

    private func load() async {
        guard routine != nil else { return }
        loadError = nil
        if let list = await session.loadWebhooks() {
            webhooks = list.webhooks
            ingress = list.ingress
            loaded = true
        } else {
            loaded = true
            loadError = String(localized: "Couldn't load the webhook details.")
        }
    }

    private func fetchKey(_ action: RoutineWebhook.KeyAction) async {
        guard let webhook else { return }
        working = action == .reveal ? .reveal : .rotate
        error = nil
        defer { working = nil }
        do {
            let response = try await session.webhookKey(id: webhook.id, action: action)
            webhooks = webhooks.map { $0.id == response.webhook.id ? response.webhook : $0 }
            token = response.credential?.token
            shown = token != nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func create() async {
        guard let routine else { return }
        working = .create
        error = nil
        defer { working = nil }
        do {
            let updated = try await session.createRoutineWebhook(routine)
            onRoutineChanged(updated)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
