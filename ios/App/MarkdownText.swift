// Bot replies, rendered.
//
// `Markdown.blocks` does the splitting; this draws each block and hands the
// inline run to Foundation, which knows emphasis, code spans, strikethrough
// and links. SwiftUI makes the links tappable on its own, which is most of
// why this is worth doing at all — a reply full of sources was previously a
// wall of bracketed URLs.
//
// Only bot messages get this. The desktop makes the same split: what you
// typed is shown as you typed it, because markdown you did not intend is
// worse than markdown you did.
import SwiftUI
import UIKit
import CompanionCore

private struct OptionalIdentifier: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let identifier: String?

    func body(content: Content) -> some View {
        if let identifier {
            content.accessibilityIdentifier(identifier)
        } else {
            content
        }
    }
}

struct MarkdownText: View {
    @Environment(\.themePalette) var themePalette
    let source: String
    /// Draws a caret after the last block. The streaming bubble sets this so
    /// the live reply and the settled one are the same view with the same
    /// layout — a caret bolted on outside would put it on its own line the
    /// moment the reply ends in a list item.
    var caret: Bool = false
    /// Identifier for the first table's horizontal scroll view. Settled
    /// bubbles pass `message-<id>-scroll`. Streaming and file preview pass nil.
    var scrollIdentifier: String? = nil
    var openLink: ((URL) -> OpenURLAction.Result)?
    /// A ```cw fence asks for approval through this. Nil leaves the card read-only.
    var cwAsk: ((CwActionBody) -> Void)? = nil
    var cwThreadId: String? = nil
    var cwBotId: String? = nil
    /// @mentions of these peers are tinted (MS21), as the desktop's
    /// `remarkMentions` does; links and code spans are left alone.
    var mentions: [MentionPeer] = []
    var mentionEveryone = false
    /// The message a picture written in the reply belongs to: a path on the
    /// computer loads through that message's file route (CA28).
    var attachmentScope: (threadId: String, messageId: String)?
    /// Pictures as their alt text (an email draft's body, as the desktop's
    /// EmailCard draws them).
    var picturesAsText = false
    /// A chat widget's Markdown node: an HTML ```widget, ```artifact or
    /// ```cw fence shows as code, never as a card or a frame
    /// (`<ChatMarkdown inert>` on the desktop).
    var inert = false

    /// Spoilers this reader has revealed, by their text.
    @State private var revealed: Set<String> = []
    /// The footnote a tapped reference opened.
    @State private var openFootnote: MarkdownFootnote?
    /// iPad desktop shell: 13/20 text, 8 pt paragraphs, 4 pt list items.
    @Environment(\.desktopChatText) private var desktop
    /// Find in conversation: the landed hit's words in this message.
    @Environment(\.desktopFindHighlight) private var findHighlight

    private var bodyFont: Font { desktop?.font(DesktopChatMetrics.textSize) ?? Theme.Font.body }
    private var bodyLineSpacing: CGFloat { desktop.map(DesktopChatMetrics.lineSpacing) ?? Theme.bodyLineSpacing }

    private static func isListItem(_ block: MarkdownBlock) -> Bool {
        switch block {
        case .bullet, .ordered, .task: true
        default: false
        }
    }

    /// The desktop's gap above block `index`: 4 between list items, 8 otherwise.
    private func desktopGap(_ blocks: [MarkdownBlock], _ index: Int) -> CGFloat {
        guard desktop != nil, index > 0 else { return 0 }
        return Self.isListItem(blocks[index]) && Self.isListItem(blocks[index - 1])
            ? DesktopChatMetrics.listItemGap : DesktopChatMetrics.paragraphGap
    }

    init(
        source: String,
        caret: Bool = false,
        scrollIdentifier: String? = nil,
        mentions: [MentionPeer] = [],
        mentionEveryone: Bool = false,
        attachmentScope: (threadId: String, messageId: String)? = nil,
        picturesAsText: Bool = false,
        cwAsk: ((CwActionBody) -> Void)? = nil,
        cwThreadId: String? = nil,
        cwBotId: String? = nil,
        openLink: ((URL) -> OpenURLAction.Result)? = nil,
        inert: Bool = false
    ) {
        self.inert = inert
        self.source = source
        self.caret = caret
        self.scrollIdentifier = scrollIdentifier
        self.mentions = mentions
        self.mentionEveryone = mentionEveryone
        self.attachmentScope = attachmentScope
        self.picturesAsText = picturesAsText
        self.cwAsk = cwAsk
        self.cwThreadId = cwThreadId
        self.cwBotId = cwBotId
        self.openLink = openLink
    }

