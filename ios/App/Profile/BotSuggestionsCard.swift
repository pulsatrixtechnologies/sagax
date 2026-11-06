// The bot panel's Suggestions card (src/components/bot-settings/
// SuggestionsSection.tsx): next steps for this bot, from its setup checklist
// (GET /api/bots/:id/overview `setup`) and the conversations waiting on the
// person (CompanionCore/BotSuggestions.swift). "Hide" turns it off for every
// bot on every device (`sagax.showSuggestions.v1`); Settings > Appearance >
// Show suggestions brings it back. Nothing to suggest: no card at all.
import CompanionCore
import SwiftUI

struct BotSuggestionsCard: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    let bot: Bot
    let run: (BotSuggestion.Action) -> Void

    @State private var setup: [BotSetupStep]?

    private var items: [BotSuggestion] {
        BotSuggestions.suggestions(setup: setup, tasks: bot.tasks, waiting: bot.waitingApprovals)
    }

    var body: some View {
        Group {
            if prefs.showSuggestions, !items.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Suggested")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                        Spacer()
                        Button("Hide") {
                            Haptics.selection()
                            prefs.setShowSuggestions(session, false)
                        }
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("panel-suggestions-hide")
                    }
                    .padding(.horizontal, 4)
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { CardHairline(leadingInset: 16) }
                            Button {
                                Haptics.selection()
                                run(item.action)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "sparkles")
                                        .foregroundStyle(Theme.accentText)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(LocalizedStringKey(item.title))
                                            .font(Theme.Font.body)
                                            .foregroundStyle(Theme.textPrimary)
                                        Text(subtitle(item))
                                            .font(Theme.Font.label)
                                            .foregroundStyle(Theme.textSecondary)
                                    }
                                    Spacer(minLength: 8)
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(Theme.chevron)
                                }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("panel-suggestion.\(item.id)")
                        }
                    }
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
        .task(id: bot.id) {
            setup = (try? await session.settingsClient?.overview(botId: bot.id))?.setup
        }
    }

    private func subtitle(_ item: BotSuggestion) -> String {
        let format = String(localized: String.LocalizationValue(item.subtitle))
        guard let argument = item.argument else { return format }
        return String(format: format, argument)
    }
}
