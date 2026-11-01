// A text message's bubble: markdown for bots, plain text and attachments
// for you, voice notes, generated images, diffs and webhook bodies.
import SwiftUI
import CompanionCore

struct TextBubble: View {
    @Environment(\.themePalette) var themePalette
    let message: Message
    let chat: Chat
    var tailed = true
    /// View Source: the bot's markdown as written, monospaced (MS3).
    var showingSource = false
    let openLink: (URL, Message) -> OpenURLAction.Result
    var cwAsk: ((CwActionBody) -> Void)? = nil
    @Environment(\.messageActions) private var context
    /// The desktop's bubble cap on iPad (nil on the iPhone).
    @Environment(\.desktopBubbleCap) private var bubbleCap
    /// A long line of yours, opened with Show full message (MS19).
    @State private var expanded = false
    /// iPad desktop shell: the desktop's text, bubble and hover row.
    @Environment(\.desktopChatText) private var desktop
    @Environment(\.desktopWideCap) private var wideCap
    @Environment(\.desktopMessageActions) private var hoverActions
    @State private var hovering = false
    /// So a bubble repaints when the person flips the bot-colour switch.
    @ObservedObject private var bubblePrefs = SidebarPrefsModel.shared
    @ObservedObject private var openBot = ThemeStore.shared
    /// The page chip over a message sent from an open page (2026-10-28).
    @Environment(\.openPagePanel) private var openPagePanel
    @State private var chipPage: PageContextRef?

    /// Over this conversation when it can, else on its own.
    private func openPage(_ ref: PageContextRef) {
        Haptics.selection()
        if let openPagePanel {
            openPagePanel(OpenPageRef(pageId: ref.pageId, botId: chat.id, threadId: chat.threadId, title: ref.title,
                                      openedAt: Date().timeIntervalSince1970 * 1000))
        } else {
            chipPage = ref
        }
    }

    private var attachedContent: AttachedMessageContent {
        AttachedMessageContent.parse(message.text ?? "")
    }

    private var parsedDiff: (filename: String, diff: String)? {
        guard message.role != .user, let source = message.text else { return nil }
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let diff: String
        if text.hasPrefix("```diff"), text.hasSuffix("```") {
            diff = String(text.dropFirst("```diff".count).dropLast(3))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } else if text.hasPrefix("diff --git ") {
            diff = text
        } else {
            return nil
        }
        let firstLine = diff.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        let filename = firstLine.split(separator: " ").last.map(String.init)?
            .replacingOccurrences(of: "b/", with: "") ?? "Git patch"
        return (filename, diff)
    }