    /// Identifier prefix for the rich blocks of a settled bubble
    /// (`message-<id>-rich-<n>`); nil while streaming and in previews.
    private var richPrefix: String? {
        scrollIdentifier.map { $0.hasSuffix("-scroll") ? String($0.dropLast("-scroll".count)) + "-rich" : $0 + "-rich" }
    }

    var body: some View {
        // A settled reply's blocks never change; the live one grows every
        // frame and would only fill the cache with drafts of itself.
        let blocks = caret ? Markdown.blocks(source) : MarkdownParseCache.blocks(source)
        // A fence the message has not closed is still being written: charts,
        // widgets and email cards wait for it (ChatMarkdown `pendingAt`).
        let openFence = RichBlocks.unclosedFenceOffset(source) >= 0
        let lastCode = blocks.lastIndex { if case .code = $0 { return true }; return false }
        VStack(alignment: .leading, spacing: desktop == nil ? Theme.Chat.paragraphSpacing : 0) {
            let firstTable = blocks.firstIndex { if case .table = $0 { return true }; return false }
            ForEach(Array(blocks.enumerated()), id: \.offset) { item in
                view(
                    for: item.element,
                    tail: caret && item.offset == blocks.count - 1,
                    scrollIdentifier: item.offset == firstTable ? scrollIdentifier : nil,
                    pending: caret || (openFence && item.offset == lastCode),
                    identifier: richPrefix.map { "\($0)-\(item.offset)" }
                )
                .padding(.top, desktopGap(blocks, item.offset))
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            switch url.scheme {
            case Self.spoilerScheme:
                let key = Self.spoilerKey(url)
                if revealed.contains(key) { revealed.remove(key) } else { revealed.insert(key) }
                return .handled
            case Markdown.footnoteScheme:
                let number = Int(url.absoluteString.dropFirst(Markdown.footnoteScheme.count + 1)) ?? 0
                openFootnote = footnotes(blocks).first { $0.number == number }
                return .handled
            default:
                return openLink?(url) ?? .systemAction(url)
            }
        })
        .alert(
            openFootnote.map { String(localized: "Footnote \($0.number)") } ?? "",
            isPresented: Binding(get: { openFootnote != nil }, set: { if !$0 { openFootnote = nil } }),
            presenting: openFootnote
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { note in
            Text(verbatim: renderedInline(note.text))
        }
    }

    private func footnotes(_ blocks: [MarkdownBlock]) -> [MarkdownFootnote] {
        for block in blocks { if case let .footnotes(notes) = block { return notes } }
        return []
    }

    /// A nested reply part (a callout's body) with this one's settings.
    private func nested(_ text: String) -> MarkdownText {
        MarkdownText(
            source: text, mentions: mentions, mentionEveryone: mentionEveryone,
            attachmentScope: attachmentScope, picturesAsText: picturesAsText,
            cwAsk: cwAsk, cwThreadId: cwThreadId, cwBotId: cwBotId, openLink: openLink, inert: inert
        )
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock, tail: Bool, scrollIdentifier: String?, pending: Bool, identifier: String?) -> some View {
        switch block {
        case let .paragraph(text):
            // inert (a widget's Markdown): a YouTube link stays a link
            let youtubeIds = inert ? [] : YouTubeLinks.ids(in: text)
            let artifactUrls = inert ? [] : ClaudeArtifacts.urls(in: text)
            if youtubeIds.count == 1, YouTubeLinks.isStandaloneParagraph(text, videoId: youtubeIds[0]) {
                YouTubeMiniPlayerView(videoId: youtubeIds[0], identifier: identifier.map { "\($0)-yt" })
            } else if artifactUrls.count == 1, ClaudeArtifacts.isStandaloneParagraph(text, url: artifactUrls[0]) {
                ClaudeArtifactCardView(url: artifactUrls[0], identifier: identifier.map { "\($0)-ca" })
            } else {
                VStack(alignment: .leading, spacing: desktop == nil ? Theme.Chat.paragraphSpacing : DesktopChatMetrics.paragraphGap) {
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        inline(text, tail: tail)
                            .font(bodyFont)
                            .lineSpacing(bodyLineSpacing)
                            .modifier(DesktopLineBox(theme: desktop))
                            .fixedSize(horizontal: false, vertical: true)
                            .modifier(RichIdentifier(identifier: text.contains("~~") || text.contains(Markdown.footnoteScheme) ? identifier : nil))
                    }
                    ForEach(youtubeIds, id: \.self) { videoId in
                        YouTubeMiniPlayerView(videoId: videoId, identifier: identifier.map { "\($0)-yt-\(videoId)" })
                    }
                    ForEach(artifactUrls, id: \.self) { artifactUrl in
                        ClaudeArtifactCardView(url: artifactUrl, identifier: identifier.map { "\($0)-ca-\(artifactUrl.suffix(8))" })
                    }
                }
            }

        case let .heading(level, text):
            // Three sizes, not six. A chat bubble is not a document, and an
            // h4 that looks exactly like body text is a heading that failed.
            inline(text, tail: tail)
                .font(.system(size: level <= 1 ? 17 : level == 2 ? 15.5 : 14, weight: .semibold))
                .lineSpacing(bodyLineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

        case let .bullet(indent, text):
            bullet(indent: indent, text: text, tail: tail)

        case let .ordered(indent, number, text):
            marker("\(number).", indent: indent, text: text, tail: tail)

        case let .task(indent, number, checked, text):
            taskRow(indent: indent, number: number, checked: checked, text: text, tail: tail)

        case let .table(table):
            RichTableView(
                table: table, tail: tail, scrollIdentifier: scrollIdentifier, identifier: identifier,
                inline: { inline($0, tail: $1) }, plain: renderedInline
            )

        case let .quote(text):
            HStack(alignment: .top, spacing: desktop == nil ? 8 : 12) {
                RoundedRectangle(cornerRadius: desktop == nil ? 1.5 : 0)
                    .fill(desktop?.hairline ?? Theme.parity(Color.secondary.opacity(0.4), Theme.hairline))
                    .frame(width: desktop == nil ? 3 : 2)
                inline(text, tail: tail)
                    .font(bodyFont)
                    .lineSpacing(bodyLineSpacing)
                    .modifier(DesktopLineBox(theme: desktop))
                    .foregroundStyle(desktop?.inkSecondary ?? Theme.parity(Color.secondary, Theme.textSecondary))
            }
            .fixedSize(horizontal: false, vertical: true)

        case let .code(language, text):
            fence(language: language, code: text, tail: tail, pending: pending, identifier: identifier)

        case .rule:
            Divider().padding(.vertical, 2)

        case let .callout(kind, title, text):
            CalloutView(kind: kind, title: title, identifier: identifier) {
                if !text.isEmpty {
                    nested(text)
                        .foregroundStyle(Theme.textPrimary)
                }
            }

        case let .image(image):
            if picturesAsText {
                inline(image.alt, tail: tail).font(bodyFont)
            } else {
                MarkdownImageView(image: image, scope: attachmentScope, identifier: identifier)
            }

        case let .footnotes(notes):
            FootnotesView(notes: notes, inline: { inline($0) }, identifier: identifier)
        }
    }

    /// A fenced block, routed the way ChatMarkdown's `pre` does: mermaid to
    /// the diagram block, then email, artifact JSON to a page card, widget,
    /// chart and CSV fences, and everything else to the code block.
    @ViewBuilder
    private func fence(language: String?, code: String, tail: Bool, pending: Bool, identifier: String?) -> some View {
        let lang = language ?? ""
        let kind = RichBlocks.fenceKind(lang)
        let email = kind == .email || kind == nil ? RichBlocks.parseEmailBlock(code, lang: lang) : nil
        let csv = kind == .csv && !pending ? MarkdownTable.delimited(code, language: lang) : nil
        if inert, kind == .cw || kind == .widget {
            CodeBlockView(language: language, code: code, pending: pending, caret: caretText(tail), identifier: identifier)
        } else if kind == .cw, let widget = CwWidget.parse(code) {
            CwWidgetCard(widget: widget, threadId: cwThreadId, botId: cwBotId, ask: cwAsk)
        } else if lang.trimmingCharacters(in: .whitespaces).lowercased() == "mermaid" {
            MermaidBlockView(code: code, pending: pending, identifier: identifier)
        } else if let email {
            EmailCardView(draft: email, pending: pending, identifier: identifier)
        } else if kind == .widget, let consent = ClaudeArtifacts.parseConsent(code) {
            ClaudeArtifactCardView(url: consent.url, consent: consent, identifier: identifier)
        } else if kind == .widget {
            if let page = RichBlocks.parseArtifactPage(code) {
                // a YouTube page is the video itself: the player, not a page card
                if !pending, let videoId = page.url.flatMap({ YouTubeLinks.videoId(from: $0) }) {
                    YouTubeMiniPlayerView(videoId: videoId, identifier: identifier.map { "\($0)-yt" })
                } else if let claudeUrl = ClaudeArtifacts.canonicalUrl(page.url) {
                    ClaudeArtifactCardView(url: claudeUrl, page: page, identifier: identifier)
                } else {
                    ArtifactCardView(page: page, pending: pending, identifier: identifier)
                }
            } else {
                WidgetFrameView(code: code, pending: pending, identifier: identifier)
            }
        } else if kind == .chart {
            ChartBlockView(code: code, pending: pending, identifier: identifier, inline: { inline($0, tail: $1) }, plain: renderedInline)
        } else if let csv, !csv.headers.isEmpty {
            RichTableView(
                table: csv, tail: tail, literal: true, identifier: identifier,
                inline: { inline($0, tail: $1) }, plain: renderedInline
            )
        } else {
            CodeBlockView(language: language, code: code, pending: pending, caret: caretText(tail), identifier: identifier)
        }
    }

    private func taskRow(indent: Int, number: Int?, checked: Bool, text: String, tail: Bool) -> some View {
        let state = String(localized: checked ? "completed" : "not completed")
        let words = renderedInline(text)
        let label = words.isEmpty ? state : "\(state), \(words)"
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let number {
                Text("\(number).")
                    .font(bodyFont)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    .frame(minWidth: 16, alignment: .trailing)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .font(bodyFont)
                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                inline(text, tail: tail).font(bodyFont).lineSpacing(bodyLineSpacing)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
        }
        .padding(.leading, CGFloat(indent) * Theme.Chat.bulletIndent)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// The words VoiceOver should hear, with inline markers removed. The
    /// visible text still goes through Foundation so emphasis stays styled.
    private func renderedInline(_ text: String) -> String {
        if let attributed = MarkdownParseCache.inline(text) {
            return String(attributed.characters)
        }
        return text
    }

    private func marker(_ symbol: String, indent: Int, text: String, tail: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(symbol)
                .font(bodyFont)
                .foregroundStyle(desktop?.ink ?? Theme.bulletDot)
                .frame(width: (desktop == nil ? Theme.Chat.bulletIndent : DesktopChatMetrics.listIndent) - 6, alignment: .trailing)
                .padding(.trailing, 6)
            inline(text, tail: tail)
                .font(bodyFont)
                .lineSpacing(bodyLineSpacing)
        }
        .modifier(DesktopLineBox(theme: desktop))
        .padding(.leading, CGFloat(indent) * (desktop == nil ? Theme.Chat.bulletIndent : DesktopChatMetrics.listIndent))
        .fixedSize(horizontal: false, vertical: true)
    }

    /// A list item (reference 02): a 5 pt dot 5 pt in from the text column,
    /// centred on the first line's x-height, and the text 26 pt in. Wrapped
    /// lines align with the first.
    @ViewBuilder
    private func bullet(indent: Int, text: String, tail: Bool) -> some View {
        if let desktop {
            // `list-disc pl-5`: the disc in the 20 pt gutter, the text at 20
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Circle()
                    .fill(desktop.ink)
                    .frame(width: 4.5, height: 4.5)
                    .alignmentGuide(.firstTextBaseline) { d in d.height + 2.6 }
                    .padding(.leading, 3)
                    .padding(.trailing, DesktopChatMetrics.listIndent - 7.5)
                    .accessibilityHidden(true)
                inline(text, tail: tail)
                    .font(bodyFont)
                    .lineSpacing(bodyLineSpacing)
            }
            .modifier(DesktopLineBox(theme: desktop))
            .padding(.leading, CGFloat(indent) * DesktopChatMetrics.listIndent)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            phoneBullet(indent: indent, text: text, tail: tail)
        }
    }

