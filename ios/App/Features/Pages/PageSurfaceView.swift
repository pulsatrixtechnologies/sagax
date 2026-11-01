// A page, open (2026-10-28, the desktop's PageSurface in
// src/components/PageViewer.tsx): the page itself, whole and interactive in
// the app's theme, under a floating row:
//   - top left, a round × that closes it (back to the conversation, at the
//     same place: the conversation stays under the page);
//   - top centre, the title pill: a tap turns it into a field (pencil),
//     Return renames (PATCH /api/pages/:id { title });
//   - top right, « ⋯ » (versions, decline a proposed version, open the
//     shared link) and Share (PageShareSheet), the one place for sharing.
// Over a conversation, its composer floats at the bottom (ChatView); from
// the Library or Settings the page opens alone.
//
// The page is the server's preview wrapper with `bare=1`, the app's theme
// and the place to keep (`y`): its frame reports how far down the reader is
// and a redraw (the bot's newer version, a new theme) starts there again.
import CompanionCore
import SwiftUI

extension Session {
    /// What a page web view draws for this version: the demo's own
    /// document, or the server's preview wrapper with this phone's bearer.
    func pageWebSource(pageId: String, previewPath: String, theme: PageTheme, y: Int) -> PageWebSource? {
        if isDemo, let demo = demoServer { return .html(demo.pageDocument(theme: theme), place: y) }
        guard let client = settingsClient,
              // the person's skin goes with the theme: the page's default theme takes it
              let request = try? client.pagePreviewRequest(path: previewPath, bare: true, theme: theme, y: y,
                                                           skin: ContentTheme.skinParam(Theme.palette.contentTokens)) else { return nil }
        return .request(request)
    }

    var pageApiBase: URL? { settingsClient?.connection.baseURL }
}