    var body: some View {
        let mine = message.role == .user
        let customCard = parsedDiff != nil
        // rooms attribute each line to the member who said it
        let speaker = message.from
        // No face beside the bubble: the bot's face is in the header, and in
        // a room the name line says who spoke. The bubble sits at the edge.
        HStack(alignment: .bottom, spacing: 0) {
            if mine { Spacer(minLength: desktop == nil ? Theme.Chat.bubbleTrailingGap : 0) }

            VStack(alignment: .leading, spacing: desktop == nil ? 4 : 0) {
                if let speaker, !mine {
                    Text(speaker.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.readable(MausPalette.color(speaker.color)))
                }
                // Sent while a page was open: the page as a chip over the
                // words (PageComposerParts.tsx PageRefChip); a tap opens it.
                if mine, let ref = message.dataContext?.page, ref.isDrawable {
                    PageRefChip(ref: ref, foreground: mineInk) { openPage(ref) }
                        .fullScreenCover(isPresented: Binding(get: { chipPage != nil }, set: { if !$0 { chipPage = nil } })) {
                            if let chipPage { PageFullScreen(pageId: chipPage.pageId, title: chipPage.title) }
                        }
                }
                // The message this one answers (MS8): tap to jump to it.
                if let targetId = message.replyToId, let target = context.lookup(targetId) {
                    ReplyQuote(
                        message: target,
                        fallbackName: chat.isBot ? chat.name : String(localized: "Bot"),
                        compact: true,
                        onJump: context.jump.map { jump in { jump(target.id) } }
                    )
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("reply-quote-\(message.id)")
                }
                ForEach(message.voiceNotes) { note in
                    VoiceNoteBubble(
                        note: note,
                        tint: MausPalette.color(chat.color),
                        transcript: message.voiceNotes.count == 1 ? message.text : nil
                    )
                }
                if desktop != nil {
                    if !mine, !message.generatedImages.isEmpty || !message.fileAttachments.isEmpty {
                        DesktopAttachmentGallery(images: message.generatedImages, files: message.fileAttachments,
                                                 threadId: chat.threadId, messageId: message.id)
                    }
                } else {
                    ForEach(message.generatedImages, id: \.path) { attachment in
                        TranscriptAttachmentView(
                            attachment: attachment, threadId: chat.threadId,
                            messageId: message.id, foreground: mine ? mineInk : BubbleColor.theirsText
                        )
                    }
                }
                // Bots get markdown, you do not — the same split the desktop
                // makes. Markdown you did not intend is worse than markdown
                // you did: a message about `**` should show the asterisks.
                if let diff = parsedDiff {
                    GitPRDiffCardView(filename: diff.filename, diffText: diff.diff)
                } else if let webhook = message.webhookContent {
                    WebhookMessageBody(content: webhook)
                } else if mine {
                    let shared = attachedContent
                    // Quotes this message carries (CO8): its own words, then
                    // the citations as chips.
                    let cited = Citations.split(shared.text)
                    // A voice note recorded in the composer plays here, with
                    // its speed, instead of showing as a file chip.
                    let recorded = shared.attachments.filter { $0.kind == .file && VoiceNoteRecording.isVoiceNoteName($0.name) }
                    let others = shared.attachments.filter { !($0.kind == .file && VoiceNoteRecording.isVoiceNoteName($0.name)) }
                    ForEach(Array(recorded.enumerated()), id: \.offset) { _, attachment in
                        VoiceNoteBubble(
                            note: MessageVoiceNote(path: attachment.path, mime: VoiceNoteRecording.mime, durationMs: nil),
                            tint: MausPalette.color(chat.color),
                            recordedIn: (chat.threadId, message.id),
                            transcript: recorded.count == 1 ? cited.display : nil
                        )
                    }
                    if desktop != nil {
                        if !others.isEmpty {
                            DesktopAttachmentGallery(images: others.filter { $0.kind == .image },
                                                     files: others.filter { $0.kind == .file },
                                                     threadId: chat.threadId, messageId: message.id)
                        }
                    } else {
                        ForEach(Array(others.enumerated()), id: \.offset) { _, attachment in
                            TranscriptAttachmentView(
                                attachment: attachment,
                                threadId: chat.threadId,
                                messageId: message.id
                            )
                        }
                    }
                    if !cited.display.isEmpty {
                        let collapsible = MessageCollapse.isLong(cited.display)
                        Text(MentionTint.attributed(cited.display, peers: context.mentionPeers, everyone: context.mentionEveryone))
                            .font(desktop?.font(DesktopChatMetrics.textSize) ?? Theme.Font.body)
                            .lineSpacing(desktop.map(DesktopChatMetrics.lineSpacing) ?? Theme.bodyLineSpacing)
                            .modifier(DesktopLineBox(theme: desktop))
                            .foregroundStyle(mineInk)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .modifier(CollapsedText(collapsed: collapsible && !expanded))
                        // Sent into a running turn (MS20): the bot took it
                        // into account at once, inside its work (2026-10-28).
                        if message.steered == true {
                            Text("taken into account")
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.textTertiary)
                                .accessibilityHint(Text("Sent while the bot was working: it took it into account right away, inside the work it was doing."))
                                .accessibilityIdentifier("steered-\(message.id)")
                        }
                        if collapsible {
                            Button { expanded.toggle() } label: {
                                if expanded { Text("Show less") } else { Text("Show full message") }
                            }
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("collapse-\(message.id)")
                        }
                    }
                    SentCitations(citations: cited.citations) { citation in
                        // `onNavigate`: only a message of this conversation.
                        guard citation.source.threadId == chat.threadId,
                              context.lookup(citation.source.messageId) != nil,
                              let jump = context.jump
                        else { return false }
                        jump(citation.source.messageId)
                        return true
                    }
                } else if showingSource, let source = message.text, !source.isEmpty {
                    RawMarkdownView(text: source)
                        .accessibilityIdentifier("raw-markdown-\(message.id)")
                } else {
                    MarkdownText(
                        source: message.text ?? "",
                        scrollIdentifier: "message-\(message.id)-scroll",
                        mentions: context.mentionPeers,
                        mentionEveryone: context.mentionEveryone,
                        attachmentScope: (chat.threadId, message.id),
                        cwAsk: cwAsk,
                        cwThreadId: chat.threadId,
                        cwBotId: message.from?.botId
                    ) { url in
                        openLink(url, message)
                    }
                        .foregroundStyle(desktop?.ink ?? BubbleColor.theirsText)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        // Chrome measures Geist a hair wider than Core Text: a
                        // line within 1.5 pt of the edge wraps there, not here
                        .padding(.trailing, desktop != nil && desktopFills(mine: false) ? 1.5 : 0)
                }
            }
            .frame(maxWidth: desktopFills(mine: mine) ? .infinity : nil, alignment: .leading)
            .padding(.horizontal, customCard ? 0 : (desktop != nil ? DesktopChatMetrics.bubblePadding.leading : Theme.Chat.bubblePaddingH))
            .padding(.vertical, customCard ? 0 : (desktop != nil ? DesktopChatMetrics.bubblePadding.top : Theme.Chat.bubblePaddingV))
            // No tail (reference 02): your message is a bubble in the accent,
            // the bot's reply one in a quiet grey (2026-10-28).
            .background(
                Group {
                    if !customCard {
                        RoundedRectangle(cornerRadius: desktop != nil ? DesktopChatMetrics.bubbleRadius : Theme.Metric.bubbleRadius, style: .continuous)
                            .fill(bubbleFill(mine: mine))
                    }
                }
            )

            // the hover row beside the bubble, outside its layout: the cap
            // (100 % - 82) already leaves it room, as on the desktop
            .overlay(alignment: mine ? .bottomLeading : .bottomTrailing) {
                if let hoverActions, desktop != nil {
                    DesktopMessageHoverStrip(model: hoverActions, mine: mine, hovering: hovering || parityHover)
                        .fixedSize()
                        .alignmentGuide(.leading) { d in d[.trailing] + 6 }
                        .alignmentGuide(.trailing) { d in d[.leading] - 6 }
                }
            }
            .modifier(DesktopBubbleCapModifier(cap: desktopCap(mine: mine), mine: mine))

            if !mine { Spacer(minLength: desktop == nil ? Theme.Chat.bubbleTrailingGap : 0) }
        }
        .onHover { hovering = $0 }
    }

    private var parityHover: Bool {
        #if DEBUG
        DesktopChatParity.forcesHover(message)
        #else
        false
        #endif
    }

    /// My bubble in a 1:1 takes the bot's colour (BubbleColors.user(botColor:)),
    /// whatever the skin's accent; a room keeps the skin's.
    private var botPaint: (fill: SkinColor, ink: SkinColor)? {
        // Black (the Grok look) keeps its neutral grey (2026-11-01)
        guard chat.isBot, !BubbleColors.keepsNeutralBubbles(themePalette.id) else { return nil }
        return BubbleColors.user(botColor: chat.color)
    }

    /// The text on my bubble.
    private var mineInk: Color {
        if let botPaint { return botPaint.ink.color }
        return desktop?.bubbleUserInk ?? BubbleColor.mineText
    }

    private func bubbleFill(mine: Bool) -> Color {
        _ = bubblePrefs.botBubble
        _ = openBot.openBotColor
        if mine, let botPaint { return botPaint.fill.color }
        if !mine, let paint = BotBubblePaint.current { return paint.fill }
        if let desktop { return mine ? desktop.bubbleUser : (message.webhookContent == nil ? desktop.bubbleBot : desktop.card) }
        return mine ? BubbleColor.mine : BubbleColor.theirs
    }

    /// The desktop's cap: the wide one for tables and rich fences.
    private func desktopCap(mine: Bool) -> CGFloat? {
        guard desktop != nil, let bubbleCap else { return bubbleCap }
        if !mine, let wideCap, DesktopChatMetrics.prefersWide(message.text ?? "") { return wideCap }
        return bubbleCap
    }

    /// A bubble holding the gallery or a wide block takes its whole cap,
    /// and so does text that wraps: CSS `w-fit` of wrapped text is the
    /// whole available width, where SwiftUI hugs the longest line.
    private func desktopFills(mine: Bool) -> Bool {
        guard let desktop else { return false }
        let text = mine ? Citations.split(attachedContent.text).display : (message.text ?? "")
        if let cap = desktopCap(mine: mine), DesktopChatMetrics.wraps(text, in: cap - 24, theme: desktop) { return true }
        if mine { return !attachedContent.attachments.isEmpty }
        return !message.generatedImages.isEmpty || !message.fileAttachments.isEmpty
            || (wideCap != nil && DesktopChatMetrics.prefersWide(message.text ?? ""))
    }
}