    private func phoneBullet(indent: Int, text: String, tail: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Circle()
                .fill(Theme.bulletDot)
                .frame(width: Theme.Chat.bulletDot, height: Theme.Chat.bulletDot)
                // dot bottom sits 0.9 pt above the baseline
                .alignmentGuide(.firstTextBaseline) { d in d.height + 0.9 }
                .padding(.leading, Theme.Chat.bulletDotInset)
                .padding(.trailing, Theme.Chat.bulletIndent - Theme.Chat.bulletDotInset - Theme.Chat.bulletDot)
                .accessibilityHidden(true)
            inline(text, tail: tail)
                .font(bodyFont)
                .lineSpacing(bodyLineSpacing)
        }
        .padding(.leading, CGFloat(indent) * Theme.Chat.bulletIndent)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Inline markdown via Foundation. `.inlineOnlyPreservingWhitespace`
    /// because the blocks are already split — asking for `.full` here would
    /// have it re-interpret list markers this has already consumed.
    ///
    /// Falling back to the raw string on a parse failure is the point: a
    /// half-typed link mid-stream should show as the characters the model has
    /// sent so far, not vanish until it closes the bracket.
    private func inline(_ text: String, tail: Bool = false) -> Text {
        let rendered: Text
        if let attributed = styledInline(text, cacheable: !tail) {
            rendered = Text(attributed)
        } else {
            rendered = Text(text)
        }
        return rendered + caretText(tail)
    }

