// iPad I3: the desktop transcript's metrics and the parts it draws its own
// way (ChatView.tsx `Bubble`, MessageActions.tsx, AttachmentGallery.tsx).
// The rows are still the phone's (MessageRow, TextBubble, MarkdownText,
// TranscriptAttachmentView): they read `\.desktopChatText` and, when it is
// set, wear these sizes and colours. Measured in
// ios/parity/desktop/refs/desktop-1366x1024-03-main.json and -21-chat-message-hover.json.
import SwiftUI
import UIKit
import CompanionCore

private struct DesktopChatTextKey: EnvironmentKey {
    static let defaultValue: DesktopTheme? = nil
}

private struct DesktopWideCapKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

private struct DesktopMessageActionsKey: EnvironmentKey {
    static let defaultValue: DesktopMessageActions? = nil
}

extension EnvironmentValues {
    /// The desktop transcript's tokens; nil on the iPhone (the phone metrics).
    var desktopChatText: DesktopTheme? {
        get { self[DesktopChatTextKey.self] }
        set { self[DesktopChatTextKey.self] = newValue }
    }

    /// The wide bubble's cap (`min(94 %, 780, 100 % - 82)`), for tables,
    /// diagrams and rich fences.
    var desktopWideCap: CGFloat? {
        get { self[DesktopWideCapKey.self] }
        set { self[DesktopWideCapKey.self] = newValue }
    }

    /// The hover row of the message being drawn (set by MessageRow on iPad).
    var desktopMessageActions: DesktopMessageActions? {
        get { self[DesktopMessageActionsKey.self] }
        set { self[DesktopMessageActionsKey.self] = newValue }
    }
}

/// The transcript's numbers: 13/20 text, bubbles padded 12 x 7 with 18 pt
/// corners, 8 pt between paragraphs, 4 between list items, lists 20 in.
enum DesktopChatMetrics {
    static let textSize: CGFloat = 13
    static let lineHeight: CGFloat = 20
    static let bubbleRadius: CGFloat = 18
    static let bubblePadding = EdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    static let paragraphGap: CGFloat = 8
    static let listItemGap: CGFloat = 4
    static let listIndent: CGFloat = 20
    static let rowGap: CGFloat = 12
    /// From the last row to the composer's top (refs: 949.5 to 962).
    static let composerGap: CGFloat = 12.5
    /// Chrome's `ui-monospace` is SF Mono at its plain 0.6 em advance (7.2
    /// at 12 pt); UIKit's monospaced system face adds its own tracking
    /// (7.3 to 7.4): this takes it back off.
    static func monoTracking(_ size: CGFloat) -> CGFloat {
        let font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        let advance = ("0000000000" as NSString).size(withAttributes: [.font: font]).width / 10
        return size * 0.6 - advance
    }

    /// The attachment gallery: `w-[min(34rem,70vw)]`, 6 pt between rows.
    static let galleryWidth: CGFloat = 544
    static let imageMax: CGFloat = 288

