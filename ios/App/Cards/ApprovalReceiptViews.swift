// Issue #426 on the iPhone and the iPad (ApprovalCard.tsx, PendingApproval.tsx):
// the words of a teammate ask, the quiet held note, the transcript's line
// while an ask waits on the dock, and the one-line receipt it leaves once
// answered or expired. The iPad desktop shell passes its theme; the phone
// draws with the skin's own colours.
import CompanionCore
import SwiftUI

// MARK: - Words

@MainActor
enum ApprovalWords {
    /// The heading of a plain tool ask: a teammate ask names who it writes
    /// to; else the server's own phrase when it is in the reader's
    /// language (#1089); else the app's phrase for the tool.
    static func wantsTo(_ card: OptionCard, name: String, session: Session) -> String {
        if let ask = TeammateAsk.parse(card) { return teammateTitle(ask, name: name, session: session) }
        if let action = ApprovalReceiptRules.plainAction(card, language: Locale.preferredLanguages.first) {
            return String(localized: "\(name) wants to \(action)")
        }
        if let plain = ApprovalHeading.plainTitle(card) { return plain }
        let action: ApprovalToolAction
        if case let .wantsTo(kind) = ApprovalHeading.of(card) { action = kind } else { action = .useTool }
        return String(localized: "\(name) wants to \(ApprovalDock.phrase(action))")
    }

    static func teammateTitle(_ ask: TeammateAsk, name: String, session: Session) -> String {
        if ask.recipients.count == 1, let only = ask.recipients.first {
            return String(localized: "\(name) wants to write to \(recipient(only, session: session).name)")
        }
        return String(localized: "\(name) wants to write to \(ask.recipients.count) bots")
    }

    /// What was asked, as an action, for the receipt: "Write to 3 bots",
    /// "Run a command".
    static func target(_ card: OptionCard, session: Session) -> String {
        if let ask = TeammateAsk.parse(card) {
            if ask.recipients.count == 1, let only = ask.recipients.first {
                return String(localized: "Write to \(recipient(only, session: session).name)")
            }
            return String(localized: "Write to \(ask.recipients.count) bots")
        }
        let phrase: String
        if let action = ApprovalReceiptRules.plainAction(card, language: Locale.preferredLanguages.first) {
            phrase = action
        } else if case let .wantsTo(kind) = ApprovalHeading.of(card) {
            phrase = ApprovalDock.phrase(kind)
        } else {
            phrase = ApprovalDock.phrase(.useTool)
        }
        return phrase.prefix(1).uppercased() + phrase.dropFirst()
    }

    /// A recipient as the bot named it: the teammate by id or by name, its
    /// own name and face. An id that matches nobody is never shown as is.
    static func recipient(_ raw: String, session: Session) -> (name: String, bot: Bot?) {
        let key = raw.trimmingCharacters(in: .whitespaces)
        if let bot = session.state.bot(key) { return (bot.name, bot) }
        let bare = key.hasPrefix("@") ? String(key.dropFirst()) : key
        if let bot = session.state.bots.first(where: { $0.name.caseInsensitiveCompare(bare) == .orderedSame }) {
            return (bot.name, bot)
        }
        return (looksLikeId(bare) ? String(localized: "Unknown bot") : bare, nil)
    }

