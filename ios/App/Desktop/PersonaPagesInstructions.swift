// Edit bot > Personality, Skills (iPad, round 4 of the parity sweep): SoulSection.tsx, SkillsSection.tsx.
import SwiftUI
import CompanionCore

/// Personality (bot-settings/SoulSection.tsx).
struct PersonaPersonalityPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .soul)
    }
}

/// Skills (bot-settings/SkillsSection.tsx).
struct PersonaSkillsPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .skills)
    }
}

