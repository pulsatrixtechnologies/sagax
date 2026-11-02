// The option card (approvals and plain options). Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import UIKit

/// An option card. When it still has a request behind it, this is the
/// screen the companion exists for — a bot stopped, and only a person can
/// let it continue.
struct CardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session
    @State private var answering = false
    /// iPad desktop shell: ApprovalCard.tsx for a permission ask.
    @Environment(\.desktopChatText) private var desktop

    /// The option this card offers that means "go ahead".
    ///
    /// Deliberately not the literal string "Allow". `options` is whatever the
    /// harness sent, and it only falls back to ["Allow", "Deny"] when the
    /// provider event named no choices of its own (`server/index.ts`) — a card
    /// is free to say "Yes", "Approve", "Allow once". Answering with a string
    /// the card never offered writes the grant and then hands the harness a
    /// choice it can reject, so the bot stays stopped with nothing on screen
    /// to explain it. The conventional label wins when it is present, which
    /// keeps the ordinary permission card behaving exactly as before.
    private var allowChoice: String? {
        guard let options = message.card?.options else { return nil }
        return options.first { $0.caseInsensitiveCompare("Allow") == .orderedSame }
            ?? options.first { !Self.isRefusal($0) }
    }

    /// One definition of "the refusal", shared by the button tint and the
    /// choice above so the two cannot drift apart.
    private static func isRefusal(_ option: String) -> Bool { OptionCard.isRefusal(option) }

    private var tint: Color { MausPalette.color(chat.color) }

    /// A permission ask is answered in the approval dock above the composer
    /// (PendingApproval.tsx). The card stays in the transcript only while
    /// it is waiting. Allowed, denied and expired asks leave the chat.
    private var answeredInDock: Bool { message.card?.isPermission == true }

    /// A finished permission ask the engine closed on its own, or one put
    /// away, is not drawn (`approvalCardStaysInChat`). Questions are not this.
    private var settledPermission: Bool {
        guard answeredInDock, let card = message.card, !card.isPending else { return false }
        return !ApprovalReceiptRules.staysInChat(card)
    }

    /// Issue #426: a plain tool ask (not a proposal) is one line in the
    /// thread, while it waits on the dock and once answered or expired.
    private var toolAsk: Bool {
        guard answeredInDock, let card = message.card else { return false }
        return !ApprovalDockRules.isProposal(card)
    }

    /// A first-run quiz goes once picked, dismissed or talked past.
    private var hidden: Bool {
        OptionCardRules.hidesOnboardingCard(message, in: session.state.visibleTranscript(forThread: chat.threadId))
    }

    var body: some View {
        if settledPermission {
            EmptyView()
        } else if toolAsk, let card = message.card, !hidden {
            if card.isPending {
                ApprovalWaitingLine(message: message, card: card, waiting: waitingLine(card), accent: Theme.readable(tint))
            } else {
                ApprovalReceiptRow(chat: chat, message: message, card: card)
            }
        } else if let desktop, let card = message.card, !hidden, answeredInDock {
            DesktopPermissionCard(chat: chat, message: message, card: card, theme: desktop, waiting: waitingLine(card))
        } else if let card = message.card, !hidden {
            VStack(alignment: .leading, spacing: 10) {
                if card.isPending && !answeredInDock {
                    Label("\(chat.name) is waiting on you", systemImage: "hand.raised.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                }
                HStack(alignment: .top, spacing: 8) {
                    Text(cardTitle(card))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.attentionText)
                        .fixedSize(horizontal: false, vertical: true)
                    if canDismiss(card) {
                        Spacer(minLength: 4)
                        // OptionCard.tsx's X: a quiz is put away, a live
                        // question declined (never denied).
                        Button {
                            Haptics.selection()
                            answering = true
                            Task {
                                await session.dismissOptionCard(message, in: chat)
                                answering = false
                            }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.attentionSecondary)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(answering)
                        .accessibilityLabel(Text("Dismiss"))
                        .accessibilityIdentifier("card-dismiss-\(message.id)")
                    }
                }
                if !card.subtitle.isEmpty, AllowRuleText.savedRule(card) == nil {
                    Text(card.subtitle)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.attentionSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let skill = card.skillRequest {
                    if let preview = skill.preview, let sha256 = skill.reviewedSha256 {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text("Review the complete SKILL.md")
                                    .font(.system(size: 12, weight: .semibold))
                                Spacer()
                                Text("sha256 \(String(sha256.prefix(8)))")
                                    .font(Theme.mono(10))
                                    .foregroundStyle(Theme.attentionSecondary)
                            }
                            Text(skill.source.map { LocalizedStringKey("Source: \($0)") } ?? "Source: unknown")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.attentionSecondary)
                                .textSelection(.enabled)
                            ScrollView(.vertical) {
                                Text(preview)
                                    .font(Theme.mono(12))
                                    .foregroundStyle(Theme.attentionText)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 220)
                            .padding(10)
                            .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10))
                        }
                    } else {
                        Label(
                            "This proposal was created by an older build and cannot be safely applied. Deny it and ask the bot to create it again.",
                            systemImage: "exclamationmark.shield"
                        )
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.warning)
                    }
                }

                if let held = ApprovalWords.held(card) {
                    Text(verbatim: held)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.attentionSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("approval-held-note")
                }

                if card.isPending && answeredInDock {
                    Label(waitingLine(card), systemImage: "checkmark.shield")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.attentionSecondary)
                        .accessibilityIdentifier("card-waiting-\(message.id)")
                } else if card.isPending {
                    HStack(spacing: 8) {
                        ForEach(card.options, id: \.self) { option in
                            Button {
                                Haptics.selection()
                                answering = true
                                Task {
                                    await session.answer(chat: chat, card: card, choice: option)
                                    answering = false
                                }
                            } label: {
                                Text(option)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Self.isRefusal(option) ? Theme.attentionText : .white)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 40)
                                    .background(
                                        Capsule().fill(Self.isRefusal(option) ? Theme.cardRaised : Theme.readable(tint))
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(
                                answering ||
                                    (card.skillRequest != nil && !Self.isRefusal(option) &&
                                        card.skillRequest?.reviewedSha256 == nil)
                            )
                        }
                    }
                    .padding(.top, 2)

                } else if answeredInDock, let found = ApprovalOutcome.of(card) {
                    // 2026-10-28: an Always allow reads as allowed; the kept
                    // rule shows in its inset below, never on the line
                    let outcome: ApprovalOutcome = found == .alwaysAllowed && ApprovalReceiptRules.isQuiet(card) ? .allowed : found
                    Label(Self.outcomeText(outcome), systemImage: outcome == .allowed || outcome == .alwaysAllowed || card.answered == "allow" ? "checkmark.circle" : "xmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.attentionSecondary)
                        .accessibilityIdentifier("card-outcome-\(message.id)")
                } else if let answered = card.answeredText ?? card.answered {
                    Label(answered, systemImage: "checkmark.circle")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.attentionSecondary)
                }
                if let rule = AllowRuleText.savedRule(card) {
                    AllowRuleInset(rule: rule, botId: AllowRuleInset.botId(of: message, in: chat), accent: Theme.readable(tint))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(card.isPending ? Theme.attentionSurface : Theme.card)
                    .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(card.isPending ? tint.opacity(0.08) : Color.clear))
            )
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(card.isPending ? tint : .clear, lineWidth: 1.5)
            }
        }
    }

    /// A kept Always-allowed card reads as the dock did ("Quasar wants to
    /// run a command", in the app's language); every other card its title.
    private func cardTitle(_ card: OptionCard) -> String {
        guard let rule = AllowRuleText.savedRule(card) else { return card.title }
        let action = AllowRuleText.action(of: rule) ?? .of(tool: card.tool)
        let name = message.from?.name ?? chat.name
        return String(localized: "\(name) wants to \(ApprovalDock.phrase(action))")
    }

    /// The X shows on a card still open that the dock does not own.
    private func canDismiss(_ card: OptionCard) -> Bool {
        !answeredInDock && card.answered == nil && card.dismissed != true && card.expired != true
    }

    private func waitingLine(_ card: OptionCard) -> String {
        if card.adminApproval == true && !session.answersServerCards {
            return String(localized: "This command runs on the server: waiting for an admin to approve it.")
        }
        if ApprovalDockRules.isProposal(card) { return String(localized: "Waiting for your confirmation below") }
        // 2026-10-28: an "Ask first" rule held it: the line names the rule
        if let rule = ApprovalReceiptRules.heldByRule(card) {
            let label = rule.org
                ? String(localized: "approval.waiting.orgRule", defaultValue: "Paused by your organization's \"Ask first\" rule")
                : String(localized: "approval.waiting.ownRule", defaultValue: "Paused by your \"Ask first\" rule")
            guard let words = rule.words, !words.isEmpty else { return label }
            return "\(label) « \(words) »"
        }
        return String(localized: "Waiting for your approval")
    }

    static func outcomeText(_ outcome: ApprovalOutcome) -> String {
        switch outcome {
        case .expired: String(localized: "Expired. Ask for a fresh proposal")
        case .allowed: String(localized: "Allowed")
        case .alwaysAllowed: String(localized: "approval.outcome.alwaysAllowed", defaultValue: "Always allowed")
        case .denied: String(localized: "Denied")
        case .cancelled: String(localized: "Cancelled")
        case .routineScheduled: String(localized: "Routine scheduled")
        case .routineCreatedPaused: String(localized: "Paused routine created")
        case .routineUpdated: String(localized: "Routine updated")
        case .routinePaused: String(localized: "Routine paused")
        case .routineResumed: String(localized: "Routine resumed")
        case .routineRunQueued: String(localized: "Routine run queued")
        case .routineDeleted: String(localized: "Routine deleted")
        case .skillEnabled: String(localized: "Skill enabled")
        case .skillUpdated: String(localized: "Skill updated")
        case .profileUpdated: String(localized: "Profile updated")
        case .ruleUpdated: String(localized: "Approval rule saved")
        case .teamSetupApplied: String(localized: "Team setup applied")
        case .botDeleted: String(localized: "Bot deleted")
        }
    }
}