    /// The parsed and styled run for `text`, or nil when Foundation cannot
    /// parse it. A settled block is parsed once and kept (`MarkdownParseCache`)
    /// keyed by its text and everything its style depends on; the block the
    /// live reply is still writing (`cacheable` false) is parsed fresh.
    /// `[`code`](address-with-a-backtick)` -> `` `code` ``.
    static func droppingBacktickLinks(_ text: String) -> String {
        guard text.contains("`](") else { return text }
        return text.replacingOccurrences(of: #"\[(`[^`\]]+`)\]\(([^)\s]*`[^)\s]*)\)"#, with: "$1", options: .regularExpression)
    }

    private func styledInline(_ text: String, cacheable: Bool) -> AttributedString? {
        // The iPad desktop styles from its theme value; only the phone's
        // styling is fully described by the key.
        let key = cacheable && desktop == nil
            ? MarkdownParseCache.styleKey(text, mentions: mentions, everyone: mentionEveryone, revealed: revealed)
            : nil
        if let key, let hit = MarkdownParseCache.styled(key) { return hit.value }
        // the desktop drops a link whose address holds a raw backtick (not a
        // URL its sanitizer keeps) and draws its text as written: a code
        // span stays a code span (`[`x`](x`)`), never a blue link
        let inlineSource = desktop == nil ? text : Self.droppingBacktickLinks(text)
        let parsed = cacheable ? MarkdownParseCache.inline(inlineSource) : MarkdownParseCache.parseInline(inlineSource)
        let styled = parsed.map { parsed -> AttributedString in
            var attributed = parsed
            if let desktop {
                // a custom face takes no bold or italic from the intent: set
                // the weight and the slant on the run (Geist has no italic;
                // the browser slants it, as `.italic()` does here)
                for run in attributed.runs {
                    guard let intent = run.inlinePresentationIntent else { continue }
                    let bold = intent.contains(.stronglyEmphasized), italic = intent.contains(.emphasized)
                    guard bold || italic else { continue }
                    var font = desktop.font(DesktopChatMetrics.textSize, bold ? .bold : .regular)
                    if italic {
                        // Geist has no italic face and `.italic()` does not
                        // slant a custom font: skew it, as the browser's
                        // synthesized oblique does
                        let upright = desktop.uiFont(DesktopChatMetrics.textSize, bold ? .bold : .regular)
                        let slanted = upright.fontDescriptor.withMatrix(CGAffineTransform(a: 1, b: 0, c: 0.2, d: 1, tx: 0, ty: 0))
                        font = Font(UIFont(descriptor: slanted, size: upright.pointSize) as CTFont)
                    }
                    attributed[run.range].font = font
                }
            }
            // Code spans: SF Mono 12 on the bubble itself, no chip.
            for run in attributed.runs where run.inlinePresentationIntent?.contains(.code) == true {
                attributed[run.range].font = desktop != nil ? Theme.mono(12) : Theme.Font.code
                if desktop != nil { attributed[run.range].tracking = DesktopChatMetrics.monoTracking(12) }
                if let desktop { attributed[run.range].backgroundColor = desktop.inset }
            }
            if let desktop {
                // `px-1` on the desktop's code chip: 4 pt each side. Geist
                // has no fixed-width spaces (they fall back) and every space
                // of the mono face is a 7.2 cell: a three-per-em space of
                // the system face at 12.235 pt is 4.0 wide.
                let ranges = attributed.runs.filter { $0.inlinePresentationIntent?.contains(.code) == true }.map(\.range)
                // A word joiner glues each pad to its chip: a line may break
                // before the chip, never between a pad and the code (the pad
                // would hang at the previous line's end).
                for range in ranges.reversed() {
                    var leading = AttributedString("\u{2004}\u{2060}")
                    leading.font = .system(size: 12.235)
                    leading.backgroundColor = desktop.inset
                    var trailing = AttributedString("\u{2060}\u{2004}")
                    trailing.font = .system(size: 12.235)
                    trailing.backgroundColor = desktop.inset
                    attributed.insert(trailing, at: range.upperBound)
                    attributed.insert(leading, at: range.lowerBound)
                }
            }
            if let desktop {
                // links: `underline decoration-accent/40`
                for run in attributed.runs where run.link != nil {
                    attributed[run.range].underlineStyle = Text.LineStyle(pattern: .solid, color: desktop.accent.opacity(0.4))
                }
            }
            if desktop != nil {
                // SwiftUI draws a `.code` intent in the environment's size
                // (13) whatever the run's font says: drop the intent so the
                // run's SF Mono 12 holds (the desktop's `text-[12px]`).
                for run in attributed.runs where run.inlinePresentationIntent?.contains(.code) == true {
                    var intent = run.inlinePresentationIntent ?? []
                    intent.remove(.code)
                    attributed[run.range].inlinePresentationIntent = intent.isEmpty ? nil : intent
                }
            }
            MentionTint.apply(to: &attributed, peers: mentions, everyone: mentionEveryone)
            if let desktop, let findHighlight, DesktopFindHighlight.holdsFirst(block: text, of: findHighlight, in: source) {
                DesktopFindHighlight.apply(to: &attributed, needle: findHighlight, theme: desktop)
            }
            styleFootnotes(&attributed)
            styleSpoilers(&attributed)
            return attributed
        }
        if let key { MarkdownParseCache.store(styled, for: key) }
        return styled
    }

    // MARK: Spoilers and footnote marks

    static let spoilerScheme = "sagax-spoiler"

    static func spoilerURL(_ key: String) -> URL? {
        var components = URLComponents()
        components.scheme = spoilerScheme
        components.path = key
        return components.url
    }

    static func spoilerKey(_ url: URL) -> String {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.path ?? url.absoluteString
    }

    /// `~~text~~` in a bot reply is a spoiler (ChatMarkdown `Spoiler`), not
    /// a deletion: hidden behind a raised chip until tapped, then shown with
    /// a dotted underline and a small "Hide". Display only: the stored text,
    /// copies and the model's context keep the raw `~~text~~`.
    private func styleSpoilers(_ attributed: inout AttributedString) {
        let ranges = attributed.runs
            .filter { $0.inlinePresentationIntent?.contains(.strikethrough) == true }
            .map(\.range)
        guard !ranges.isEmpty else { return }
        for range in ranges.reversed() {
            let key = String(attributed[range].characters)
            guard let url = Self.spoilerURL(key) else { continue }
            var intent = attributed[range].inlinePresentationIntent ?? []
            intent.remove(.strikethrough)
            if revealed.contains(key) {
                attributed[range].inlinePresentationIntent = intent
                attributed[range].underlineStyle = Text.LineStyle(pattern: .dot, color: Theme.hairline)
                var hide = AttributedString(" " + String(localized: "Hide"))
                hide.link = url
                hide.font = .system(size: 11)
                attributed.insert(hide, at: range.upperBound)
            } else {
                // the words become figure spaces on a raised chip: nothing to
                // read until the tap, whatever colour the link takes
                var mask = AttributedString(String(repeating: "\u{2007}", count: max(2, key.count)))
                mask.link = url
                mask.backgroundColor = Theme.cardRaised
                mask.inlinePresentationIntent = intent
                if let font = attributed[range].font { mask.font = font }
                attributed.replaceSubrange(range, with: mask)
            }
        }
    }

    /// Footnote references (`[^id]`, rewritten by the splitter as links)
    /// read as small raised numbers.
    private func styleFootnotes(_ attributed: inout AttributedString) {
        for run in attributed.runs where run.link?.scheme == Markdown.footnoteScheme {
            attributed[run.range].font = .system(size: 10, weight: .medium)
            attributed[run.range].baselineOffset = 5
        }
    }

    /// A figure space then a block, so the caret sits off the last glyph
    /// rather than touching it. Empty when not streaming — an empty `Text`
    /// concatenated in costs nothing and keeps the callers branch-free.
    private func caretText(_ tail: Bool) -> Text {
        tail ? Text("\u{2007}▍").foregroundColor(Theme.parity(Color.secondary, Theme.textSecondary)) : Text("")
    }
}

/// Parsed markdown, kept between renders. Parsing is pure (the same text
/// always gives the same blocks and the same inline runs), so a reply that
/// has settled is parsed once instead of on every render of the chat.
/// `NSCache` is thread-safe and gives the memory back under pressure.
enum MarkdownParseCache {
    final class Box<Value>: NSObject {
        let value: Value
        init(_ value: Value) { self.value = value }
    }

