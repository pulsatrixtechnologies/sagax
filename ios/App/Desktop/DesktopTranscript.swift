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
    /// Toggles one of my reactions (nil: the message takes none).
    var react: ((String) -> Void)? = nil
    /// The emoji I already put on it (the pill marks them).
    var mine: Set<String> = []
    /// The full emoji picker ("More reactions").
    var moreReactions: (() -> Void)? = nil
}

/// MessageBar.tsx and MessageHoverActions.tsx (the reference tray,
/// 2026-10-15): beside the bubble, bottom-aligned, a row of 24 pt square
/// buttons 2 apart (react, reply, "…"; mirrored on my side), 16 pt thin
/// glyphs in the secondary ink, then the time under them, 11 pt tertiary.
/// The smiley opens the quick reactions; "…" opens the menu: the same
/// reactions, Reply, Copy, then what changes the message (regenerate, pin,
/// report, block), then how it is shown (read aloud, raw markdown). It
/// shows on hover; without a pointer the same actions are the long press.
struct DesktopMessageHoverStrip: View {
    @Environment(\.desktopTheme) private var theme
    let model: DesktopMessageActions
    let mine: Bool
    let hovering: Bool
    @State private var reactionsOpen = false
    @State private var overStrip = false

    /// `BAR_REACTIONS` (shared/reactions.ts).
    static let quickReactions = ["👍", "👎", "❤️", "😂", "🎉"]