    /// ChatView.tsx `DaySeparator`: "Today 4:04 PM", "Yesterday 9:12 AM",
    /// else "Mon, Sep 28 11:31 AM".
    static func dayLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        if calendar.isDate(date, inSameDayAs: now) { return String(localized: "Today \(time)") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return String(localized: "Yesterday \(time)")
        }
        let day = date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        return "\(day) \(time)"
    }

    /// The line spacing that turns the face's natural line into 20 pt.
    static func lineSpacing(_ theme: DesktopTheme) -> CGFloat {
        max(0, lineHeight - theme.uiFont(textSize).lineHeight)
    }

    /// Half of it above and below a block, as CSS centres the line box.
    /// SwiftUI rounds a text's height up to the pixel (Geist 13: 20 n - 3.1
    /// draws 20 n - 3.0), so the two halves add up to the spacing floored
    /// to the half point: every block is then exactly n x 20, and a long
    /// reply no longer drifts half a point per few paragraphs.
    static func halfLeading(_ theme: DesktopTheme) -> CGFloat { (lineSpacing(theme) * 2).rounded(.down) / 4 }

    /// `min(80 %, 560, 100 % - 82)` of the transcript column.
    static func bubbleCap(column: CGFloat) -> CGFloat { max(120, min(column * 0.8, 560, column - 82)) }

    /// `min(94 %, 780, 100 % - 82)`.
    static func wideCap(column: CGFloat) -> CGFloat { max(120, min(column * 0.94, 780, column - 82)) }

    /// True when some line of this text is wider than `width` at 13 pt
    /// (markdown marks stripped roughly): the bubble then wraps.
    static func wraps(_ text: String, in width: CGFloat, theme: DesktopTheme) -> Bool {
        guard width > 0 else { return false }
        let font = theme.uiFont(textSize)
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            // links read as their text (`[Guide](https://…)` is "Guide")
            let plain = String(line)
                .replacingOccurrences(of: #"!?\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
                .replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
            if (plain as NSString).size(withAttributes: [.font: font]).width > width { return true }
        }
        return false
    }

    /// rich-blocks.ts `prefersWideBubble`: a table rule or a rich fence.
    static func prefersWide(_ text: String) -> Bool {
        text.range(of: #"(^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*(?:email|mail|eml|widget|html-widget|artifact|chart|csv|tsv|mermaid|cw)\b"#,
                   options: [.regularExpression, .caseInsensitive]) != nil
            || text.range(of: #"(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(\n|$)"#, options: .regularExpression) != nil
    }
}

/// A text block at the desktop's line box: 20 pt lines, the half leading
/// above and below. Nothing on the phone.
struct DesktopLineBox: ViewModifier {
    let theme: DesktopTheme?

    func body(content: Content) -> some View {
        if let theme {
            content.padding(.vertical, DesktopChatMetrics.halfLeading(theme))
        } else {
            content
        }
    }
}

// MARK: - Hover actions

/// What a row's hover strip shows: the actions of its long-press menu and
/// the time. Built by MessageRow from its own `MessageActionSet`.
struct DesktopMessageActions {
    var copyText: String?
    var actions: MessageActionSet
    var at: Date
}

/// MessageActions.tsx: beside the bubble, bottom-aligned, a "⋯" (26 pt,
/// radius 6) that appears on hover; hovering it (or a tap, or a pinned
/// open) slides out Copy, raw markdown, Read aloud, Regenerate, Reply, Pin;
/// then the time, 11 pt tertiary. The user side is mirrored. Without a
/// pointer the same actions are the long-press menu.
struct DesktopMessageHoverStrip: View {
    @Environment(\.desktopTheme) private var theme
    let model: DesktopMessageActions
    let mine: Bool
    let hovering: Bool
    @State private var open = false
    @State private var overStrip = false

    var body: some View {
        let expanded = open || overStrip || model.actions.speaking || model.actions.showingSource
        HStack(spacing: 2) {
            if mine {
                time
                if expanded { buttons.transition(.opacity) }
                ellipsis
            } else {
                ellipsis
                if expanded { buttons.transition(.opacity) }
                time
            }
        }
        .padding(.bottom, 2)
        .opacity(hovering || expanded ? 1 : 0)
        .onHover { overStrip = $0 }
        .animation(.easeOut(duration: 0.2), value: expanded)
        .accessibilityHidden(!(hovering || expanded))
    }

    private var ellipsis: some View {
        DesktopActionButton(systemImage: "ellipsis", label: "Message actions", active: open) { open.toggle() }
            .accessibilityIdentifier("desktop-message-actions")
    }

    private var time: some View {
        Text(model.at, format: .dateTime.hour().minute())
            .font(theme.font(11))
            .monospacedDigit()
            .foregroundStyle(theme.inkTertiary)
            .padding(.bottom, 4)
            .padding(.horizontal, 6)
    }

