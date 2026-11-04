// Edit bot > Bot folder, Access (iPad, round 4 of the parity sweep): WorkspaceFilesSection.tsx, AccessSection.tsx.
import SwiftUI
import CompanionCore

/// Bot folder (bot-settings/WorkspaceFilesSection.tsx). `replacesStack`:
/// true once this view draws the whole page (the window then stops
/// drawing the phone's file list with the memory under it).
struct PersonaBotFolderPage: View {
    static let replacesStack = false
    let bot: Bot
    let slackURL: URL?
    let memory: Bool

    var body: some View {
        BotDocsList(bot: bot)
    }
}

/// Access (bot-settings/AccessSection.tsx).
struct PersonaAccessPage: View {
    let bot: Bot
    let slackURL: URL?

    var body: some View {
        BotPanelMore(bot: bot, slackURL: slackURL, only: .access)
    }
}