    var body: some View {
        let a = model.actions
        let shown = hovering || overStrip || reactionsOpen || a.speaking || a.showingSource
        VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
            HStack(spacing: 2) {
                if mine {
                    menuButton
                    replyButton
                    reactButton
                } else {
                    reactButton
                    replyButton
                    menuButton
                }
            }
            Text(model.at, format: .dateTime.hour().minute())
                .font(theme.font(11))
                .monospacedDigit()
                .foregroundStyle(theme.inkTertiary)
                .lineLimit(1)
                .frame(height: 16)
                .padding(.horizontal, 4)
        }
        .padding(.bottom, 2)
        .opacity(shown ? 1 : 0)
        .onHover { overStrip = $0 }
        .accessibilityHidden(!shown)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-message-bar")
    }

    @ViewBuilder
    private var reactButton: some View {
        if model.react != nil {
            DesktopActionButton(lucide: DesktopLucide.smile, label: "Add reaction", active: reactionsOpen) { reactionsOpen.toggle() }
                .popover(isPresented: $reactionsOpen, arrowEdge: .bottom) { reactionPill }
                .accessibilityIdentifier("desktop-message-react")
        }
    }

    @ViewBuilder
    private var replyButton: some View {
        if let reply = model.actions.reply {
            // the user side mirrors the arrow (`-scale-x-100`)
            DesktopActionButton(lucide: DesktopLucide.reply, label: "Reply", action: reply)
                .scaleEffect(x: mine ? -1 : 1, y: 1)
                .accessibilityIdentifier("desktop-message-reply")
        }
    }

    /// The quick reactions: 32 pt round cells, 20 pt emoji, 4 apart, 6 in;
    /// then "more reactions".
    private var reactionPill: some View {
        HStack(spacing: 4) {
            ForEach(Self.quickReactions, id: \.self) { emoji in
                Button {
                    reactionsOpen = false
                    model.react?(emoji)
                } label: {
                    Text(verbatim: emoji)
                        .font(.system(size: 20))
                        .frame(width: 32, height: 32)
                        .background(model.mine.contains(emoji) ? theme.ink.opacity(0.1) : .clear, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("React with \(emoji)"))
            }
            if let more = model.moreReactions {
                Button {
                    reactionsOpen = false
                    more()
                } label: {
                    DesktopLucideGlyph(paths: DesktopLucide.smilePlus, size: 18)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("More reactions"))
            }
        }
        .padding(6)
    }

    private var menuButton: some View {
        let a = model.actions
        return Menu {
            if let react = model.react {
                ControlGroup {
                    ForEach(Self.quickReactions, id: \.self) { emoji in
                        Button { react(emoji) } label: { Text(verbatim: emoji) }
                    }
                }
            }
            if let reply = a.reply { Button(action: reply) { Label("Reply", systemImage: "arrowshape.turn.up.left") } }
            if let text = model.copyText, !text.isEmpty {
                Button { PlatformBridge.copyToPasteboard(text) } label: { Label("Copy", systemImage: "doc.on.doc") }
            }
            Section {
                if let regenerate = a.regenerate { Button(action: regenerate) { Label("Regenerate response", systemImage: "arrow.clockwise") } }
                if let pin = a.togglePin { Button(action: pin) { Label(a.pinned ? "Unpin" : "Pin message", systemImage: a.pinned ? "pin.slash" : "pin") } }
                if let report = a.report { Button(action: report) { Label("Report", systemImage: "flag") } }
                if let toggleBlock = a.toggleBlock {
                    Button(action: toggleBlock) {
                        Label(a.personBlocked ? "Unblock \(a.personName)" : "Block \(a.personName)",
                              systemImage: a.personBlocked ? "hand.raised.slash" : "hand.raised")
                    }
                }
            }
            Section {
                if let speak = a.speak { Button(action: speak) { Label(a.speaking ? "Stop Speaking" : "Read Aloud", systemImage: a.speaking ? "stop.fill" : "speaker.wave.2") } }
                if let toggle = a.toggleSource {
                    Button(action: toggle) { Label(a.showingSource ? "Hide Source" : "Show raw markdown", systemImage: "chevron.left.forwardslash.chevron.right") }
                }
            }
        } label: {
            DesktopActionButton.face(lucide: DesktopLucide.ellipsis, theme: theme, active: false)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Message actions"))
        .accessibilityIdentifier("desktop-message-actions")
    }
}

/// `HOVER_ACTION_BUTTON`: a 24 pt square, radius 6, the glyph 16 pt thin
/// (stroke 1.5) in the secondary ink; a 6 % ink wash on hover or open.
struct DesktopActionButton: View {
    @Environment(\.desktopTheme) private var theme
    var systemImage: String? = nil
    var lucide: [String]? = nil
    let label: LocalizedStringKey
    var active = false
    let action: () -> Void
    @State private var hovered = false

    init(systemImage: String, label: LocalizedStringKey, active: Bool = false, action: @escaping () -> Void) {
        self.systemImage = systemImage
        self.label = label
        self.active = active
        self.action = action
    }

    init(lucide: [String], label: LocalizedStringKey, active: Bool = false, action: @escaping () -> Void) {
        self.lucide = lucide
        self.label = label
        self.active = active
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if let lucide {
                    Self.face(lucide: lucide, theme: theme, active: active || hovered)
                } else {
                    Image(systemName: systemImage ?? "ellipsis")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(active || hovered ? theme.ink : theme.inkSecondary)
                        .frame(width: 26, height: 26)
                        .background(active || hovered ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .accessibilityLabel(Text(label))
    }

    /// The 24 pt face (also the "…" menu's label).
    static func face(lucide: [String], theme: DesktopTheme, active: Bool) -> some View {
        DesktopLucideGlyph(paths: lucide, size: 16, strokeWidth: 1.5)
            .foregroundStyle(theme.inkSecondary)
            .frame(width: 24, height: 24)
            .background(active ? theme.ink.opacity(0.06) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
    }
}

// MARK: - Attachments

/// AttachmentGallery.tsx (2026-11-03 references): under the message's
/// words, the pictures as 96 pt tall thumbnails (`h-24 w-auto max-w-48`,
/// 16 pt corners) in a wrapping row 8 apart, then the files as 28 pt pills
/// in a wrapping row 6 apart. The bubble keeps its own width (`w-fit`).
struct DesktopAttachmentGallery: View {
    let images: [DisplayedMessageAttachment]
    let files: [DisplayedMessageAttachment]
    let threadId: String
    let messageId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !images.isEmpty {
                DesktopChipFlow(spacing: 8) {
                    ForEach(images, id: \.path) { image in
                        TranscriptAttachmentView(attachment: image, threadId: threadId, messageId: messageId)
                    }
                }
            }
            if !files.isEmpty {
                DesktopChipFlow(spacing: 6) {
                    ForEach(files, id: \.path) { file in
                        TranscriptAttachmentView(attachment: file, threadId: threadId, messageId: messageId)
                    }
                }
            }
        }
    }
}

/// A wrapping row as wide as what it holds (`flex flex-wrap`), never wider
/// than offered.
struct DesktopChipFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = Self.measure(view, width: width)
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    /// A chip's own width (`w-fit`), the row's width only when it is wider:
    /// a view that fills what it is offered would otherwise take a line each.
    static func measure(_ view: LayoutSubview, width: CGFloat) -> CGSize {
        let ideal = view.sizeThatFits(.unspecified)
        if ideal.width <= width { return ideal }
        return view.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = Self.measure(view, width: bounds.width)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// AttachedFileChip (`file-chip`): a 28 pt pill of 6 % ink, a 14 pt
/// document glyph, the name 13 in the ink (at most 16rem), a 13 pt download
/// glyph in the secondary ink; ps-2.5 pe-2, 6 apart.
struct DesktopFileChip: View {
    @Environment(\.desktopTheme) private var theme
    let name: String
    let loading: Bool

    /// `filePreviewKind` (TableFilePreview.tsx): what the chip's preview
    /// button opens, from the name.
    enum PreviewKind { case table, pdf, json, html }

    static func previewKind(_ name: String) -> PreviewKind? {
        let lower = name.lowercased().trimmingCharacters(in: .whitespaces)
        if [".csv", ".tsv", ".xlsx"].contains(where: lower.hasSuffix) { return .table }
        if lower.hasSuffix(".pdf") { return .pdf }
        if lower.hasSuffix(".json") { return .json }
        if lower.hasSuffix(".html") || lower.hasSuffix(".htm") { return .html }
        return nil
    }

    /// CompactFileChip: a 28 pt pill at 6 % ink, the file glyph, the name
    /// 13, the download glyph (ps-2.5 pe-2), then the preview button as a
    /// 24 pt circle (`.file-chip .table-action`) for a file the app opens.
    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                DesktopIconView(icon: .fileText, size: 14)
                    .foregroundStyle(theme.inkSecondary)
                Text(verbatim: name)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if loading {
                    ProgressView().controlSize(.mini)
                } else {
                    DesktopLucideGlyph(paths: DesktopLucide.download, size: 13, strokeWidth: 1.75)
                        .foregroundStyle(theme.inkSecondary)
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 8)
            if let kind = Self.previewKind(name) {
                Group {
                    switch kind {
                    case .table: DesktopLucideGlyph(paths: DesktopLucide.table2, size: 14)
                    case .pdf: DesktopIconView(icon: .fileText, size: 14)
                    case .json: Image(systemName: "curlybraces").font(.system(size: 12))
                    case .html: Image(systemName: "globe").font(.system(size: 12))
                    }
                }
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 24, height: 24)
                .contentShape(Circle())
                .padding(.trailing, 2)
                .accessibilityHidden(true)
            }
        }
        .frame(height: 28)
        .fixedSize()
        .background(theme.ink.opacity(0.06), in: Capsule())
        .contentShape(Capsule())
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

/// ApprovalParts.tsx `ApprovalHeading` since #3414 (#3415 on the iPad): the
/// compact card's head. A shield icon, the ask in one line (14 semibold)
/// naming the bot once, never again by an avatar; under it one line with
/// the read or write mark and what it does; `aside` on the right (the
/// dock's stepper and its skip).
struct DesktopApprovalHeading: View {
    /// Who asks. Named in the title only (#3415): kept for the callers.
    let bot: Bot?
    let title: String
    let risk: ApprovalRisk?
    let theme: DesktopTheme
    var aside: AnyView? = nil
    /// ApprovalParts.tsx's summary after the mark (`text-[13px]`).
    var summary: String? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            DesktopLucideGlyph(paths: DesktopLucide.shieldCheck, size: 15)
                .foregroundStyle(theme.accent)
                .frame(height: 20)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(theme.font(14, .semibold))
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minHeight: 20, alignment: .leading)
                    .accessibilityIdentifier("approval-heading")
                if risk != nil || summary != nil {
                    HStack(spacing: 6) {
                        if let risk { DesktopRiskChip(risk: risk, theme: theme) }
                        if risk != nil, summary != nil {
                            Text(verbatim: "·").accessibilityHidden(true)
                        }
                        if let summary {
                            Text(verbatim: summary)
                                .lineLimit(2)
                                .accessibilityIdentifier("approval-summary")
                        }
                    }
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let aside { aside }
        }
    }
}