    @ViewBuilder
    private var buttons: some View {
        let a = model.actions
        HStack(spacing: 2) {
            if let text = model.copyText, !text.isEmpty {
                DesktopActionButton(systemImage: "doc.on.doc", label: "Copy message") { PlatformBridge.copyToPasteboard(text) }
            }
            if let toggle = a.toggleSource {
                DesktopActionButton(systemImage: "chevron.left.forwardslash.chevron.right",
                                    label: a.showingSource ? "Hide Source" : "Show raw markdown", active: a.showingSource, action: toggle)
            }
            if let speak = a.speak {
                DesktopActionButton(systemImage: a.speaking ? "stop.fill" : "speaker.wave.2",
                                    label: a.speaking ? "Stop Speaking" : "Read Aloud", active: a.speaking, action: speak)
            }
            if let regenerate = a.regenerate {
                DesktopActionButton(systemImage: "arrow.clockwise", label: "Regenerate response", action: regenerate)
            }
            if let reply = a.reply {
                DesktopActionButton(systemImage: "arrowshape.turn.up.left", label: "Reply to message", action: reply)
            }
            if let pin = a.togglePin {
                DesktopActionButton(systemImage: a.pinned ? "pin.slash" : "pin", label: a.pinned ? "Unpin" : "Pin message", action: pin)
            }
            if let report = a.report {
                DesktopActionButton(systemImage: "flag", label: "Report", action: report)
            }
            if let toggleBlock = a.toggleBlock {
                DesktopActionButton(systemImage: a.personBlocked ? "hand.raised.slash" : "hand.raised",
                                    label: a.personBlocked ? "Unblock \(a.personName)" : "Block \(a.personName)", action: toggleBlock)
            }
        }
    }
}

/// `rounded-md p-1.5`: a 14 pt glyph in a 26 pt square, raised on hover.
struct DesktopActionButton: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let label: LocalizedStringKey
    var active = false
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(active || hovered ? theme.ink : theme.inkSecondary)
                .frame(width: 26, height: 26)
                .background(active || hovered ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .accessibilityLabel(Text(label))
    }
}

// MARK: - Attachments

/// AttachmentGallery.tsx: the pictures first (one column for one, two
/// otherwise, at most 288 tall, 16 pt corners), then the file chips, all in
/// a column of at most 544, 6 pt apart.
struct DesktopAttachmentGallery: View {
    let images: [DisplayedMessageAttachment]
    let files: [DisplayedMessageAttachment]
    let threadId: String
    let messageId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if images.count == 1, let image = images.first {
                TranscriptAttachmentView(attachment: image, threadId: threadId, messageId: messageId)
            } else if !images.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(images, id: \.path) { image in
                        TranscriptAttachmentView(attachment: image, threadId: threadId, messageId: messageId)
                    }
                }
            }
            ForEach(files, id: \.path) { file in
                TranscriptAttachmentView(attachment: file, threadId: threadId, messageId: messageId)
            }
        }
        .frame(maxWidth: DesktopChatMetrics.galleryWidth, alignment: .leading)
        .padding(.bottom, 6)
    }
}

/// AttachedFileChip: 1 pt ring (hairline at 25 %), 12 pt corners, a 14 pt
/// document glyph, the name 12 pt ink, a 13 pt download glyph; 40 tall.
struct DesktopFileChip: View {
    @Environment(\.desktopTheme) private var theme
    let name: String
    let loading: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.text")
                .font(.system(size: 12, weight: .regular))
                .frame(width: 14, height: 14)
                .foregroundStyle(theme.inkSecondary)
            Text(verbatim: name)
                .font(theme.font(12))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            if loading {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "arrow.down.to.line")
                    .font(.system(size: 11, weight: .regular))
                    .frame(width: 13, height: 13)
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(minHeight: 40)
        .padding(1)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.25), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// PdfAttachment: a 288 pt card (inset at 60 %, hairline ring at 30 %,
