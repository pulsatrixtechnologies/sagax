// The two X (Twitter) cards of the chat (`XPostCards.tsx`, #4638):
//   XDraftCardView  a post a bot drafted: the avatar, "Post" and the @handle, Copy,
//                   the text editable in place with X's counter (only near the limit),
//                   Discard and Post. Post is the person's go: the server hands the
//                   bot the exact text and the card follows the post, then turns into
//                   the published post with its link.
//   XPostListView   what a bot read from X, drawn the way x.com draws a post, stacked
//                   like a timeline; a tap opens the post on x.com.
import SwiftUI
import UIKit
import CompanionCore

private struct XColors {
    let ink: Color, sub: Color, line: Color, quoteLine: Color, background: Color
    init(dark: Bool) {
        ink = dark ? Color(red: 0.906, green: 0.914, blue: 0.918) : Color(red: 0.059, green: 0.078, blue: 0.098)
        sub = dark ? Color(red: 0.443, green: 0.463, blue: 0.482) : Color(red: 0.325, green: 0.392, blue: 0.443)
        line = dark ? Color(red: 0.184, green: 0.2, blue: 0.212) : Color(red: 0.937, green: 0.953, blue: 0.957)
        quoteLine = dark ? Color(red: 0.184, green: 0.2, blue: 0.212) : Color(red: 0.812, green: 0.851, blue: 0.871)
        background = dark ? .black : .white
    }
    static let blue = Color(red: 0.114, green: 0.608, blue: 0.941)
}

private struct XAvatarView: View {
    let url: String?
    let name: String
    var size: CGFloat = 40
    var body: some View {
        ZStack {
            Circle().fill(Theme.cardRaised)
            if let url, XPosts.isXMediaHost(url), let address = URL(string: url) {
                AsyncImage(url: address) { image in image.resizable().scaledToFill() } placeholder: { initials }
            } else if size >= 32 {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
    private var initials: some View {
        Text(verbatim: String(name.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()))
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.textSecondary)
    }
}

private func xDateText(_ value: String?) -> String {
    guard let value else { return "" }
    let parsers: [ISO8601DateFormatter] = [
        { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter }(),
        ISO8601DateFormatter(),
    ]
    guard let date = parsers.lazy.compactMap({ $0.date(from: value) }).first else { return value }
    let sameYear = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year)
    return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
}

private struct XPostRow: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL
    let post: XPost
    var divider = false
    private var colors: XColors { XColors(dark: scheme == .dark) }
    private var french: Bool { Locale.current.language.languageCode?.identifier == "fr" }

