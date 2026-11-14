// A page open over its conversation (2026-10-28, the desktop's ChatView
// with PageSurface, PageBotStatus and PageRefChip): the page covers the
// transcript, which stays mounted under it, and the conversation's own
// composer floats over the page's bottom. Above the composer, one line with
// the bot's face says what it is doing ("On it") or its newest answer since
// the page opened. A message sent then carries the page (`dataContext.page`)
// and is drawn with a chip over its words; the bot's newer version of the
// page (a new `pagePublish` of the same page) is drawn in place, at the same
// place.
import CompanionCore
import SwiftUI

extension ChatView {
    /// Opens a page over this conversation (a card, a chip).
    var openPagePanelAction: (OpenPageRef) -> Void {
        { ref in
            // "since the page opened" on the server's clock, not the
            // phone's: just after the conversation's newest line
            var opened = ref
            if let last = messages.map(\.at).max() { opened.openedAt = last + 1 }
            withAnimation(.snappy(duration: 0.22)) { openPage = opened }
        }
    }

    /// The open page, behind the composer and over the ground.
    @ViewBuilder var openPageLayer: some View {
        if let page = openPage {
            PageSurfaceView(
                pageId: page.pageId,
                initialVersion: page.version,
                initialTitle: page.title,
                latestVersion: PageViewRules.latestVersion(in: messages, pageId: page.pageId),
                onClose: {
                    composerFocused = false
                    withAnimation(.snappy(duration: 0.22)) { openPage = nil }
                },
                onShown: { summary, version in
                    guard var open = openPage, open.pageId == page.pageId else { return }
                    if let title = summary?.title, !title.isEmpty { open.title = title }
                    if let version { open.version = version }
                    if open != openPage { openPage = open }
                }
            )
            .id(page.pageId)
            .ignoresSafeArea(.container, edges: .bottom)
            .transition(.opacity)
        }
    }
}

#if DEBUG
/// Screenshot harness only: `-open-page` opens the conversation's first page
/// card, `-page-share` then its Share sheet, `-page-send "<words>"` sends
/// those words from the open page, `-page-close-after <seconds>` closes it.
enum PageDebugLaunch {
    static func argument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }
    static var opensShare: Bool { ProcessInfo.processInfo.arguments.contains("-page-share") }
    /// `-page-caps-sample`: the demo's open page shows the capability strip
    /// with an Ask first card and a link card (headless captures, #3413).
    static var capsSample: Bool { ProcessInfo.processInfo.arguments.contains("-page-caps-sample") }

    @MainActor
    static func sampleBroker(relay: PageCapRelay) -> PageCapabilityBroker {
        let french = Locale.current.language.languageCode?.identifier == "fr"
        let broker = PageCapabilityBroker(pageId: "demo_page", version: 1, lang: french ? "fr" : "en", deps: .init(
            api: { method, path, _, _ in
                if path.hasSuffix("/capabilities") {
                    return PageCapHTTPAnswer(status: 200, body: ["capabilities": ["data": ["team-board"], "viewer": true, "open": true],
                                                                 "reads": [["name": "team-board", "label": String(localized: "the work of your coding teams")]]])
                }
                if path.hasSuffix("/data/team-board") { return PageCapHTTPAnswer(status: 409, body: ["error": "", "code": "ask_first", "approvalId": "sample"]) }
                if path.hasSuffix("/viewer") { return PageCapHTTPAnswer(status: 200, body: ["name": "", "role": "owner"]) }
                if path.hasSuffix("/link-approvals"), method == "GET" { return PageCapHTTPAnswer(status: 200, body: ["allowed": false]) }
                return PageCapHTTPAnswer(status: 200, body: ["ok": true])
            },
            post: { [weak relay] in relay?.post($0) },
            openURL: { _ in },
            openRef: { _, _ in false },
            saveFile: { _, _, _ in }
        ))
        Task { @MainActor in
            broker.start()
            await broker.receive(["type": "sagax-cap", "v": 1, "id": 1, "cap": "viewer.get"], fromClick: false)
            await broker.receive(["type": "sagax-cap", "v": 1, "id": 2, "cap": "open", "args": ["ref": "https://example.com/reports/weekly?team=core&range=30d"]], fromClick: true)
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            await broker.receive(["type": "sagax-cap", "v": 1, "id": 3, "cap": "data.read", "args": ["name": "team-board"]], fromClick: false)
        }
        return broker
    }
}

extension ChatView {
    func pageDebugLaunch() async {
        guard ProcessInfo.processInfo.arguments.contains("-open-page") else { return }
        for _ in 0..<100 where !messages.contains(where: { $0.pagePublish != nil }) {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        guard let card = messages.last(where: { $0.pagePublish?.isDrawable == true }), let ref = card.pagePublish else { return }
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        openPagePanelAction(OpenPageRef(pageId: ref.pageId, botId: current.id, threadId: current.threadId, title: ref.title,
                                        version: ref.version, openedAt: Date().timeIntervalSince1970 * 1000))
        if let words = PageDebugLaunch.argument("-page-send") {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            submit(words)
        }
        if let seconds = PageDebugLaunch.argument("-page-close-after").flatMap(Double.init) {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            withAnimation { openPage = nil }
        }
    }
}
#endif

/// The bot's one line over the floating composer.
struct PageBotStatusBubble: View {
    @Environment(\.themePalette) var themePalette
    let status: PageBotStatus
    let chat: Chat

    var body: some View {
        HStack(spacing: 8) {
            ChatAvatarView(chat: chat, size: 24, state: status == .working ? .working : .idle, animated: status == .working)
                .frame(width: 24, height: 24)
            Text(verbatim: text)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.leading, 6)
        .padding(.trailing, 14)
        .frame(height: 36)
        .themeGlass(Capsule(), interactive: false)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(chat.name): \(text)"))
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("page-bot-status")
    }

    private var text: String {
        switch status {
        case .working: String(localized: "On it")
        case let .reply(line): line
        }
    }
}