    static func looksLikeId(_ text: String) -> Bool {
        text.range(of: #"^(bot[_-])?[0-9a-fA-F-]{8,}$"#, options: .regularExpression) != nil
            || text.hasPrefix("bot_") || text.hasPrefix("bot-")
    }

    static func pill(_ pill: ApprovalPill) -> String {
        switch pill {
        case .expired: String(localized: "Expired")
        case .undone: String(localized: "Undone")
        case .alwaysAllowed: String(localized: "approval.outcome.alwaysAllowed", defaultValue: "Always allowed")
        case .alwaysDenied: String(localized: "Always denied")
        case .allowedOnce: String(localized: "Allowed once")
        case .declined: String(localized: "Declined")
        case .skipped: String(localized: "approval.pill.skipped", defaultValue: "Skipped")
        }
    }

    /// How it was answered when it was not a tap.
    static func via(_ card: OptionCard) -> String? {
        switch card.answeredBy?.via {
        case "call": String(localized: "by voice")
        case "ai-client": String(localized: "from an AI client")
        case "auto-review": String(localized: "by automatic review")
        case "primary-bot": String(localized: "via \(card.answeredBy?.bot ?? String(localized: "your Primary Bot"))")
        default: nil
        }
    }

    /// The held note in the app's words when it is a fixed one, else as the
    /// server sent it; nil when the card shows none.
    static func held(_ card: OptionCard) -> String? {
        guard ApprovalHeldNote.shows(card) else { return nil }
        switch card.heldCode {
        case "approval.held.outbound": return String(localized: "This sends something on your behalf. Allow it once, or always for this tool.")
        case "approval.held.sandbox": return String(localized: "This changes the provider sandbox, so only Full access can approve it automatically.")
        case "approval.held.undelivered": return String(localized: "Approve for me couldn't answer this one.")
        case "approval.held.undeliveredFull": return String(localized: "Full access couldn't deliver this approval.")
        case "approval.held.customRule": return String(localized: "Your rule asks you first for this.")
        case "approval.held.connectorNoDetails": return String(localized: "Grok did not share this call's details. Allow it only if you asked for it.")
        default: return card.held
        }
    }
}

// MARK: - Pieces

/// The colours a piece draws with: the iPad desktop theme, or the skin.
struct ApprovalInk {
    var ink: Color
    var secondary: Color
    var tertiary: Color
    var inset: Color
    var hairline: Color
    var accent: Color
    var success: Color
    var danger: Color
    var font: (CGFloat, Font.Weight) -> Font

    static func of(_ desktop: DesktopTheme?, accent: Color) -> ApprovalInk {
        if let desktop {
            return ApprovalInk(
                ink: desktop.ink, secondary: desktop.inkSecondary, tertiary: desktop.inkTertiary,
                inset: desktop.inset, hairline: desktop.hairline, accent: desktop.accent,
                success: desktop.success, danger: desktop.danger,
                font: { desktop.font($0, $1) }
            )
        }
        return ApprovalInk(
            ink: Theme.textPrimary, secondary: Theme.textSecondary, tertiary: Theme.textTertiary,
            inset: Theme.inset, hairline: Theme.hairline, accent: accent,
            success: Theme.success, danger: Theme.danger,
            font: { .system(size: $0, weight: $1) }
        )
    }
}

/// "To" and each recipient by face and name, never an id.
struct TeammateRecipientsView: View {
    @EnvironmentObject private var session: Session
    let ask: TeammateAsk
    let ink: ApprovalInk

    var body: some View {
        let people = ask.recipients.map { ApprovalWords.recipient($0, session: session) }
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { chips(people) }
            VStack(alignment: .leading, spacing: 4) { chips(people) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("approval-teammate-recipients")
    }

    @ViewBuilder
    private func chips(_ people: [(name: String, bot: Bot?)]) -> some View {
        ForEach(Array(people.enumerated()), id: \.offset) { _, person in
            HStack(spacing: 5) {
                if let bot = person.bot {
                    BotMascotView(bot: bot, size: 18, state: .idle, animated: false)
                        .frame(width: 18, height: 18)
                } else {
                    Image(systemName: "person.crop.circle")
                        .font(.system(size: 15))
                        .foregroundStyle(ink.tertiary)
                }
                Text(verbatim: person.name)
                    .font(ink.font(12.5, .medium))
                    .foregroundStyle(ink.ink)
                    .lineLimit(1)
            }
            .padding(.leading, 3)
            .padding(.trailing, 8)
            .padding(.vertical, 3)
            .background(ink.inset, in: Capsule())
        }
    }
}

/// The message a teammate ask sends, quoted, cut near 240 characters with
/// "See all".
struct TeammateQuoteView: View {
    let ask: TeammateAsk
    let ink: ApprovalInk
    @State private var all = false

    var body: some View {
        if !ask.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: all ? ask.message.trimmingCharacters(in: .whitespacesAndNewlines) : ask.quote)
                    .font(ink.font(13, .regular))
                    .foregroundStyle(ink.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(ink.hairline).frame(width: 2)
                    }
                    .accessibilityIdentifier("approval-teammate-quote")
                if ask.quoteIsCut {
                    Button { all.toggle() } label: {
                        Text(all ? "Show less" : "See all")
                            .font(ink.font(12.5, .medium))
                            .foregroundStyle(ink.accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("approval-teammate-see-all")
                }
            }
        }
    }
}

/// The held note: one quiet line, no shield, no amber.
struct ApprovalHeldLine: View {
    let card: OptionCard
    let ink: ApprovalInk