/// radius 12, 10 in): a 40 x 48 page glyph with "PDF" in the danger colour,
/// the name 12.5 medium, "PDF document" 11, a download glyph.
struct DesktopPdfCard: View {
    @Environment(\.desktopTheme) private var theme
    let name: String
    let loading: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(spacing: 2) {
                Image(systemName: "doc.text")
                    .font(.system(size: 14))
                    .frame(width: 18, height: 18)
                Text(verbatim: "PDF")
                    .font(theme.font(8.5, .bold))
                    .tracking(0.4)
            }
            .foregroundStyle(theme.danger)
            .frame(width: 40, height: 48)
            .background(theme.panel, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: name)
                    .font(theme.font(12.5, .medium))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .frame(height: 20)
                Text("PDF document")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(height: 20)
            }
            Spacer(minLength: 0)
            if loading {
                ProgressView().controlSize(.mini)
            } else {
                Image(systemName: "arrow.down.to.line")
                    .font(.system(size: 12))
                    .frame(width: 14, height: 14)
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(10)
        .frame(width: 288, alignment: .leading)
        .background(theme.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.3), lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - Cards

/// ApprovalCard.tsx: what a permission ask asks, in the transcript (it is
/// answered in the dock). The chat mounts this only while the ask is open.
/// Card fill, accent ring at 40 % while pending
/// (hairline at 30 % and 80 % opacity once settled), radius 16, 16 x 12 in,
/// at most 840: the heading (avatar, "Ara wants to run a command", the
/// risk chip), the command on an inset block, then the waiting line or the
/// outcome; a settled tool ask keeps its technical details if mounted.
struct DesktopPermissionCard: View {
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message
    let card: OptionCard
    let theme: DesktopTheme
    let waiting: String

    var body: some View {
        let proposal = ApprovalDockRules.isProposal(card)
        let open = card.isPending
        let outcome = ApprovalOutcome.of(card)
        VStack(alignment: .leading, spacing: 0) {
            DesktopApprovalHeading(
                bot: DesktopApprovalText.bot(of: message, in: chat, session: session),
                title: DesktopApprovalText.cardTitle(card, name: message.from?.name ?? PeopleDirectory.shared.name(chat, session: session)),
                risk: proposal ? nil : ApprovalRiskClassifier.risk(of: card),
                theme: theme
            )
            if let detail = DesktopApprovalText.plain(card) {
                DesktopApprovalBlock(text: detail, size: 12.5, theme: theme)
            }
            if let held = card.held, !held.isEmpty {
                Text(verbatim: held)
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.warning)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.warning.opacity(0.3), lineWidth: 1))
                    .padding(.top, 8)
            }
            HStack(spacing: 6) {
                if let outcome {
                    Image(systemName: outcome == .allowed || outcome == .alwaysAllowed ? "checkmark" : "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(outcome == .allowed || outcome == .alwaysAllowed ? theme.success : theme.inkSecondary)
                        .frame(width: 14, height: 14)
                    Text(verbatim: CardView.outcomeText(outcome))
                        .accessibilityIdentifier("card-outcome-\(message.id)")
                } else {
                    DesktopLucideGlyph(paths: DesktopLucide.shieldCheck, size: 14)
                        .foregroundStyle(theme.accent)
                    Text(verbatim: waiting)
                        .accessibilityIdentifier("card-waiting-\(message.id)")
                }
            }
            .font(theme.font(13))
            .foregroundStyle(theme.inkSecondary)
            .frame(minHeight: 19.5)
            .padding(.top, 8)
            if let rule = AllowRuleText.savedRule(card) {
                AllowRuleInset(
                    rule: rule, botId: AllowRuleInset.botId(of: message, in: chat), font: { theme.font($0) },
                    ink: theme.ink, secondary: theme.inkSecondary, accent: theme.accent, surface: theme.inset
                )
            }
            if !proposal, !open, card.tool?.isEmpty == false {
                DesktopTechnicalDetails(card: card, theme: theme)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(1)
        .overlay(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .strokeBorder(open ? theme.accent.opacity(0.4) : theme.hairline.opacity(0.3), lineWidth: 1)
        )
        .opacity(open ? 1 : 0.8)
        .frame(maxWidth: 840, alignment: .leading)
    }
}

/// The words of the human approval cards (approval-describe.ts, ApprovalCard.tsx).
enum DesktopApprovalText {
    /// Who asks: the 1:1 bot, or the room member the message is from.
    @MainActor
    static func bot(of message: Message, in chat: Chat, session: Session) -> Bot? {
        switch chat {
        case let .bot(bot): session.state.bot(bot.id) ?? bot
        case let .room(room): (message.from?.botId ?? room.busyBotId).flatMap { session.state.bot($0) }
        }
    }

    /// "Ara wants to run a command"; a proposal names what it proposes
    /// ("Ara wants to schedule a routine"); a team setup keeps its title.
    static func cardTitle(_ card: OptionCard, name: String) -> String {
        switch ApprovalHeading.of(card) {
        case let .wantsTo(action): return wants(name, action)
        case .confirmRoutine: return wants(name, .scheduleRoutine)
        case .confirmPausedRoutine: return String(localized: "\(name) wants to schedule a paused routine")
        case .confirmRoutineChange: return wants(name, .changeRoutine)
        case .enableSkill: return wants(name, .enableSkill)
        case .updateSkill: return wants(name, .updateSkill)
        case .confirmProfileChange: return wants(name, .updateProfile)
        case .confirmRuleChange: return String(localized: "\(name) wants to change an approval rule")
        case let .teamSetup(title): return title
        }
    }

    static func wants(_ name: String, _ action: ApprovalToolAction) -> String {
        String(localized: "\(name) wants to \(ApprovalDock.phrase(action))")
    }

    /// The block under the heading: a proposal's text, or a tool's command
    /// or URL as is; JSON arguments stay behind the technical details.
    static func plain(_ card: OptionCard) -> String? {
        if ApprovalDockRules.isProposal(card) { return card.subtitle.isEmpty ? nil : card.subtitle }
        if let command = card.commandAllowlist?.command, !command.isEmpty { return command }
        let text = card.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        // the gate's `<tool> {json}` is arguments too (#426)
        return text.isEmpty || GateArguments.isTechnical(card) ? nil : card.subtitle
    }

    static func technical(_ text: String) -> Bool { text.hasPrefix("{") || text.hasPrefix("[") }

    /// The arguments for the details, pretty JSON when they are JSON.
    static func arguments(_ card: OptionCard) -> String? {
        let subtitle = card.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = card.toolInput
            ?? GateArguments.split(subtitle, known: [card.tool, card.mcpTool])?.json
            ?? (technical(subtitle) ? card.subtitle : nil)
        guard let raw, !raw.isEmpty else { return nil }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: pretty, encoding: .utf8)
        else { return raw }
        return text
    }

    static func riskLabel(_ risk: ApprovalRisk) -> String {
        switch risk {
        case .read: String(localized: "Read-only")
        case .write: String(localized: "Makes changes")
        case .destructive: String(localized: "Destructive")
        case .execute: String(localized: "Runs an action")
        }
    }
}

