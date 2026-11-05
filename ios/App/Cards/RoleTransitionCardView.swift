// Visible roles (2026-11-05, #2016): the inline "Agit comme" card at a role
// transition (RoleTransitionCard.tsx), on the shared QuestionSheet like the
// other asks. It says who switches from which role to which, why (a read
// refused with 403, or the bot's own switch) and on whose behalf. Continue
// keeps going; Stay puts the thread back in the previous role; Always (the
// bot's owner only, `canAlways`) saves a rule on the bot's Permissions page.
// Answered on its own route, never as a typed reply; once settled the card
// stays with the pick marked and the answer under it.
import CompanionCore
import SwiftUI

struct RoleTransitionCardView: View {
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session
    @Environment(\.desktopChatText) private var desktop
    /// The pick sent while the server settles the card.
    @State private var sending: RoleTransitionChoice?

    var body: some View {
        if let card = message.card, let transition = card.roleTransition {
            let words = StepWords.app
            let colors = QuestionSheetColors(desktop: desktop)
            let answered = VisibleRoles.settledChoice(card)
            let settled = answered != nil || card.answered != nil
            let choices = VisibleRoles.choices(transition, words: words, opaque: VisibleRoles.appOpaque)
            QuestionSheet(colors: colors, title: VisibleRoles.transitionTitle(transition, words: words, opaque: VisibleRoles.appOpaque)) {
                Text(verbatim: VisibleRoles.transitionText(transition, words: words, opaque: VisibleRoles.appOpaque))
                    .font(colors.font(13))
                    .foregroundStyle(colors.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("role-transition-text")
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(choices.enumerated()), id: \.offset) { position, entry in
                        QuestionSheetRow(
                            colors: colors, index: position, label: entry.label,
                            on: (answered ?? sending) == entry.choice,
                            settled: settled, disabled: sending != nil
                        ) { pick(entry.choice, transition: transition) }
                        .accessibilityIdentifier("role-transition-\(entry.choice.rawValue)")
                    }
                }
                if let answered {
                    QuestionSheetNote(colors: colors, text: VisibleRoles.answeredText(answered, card: transition, words: words, opaque: VisibleRoles.appOpaque))
                }
            }
            .accessibilityIdentifier("role-transition-\(message.id)")
        }
    }

    private func pick(_ choice: RoleTransitionChoice, transition: RoleTransitionCard) {
        guard sending == nil, message.card?.answered == nil, transition.choice == nil else { return }
        sending = choice
        Task {
            // kept until the server's patch settles the card; a failure frees it
            if await !session.answerRoleTransition(chat: chat, message: message, choice: choice) { sending = nil }
        }
    }
}

extension Session {
    /// An "Agit comme" card answered on its own route
    /// (`POST /api/bots/:botId/cards/:messageId/role-transition`); the
    /// server patches the card with the choice.
    @discardableResult
    func answerRoleTransition(chat: Chat, message: Message, choice: RoleTransitionChoice) async -> Bool {
        guard let transition = message.card?.roleTransition else { return false }
        var sent = false
        await perform {
            try await $0.answerRoleTransition(botId: transition.botId, messageId: message.id, threadId: chat.threadId, choice: choice)
            sent = true
        }
        return sent
    }
}
