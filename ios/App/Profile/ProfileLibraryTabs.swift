// The bot's links (`GET /api/bots/:id/links`), the Library tab's Links chip
// in the bot panel (iPhone and iPad): the first page, then "Show more". (The profile's Media
// and Files tabs became the Library's kind chips over the conversation's
// files, as on the desktop.)
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Links (08)

/// The bot's links, as the reference design's Links tab behaves: a row names the page
/// (its title and icon from `LinkPreviewStore`, else the link's text or
/// the domain), with the domain, the day and the conversation under it. A
/// tap opens a web page in the in-app browser (SFSafariViewController); a
/// long press offers Open in Safari, Copy Link, Share and Go to Message.
/// An address that only answers on the computer (`LinkReach.computer`:
/// localhost, 127.0.0.1, a private or `.local` address) is greyed with
/// "On the computer", and a tap copies it instead of opening a page that
/// cannot load.
struct LinksTab: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var loader: LibraryLoader<BotLink>
    /// Show the link's message in its conversation; the host closes what covers it.
    var onShowMessage: ((BotLink) -> Void)? = nil
    @State private var status: String?
    @State private var statusClear: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            if let page = loader.page, !page.items.isEmpty {
                ProfileCard {
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, link in
                        if index > 0 { PanelRowDivider(leading: Theme.PhonePanel.listTextColumn) }
                        LibraryLinkButton(bot: bot, link: link, subtitle: .full, identifier: "profile-link.\(index)", onShowMessage: onShowMessage) { copied() }
                    }
                }
                if page.hasMore { ShowMoreButton(loading: loader.loading) { loader.loadMore() } }
            } else {
                LibraryEmptyState(loading: loader.loading || loader.page == nil && loader.problem == nil, problem: loader.problem, empty: Text("No links yet"))
            }
        }
        .overlay(alignment: .top) {
            if let status {
                Text(verbatim: status)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .transition(.opacity)
                    // the toast sits over the first link: touches go through to it
                    .allowsHitTesting(false)
                    .accessibilityIdentifier("profile-links-status")
            }
        }
    }

    private func copied() {
        withAnimation { status = String(localized: "Link copied") }
        statusClear?.cancel()
        statusClear = Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { status = nil }
        }
    }
}

/// One of the bot's links as a Library row, on the Links chip and among the
/// files on All (#4101): a tap opens a web page in the in-app browser
/// (SFSafariViewController), or copies an address that only answers on the
/// computer; a long press offers Open, Open in Safari, Copy Link, Share and
/// Go to Message. The host shows "Link copied" (`onCopied`).
struct LibraryLinkButton: View {
    /// Under the title: on Links the host, the day and the conversation;
    /// on All the host alone, as the reference's All page draws a link.
    enum Subtitle { case full, host }

    let bot: Bot
    let link: BotLink
    let subtitle: Subtitle
    let identifier: String
    var onShowMessage: ((BotLink) -> Void)? = nil
    let onCopied: () -> Void
    @ObservedObject private var previews = LinkPreviewStore.shared
    @State private var opened: IdentifiedURL?
    @State private var sharing: IdentifiedURL?

