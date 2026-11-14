// The small parts of the page view (2026-10-28, the desktop's PageGlyph,
// PageRefChip and the preview frame): the page's icon, the chip over a
// message sent from an open page, the way a row opens a page over its
// conversation, and the web view a page is drawn in.
//
// The web view only ever loads this server's preview wrapper (and the frame
// under it) with this phone's bearer, or, in the demo, a document drawn on
// the phone. Scripts in isolated content worlds (the page's own scripts
// cannot see them) hand back how far down the reader is (a
// `sagax-page-scroll` message posted by the page's frame, checked again here
// as a whole number) and, for a page that declares capabilities, the frame's
// capability calls and links to its broker (#3413 lot 8, PageCapBridge),
// which answers them with this phone's session. Nothing from the page is
// ever read as an instruction.
import CompanionCore
import SwiftUI
import WebKit

// MARK: - Opening a page over its conversation

private struct OpenPagePanelKey: EnvironmentKey {
    static let defaultValue: ((OpenPageRef) -> Void)? = nil
}

extension EnvironmentValues {
    /// Set by a conversation: opens a page over it, its composer floating
    /// on top. Nil elsewhere (a row then opens the page on its own).
    var openPagePanel: ((OpenPageRef) -> Void)? {
        get { self[OpenPagePanelKey.self] }
        set { self[OpenPagePanelKey.self] = newValue }
    }
}

// MARK: - Icon and chip

/// The page's icon: a small chart on a blue-to-indigo square, the same on
/// the card, the title pill, the Library and a message about the page.
struct PageGlyph: View {
    var size: CGFloat = 20
    var corner: CGFloat?

