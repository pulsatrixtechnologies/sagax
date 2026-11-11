// What the person hid from their sidebar (matrix row SB25), and the thread
// switch (SB10): Settings > Appearance (SidebarHiddenSettings.tsx,
// SettingsModal ShowThreadsRow). Settings is the one place that lists the
// hidden entries with Show; the sidebar and the home list draw nothing for
// them (#3576), and search still finds them.
import CompanionCore
import SwiftUI
import UIKit

/// Settings > Appearance: on iPad the sidebar density, the thread switch, then the hidden entries with
/// Show and whether a new message brings one back.
private func freshTopicLabel(_ hours: Int) -> String {
    hours == 0 ? String(localized: "Never") : String(localized: "\(hours) h")
}

struct SidebarAppearanceSettings: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    /// iPad I2: the desktop sidebar's density, on this device.
    @AppStorage(PrefKey.desktopSidebarDensity) private var desktopDensity = DesktopSidebarDensity.comfortable.rawValue
    @AppStorage(SidebarLogoPreference.key) private var showSidebarLogo = SidebarLogoPreference.defaultEnabled
    /// One conversation per bot: how long away (or quiet) before coming back
    /// opens a fresh topic (CompanionCore/FreshTopic.swift).
    @AppStorage(FreshTopic.afterKey) private var freshTopicAfter = String(FreshTopic.defaultHours)

    var body: some View {
        let rows = session.state.sidebarHiddenRows(prefs.prefs.hidden)
        if UIDevice.current.userInterfaceIdiom == .pad {
            SettingsSectionLabel(text: "Sidebar")
            SettingsCard {
                densityRow("Comfortable", .comfortable, subtitle: "Avatars, titles and the last message.")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                densityRow("Compact", .compact, subtitle: "One line per bot.")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                densityRow("Avatars only", .icons, subtitle: "The sidebar folds to a rail of avatars.")
            }
            if SidebarLogoRuntime.showsSetting {
                SettingsCard {
                    SettingsRow(
                        title: "Sidebar logo",
                        subtitle: "Show the Sagax logo and name at the top of the sidebar.",
                        accessory: .toggle($showSidebarLogo),
                        identifier: "settings.sidebarLogo"
                    )
                }
            }
        }
        SettingsSectionLabel(text: "Threads")
        SettingsCard {
            SettingsRow(
                title: "Show threads",
                subtitle: "Thread lists, their controls and thread receipts in the chat. Off: one conversation per bot, as on your computer.",
                accessory: .toggle(Binding(
                    get: { prefs.showThreads },
                    set: { prefs.setShowThreads(session, $0) }
                )),
                identifier: "settings.showThreads"
            )
            if !prefs.showThreads {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                Menu {
                    Picker(selection: $freshTopicAfter) {
                        ForEach(FreshTopic.choices, id: \.self) { hours in
                            Text(freshTopicLabel(hours)).tag(String(hours))
                        }
                    } label: { EmptyView() }
                } label: {
                    SettingsRow(
                        title: "New topic on return",
                        subtitle: "Coming back to a bot after this long opens a new, empty topic. The bot keeps all of the history.",
                        accessory: .valueChevron(freshTopicLabel(FreshTopic.parseAfter(freshTopicAfter))),
                        identifier: "settings.freshTopicAfter"
                    )
                }
                .buttonStyle(.plain)
            }
        }
        // #210: one place at a time, this device only; off while threads are off
        SettingsSectionLabel(text: "Threads location")
        SettingsCard {
            threadsLocationRow("In the chat header", .header)
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            threadsLocationRow("In the sidebar", .sidebar)
        }
        .disabled(!prefs.showThreads)
        .opacity(prefs.showThreads ? 1 : 0.45)
        SettingsFooter(text: "Where threads and folders live: the chat header or under each bot in the list, never both. This device only.")
        SettingsSectionLabel(text: "Hidden from the sidebar")
        SettingsCard {
            if rows.isEmpty {
                SettingsRow(title: "Nothing hidden. Long-press a bot, a group or a person to hide it; it stays in search.")
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                HStack(spacing: 8) {
                    Text(verbatim: row.name)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(kindLabel(row.kind))
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                    Button {
                        Haptics.selection()
                        prefs.show(session, [row.key])
                    } label: {
                        Label("Show", systemImage: "eye")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.accentText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Show \(row.name) in the sidebar"))
                    .accessibilityIdentifier("settings-hidden-show.\(row.key)")
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
            }
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Show people again when they write",
                subtitle: "A hidden person or group comes back when a new message arrives, so a colleague is never missed.",
                accessory: .toggle(Binding(
                    get: { prefs.prefs.hidden.unhidePeople },
                    set: { prefs.setUnhide(session, people: $0) }
                )),
                identifier: "settings.unhidePeople"
            )
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(
                title: "Show bots again when they post",
                subtitle: "Off by default: bots post on their own (routines, reports), so a bot you hid would come back at every run.",
                accessory: .toggle(Binding(
                    get: { prefs.prefs.hidden.unhideBots },
                    set: { prefs.setUnhide(session, bots: $0) }
                )),
                identifier: "settings.unhideBots"
            )
        }
        .task(id: session.connection?.id) { await prefs.load(session) }
    }

    private func densityRow(_ title: LocalizedStringKey, _ value: DesktopSidebarDensity, subtitle: String) -> some View {
        Button {
            Haptics.selection()
            desktopDensity = value.rawValue
        } label: {
            SettingsRow(
                title: title,
                subtitle: subtitle,
                accessory: desktopDensity == value.rawValue ? .check : .none,
                identifier: "settings.sidebarDensity.\(value.rawValue)"
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(desktopDensity == value.rawValue ? .isSelected : [])
    }

    private func threadsLocationRow(_ title: LocalizedStringKey, _ value: ThreadsLocation) -> some View {
        let chosen = prefs.threadsLocation == value
        return Button {
            Haptics.selection()
            prefs.setThreadsLocation(value)
        } label: {
            SettingsRow(title: title, accessory: chosen ? .check : .none, identifier: "settings.threadsLocation.\(value.rawValue)")
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private func kindLabel(_ kind: HiddenKind) -> LocalizedStringKey { hiddenKindLabel(kind) }
}

/// What a hidden entry is, as Settings > Appearance names it (the phone's
/// list and the iPad's, one wording).
func hiddenKindLabel(_ kind: HiddenKind) -> LocalizedStringKey {
    switch kind {
    case .bot: "Bot"
    case .group: "Group"
    case .person: "Person"
    }
}