    var body: some View {
        if let held = ApprovalWords.held(card) {
            Text(verbatim: held)
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("approval-held-note")
        }
    }
}

/// The rule saved with this answer (`OwnerRuleInset`): what it says and a
/// way to the bot's rules.
struct OwnerRuleSavedInset: View {
    let rule: SavedOwnerRule
    let botId: String?
    let ink: ApprovalInk

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(rule.behavior == "deny" ? "Added to your rules: denied" : "Added to your rules: allowed automatically")
                .font(ink.font(12.5, .medium))
                .foregroundStyle(rule.behavior == "deny" ? ink.ink : ink.success)
            if !rule.description.isEmpty {
                Text(verbatim: "« \(rule.description) »")
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.secondary)
            }
            Button {
                NotificationCenter.default.post(name: .approvalEditRule, object: botId)
            } label: {
                Text("Edit rule").font(ink.font(12.5, .regular))
            }
            .buttonStyle(.plain)
            .foregroundStyle(ink.accent)
            .accessibilityIdentifier("owner-rule-edit")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(ink.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("owner-rule-saved")
    }
}

// MARK: - In the transcript

/// One card per request: the dock above the composer asks; the thread only
/// says it waits, as a quiet step line.
struct ApprovalWaitingLine: View {
    let message: Message
    let card: OptionCard
    let waiting: String
    let accent: Color
    @Environment(\.desktopChatText) private var desktop

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: accent)
        HStack(spacing: 6) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ink.accent)
            Text(verbatim: waiting)
                .font(ink.font(13, .regular))
                .foregroundStyle(ink.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("card-waiting-\(message.id)")
    }
}

/// An answered or expired tool ask: one line ("✓ Always allowed · Write to
/// 3 bots") that opens on what was asked, the saved rule and the details.
struct ApprovalReceiptRow: View {
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message
    let card: OptionCard
    @Environment(\.desktopChatText) private var desktop
    @State private var open = false
    @State private var detail: PendingApproval?