/// `approvalPlain`'s fallback line (shared/approval-describe.ts), for a tool
/// ask with nothing readable to show: "Uses a tool.", "Only reads data.
/// Nothing changes.", ...
enum DesktopApprovalLine {
    static func fallback(_ risk: ApprovalRisk?) -> String {
        switch risk {
        case .read: String(localized: "Only reads data. Nothing changes.")
        case .write: String(localized: "Makes changes.")
        case .execute: String(localized: "Runs an action.")
        case .destructive: String(localized: "Deletes data.")
        case nil: String(localized: "Uses a tool.")
        }
    }
}

/// `RiskChip` since #3414: a quiet word with its icon in the risk's ink,
/// never a filled pill (12 pt medium).
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
            DesktopLucideGlyph(paths: icon, size: 12)
            Text(verbatim: DesktopApprovalText.riskLabel(risk))
                .font(theme.font(12, .medium))
        }
        .foregroundStyle(tone)
        .fixedSize()
    }
}

/// PendingApproval.tsx (2026-10-20): one short line of what runs on an
/// inset row (`rounded-lg bg-inset px-2.5 py-1.5 text-[12px]`), a 13 pt
/// chevron turned right while folded; open, the whole text on its block and
/// the technical details under it, already open.
struct DesktopApprovalFold: View {
    let text: String?
    let card: OptionCard
    let theme: DesktopTheme
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    DesktopLucideGlyph(paths: DesktopLucide.chevronDown, size: 13)
                        .rotationEffect(.degrees(open ? 0 : -90))
                        .foregroundStyle(theme.inkSecondary)
                    if let text, !open {
                        Text(verbatim: text.split(whereSeparator: \.isWhitespace).joined(separator: " "))
                            .font(.system(size: 12, design: .monospaced))
                            .tracking(DesktopChatMetrics.monoTracking(12))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    } else {
                        Text("Details").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .frame(height: 30)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Approval details to review"))
            .accessibilityValue(text.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
            .accessibilityIdentifier("approval-dock-fold")
            if open {
                if let text { DesktopApprovalBlock(text: text, size: 12, theme: theme).padding(.top, -2) }
                if card.tool?.isEmpty == false { DesktopTechnicalDetails(card: card, theme: theme, defaultOpen: true) }
            }
        }
        .padding(.top, 6)
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
    @State private var open: Bool
    @State private var copied = false

    /// `defaultOpen`: the approval box's Details fold opens it already open.
    init(card: OptionCard, theme: DesktopTheme, defaultOpen: Bool = false) {
        self.card = card
        self.theme = theme
        _open = State(initialValue: defaultOpen)
    }

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

// MARK: - Find in conversation

/// The landed find hit (ChatFindBar.tsx, focus-message.ts): its message
/// takes the accent ring (`ring-2 ring-accent/70 rounded-2xl`) and the
/// matched words the `search-result-text` highlight (ink on the accent at
/// 35 %).
struct DesktopFindHit: Equatable {
    var messageId: String
    var text: String

    /// The hit's matched words, from its snippet.
    init?(_ hit: SearchHit?) {
        guard let hit else { return nil }
        let characters = Array(hit.snippet)
        let start = max(0, min(hit.matchStart, characters.count))
        let end = max(start, min(hit.matchStart + hit.matchLength, characters.count))
        let words = String(characters[start..<end])
        guard !words.isEmpty else { return nil }
        messageId = hit.messageId
        text = words
    }
}

private struct DesktopFindHitKey: EnvironmentKey {
    static let defaultValue: DesktopFindHit? = nil
}

private struct DesktopFindHighlightKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// Set on the desktop transcript while find has landed on a hit.
    var desktopFindHit: DesktopFindHit? {
        get { self[DesktopFindHitKey.self] }
        set { self[DesktopFindHitKey.self] = newValue }
    }

    /// Set on the hit's own bubble: the words its text highlights.
    var desktopFindHighlight: String? {
        get { self[DesktopFindHighlightKey.self] }
        set { self[DesktopFindHighlightKey.self] = newValue }
    }
}

enum DesktopFindHighlight {
    /// focus-message.ts `matchRange`: the first occurrence of `needle`
    /// (case ignored, the words' own accents kept) in the message's text,
    /// one range only.
    static func range(of needle: String, in text: String) -> Range<String.Index>? {
        let trimmed = needle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return text.range(of: trimmed, options: [.caseInsensitive])
    }