/// ApprovalParts.tsx `ApprovalHeading`: the 30 pt avatar, 12 pt, then the
/// title (15 semibold) and the risk chip on one wrapping row; `aside` on
/// the right (the dock's stepper).
struct DesktopApprovalHeading: View {
    let bot: Bot?
    let title: String
    let risk: ApprovalRisk?
    let theme: DesktopTheme
    var aside: AnyView? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let bot {
                BotMascotView(bot: bot, size: 30, state: .idle, animated: false)
                    .frame(width: 30, height: 30)
            }
            HStack(alignment: .center, spacing: 8) {
                Text(verbatim: title)
                    .font(theme.font(15, .semibold))
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("approval-heading")
                if let risk { DesktopRiskChip(risk: risk, theme: theme) }
            }
            .frame(minHeight: 22.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            if let aside { aside }
        }
    }
}

/// `RiskChip`: 11 pt medium on a 10 % wash, a 35 % ring (40 % destructive).
struct DesktopRiskChip: View {
    let risk: ApprovalRisk
    let theme: DesktopTheme

    var body: some View {
        let tone: Color = switch risk {
        case .read: theme.success
        case .write, .execute: theme.warning
        case .destructive: theme.danger
        }
        let icon = switch risk {
        case .read: DesktopLucide.eye
        case .write: DesktopLucide.pencilLine
        case .execute: DesktopLucide.play
        case .destructive: DesktopLucide.trash
        }
        HStack(spacing: 4) {
            DesktopLucideGlyph(paths: icon, size: 11)
            Text(verbatim: DesktopApprovalText.riskLabel(risk))
                .font(theme.font(11, .medium))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 8)
        .frame(height: 22.5)
        .background(tone.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(risk == .destructive ? 0.4 : 0.35), lineWidth: 1))
        .fixedSize()
    }
}