    private var askerName: String { message.from?.name ?? chat.name }

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: Theme.readable(MausPalette.color(chat.color)))
        let pill = ApprovalPill.of(card)
        // 2026-10-28: an Always allow or the automatic review reads as the
        // call's ordinary step line; "Always allowed" stays in the details.
        let quiet = ApprovalReceiptRules.isQuiet(card)
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptics.selection()
                withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
            } label: {
                HStack(spacing: 6) {
                    if !quiet {
                        icon(pill, ink: ink)
                        Text(verbatim: Self.outcomeWords(card, pill: pill))
                            .foregroundStyle(ink.secondary)
                        Text(verbatim: "·").foregroundStyle(ink.tertiary)
                    }
                    Text(verbatim: ApprovalWords.target(card, session: session))
                        .foregroundStyle(ink.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if let via = ApprovalWords.via(card) {
                        Text(verbatim: "· \(via)").foregroundStyle(ink.tertiary).lineLimit(1)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ink.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .font(ink.font(13, .regular))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text(open ? "Hides the request" : "Shows the request"))
            .accessibilityIdentifier("approval-receipt-\(message.id)")

            if open {
                if quiet {
                    HStack(spacing: 6) {
                        icon(pill, ink: ink)
                        Text(verbatim: card.answeredBy?.via == "auto-review"
                            ? String(localized: "approval.receipt.autoReview", defaultValue: "Approved by automatic review under your rule")
                            : (pill.map(ApprovalWords.pill) ?? ""))
                            .font(ink.font(12.5, .regular))
                            .foregroundStyle(ink.secondary)
                    }
                    .padding(.leading, 18)
                    .accessibilityIdentifier("approval-receipt-quiet-\(message.id)")
                }
                details(ink)
            }
        }
        .frame(maxWidth: desktop != nil ? 840 : .infinity, alignment: .leading)
        .sheet(item: $detail) { pending in
            ApprovalDetailSheet(chat: chat, pending: pending)
        }
    }

    /// The row's word: the pill of a tool ask; a proposal says what it did
    /// ("Routine scheduled"), #3415. Skipped and expired read as such.
    static func outcomeWords(_ card: OptionCard, pill: ApprovalPill?) -> String {
        if ApprovalDockRules.isProposal(card), pill != .skipped, pill != .expired, let outcome = ApprovalOutcome.of(card) {
            return CardView.outcomeText(outcome)
        }
        return pill.map(ApprovalWords.pill) ?? CardView.outcomeText(ApprovalOutcome.of(card) ?? .denied)
    }

    @ViewBuilder
    private func icon(_ pill: ApprovalPill?, ink: ApprovalInk) -> some View {
        switch pill?.tone {
        case .success:
            Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(ink.success)
        case .danger:
            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(ink.danger)
        default:
            Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(ink.tertiary)
        }
    }

    @ViewBuilder
    private func details(_ ink: ApprovalInk) -> some View {
        let ask = TeammateAsk.parse(card)
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: ApprovalWords.wantsTo(card, name: askerName, session: session))
                .font(ink.font(13, .medium))
                .foregroundStyle(ink.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let ask {
                if !ask.recipients.isEmpty { TeammateRecipientsView(ask: ask, ink: ink) }
                TeammateQuoteView(ask: ask, ink: ink)
            } else if let shown = ApprovalHeading.detail(card) {
                ScrollView(.vertical) {
                    Text(verbatim: shown)
                        .font(Theme.mono(12))
                        .foregroundStyle(ink.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 96)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            ApprovalHeldLine(card: card, ink: ink)
            if let rule = AllowRuleText.savedRule(card) {
                AllowRuleInset(
                    rule: rule, botId: AllowRuleInset.botId(of: message, in: chat), font: { ink.font($0, .regular) },
                    ink: ink.ink, secondary: ink.secondary, accent: ink.accent, surface: ink.inset
                )
            }
            if card.answered != nil, let saved = card.ruleSaved {
                OwnerRuleSavedInset(rule: saved, botId: AllowRuleInset.botId(of: message, in: chat), ink: ink)
            }
            if let desktop {
                if card.tool?.isEmpty == false { DesktopTechnicalDetails(card: card, theme: desktop) }
            } else if let requestId = card.requestId, let tool = card.tool {
                Button {
                    Haptics.selection()
                    detail = PendingApproval(message: message, card: card, requestId: requestId, tool: tool)
                } label: {
                    Text("See the full request")
                        .font(ink.font(12.5, .medium))
                        .foregroundStyle(ink.accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("approval-receipt-full-\(message.id)")
            }
        }
        .padding(.leading, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - The compact card's parts on the phone (#3415)

/// The read or write mark: a quiet word with its icon in the risk's ink,
/// never a filled pill (ApprovalParts.tsx `RiskChip` since #3414).
struct PhoneRiskMark: View {
    let risk: ApprovalRisk

    var body: some View {
        let tone: Color = switch risk {
        case .read: Theme.success
        case .write, .execute: Theme.warning
        case .destructive: Theme.danger
        }
        let icon = switch risk {
        case .read: "eye"
        case .write: "pencil.line"
        case .execute: "play"
        case .destructive: "trash"
        }
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 11, weight: .medium))
            Text(verbatim: DesktopApprovalText.riskLabel(risk)).font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(tone)
        .fixedSize()
        .accessibilityIdentifier("approval-risk-\(risk.rawValue)")
    }
}

/// The raw detail folded: one inset row with a chevron and what runs on one
/// line (or "Details"); open, the whole text on its block and the full
/// request (the tool and its arguments) one tap away.
struct PhoneApprovalFold: View {
    let text: String?
    let accent: Color
    let fullRequest: () -> Void
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptics.selection()
                withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.attentionSecondary)
                        .rotationEffect(.degrees(open ? 0 : -90))
                    if let text, !open {
                        Text(verbatim: text.split(whereSeparator: \.isWhitespace).joined(separator: " "))
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.attentionText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    } else {
                        Text("Details")
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.attentionSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .frame(height: 32)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Approval details to review"))
            .accessibilityValue(text.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
            .accessibilityIdentifier("approval-dock-fold")
            if open {
                if let text {
                    ScrollView(.vertical) {
                        Text(text)
                            .font(Theme.mono(12))
                            .foregroundStyle(Theme.attentionText)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("approval-dock-detail")
                    }
                    .frame(maxHeight: 120)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                Button(action: fullRequest) {
                    Text("See the full request")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("approval-full-request")
            }
        }
    }
}