    var body: some View {
        let content = HStack(alignment: .top, spacing: 12) {
            XAvatarView(url: post.avatarUrl, name: post.name)
            VStack(alignment: .leading, spacing: 0) {
                header(post)
                Text(verbatim: post.text).font(.system(size: 15)).lineSpacing(2).foregroundStyle(colors.ink)
                    .fixedSize(horizontal: false, vertical: true)
                media(post.media)
                if let quoted = post.quoted { quote(quoted) }
                footer
            }
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
        .overlay(alignment: .top) { if divider { Rectangle().fill(colors.line).frame(height: 0.5) } }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Post by \(post.name) (@\(post.handle))"))
        .accessibilityIdentifier("x-post-\(post.id)")
        if let url = post.url.flatMap(URL.init(string:)) {
            Button { openURL(url) } label: { content }.buttonStyle(.plain)
        } else {
            content
        }
    }

    private func header(_ post: XPost) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: post.name).font(.system(size: 15, weight: .bold)).foregroundStyle(colors.ink).lineLimit(1)
            if post.verified {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 14)).foregroundStyle(XColors.blue)
                    .accessibilityLabel(Text("Verified account"))
            }
            Text(verbatim: "@\(post.handle)").font(.system(size: 15)).foregroundStyle(colors.sub).lineLimit(1)
            let date = xDateText(post.createdAt)
            if !date.isEmpty {
                Text(verbatim: "·").foregroundStyle(colors.sub)
                Text(verbatim: date).font(.system(size: 15)).foregroundStyle(colors.sub).lineLimit(1).fixedSize()
            }
        }
    }

    @ViewBuilder private func media(_ items: [XMedia]) -> some View {
        if !items.isEmpty {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: items.count == 1 ? 1 : 2), spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    let shown = item.previewUrl ?? item.url
                    ZStack {
                        Rectangle().fill(colors.line)
                        if XPosts.isXMediaHost(shown), let address = URL(string: shown) {
                            AsyncImage(url: address) { image in image.resizable().scaledToFill() } placeholder: { ProgressView() }
                        } else {
                            Text("Image hidden: tap the post to open it").font(.system(size: 12)).foregroundStyle(colors.sub).padding(8)
                        }
                    }
                    .aspectRatio(16 / 9, contentMode: .fit).clipped()
                    .accessibilityLabel(Text(verbatim: item.alt ?? (item.type == "photo" ? String(localized: "Photo") : String(localized: "Video"))))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(colors.quoteLine, lineWidth: 0.5))
            .padding(.top, 12)
        }
    }

    private func quote(_ quoted: XPost) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                XAvatarView(url: quoted.avatarUrl, name: quoted.name, size: 20)
                header(quoted)
            }
            Text(verbatim: quoted.text).font(.system(size: 15)).lineSpacing(2).foregroundStyle(colors.ink).fixedSize(horizontal: false, vertical: true)
            media(quoted.media)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(colors.quoteLine, lineWidth: 0.5))
        .padding(.top, 12)
        .accessibilityIdentifier("x-quote")
    }

    private var footer: some View {
        let metrics = post.metrics
        func item(_ symbol: String, _ value: Int?) -> some View {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 15))
                Text(verbatim: value.map { XPosts.shortCount($0, french: french) } ?? "").font(.system(size: 13)).monospacedDigit()
            }
            .foregroundStyle(colors.sub).frame(minHeight: 34)
        }
        return HStack {
            item("bubble.left", metrics?.replies)
            Spacer(minLength: 0)
            item("arrow.2.squarepath", metrics?.reposts)
            Spacer(minLength: 0)
            item("heart", metrics?.likes)
            Spacer(minLength: 0)
            item("chart.bar", metrics?.views)
            Spacer(minLength: 0)
            item("bookmark", nil)
            item("square.and.arrow.up", nil)
        }
        .frame(maxWidth: 425)
        .padding(.top, 4)
        .accessibilityIdentifier("x-metrics")
    }
}

struct XPostListView: View {
    @Environment(\.colorScheme) private var scheme
    let posts: [XPost]
    var identifier: String?

    var body: some View {
        let colors = XColors(dark: scheme == .dark)
        VStack(spacing: 0) {
            ForEach(Array(posts.enumerated()), id: \.offset) { index, post in
                XPostRow(post: post, divider: index > 0)
            }
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(colors.background))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(colors.line, lineWidth: 0.5))
        .modifier(RichIdentifier(identifier: identifier ?? "x-posts"))
    }
}