    private static let blockCache: NSCache<NSString, Box<[MarkdownBlock]>> = {
        let cache = NSCache<NSString, Box<[MarkdownBlock]>>()
        cache.countLimit = 400
        return cache
    }()
    private static let inlineCache: NSCache<NSString, Box<AttributedString?>> = {
        let cache = NSCache<NSString, Box<AttributedString?>>()
        cache.countLimit = 3000
        return cache
    }()
    private static let styledCache: NSCache<NSString, Box<AttributedString?>> = {
        let cache = NSCache<NSString, Box<AttributedString?>>()
        cache.countLimit = 3000
        return cache
    }()

    static func blocks(_ source: String) -> [MarkdownBlock] {
        let key = source as NSString
        if let hit = blockCache.object(forKey: key) { return hit.value }
        let blocks = Markdown.blocks(source)
        blockCache.setObject(Box(blocks), forKey: key)
        return blocks
    }

    /// Foundation's inline parse, as `MarkdownText` asks for it.
    static func parseInline(_ text: String) -> AttributedString? {
        try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
    }

    static func inline(_ text: String) -> AttributedString? {
        let key = text as NSString
        if let hit = inlineCache.object(forKey: key) { return hit.value }
        let parsed = parseInline(text)
        inlineCache.setObject(Box(parsed), forKey: key)
        return parsed
    }

    /// The text plus everything the phone's styling reads: the skin (its
    /// colours and face), the mentions, and which spoilers are open.
    static func styleKey(_ text: String, mentions: [MentionPeer], everyone: Bool, revealed: Set<String>) -> NSString {
        var style = Hasher()
        style.combine(ThemeRuntime.palette.id)
        style.combine(ThemeRuntime.palette.isDark)
        style.combine(ThemeRuntime.typeface.rawValue)
        style.combine(ThemeRuntime.desktopFace)
        style.combine(mentions)
        style.combine(everyone)
        style.combine(revealed)
        return "\(style.finalize())\u{1}\(text)" as NSString
    }

    static func styled(_ key: NSString) -> Box<AttributedString?>? {
        styledCache.object(forKey: key)
    }

    static func store(_ styled: AttributedString?, for key: NSString) {
        styledCache.setObject(Box(styled), forKey: key)
    }
}
