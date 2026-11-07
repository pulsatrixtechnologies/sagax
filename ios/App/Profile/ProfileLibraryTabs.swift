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
    @ObservedObject private var previews = LinkPreviewStore.shared
    @State private var opened: IdentifiedURL?
    @State private var sharing: IdentifiedURL?
    @State private var status: String?
    @State private var statusClear: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            if let page = loader.page, !page.items.isEmpty {
                ProfileCard {
                    ForEach(Array(page.items.enumerated()), id: \.element.id) { index, link in
                        if index > 0 { ProfileDivider() }
                        row(link, index: index)
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
        .sheet(item: $opened) { link in
            CloudDesktopBrowser(url: link.url).ignoresSafeArea()
        }
        .sheet(item: $sharing) { item in ProfileShareSheet(items: [item.url]) }
    }

    private func row(_ link: BotLink, index: Int) -> some View {
        let computer = link.reach == .computer
        let preview = computer ? nil : link.webURL.flatMap(previews.preview(for:))
        return Button {
            Haptics.selection()
            if computer {
                copy(link)
            } else if let url = link.webURL {
                opened = IdentifiedURL(url: url)
            }
        } label: {
            LinkRow(link: link, preview: preview, subtitle: subtitle(link, computer: computer), computer: computer)
        }
        .buttonStyle(.plain)
        .contextMenu { menu(link, computer: computer) }
        .onAppear { if !computer, let url = link.webURL { previews.load(url) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText(link, preview: preview, computer: computer)))
        .accessibilityHint(computer ? Text("Copies the link") : Text("Opens the page"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(named: Text("Copy link")) { copy(link) }
        .accessibilityAction(named: Text("Share")) { if let url = link.webURL { sharing = IdentifiedURL(url: url) } }
        .accessibilityAction(named: Text("Go to message")) { onShowMessage?(link) }
        .accessibilityIdentifier("profile-link.\(index)")
    }

    @ViewBuilder
    private func menu(_ link: BotLink, computer: Bool) -> some View {
        if !computer, let url = link.webURL {
            Button { opened = IdentifiedURL(url: url) } label: { Label("Open", systemImage: "safari") }
                .accessibilityIdentifier("link-menu.open")
            Button { UIApplication.shared.open(url) } label: { Label("Open in Safari", systemImage: "arrow.up.forward.app") }
                .accessibilityIdentifier("link-menu.safari")
        }
        Button { copy(link) } label: { Label("Copy link", systemImage: "doc.on.doc") }
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

    /// "example.com · Oct 12 · Migration plan", or "On the computer · ..."
    private func subtitle(_ link: BotLink, computer: Bool) -> String {
        var parts = [computer ? String(localized: "On the computer") : link.domain]
        if link.at > 0 { parts.append(Self.day(link.at)) }
        let thread = link.threadId.flatMap { id in bot.tasks?.first { $0.threadId == id }?.title }
        if let thread, !thread.isEmpty { parts.append(thread) } else if link.threadId != bot.threadId || bot.tasks == nil { parts.append(bot.name) }
        return parts.joined(separator: " \u{00B7} ")
    }

    private func accessibilityText(_ link: BotLink, preview: LinkPreview?, computer: Bool) -> String {
        [LinkRow.title(link, preview: preview, computer: computer), subtitle(link, computer: computer), link.readableAddress].joined(separator: ", ")
    }

    private static func day(_ at: Double) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
        return sameYear ? date.formatted(.dateTime.month(.abbreviated).day()) : date.formatted(.dateTime.year().month(.abbreviated).day())
    }

    private func copy(_ link: BotLink) {
        UIPasteboard.general.string = link.webURL?.absoluteString ?? link.url
        withAnimation { status = String(localized: "Link copied") }
        statusClear?.cancel()
        statusClear = Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled else { return }
            withAnimation { status = nil }
        }
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

    var body: some View {
        HStack(spacing: 0) {
            thumbnail
                .frame(width: Theme.Profile.iconColumn, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: Self.title(link, preview: preview, computer: computer))
                    .font(Theme.Font.body)
                    .foregroundStyle(computer ? Theme.textSecondary : Theme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(verbatim: subtitle)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(computer ? Theme.textTertiary : Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if computer, link.title != nil {
                    Text(verbatim: link.readableAddress)
                        .font(Theme.Profile.labelFont.monospaced())
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 12)
            if computer {
                Image(systemName: "doc.on.doc")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.trailing, Theme.Profile.chevronTrailing)
            } else {
                ProfileChevronTrailing()
            }
        }
        .padding(.vertical, 12)
        .frame(minHeight: Theme.Profile.linkRow)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let image = preview?.image ?? preview?.icon {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 34, height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
                .padding(.leading, Theme.Profile.iconCentre - 17)
        } else {
            ProfileRowIcon(systemImage: computer ? "desktopcomputer" : "globe", size: 17.5, color: computer ? Theme.textTertiary : Theme.iconGrey)
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
