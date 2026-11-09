// A section this viewer may not change (iPad Edit bot): the desktop
// BotProfilePage `botSectionLock` block. A locked section is still a card,
// its label then the reason as a Note row (lock icon, 14 px secondary,
// min-h 44); Personality also shows the soul as it is, read-only
// (`data-persona-readonly`: inset, 13 px secondary, max 420 px tall).
import CompanionCore
import SwiftUI

struct PersonaLockedSection: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let section: DesktopPanelSection
    let lock: LocalizedStringKey

    @State private var soul = ""

    var body: some View {
        DesktopSettingsGroup(Text(section.localizedTitle), identifier: "bot-profile-locked-\(section.rawValue)") {
            Label { Text(lock) } icon: { Image(systemName: "lock") }
                .font(theme.font(14))
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 16)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("persona-locked.\(section.rawValue)")
            if section == .soul, !soul.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ScrollView {
                    Text(verbatim: soul)
                        .font(theme.font(13))
                        .foregroundStyle(theme.inkSecondary)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(maxHeight: 420)
                .fixedSize(horizontal: false, vertical: true)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 6)
                .accessibilityIdentifier("persona-locked.soul.readonly")
            }
        }
        .task(id: bot.id) {
            guard section == .soul else { return }
            #if DEBUG
            if session.profileClient == nil, let preview = UserDefaults.standard.string(forKey: "previewSoul") {
                soul = preview
                return
            }
            #endif
            guard let client = session.profileClient else { return }
            soul = (try? await client.soul(botId: bot.id).soul) ?? ""
        }
    }
}
