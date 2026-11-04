// Edit bot > Identity, Changes, Usage (iPad, round 4 of the parity sweep): PersonaOverview.tsx, HistorySection.tsx, UsageSection.tsx.
import SwiftUI
import CompanionCore

/// Identity (persona/PersonaOverview.tsx).
struct PersonaIdentityPage: View {
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    var body: some View {
        PhoneBotIdentityFields(bot: bot) { model.personaPage = .appearance }
    }
}

/// Changes (bot-settings/HistorySection.tsx).
struct PersonaChangesPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .history)
    }
}

/// Usage (bot-settings/UsageSection.tsx).
struct PersonaUsagePage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .usage)
    }
}

