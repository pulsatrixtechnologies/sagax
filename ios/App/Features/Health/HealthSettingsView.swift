// Settings > Health ("Santé", iPhone and iPad): which Apple Health categories
// the person's own bots may read, and which they may add. Each switch opens
// the HealthKit permission sheet for that category; nothing is read or
// written before that, and a bot is offered the health tools only while a
// switch is on. Shared settings components only (card, row, label, footer),
// like the neighbouring Privacy and security page. The choice stays on this
// phone. The rules are CompanionCore's (Health.swift), the HealthKit calls
// HealthKitStore's.
import CompanionCore
import SwiftUI

struct HealthSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @State private var choice = HealthChoiceStore().load()
    @State private var message: String?

    var body: some View {
        SettingsPage(title: "Health") {
            SettingsSectionLabel(text: "health.read.title")
            SettingsCard {
                ForEach(Array(HealthCategory.allCases.enumerated()), id: \.element) { index, category in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(
                        title: Self.name(category),
                        systemImage: Self.symbol(category),
                        accessory: .toggle(Binding(
                            get: { choice.read.contains(category) },
                            set: { on in Task { await setRead(category, on) } }
                        )),
                        identifier: "health-read-\(category.rawValue)"
                    )
                }
            }
            SettingsFooter(text: "health.read.footer")

            SettingsSectionLabel(text: "health.write.title")
            SettingsCard {
                let writable = HealthCategory.allCases.filter(\.canWrite)
                ForEach(Array(writable.enumerated()), id: \.element) { index, category in
                    if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(
                        title: Self.writeName(category),
                        systemImage: Self.symbol(category),
                        accessory: .toggle(Binding(
                            get: { choice.write.contains(category) },
                            set: { on in Task { await setWrite(category, on) } }
                        )),
                        identifier: "health-write-\(category.rawValue)"
                    )
                }
            }
            SettingsFooter(text: "health.write.footer")

            if let message {
                SettingsFooter(text: LocalizedStringKey(message))
                    .accessibilityIdentifier("health-message")
            }
        }
    }

    // MARK: Changes

    private func setRead(_ category: HealthCategory, _ on: Bool) async {
        message = nil
        if on {
            do {
                try await HealthKitStore.shared.requestAccess(read: [category], write: [])
            } catch {
                message = "health.error.sheet"
                return
            }
        }
        choice.setRead(category, on)
        commit()
    }

    private func setWrite(_ category: HealthCategory, _ on: Bool) async {
        message = nil
        if on {
            do {
                try await HealthKitStore.shared.requestAccess(read: [], write: [category])
            } catch {
                message = "health.error.sheet"
                return
            }
            // Health tells a refused write: the switch stays off
            guard HealthKitStore.shared.canWrite(category) else {
                message = "health.error.writeDenied"
                choice.setWrite(category, false)
                commit()
                return
            }
        }
        choice.setWrite(category, on)
        commit()
    }

    /// Saved on this phone, and the server hears at once which tools are on.
    private func commit() {
        HealthChoiceStore().save(choice)
        Haptics.selection()
        Task { await PhoneToolCenter.shared.register() }
    }

    // MARK: Words and icons

    static func name(_ category: HealthCategory) -> LocalizedStringKey {
        let key = "health.category." + category.rawValue
        return LocalizedStringKey(key)
    }

    static func writeName(_ category: HealthCategory) -> LocalizedStringKey {
        category == .workouts ? "health.category.workout_notes" : name(category)
    }

    static func symbol(_ category: HealthCategory) -> String {
        switch category {
        case .sleep: "bed.double"
        case .steps: "figure.walk"
        case .exercise: "flame"
        case .heartRate: "heart"
        case .restingHeartRate: "heart.circle"
        case .hrv: "waveform.path.ecg"
        case .mindfulMinutes: "brain.head.profile"
        case .water: "drop"
        case .weight: "scalemass"
        case .workouts: "figure.run"
        }
    }
}