    var body: some View {
        RoundedRectangle(cornerRadius: corner ?? size * 0.28, style: .continuous)
            .fill(LinearGradient(
                colors: [Color(red: 0.055, green: 0.647, blue: 0.914), Color(red: 0.388, green: 0.4, blue: 0.945)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .overlay(
                Image(systemName: "chart.bar.fill")
                    .font(.system(size: size * 0.5, weight: .bold))
                    .foregroundStyle(.white)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Over a message sent while a page was open: the page's icon and title.
/// A tap opens that page.
struct PageRefChip: View {
    let ref: PageContextRef
    let foreground: Color
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                PageGlyph(size: 16, corner: 4)
                Text(verbatim: ref.title.isEmpty ? String(localized: "Untitled page") : ref.title)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(foreground.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "Open the page \(ref.title)")))
        .accessibilityIdentifier("page-ref-\(ref.pageId)")
    }
}

// MARK: - Web view

/// What a page web view draws.
enum PageWebSource: Equatable {
    /// The server's preview wrapper, with this phone's bearer.
    case request(URLRequest)
    /// The demo's own document, drawn on the phone.
    case html(String, place: Int)
}

/// The page, in a web view with no bridge to the app but the reader's
/// place. `interactive` false draws it inert (the card's thumbnail).
struct PageWebView: UIViewRepresentable {
    let source: PageWebSource
    let apiBase: URL?
    /// Bumped to draw the same address again (Reload).
    var drawID = 0
    var interactive = true
    var dark = false
    /// The reader scrolled: the place, a whole number of pixels.
    var onPlace: ((Int) -> Void)?
    /// The page's capability broker and the relay that posts its answers
    /// (the server's preview wrapper only, never the demo's document).
    var capabilities: PageCapabilityBroker?
    var relay: PageCapRelay?

    static let placeWorld = "sagax-page-place"
    static let placeHandler = "sagaxPagePlace"

    func makeCoordinator() -> Coordinator { Coordinator(apiBase: apiBase, onPlace: onPlace, capabilities: capabilities) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        if onPlace != nil {
            // An isolated world: the page's scripts never see this handler.
            let world = WKContentWorld.world(name: Self.placeWorld)
            let controller = config.userContentController
            controller.add(WeakPlaceHandler(context.coordinator), contentWorld: world, name: Self.placeHandler)
            controller.addUserScript(WKUserScript(source: Self.placeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
        }
        if capabilities != nil, case .request = source {
            // its own isolated world: the page's scripts never see the broker's handler
            let world = WKContentWorld.world(name: PageCapBridge.world)
            let controller = config.userContentController
            controller.add(WeakCapsHandler(context.coordinator), contentWorld: world, name: PageCapBridge.handler)
            controller.addUserScript(WKUserScript(source: PageCapBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: world))
        }
        let view = WKWebView(frame: .zero, configuration: config)
        relay?.webView = view
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.allowsLinkPreview = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        apply(view)
        context.coordinator.load(source, drawID: drawID, into: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onPlace = onPlace
        if context.coordinator.capabilities !== capabilities {
            context.coordinator.capabilities = capabilities
            capabilities?.start()
        }
        relay?.webView = view
        apply(view)
        context.coordinator.load(source, drawID: drawID, into: view)
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
        view.stopLoading()
    }

    private func apply(_ view: WKWebView) {
        view.isUserInteractionEnabled = interactive
        view.scrollView.isScrollEnabled = interactive
        view.overrideUserInterfaceStyle = dark ? .dark : .light
        view.underPageBackgroundColor = .clear
    }

    /// Runs in the isolated world of the wrapper (main frame only): a
    /// `sagax-page-scroll` posted by the wrapper's own page frame, as three
    /// plain fields. In the demo (no frame) the document's own scroll.
    static let placeScript = """
    (function(){"use strict";
    var h=window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.\(placeHandler);if(!h)return;
    window.addEventListener("message",function(e){try{
    var f=window.frames&&window.frames[0];if(!f||e.source!==f)return;var d=e.data;
    if(!d||typeof d!=="object"||d.type!=="sagax-page-scroll"||d.v!==1||typeof d.y!=="number")return;
    h.postMessage({type:"sagax-page-scroll",v:1,y:d.y});}catch(x){}});
    if(location.protocol==="about:"){var t=0;window.addEventListener("scroll",function(){clearTimeout(t);t=setTimeout(function(){
    h.postMessage({type:"sagax-page-scroll",v:1,y:Math.max(0,Math.round(window.scrollY))});},120);},{passive:true});}
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let apiBase: URL?
        var onPlace: ((Int) -> Void)?
        var capabilities: PageCapabilityBroker?
        private var loaded: PageWebSource?
        private var loadedDraw = -1
        private var htmlPlace = 0

        init(apiBase: URL?, onPlace: ((Int) -> Void)?, capabilities: PageCapabilityBroker?) {
            self.apiBase = apiBase
            self.onPlace = onPlace
            self.capabilities = capabilities
        }

        func load(_ source: PageWebSource, drawID: Int, into view: WKWebView) {
            guard loaded != source || loadedDraw != drawID else { return }
            loaded = source
            loadedDraw = drawID
            switch source {
            case let .request(request):
                view.load(request)
            case let .html(html, place):
                htmlPlace = place
                view.loadHTMLString(html, baseURL: nil)
            }
        }

        func receive(_ body: Any) {
            guard let y = PageViewRules.parseScroll(body) else { return }
            onPlace?(y)
        }

        /// A capability call, a hello or a link from the page's frame.
        func receiveCapability(_ body: Any) {
            guard let broker = capabilities, let (message, fromClick) = PageCapBridge.parse(body) else { return }
            Task { @MainActor in
                if PageCapRules.openMessage(message) != nil {
                    await broker.receiveOpen(message)
                } else {
                    await broker.receive(message, fromClick: fromClick)
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // the broker listens: the frame's queued calls go now
            if case .request = loaded { capabilities?.start() }
            // the demo's document keeps its place itself (no frame script)
            if case .html = loaded, htmlPlace > 0 {
                webView.evaluateJavaScript("window.scrollTo(0,\(htmlPlace))", in: nil, in: .world(name: PageWebView.placeWorld))
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
            if case .html = loaded {
                // the demo's document only: no other address
                return decisionHandler(url.scheme == "about" ? .allow : .cancel)
            }
            guard let apiBase, PagePreview.allows(url, apiBase: apiBase) else { return decisionHandler(.cancel) }
            decisionHandler(.allow)
        }

        /// No window the page opens (target=_blank, window.open).
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            nil
        }
    }

    /// The capability handler, weak like the place handler.
    private final class WeakCapsHandler: NSObject, WKScriptMessageHandler {
        weak var coordinator: Coordinator?
        init(_ coordinator: Coordinator) { self.coordinator = coordinator }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            coordinator?.receiveCapability(message.body)
        }
    }

    /// The controller keeps its handler: this one does not keep the view's
    /// coordinator alive.
    private final class WeakPlaceHandler: NSObject, WKScriptMessageHandler {
        weak var coordinator: Coordinator?
        init(_ coordinator: Coordinator) { self.coordinator = coordinator }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            coordinator?.receive(message.body)
        }
    }
}
