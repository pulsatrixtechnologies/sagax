// claude.ai artifact cards (#2018, `ClaudeArtifactCard.tsx` on the web): a
// claude.ai/[code/]artifact link or an ```artifact fence with such a url.
// Title, owner, updated time and a plain-text summary come from
// GET /api/claude-artifacts/summary with the person's own session. No web view:
// "Open" hands the URL to the system. Artifact content is untrusted text.
import SwiftUI
import CompanionCore

/// Cards of one url refresh together when a newer publish fence of that url arrives.
@MainActor
final class ClaudeArtifactStore: ObservableObject {
    static let shared = ClaudeArtifactStore()

    @Published private(set) var versions: [String: Int] = [:]
    @Published private(set) var pages: [String: ArtifactPage] = [:]
    private var seen: [String: Set<String>] = [:]

    func version(_ url: String) -> Int { versions[url] ?? 0 }

    /// A publish fence for `url` was drawn. The first sighting only records it;
    /// a later fence (another message, or changed fields) bumps every card of the url.
    func publish(_ page: ArtifactPage, url: String, source: String?) {
        let known = seen[url] != nil
        var fresh = false
        if let source, seen[url]?.contains(source) != true {
            seen[url, default: []].insert(source)
            fresh = known
        } else if source == nil {
            seen[url, default: []] = seen[url] ?? []
        }
        let changed = pages[url] != nil && pages[url] != page
        pages[url] = page
        if fresh || changed { versions[url] = (versions[url] ?? 0) + 1 }
    }
}