/// The monospace block (`rounded-lg bg-inset px-3 py-2`, leading-relaxed),
/// 8 pt under what precedes it; long text scrolls instead of truncating.
struct DesktopApprovalBlock: View {
    let text: String
    let size: CGFloat
    let theme: DesktopTheme
    var maxHeight: CGFloat = 160

    var body: some View {
        let font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        ScrollView(.vertical) {
            Text(verbatim: text)
                .font(.system(size: size, design: .monospaced))
                .tracking(DesktopChatMetrics.monoTracking(size))
                .lineSpacing(max(0, size * 1.625 - font.lineHeight))
                .foregroundStyle(theme.ink)
                .textSelection(.enabled)
                .padding(.vertical, max(0, size * 1.625 - font.lineHeight) / 2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("approval-dock-detail")
        }
        .frame(maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(.top, 8)
    }
}

/// "See technical details": collapsed by default; open, the tool id, its
/// server and the arguments on an inset box, with Copy.
struct DesktopTechnicalDetails: View {
    let card: OptionCard
    let theme: DesktopTheme
    @State private var open = false
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } } label: {
                HStack(spacing: 4) {
                    DesktopLucideGlyph(paths: DesktopLucide.chevronDown, size: 13)
                        .rotationEffect(.degrees(open ? 0 : -90))
                    Text(open ? "Hide technical details" : "See technical details")
                        .font(theme.font(12.5))
                }
                .foregroundStyle(theme.inkSecondary)
                .frame(height: 22.8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("approval-technical-details")
            if open { details }
        }
        .padding(.top, 8)
    }

    private var details: some View {
        let tool = card.tool ?? ""
        let server = ApprovalRiskClassifier.parseToolId(tool).server
        let args = DesktopApprovalText.arguments(card)
        return VStack(alignment: .leading, spacing: 2) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                if !tool.isEmpty { row(Text("Tool"), tool) }
                if let server { row(Text("Server"), server) }
            }
            if let args {
                HStack {
                    Text("Arguments").foregroundStyle(theme.inkSecondary)
                    Spacer()
                    Button {
                        PlatformBridge.copyToPasteboard(args)
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(theme.font(11.5))
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .buttonStyle(.plain)
                }
                .font(theme.font(12))
                .padding(.top, 6)
                ScrollView(.vertical) {
                    Text(verbatim: args)
                        .font(Theme.mono(12))
                        .foregroundStyle(theme.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 240)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    private func row(_ label: Text, _ value: String) -> some View {
        GridRow {
            label.foregroundStyle(theme.inkSecondary)
            Text(verbatim: value)
                .font(Theme.mono(12))
                .foregroundStyle(theme.ink)
                .textSelection(.enabled)
        }
        .font(theme.font(12))
    }
}