    /// Marks that one occurrence in the run (ink on the accent at 35 %).
    static func apply(to attributed: inout AttributedString, needle: String, theme: DesktopTheme) {
        let plain = String(attributed.characters)
        guard let found = range(of: needle, in: plain) else { return }
        let lower = plain.distance(from: plain.startIndex, to: found.lowerBound)
        let length = plain.distance(from: found.lowerBound, to: found.upperBound)
        let start = attributed.characters.index(attributed.characters.startIndex, offsetBy: lower)
        let end = attributed.characters.index(start, offsetBy: length)
        attributed[start..<end].backgroundColor = theme.accent.opacity(0.35)
        attributed[start..<end].foregroundColor = theme.ink
    }

    /// The block of a message's markdown that holds the first occurrence:
    /// only it is marked (the desktop marks one range in the whole reply).
    static func holdsFirst(block: String, of needle: String, in source: String) -> Bool {
        guard let first = range(of: needle, in: source), range(of: needle, in: block) != nil,
              let place = source.range(of: block) else { return false }
        return place.lowerBound <= first.lowerBound && first.lowerBound < place.upperBound
    }
}

/// Where the landed hit's words sit in its bubble, so the transcript can
/// centre them (focus-message.ts: the match's line, not the bubble, is
/// scrolled to the middle of the pane).
struct DesktopFindProbe: UIViewRepresentable {
    private static weak var current: UIView?

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        Self.current = view
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { Self.current = view }