    var body: some View {
        let computer = link.reach == .computer
        let preview = computer ? nil : link.webURL.flatMap(previews.preview(for:))
        let line = subtitleText(computer: computer)
        Button {
            Haptics.selection()
            if computer {
                copy()
            } else if let url = link.webURL {
                opened = IdentifiedURL(url: url)
            }
        } label: {
            LinkRow(link: link, preview: preview, subtitle: line, computer: computer)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(computer: computer) }
        .onAppear { if !computer, let url = link.webURL { previews.load(url) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: [LinkRow.title(link, preview: preview, computer: computer), line, link.readableAddress].joined(separator: ", ")))
        .accessibilityHint(computer ? Text("Copies the link") : Text("Opens the page"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: Text("Copy link")) { copy() }
        .accessibilityAction(named: Text("Share")) { if let url = link.webURL { sharing = IdentifiedURL(url: url) } }
        .accessibilityAction(named: Text("Go to message")) { onShowMessage?(link) }
        .accessibilityIdentifier(identifier)
        .sheet(item: $opened) { item in
            CloudDesktopBrowser(url: item.url).ignoresSafeArea()
        }
        .sheet(item: $sharing) { item in ProfileShareSheet(items: [item.url]) }
    }

    @ViewBuilder
    private func menu(computer: Bool) -> some View {
        if !computer, let url = link.webURL {
            Button { opened = IdentifiedURL(url: url) } label: { Label("Open", systemImage: "safari") }
                .accessibilityIdentifier("link-menu.open")
            Button { UIApplication.shared.open(url) } label: { Label("Open in Safari", systemImage: "arrow.up.forward.app") }
                .accessibilityIdentifier("link-menu.safari")
        }
        Button { copy() } label: { Label("Copy link", systemImage: "doc.on.doc") }
            .accessibilityIdentifier("link-menu.copy")
        if let url = link.webURL {
            Button { sharing = IdentifiedURL(url: url) } label: { Label("Share", systemImage: "square.and.arrow.up") }
                .accessibilityIdentifier("link-menu.share")
        }
        if let onShowMessage, link.messageId != nil {
            Button { onShowMessage(link) } label: { Label("Go to message", systemImage: "text.bubble") }
                .accessibilityIdentifier("link-menu.message")
        }
    }

    /// "example.com · Oct 12 · Migration plan" on Links, "example.com" on
    /// All; "On the computer" in place of the host for a local address.
    private func subtitleText(computer: Bool) -> String {
        let host = computer ? String(localized: "On the computer") : link.domain
        guard subtitle == .full else { return host }
        var parts = [host]
        if link.at > 0 { parts.append(Self.day(link.at)) }
        let thread = link.threadId.flatMap { id in bot.tasks?.first { $0.threadId == id }?.title }
        if let thread, !thread.isEmpty { parts.append(thread) } else if link.threadId != bot.threadId || bot.tasks == nil { parts.append(bot.name) }
        return parts.joined(separator: " \u{00B7} ")
    }

    private static func day(_ at: Double) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
        return sameYear ? date.formatted(.dateTime.month(.abbreviated).day()) : date.formatted(.dateTime.year().month(.abbreviated).day())
    }

    private func copy() {
        UIPasteboard.general.string = link.webURL?.absoluteString ?? link.url
        onCopied()
    }
}

/// One link: the page's image or icon (else a globe, or a computer for a
/// computer-only address), the title, and the subtitle.
struct LinkRow: View {
    @Environment(\.themePalette) var themePalette
    let link: BotLink
    let preview: LinkPreview?
    let subtitle: String
    let computer: Bool

    static func title(_ link: BotLink, preview: LinkPreview?, computer: Bool) -> String {
        if computer { return link.title ?? link.readableAddress }
        return preview?.title ?? link.fallbackTitle
    }

    /// The reference's Library row (#4101): a 26 pt rounded thumbnail, the
    /// page's name on one line cut at its end, the host and the day muted.
    var body: some View {
        HStack(spacing: 0) {
            thumbnail
                .frame(width: Theme.PhonePanel.thumbnail, height: Theme.PhonePanel.thumbnail)
                .padding(.leading, Theme.PhonePanel.thumbnailLeading)
                .frame(width: Theme.PhonePanel.listTextColumn, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: Self.title(link, preview: preview, computer: computer))
                    .font(Theme.PhonePanel.rowFont)
                    .foregroundStyle(computer ? Theme.textSecondary : Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: subtitle)
                    .font(Theme.PhonePanel.subtitleFont)
                    .foregroundStyle(computer ? Theme.textTertiary : Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if computer, link.title != nil {
                    Text(verbatim: link.readableAddress)
                        .font(Theme.PhonePanel.subtitleFont.monospaced())
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if computer {
                Image(systemName: "doc.on.doc")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.leading, 12)
            }
        }
        .padding(.trailing, Theme.PhonePanel.textInset)
        .padding(.vertical, 12)
        .frame(minHeight: Theme.PhonePanel.listRow)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let image = preview?.image ?? preview?.icon {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: Theme.PhonePanel.thumbnail, height: Theme.PhonePanel.thumbnail)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.hairline))
        } else {
            Image(systemName: computer ? "desktopcomputer" : "globe")
                .font(.system(size: 17.5))
                .foregroundStyle(computer ? Theme.textTertiary : Theme.iconGrey)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Empty

struct LibraryEmptyState: View {
    @Environment(\.themePalette) var themePalette
    let loading: Bool
    let problem: String?
    let empty: Text

    var body: some View {
        ProfileCard {
            HStack {
                if loading {
                    ProgressView().controlSize(.small)
                } else if let problem {
                    Text(verbatim: problem).foregroundStyle(Theme.textSecondary)
                } else {
                    empty.foregroundStyle(Theme.textDisabled)
                }
                Spacer()
            }
            .font(Theme.Font.body)
            .padding(.leading, Theme.Profile.textInset)
            .frame(height: Theme.Profile.singleRow)
        }
        .accessibilityIdentifier("profile-library-empty")
    }
}