/// iPad desktop shell: a bubble no wider than the desktop's 560. The phone
/// (no cap) is left exactly as it was.
private struct DesktopBubbleCapModifier: ViewModifier {
    let cap: CGFloat?
    let mine: Bool

    func body(content: Content) -> some View {
        if let cap {
            content.frame(maxWidth: cap, alignment: mine ? .trailing : .leading)
        } else {
            content
        }
    }
}

/// The desktop's `RawMarkdownView`: the source as written, monospaced, on an
/// inset panel, selectable.
struct RawMarkdownView: View {
    @Environment(\.themePalette) var themePalette
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.mono(12.5))
            .lineSpacing(3)
            .foregroundStyle(Theme.textPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Theme.inset.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Theme.hairline.opacity(0.3), lineWidth: 1)
            )
    }
}

/// A long line of yours folded to the desktop's 160 pt behind a fade.
private struct CollapsedText: ViewModifier {
    let collapsed: Bool

    func body(content: Content) -> some View {
        if collapsed {
            content
                .frame(maxHeight: CGFloat(MessageCollapse.collapsedHeight), alignment: .top)
                .clipped()
                .mask(
                    LinearGradient(
                        stops: [.init(color: .black, location: 0.6), .init(color: .clear, location: 1)],
                        startPoint: .top, endPoint: .bottom
                    )
                )
        } else {
            content
        }
    }
}

