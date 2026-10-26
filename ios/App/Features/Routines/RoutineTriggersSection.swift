// Triggers already on the computer (parity T5, T6). The phone can read the
// public URL, the last delivery and turn one on or off. Creating, rotating
// and the signing secret stay on the paired computer.
import CompanionCore
import SwiftUI

struct RoutineTriggersSection: View {
    let hooks: [WebhookListing]
    let baseURL: String?
    let busyId: String?
    let onToggle: (WebhookListing) -> Void

    var body: some View {
        Section {
            if hooks.isEmpty {
                Label("Computer only", systemImage: "lock.desktopcomputer")
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(hooks) { hook in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: title(hook))
                                .font(.body)
                            Text(verbatim: detail(hook))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer(minLength: 8)
                        Toggle("Enabled", isOn: Binding(
                            get: { hook.enabled },
                            set: { _ in onToggle(hook) }
                        ))
                        .labelsHidden()
                        .disabled(busyId != nil)
                        .accessibilityIdentifier("trigger-enabled.\(hook.id)")
                    }
                    if !hook.sourceFilters.isEmpty {
                        Text(verbatim: hook.sourceFilters)
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    if let url = WebhookPublicURL.make(baseURL: baseURL, endpointId: hook.endpointId, typed: hook.sourceType != nil) {
                        Text(verbatim: url)
                            .font(.caption.monospaced())
                            .foregroundStyle(Theme.textSecondary)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("trigger-url.\(hook.id)")
                    }
                    Text(delivery(hook))
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                    if hook.signingSecretSet {
                        Text("Signing secret stays on the computer")
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("trigger-row.\(hook.id)")
            }
        } header: {
            Text("Triggers")
        } footer: {
            Text("Creating or rotating a webhook changes an internet-reachable trigger and signing secret, so webhook management remains on the paired computer. Webhook run receipts still appear in Run logs.")
        }
    }

    /// A brand as written; bot email (not a brand) in the app's language.
    private static func sourceName(_ type: String) -> String {
        type == "botmail" ? String(localized: "Bot email") : WebhookPublicURL.sourceLabel(type)
    }

    private func title(_ hook: WebhookListing) -> String {
        if !hook.name.isEmpty { return hook.name }
        if let type = hook.sourceType, !type.isEmpty { return Self.sourceName(type) }
        return String(localized: "Webhook")
    }

    private func detail(_ hook: WebhookListing) -> String {
        guard let type = hook.sourceType, !type.isEmpty else { return String(localized: "Webhook") }
        let label = Self.sourceName(type)
        if hook.sourceEvents.isEmpty { return "\(label) · \(String(localized: "Every event"))" }
        let events = hook.sourceEvents.map { kind in
            WebhookPublicURL.eventLabel(kind).map { String(localized: String.LocalizationValue($0)) } ?? kind
        }
        return "\(label) · \(events.joined(separator: ", "))"
    }

    private func delivery(_ hook: WebhookListing) -> String {
        let count = hook.deliveryCount == 1
            ? String(localized: "1 delivery")
            : String(localized: "\(hook.deliveryCount) deliveries")
        guard let at = hook.lastReceivedAt else {
            return "\(count) · \(String(localized: "No delivery yet"))"
        }
        let when = Date(timeIntervalSince1970: at / 1_000).formatted(date: .abbreviated, time: .shortened)
        return "\(count) · \(String(localized: "Last delivery")) \(when)"
    }
}