struct PageSurfaceView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let pageId: String
    /// The version to show first; nil: the newest.
    var initialVersion: Int?
    /// The title the card knew, until the page answers.
    var initialTitle = ""
    /// The newest version the conversation names: a newer one is drawn in
    /// place, at the same place.
    var latestVersion: Int?
    let onClose: () -> Void
    /// The page changed (title, sharing) or the version on screen did.
    var onShown: ((PublishedPageSummary?, Int?) -> Void)?

    @State private var page: PublishedPageSummary?
    @State private var version: Int?
    @State private var previewPath: String?
    @State private var source: PageWebSource?
    @State private var drawID = 0
    @State private var policy = PagesPolicy.default
    @State private var error: String?
    @State private var busy = false
    @State private var draft: String?
    @State private var sharing = false
    @State private var showingVersions = false
    @FocusState private var titleFocused: Bool

    private var theme: PageTheme { Theme.palette.isDark ? .dark : .light }
    private var title: String { page?.title ?? initialTitle }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            Group {
                if let source {
                    PageWebView(source: source, apiBase: session.pageApiBase, drawID: drawID, dark: theme == .dark) { y in
                        PagePlaces.shared.remember(pageId, y: y)
                    }
                    .padding(.top, 52)
                    .accessibilityIdentifier("page-surface-web")
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .ignoresSafeArea(.container, edges: .bottom)
            header
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
                    .padding(.horizontal, 16)
                    .padding(.top, 60)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("page-surface-error")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-surface-\(pageId)")
        .task(id: pageId) { await load(asked: initialVersion) }
        .task(id: PageViewRules.newerVersion(shown: version, latest: latestVersion)) {
            // the bot changed this page: its new version, at the same place
            guard let newer = PageViewRules.newerVersion(shown: version, latest: latestVersion), page != nil else { return }
            await load(asked: newer)
        }
        .task(id: "\(version ?? 0)") { await loadPreview() }
        .onValueChange(of: theme) { _ in redraw() }
        .sheet(isPresented: $sharing) {
            if let page, let version {
                PageShareSheet(page: page, version: version, policy: policy) { next in
                    self.page = next
                    onShown?(next, version)
                }
            }
        }
        .sheet(isPresented: $showingVersions) {
            if let page { versionsSheet(page) }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Button {
                Haptics.selection()
                onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(width: 40, height: 40)
                    .themeGlass(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "Close")))
            .accessibilityIdentifier("page-close")
            Spacer(minLength: 0)
            titlePill
                .layoutPriority(1)
            Spacer(minLength: 0)
            if let page { moreMenu(page) }
            Button {
                Haptics.selection()
                sharing = true
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 13, weight: .semibold))
                    Text(String(localized: "Share")).font(.system(size: 14, weight: .medium))
                }
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 12)
                .frame(height: 40)
                .themeGlass(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(page == nil || version == nil)
            .accessibilityIdentifier("page-share")
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
    }

    @ViewBuilder
    private var titlePill: some View {
        if let draft {
            HStack(spacing: 6) {
                PageGlyph(size: 18)
                TextField(String(localized: "Rename the page"), text: Binding(get: { draft }, set: { self.draft = $0 }))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .focused($titleFocused)
                    .submitLabel(.done)
                    .onSubmit { Task { await rename() } }
                    .disabled(busy)
                    .accessibilityIdentifier("page-title-field")
                Image(systemName: "pencil").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)
            .themeGlass(Capsule())
            .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.6), lineWidth: 1))
            .onValueChange(of: titleFocused) { focused in
                // leaving the field without a change cancels it
                if !focused, PageViewRules.renameTitle(draft: self.draft ?? "", current: title) == nil { self.draft = nil }
            }
        } else {
            Button {
                draft = title
                titleFocused = true
            } label: {
                HStack(spacing: 6) {
                    PageGlyph(size: 18)
                    Text(verbatim: title.isEmpty ? String(localized: "Untitled page") : title)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(height: 40)
                .themeGlass(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "Rename the page")))
            .accessibilityValue(Text(verbatim: title))
            .accessibilityIdentifier("page-title")
        }
    }

    private func moreMenu(_ page: PublishedPageSummary) -> some View {
        let shown = page.versions.first { $0.n == version }
        let proposed = shown.map { $0.state == "proposed" && page.currentVersion != $0.n } ?? false
        return Menu {
            if page.versions.count > 1 {
                Button(String(localized: "Versions (\(page.versions.count))"), systemImage: "clock.arrow.circlepath") { showingVersions = true }
            }
            if proposed, let n = shown?.n {
                Button(String(localized: "Decline version \(n)"), systemImage: "xmark.circle", role: .destructive) {
                    Task { await step(PageShareStep(method: "POST", path: "/decline", body: ["version": n])) }
                }
            }
            if page.isPublished, let url = page.url, RichBlocks.isSafeHttpUrl(url), let link = URL(string: url) {
                Link(destination: link) { Label(String(localized: "Open in browser"), systemImage: "safari") }
            }
            Button(String(localized: "Reload"), systemImage: "arrow.clockwise") { redraw() }
        } label: {
            // AXe reads the Menu's label Button; put the name on the label
            // itself so VoiceOver and UI tests see "More" / page-more.
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: 40, height: 40)
                .themeGlass(Circle())
                .accessibilityLabel(Text(String(localized: "More")))
                .accessibilityIdentifier("page-more")
        }
    }

    private func versionsSheet(_ page: PublishedPageSummary) -> some View {
        NavigationStack {
            List {
                ForEach(page.versions.reversed()) { entry in
                    Button {
                        version = entry.n
                        showingVersions = false
                        onShown?(page, entry.n)
                    } label: {
                        HStack {
                            Image(systemName: "checkmark").opacity(entry.n == version ? 1 : 0)
                            Text(String(localized: "Version \(entry.n)")).foregroundStyle(Theme.textPrimary)
                            Spacer()
                            if page.currentVersion == entry.n, page.status == "published" {
                                Text(String(localized: "Published")).foregroundStyle(Theme.success)
                            } else if entry.state == "declined" {
                                Text(String(localized: "Declined")).foregroundStyle(Theme.textTertiary)
                            }
                        }
                        .font(Theme.Font.body)
                    }
                    .accessibilityIdentifier("page-version-\(entry.n)")
                }
            }
            .navigationTitle(String(localized: "Versions (\(page.versions.count))"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Close")) { showingVersions = false } }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: Loading

    private func load(asked: Int?) async {
        guard let client = session.settingsClient else {
            error = String(localized: "Sagax is not connected.")
            return
        }
        policy = await client.pagesPolicy()
        do {
            let next = try await client.publishedPage(id: pageId)
            page = next
            let shown = PageViewRules.versionToShow(page: next, asked: asked ?? version)
            version = shown
            error = nil
            onShown?(next, shown)
#if DEBUG
            if PageDebugLaunch.opensShare, asked == initialVersion {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                sharing = true
            }
#endif
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadPreview() async {
        guard let version, let client = session.settingsClient else { return }
        do {
            let preview = try await client.pageVersionPreview(id: pageId, version: version)
            previewPath = preview.previewPath
            redraw()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Draw the page again (a new version, the theme), at the reader's place.
    private func redraw() {
        guard let previewPath else { return }
        drawID += 1
        source = session.pageWebSource(pageId: pageId, previewPath: previewPath, theme: theme, y: PagePlaces.shared.place(pageId))
    }

    // MARK: Actions

    private func rename() async {
        guard let next = PageViewRules.renameTitle(draft: draft ?? "", current: title) else {
            draft = nil
            return
        }
        guard let client = session.settingsClient else { return }
        busy = true
        defer { busy = false }
        do {
            let renamed = try await client.renamePage(id: pageId, title: next)
            page = renamed
            draft = nil
            error = nil
            onShown?(renamed, version)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func step(_ step: PageShareStep) async {
        guard let client = session.settingsClient else { return }
        busy = true
        defer { busy = false }
        do {
            let next = try await client.pageStep(id: pageId, step)
            page = next
            error = nil
            onShown?(next, version)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The page over anything else (the Library, Settings): the same surface,
/// full screen, without a composer.
struct PageFullScreen: View {
    let pageId: String
    var version: Int?
    var title = ""
    var onChange: ((PublishedPageSummary) -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PageSurfaceView(pageId: pageId, initialVersion: version, initialTitle: title, onClose: { dismiss() }) { page, _ in
            if let page { onChange?(page) }
        }
    }
}