/// @mentions of known peers, tinted as the desktop's `.mention-highlight`:
/// the peer's colour as a soft background and an underline.
enum MentionTint {
    static func apply(to attributed: inout AttributedString, peers: [MentionPeer], everyone: Bool) {
        guard !peers.isEmpty || everyone else { return }
        let plain = String(attributed.characters)
        guard plain.contains("@") else { return }
        for range in Mentions.ranges(in: plain, peers: peers, everyone: everyone) {
            let start = attributed.characters.index(attributed.characters.startIndex, offsetBy: range.start)
            let end = attributed.characters.index(start, offsetBy: range.end - range.start)
            let span = start..<end
            // Links and code keep their own look, as the remark plugin skips them.
            if attributed[span].runs.contains(where: { $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true }) {
                continue
            }
            if range.person {
                // A person tagged: a tinted chip, bold and stronger when it is the viewer.
                attributed[span].backgroundColor = Theme.accent.opacity(range.me ? 0.55 : 0.28)
                attributed[span].inlinePresentationIntent = range.me ? .stronglyEmphasized : nil
                continue
            }
            let color = range.colorName.map(MausPalette.color) ?? Theme.textSecondary
            attributed[span].backgroundColor = color.opacity(0.24)
            attributed[span].underlineStyle = Text.LineStyle(pattern: .solid, color: color)
        }
    }

    static func attributed(_ text: String, peers: [MentionPeer], everyone: Bool) -> AttributedString {
        var attributed = AttributedString(text)
        apply(to: &attributed, peers: peers, everyone: everyone)
        return attributed
    }
}
