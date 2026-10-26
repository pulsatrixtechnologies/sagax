// Scheduled update of the bot's computer (parity R7, O2): the desktop's
// Settings > Computer > Scheduled update, from the phone. On or off, the
// days, the hour, the next window and how the last one went. Each change is
// saved at once (PUT /api/computer/maintenance); a refusal puts the last
// saved schedule back.
import CompanionCore
import SwiftUI

struct ComputerMaintenanceSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var maintenance: ComputerMaintenance?
    @State private var draft: MaintenanceSchedule?
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        Group {
            if let draft {
                card(draft)
            }
        }
        .task { await load() }
        .alert("Scheduled update", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: failure ?? "")
        }
    }

    private func card(_ schedule: MaintenanceSchedule) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsCard {
                SettingsRow(
                    title: "Scheduled update",
                    subtitle: summary(schedule),
                    accessory: .toggle(Binding(get: { schedule.enabled }, set: { on in save { $0.enabled = on } })),
                    height: 74,
                    identifier: "computer-maintenance"
                )
                if schedule.enabled {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    days(schedule)
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    hourRow(schedule)
                }
                if let result = maintenance?.lastResult {
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                    SettingsRow(title: "Last update", accessory: .value(resultText(result)), height: 45, identifier: "computer-maintenance-last")
                }
            }
            .disabled(saving || maintenance?.running == true)
            SettingsFooter(text: "Updates the computer in this window when no Bot is using it. Files and logins stay.")
        }
    }

    private func days(_ schedule: MaintenanceSchedule) -> some View {
        let symbols = Calendar.current.veryShortWeekdaySymbols
        return HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let on = schedule.days.contains(day)
                Button {
                    Haptics.selection()
                    save { $0 = $0.toggling(day: day) }
                } label: {
                    Text(verbatim: symbols.indices.contains(day) ? symbols[day] : "\(day)")
                        .font(Theme.Font.label.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .foregroundStyle(on ? Color.white : Theme.textPrimary)
                        .background(Capsule().fill(on ? Theme.blue : Theme.hairline.opacity(0.6)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: Calendar.current.weekdaySymbols[day]))
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("computer-maintenance-day.\(day)")
            }
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 10)
    }

    private func hourRow(_ schedule: MaintenanceSchedule) -> some View {
        HStack {
            Text("Starts at")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            Picker("Starts at", selection: Binding(get: { schedule.hour }, set: { hour in save { $0.hour = hour } })) {
                ForEach(0..<24, id: \.self) { hour in
                    Text(verbatim: hourLabel(hour)).tag(hour)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .accessibilityIdentifier("computer-maintenance-hour")
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .frame(minHeight: 45)
    }

    private func hourLabel(_ hour: Int) -> String {
        var parts = DateComponents()
        parts.hour = hour
        parts.minute = 0
        let date = Calendar.current.date(from: parts) ?? Date()
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func summary(_ schedule: MaintenanceSchedule) -> String {
        if maintenance?.running == true { return String(localized: "Updating now…") }
        guard schedule.enabled else { return String(localized: "Off. Update the computer yourself when you choose.") }
        guard let next = maintenance?.nextWindow, maintenance?.schedule == schedule else {
            return String(localized: "On")
        }
        let when = next.formatted(.dateTime.weekday(.wide).hour().minute())
        return String(localized: "Next update: \(when)")
    }

    private func resultText(_ result: MaintenanceResult) -> String {
        switch result.outcome {
        case .updated: String(localized: "Updated")
        case .postponed: String(localized: "Missed: a Bot was using it")
        case .failed: String(localized: "Failed")
        case .unknown: "—"
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do {
            let loaded = try await client.computerMaintenance()
            maintenance = loaded
            draft = loaded.editable()
        } catch {
            // No computer to schedule here (a refusal or an older server): no section.
            maintenance = nil
            draft = nil
        }
    }

    private func save(_ change: (inout MaintenanceSchedule) -> Void) {
        guard var next = draft, let client = session.settingsClient else { return }
        let previous = draft
        change(&next)
        next = next.normalized
        guard next != previous else { return }
        draft = next
        saving = true
        Task {
            do {
                let saved = try await client.setComputerMaintenance(next)
                maintenance = saved
                draft = saved.schedule.normalized
            } catch {
                draft = previous
                failure = error.localizedDescription
            }
            saving = false
        }
    }
}