    /// Scrolls the transcript so the probe is in the middle of what shows.
    @MainActor
    static func center() {
        guard let probe = current, probe.window != nil else { return }
        var view = probe.superview
        while let candidate = view, !(candidate is UIScrollView) { view = candidate.superview }
        guard let scroll = view as? UIScrollView else { return }
        let inScroll = probe.convert(CGPoint(x: 0, y: probe.bounds.midY), to: scroll)
        let insets = scroll.adjustedContentInset
        let visible = scroll.bounds.height - insets.top - insets.bottom
        let lowest = -insets.top
        let highest = max(lowest, scroll.contentSize.height - scroll.bounds.height + insets.bottom)
        let target = inScroll.y - insets.top - visible / 2
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: min(highest, max(lowest, target))), animated: false)
    }

    /// The hit's place down its text, 0 at the top and 1 at the end.
    static func fraction(of needle: String, in text: String) -> CGFloat {
        guard !text.isEmpty, let range = DesktopFindHighlight.range(of: needle, in: text) else { return 0.5 }
        return CGFloat(text.distance(from: text.startIndex, to: range.lowerBound)) / CGFloat(text.count)
    }
}

/// JumpToLatestPill.tsx: `rounded-full border border-hairline/40 bg-raised
/// px-3 py-1.5 text-[12.5px] shadow-lg`, a 13 pt arrow then the words,
/// centred over the transcript.
struct DesktopJumpToLatestPill: View {
    @Environment(\.desktopTheme) private var theme
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                DesktopLucideGlyph(paths: ["M12 5v14", "m19 12-7 7-7-7"], size: 13)
                Text("Jump to latest").font(theme.font(12.5))
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            .shadow(color: .black.opacity(0.25), radius: 12, y: 8)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Jump to latest messages"))
        .accessibilityIdentifier("jump-to-latest")
        .transition(.scale(scale: 0.9).combined(with: .opacity))
    }
}

/// NewMessagesDivider.tsx: a 1 pt rule fading in from each side to the
/// accent at 60 %, "NEW" between (11 pt semibold, 0.08 em tracking, the
/// accent text), 2 pt above and below the 16 pt line.
struct DesktopNewMessagesDivider: View {
    @Environment(\.desktopTheme) private var theme

    var body: some View {
        HStack(spacing: 12) {
            LinearGradient(colors: [theme.accent.opacity(0), theme.accent.opacity(0.6)], startPoint: .leading, endPoint: .trailing)
                .frame(height: 1)
            Text(String(localized: "chat.newMessages", defaultValue: "New"))
                .textCase(.uppercase)
                .font(theme.font(11, .semibold))
                .tracking(11 * 0.08)
                .foregroundStyle(theme.accent)
                .frame(height: 16)
            LinearGradient(colors: [theme.accent.opacity(0.6), theme.accent.opacity(0)], startPoint: .leading, endPoint: .trailing)
                .frame(height: 1)
        }
        .padding(.vertical, 2)
        .accessibilityElement()
        .accessibilityLabel(Text("New messages"))
        .accessibilityIdentifier("desktop-new-messages")
    }
}
