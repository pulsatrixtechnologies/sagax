// iPad I-sync: Settings > Usage > Plan usage (`PlanUsage.tsx`): each
// connected provider's remaining allowance (name 14 medium and the plan 12,
// then the 5-hour, weekly, extra and per-model windows: a 72 pt label, the
// headline "72% left · resets in 2h 30m" and a 6 pt meter in the usage
// tone). Since 2026-10-15 a provider in error or not signed in is not shown,
// and with none connected the card is not drawn at all. Refresh asks the providers again;
// a window whose reset has passed refreshes on its own (checked every 30 s).
import SwiftUI
import CompanionCore

struct DesktopPlanUsageCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session

    @State private var report: PlanUsageReport?
    @State private var loading = true
    @State private var now = Date()

    @EnvironmentObject private var shell: DesktopShellModel
    @State private var failed = false

    /// 2026-10-16: the group is always drawn under Cost; with no row it says
    /// why. 2026-10-30 (#1774): signed-out and error rows stay listed with
    /// Connect or Try again.
    var body: some View {
        let providers = report?.providers ?? []
        DesktopSettingsGroup(Text("Plan"), accessory: AnyView(refresh), identifier: "plan") {
            if providers.isEmpty {
                DesktopText(loading ? Text("Checking plan usage…")
                            : failed ? Text("Plan unavailable for this account.")
                            : Text("Connect a subscription (Claude, ChatGPT, Grok) to see its 5-hour and weekly limits."),
                            color: \.inkSecondary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
            }
            ForEach(providers) { provider in
                AnyView(providerView(provider))
                    .padding(.horizontal, 14).padding(.vertical, 10)
            }
        }
        .task(id: session.connection?.id) {
            await load(refresh: false)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = Date()
                if let report, !loading, PlanUsageRules.hasDueReset(report, now: now) { await load(refresh: true) }
            }
        }
    }

    private var refresh: some View {
        HStack {
            Spacer(minLength: 0)
            Button { Task { await load(refresh: true) } } label: {
                Group {
                    if loading { ProgressView().controlSize(.mini) } else { DesktopSettingsIconView(icon: .refreshCw, size: 13) }
                }
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Circle())
            }
            .buttonStyle(DesktopHoverFill(radius: 14))
            .disabled(loading)
            .accessibilityLabel(Text("Refresh"))
        }
    }

    private func providerView(_ provider: PlanUsageReport.Provider) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: provider.name).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                if let plan = provider.plan, !plan.isEmpty {
                    Text(verbatim: plan).font(theme.font(12)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                }
            }
            if provider.rowState == "signed-out" {
                VStack(alignment: .leading, spacing: 8) {
                    DesktopText(Text("Not signed in"), size: 12, line: 16, color: \.inkSecondary)
                    Button(String(format: AppStrings.localized("Connect %@"), provider.name)) { shell.settingsSection = .providers }
                        .buttonStyle(DesktopPillButtonStyle())
                        .accessibilityIdentifier("desktop-settings.plan-connect.\(provider.id)")
                }
            } else if provider.rowState == "error" {
                HStack(spacing: 12) {
                    DesktopText(verbatim: provider.error ?? AppStrings.localized("Could not load plan usage."), size: 12, line: 16, color: \.danger)
                    Button("Try again") { Task { await load(refresh: true) } }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12))
                }
            } else if provider.rowState == "no-windows" {
                DesktopText(Text("No plan windows for this provider"), size: 12, line: 16, color: \.inkSecondary)
            } else if provider.ok {
                AnyView(windowRow(String(localized: "5-hour"), provider.fiveHour))
                AnyView(windowRow(String(localized: "Weekly"), provider.weekly))
                ForEach(Array(provider.extra.enumerated()), id: \.offset) { _, extra in
                    AnyView(windowRow(label(extra.label), extra.window))
                }
                if let models = provider.models, !models.isEmpty {
                    Text("By model").font(theme.font(11, .medium)).tracking(0.9).textCase(.uppercase)
                        .foregroundStyle(theme.inkSecondary).padding(.top, 4)
                    ForEach(models, id: \.name) { model in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: model.name).font(theme.font(13, .medium)).foregroundStyle(theme.ink)
                            ForEach(Array(model.windows.enumerated()), id: \.offset) { _, entry in
                                AnyView(windowRow(label(entry.label), entry.window, usedHeadline: true))
                            }
                        }
                    }
                }
            }
        }
    }

    private func label(_ raw: String) -> String {
        switch raw {
        case "5-hour": String(localized: "5-hour")
        case "Weekly": String(localized: "Weekly")
        default: raw
        }
    }

    private func windowRow(_ label: String, _ window: PlanUsageReport.Window, usedHeadline: Bool = false) -> some View {
        let used = min(100, max(0, window.usedPercent ?? 0))
        let headline: String? = usedHeadline
            ? window.usedPercent.map { String(localized: "\(Int($0.rounded()))% used") }
            : window.remainingPercent.map { String(localized: "\(Int($0.rounded()))% left") }
        let when = window.available ? PlanUsageRules.resetDistance(window.resetsAt, now: now) : nil
        return HStack(alignment: .center, spacing: 12) {
            Text(verbatim: label).font(theme.font(12)).foregroundStyle(theme.inkSecondary).frame(width: 72, alignment: .leading)
            if window.available, let headline {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(verbatim: headline).font(theme.font(13)).monospacedDigit().foregroundStyle(theme.ink)
                        if let when {
                            Text("resets in \(when)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                        }
                    }
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(theme.inset)
                            Capsule().fill(tone(used)).frame(width: geometry.size.width * used / 100)
                        }
                    }
                    .frame(height: 6)
                    .accessibilityLabel(Text(verbatim: label))
                    .accessibilityValue(Text(verbatim: "\(Int(used.rounded()))%"))
                }
            } else {
                Text("Not reported by this plan").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
        }
    }

    private func tone(_ used: Double) -> Color {
        switch PlanUsageRules.tone(used: used) {
        case .danger: theme.danger
        case .warning: theme.warning
        case .success: theme.success
        }
    }

    private func load(refresh: Bool) async {
        guard let client = session.settingsClient else { loading = false; return }
        loading = true
        // A failed read shows nothing: the card keeps the last connected rows.
        if let next = try? await client.planUsage(refresh: refresh) {
            report = next
            now = Date()
            failed = false
        } else if report == nil {
            failed = true
        }
        loading = false
    }
}
