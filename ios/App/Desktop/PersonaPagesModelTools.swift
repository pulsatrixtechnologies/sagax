// Edit bot > Model, Permissions, Voice (iPad, round 4 of the parity sweep): ModelSection.tsx, PermissionsSection.tsx, VoiceSection.tsx.
import SwiftUI
import CompanionCore

/// Model (bot-settings/ModelSection.tsx).
struct PersonaModelPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .model)
    }
}

/// Permissions (bot-settings/PermissionsSection.tsx).
struct PersonaPermissionsPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .permissions)
    }
}

/// Voice (bot-settings/VoiceSection.tsx).
struct PersonaVoicePage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .voice)
    }
}