struct XDraftCardView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.colorScheme) private var scheme
    let draft: XDraft
    var pending = false
    /// The conversation and the bot message that holds the fence: the state is kept on it.
    var scope: (threadId: String, messageId: String)?
    var identifier: String?
    @StateObject private var feedback = RichCopyFeedback()
    @State private var edited: String?
    @State private var state: XDraftState?
    @State private var asking = false
    @State private var failure: String?

    private var text: String { edited ?? draft.text }
    private var key: String { XPosts.draftKey(draft.text) }
    private var counter: (used: Int, remaining: Int, over: Bool, show: Bool) { XPosts.counter(text) }
    private var busy: Bool { asking || state?.status == "sending" }
    private var settled: Bool { state?.status == "posted" || state?.status == "discarded" }
    private var canAct: Bool { scope != nil && !pending && !busy && !settled }
    private var canPost: Bool { canAct && !XPosts.postText(text).isEmpty && !counter.over }

    var body: some View {
        if state?.status == "posted" {
            postedCard
        } else {
            draftCard
        }
    }

    private var postedCard: some View {
        let colors = XColors(dark: scheme == .dark)
        let post = XPost(id: key, url: state?.url, name: draft.name ?? draft.handle ?? String(localized: "Your account"), handle: draft.handle ?? "x", verified: false,
                         avatarUrl: draft.avatarUrl, createdAt: ISO8601DateFormatter().string(from: Date()), text: state?.text ?? text, media: [], quoted: nil, metrics: nil)
        return VStack(alignment: .leading, spacing: 0) {
            Label("Posted", systemImage: "checkmark").font(.system(size: 13)).foregroundStyle(colors.sub).padding(.horizontal, 16).padding(.top, 12)
            XPostRow(post: post)
            if let url = state?.url.flatMap(URL.init(string:)) {
                Link("View on X", destination: url).font(.system(size: 13, weight: .medium)).foregroundStyle(XColors.blue).padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(colors.background))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(colors.line, lineWidth: 0.5))
        .modifier(RichIdentifier(identifier: identifier ?? "x-draft"))
    }

    private var draftCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                XAvatarView(url: draft.avatarUrl, name: draft.name ?? draft.handle ?? "X")
                VStack(alignment: .leading, spacing: 0) {
                    Text("Post").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    if let handle = draft.handle { Text(verbatim: "@\(handle)").font(.system(size: 13)).foregroundStyle(Theme.textSecondary) }
                }
                Spacer(minLength: 4)
                Button { feedback.copy("text", XPosts.postText(text)) } label: {
                    Image(systemName: feedback.copied == "text" ? "checkmark" : "doc.on.doc").font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary).frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(feedback.copied == "text" ? "Copied" : "Copy"))
                .accessibilityIdentifier("x-draft-copy")
            }
            if pending { Text("Still being written…").font(.system(size: 11)).foregroundStyle(Theme.textSecondary).padding(.top, 8) }
            Group {
                if busy || settled {
                    Text(verbatim: state?.text ?? text).strikethrough(state?.status == "discarded")
                        .foregroundStyle(state?.status == "discarded" ? Theme.textSecondary : Theme.textPrimary)
                } else {
                    TextField("Post text", text: Binding(get: { text }, set: { edited = $0 }), axis: .vertical)
                        .disabled(!canAct)
                        .foregroundStyle(Theme.textPrimary)
                        .accessibilityIdentifier("x-draft-editor")
                }
            }
            .font(.system(size: 15)).lineSpacing(3)
            .padding(.top, 12)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                if !busy && !settled && counter.show {
                    Text(verbatim: "\(counter.remaining)").font(.system(size: 13)).monospacedDigit()
                        .foregroundStyle(counter.over ? Color.red : Theme.textSecondary)
                        .accessibilityLabel(Text("\(counter.remaining) characters left"))
                        .accessibilityIdentifier("x-draft-counter")
                }
            }
            .frame(minHeight: 24)
            if let line = statusLine {
                Text(verbatim: line).font(.system(size: 12)).foregroundStyle(state?.status == "failed" ? Color.red : Theme.textSecondary).padding(.top, 8)
            }
            if !settled {
                HStack(spacing: 12) {
                    pill("Discard", id: "x-draft-discard", primary: false, enabled: canAct || state?.status == "failed") { Task { await act(.discard) } }
                    pill(state?.status == "failed" ? "Try again" : "Post", id: "x-draft-post", primary: true,
                         enabled: canPost || (state?.status == "failed" && !XPosts.postText(text).isEmpty && !counter.over)) { Task { await act(.post) } }
                }
                .padding(.top, 16)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("X post draft"))
        .modifier(RichIdentifier(identifier: identifier ?? "x-draft"))
        .task { await read() }
        .task(id: busy) {
            while busy, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await read()
            }
        }
    }

    private var statusLine: String? {
        if state?.status == "failed" || failure != nil {
            let error = failure ?? state?.error
            return error.map { String(localized: "The post did not go out: \($0)") } ?? String(localized: "The post did not go out.")
        }
        if state?.status == "discarded" { return String(localized: "Discarded") }
        if busy { return String(localized: "Posting…") }
        return nil
    }

    private func pill(_ title: LocalizedStringKey, id: String, primary: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(primary ? Theme.card : Theme.textPrimary)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(Capsule().fill(primary ? Theme.textPrimary : Theme.cardRaised))
                .overlay(Capsule().strokeBorder(Theme.hairline.opacity(primary ? 0 : 0.6), lineWidth: 0.5))
                .opacity(enabled ? 1 : 0.5)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityIdentifier(id)
    }

    private func read() async {
        guard let scope else { return }
        if let next = await SessionHub.session.xDraftState(threadId: scope.threadId, messageId: scope.messageId, draftKey: key) { state = next }
    }

    private func act(_ kind: XDraftAction) async {
        guard let scope else { return }
        failure = nil
        asking = kind == .post
        defer { asking = false }
        if let problem = await SessionHub.session.actOnXDraft(threadId: scope.threadId, kind: kind, messageId: scope.messageId, draftKey: key, text: text, handle: draft.handle) {
            failure = problem
        } else {
            state = XDraftState(status: kind == .post ? "sending" : "discarded", text: text, url: nil, error: nil)
        }
    }
}