struct ClaudeArtifactCardView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.youtubeSendToBot) private var sendToBot
    @EnvironmentObject private var session: Session
    @ObservedObject private var store = ClaudeArtifactStore.shared
    let url: String
    var page: ArtifactPage?
    /// The fence said another account owns it: no fetch, the consent variant.
    var consent: ClaudeArtifactConsent?
    var identifier: String?

    @State private var summary: ClaudeArtifactSummary?
    @State private var failed = false
    @State private var notSignedIn = false
    @State private var threads: [ClaudeArtifactThread] = []
    @State private var copyRequested = false
    @State private var showEngines = false

    private var title: String {
        let value = summary?.title ?? page?.title ?? ""
        return value.isEmpty ? String(localized: "claudeArtifact.untitled") : value
    }

    private var owned: Bool? { summary?.owned ?? page?.owned }

    private var blocked: Bool { consent != nil || summary?.blocked == "other_account" }

    private var account: String? { consent?.account ?? summary?.account }

    private var updated: String? {
        guard let date = ClaudeArtifacts.date(summary?.updatedAt) else { return nil }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }

    private var id: String { identifier ?? "claude-artifact" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            card
            ForEach(threads.filter(\.isOpen)) { thread in
                ClaudeArtifactCommentCard(url: url, title: title, thread: thread, identifier: "\(id)-comment-\(thread.id)") {
                    await loadThreads()
                }
            }
        }
        .task(id: store.version(url)) { await load() }
        .onAppear {
            if let page { store.publish(page, url: url, source: identifier) }
        }
        .sheet(isPresented: $showEngines) {
            NavigationStack {
                ScrollView { MyEnginesSection(style: .phone).padding(16) }
                    .background(Theme.bg.ignoresSafeArea())
                    .navigationTitle(Text("My engines"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showEngines = false }
                        }
                    }
            }
            .environmentObject(session)
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "doc.richtext").accessibilityHidden(true)
                Text("claudeArtifact.kind").fontWeight(.medium).foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 4)
                if let owned {
                    Text(owned ? "claudeArtifact.ownedYou" : "claudeArtifact.ownedOther").font(.system(size: 11))
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.cardRaised.opacity(0.3))
            Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5)
            VStack(alignment: .leading, spacing: 8) {
                if blocked {
                    consentBody
                } else {
                    Text(verbatim: title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let updated {
                        Text("claudeArtifact.updated \(updated)").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    if let text = summary?.summary, !text.isEmpty {
                        Text(verbatim: text)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(8)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if notSignedIn {
                        Text("claudeArtifact.notSignedIn").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    } else if failed {
                        Text("claudeArtifact.unavailable").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    HStack(spacing: 6) {
                        if let link = URL(string: url) {
                            pill("claudeArtifact.open", icon: "arrow.up.right.square", id: "\(id)-open") { openURL(link) }
                        }
                    }
                }
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
        .modifier(RichIdentifier(identifier: identifier))
    }

    @ViewBuilder
    private var consentBody: some View {
        Text(verbatim: title == String(localized: "claudeArtifact.untitled") ? url : title)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
        if let account {
            Text("claudeArtifact.blockedAccount \(account)")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text("claudeArtifact.blocked")
                .font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        HStack(spacing: 6) {
            if let sendToBot {
                pill(copyRequested ? "claudeArtifact.copyAsked" : "claudeArtifact.copy", icon: "doc.on.doc", id: "\(id)-copy") {
                    copyRequested = true
                    sendToBot(ClaudeArtifacts.copyMessage(url: url))
                }
                .disabled(copyRequested)
            }
            pill("claudeArtifact.reconnect", icon: "person.crop.circle.badge.checkmark", id: "\(id)-reconnect") { showEngines = true }
        }
    }

    private func pill(_ key: LocalizedStringKey, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(key, systemImage: icon)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(minHeight: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func load() async {
        if consent != nil { return }
        failed = false
        notSignedIn = false
        do {
            summary = try await session.claudeArtifactSummary(url: url)
        } catch {
            if case let APIError.status(code, _) = error, code == 409 { notSignedIn = true } else { failed = true }
            return
        }
        if summary?.blocked == nil { await loadThreads() } else { threads = [] }
    }

    private func loadThreads() async {
        threads = (try? await session.claudeArtifactComments(url: url)) ?? []
    }
}

/// One comment thread of an artifact: "Commentaire sur <title>", Reply, Resolve.
struct ClaudeArtifactCommentCard: View {
    @EnvironmentObject private var session: Session
    let url: String
    let title: String
    let thread: ClaudeArtifactThread
    var identifier: String
    let changed: () async -> Void

    @State private var replying = false
    @State private var draft = ""
    @State private var busy = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("claudeArtifact.commentOn \(title)")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
            line(author: thread.author, text: thread.text)
            ForEach(Array(thread.replies.enumerated()), id: \.offset) { _, reply in
                line(author: reply.author, text: reply.text).padding(.leading, 12)
            }
            if replying {
                TextField("claudeArtifact.replyPlaceholder", text: $draft, axis: .vertical)
                    .font(.system(size: 13))
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .accessibilityIdentifier("\(identifier)-field")
            }
            if failed {
                Text("claudeArtifact.actionFailed").font(.system(size: 11)).foregroundStyle(Theme.danger)
            }
            HStack(spacing: 6) {
                if replying {
                    action("claudeArtifact.send", id: "\(identifier)-send") {
                        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        await run { try await session.claudeArtifactReply(url: url, threadId: thread.id, text: text) }
                        draft = ""
                        replying = false
                    }
                } else {
                    action("claudeArtifact.reply", id: "\(identifier)-reply") { replying = true }
                }
                action("claudeArtifact.resolve", id: "\(identifier)-resolve") {
                    await run { try await session.claudeArtifactResolve(url: url, threadId: thread.id) }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    private func line(author: String?, text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let author, !author.isEmpty {
                Text(verbatim: author).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
            }
            Text(verbatim: text).font(.system(size: 13)).foregroundStyle(Theme.textPrimary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func action(_ key: LocalizedStringKey, id: String, _ run: @escaping () async -> Void) -> some View {
        Button { Task { await run() } } label: {
            Text(key)
                .font(.system(size: 12))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 10)
                .frame(minHeight: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier(id)
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        failed = false
        do { try await work(); await changed() } catch { failed = true }
        busy = false
    }
}
