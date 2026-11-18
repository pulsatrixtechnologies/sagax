// Ask the bot about a selected passage of its page, in place (#4099, the
// desktop's src/components/PageSelectionAsk.tsx). The page's own frame says
// where the person's text selection is (`sagax-page-selection`, forwarded by
// the web view's isolated script, CompanionCore PageViewRules.parseSelection).
// The system edit menu of the selection gets one more entry, "Ask <bot>":
// it opens the composer under the passage (over it near the bottom), with an
// outline in the skin's accent and a "Selected text" tag on its top edge.
// Send is the person's ordinary message in the bot's conversation, carrying
// the page and the passage (`dataContext.page.selection`); the bot's new
// version is drawn in place, with one line that offers Undo.
import CompanionCore
import SwiftUI
import UIKit
import WebKit

/// What the page over a conversation needs to offer the ask: the bot (its
/// face and name), whether it is working, and how the words leave. Absent
/// where there is no conversation to write in, or where the person only
/// reads (the ask is then not offered at all).
struct PageAsk {
    let chat: Chat
    let working: Bool
    let send: (String, PageContextRef) -> Void
}

/// Posts to the page's frame through the web view's isolated script: follow
/// a passage or drop the selection (`pageSelectionRequest`).
@MainActor
final class PageSelectionRelay {
    weak var webView: WKWebView?

    func request(_ anchor: PageQuote?) {
        let json = PageViewRules.selectionRequestJSON(anchor)
        webView?.evaluateJavaScript("window.__sagaxSelPost&&window.__sagaxSelPost(\(json));void 0", in: nil, in: .world(name: PageWebView.placeWorld)) { _ in }
    }
}

/// The page's web view with one more entry in the selection's edit menu.
final class PageAskWebView: WKWebView {
    var askTitle: String?
    var onAsk: (() -> Void)?

    override func buildMenu(with builder: any UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context, let askTitle, onAsk != nil else { return }
        let action = UIAction(title: askTitle, image: UIImage(systemName: "sparkles")) { [weak self] _ in self?.onAsk?() }
        builder.insertChild(UIMenu(options: .displayInline, children: [action]), atStartOfMenu: .standardEdit)
    }
}

/// The passage being asked about: its words, its box when the person chose
/// "Ask", and what they typed.
struct AskingPassage: Equatable {
    var quote: PageQuote
    var rect: PageSelectionRect
    var text = ""
    /// Sent: the composer shows the bot's working line until the page is redrawn.
    var sent = false
    var sawWorking = false
}

/// The outline, its tag and the composer, over the page (the web view's own
/// frame: the box the frame reported is in its coordinates).
struct PageSelectionAskView: View {
    @Binding var asking: AskingPassage
    let chat: Chat
    let working: Bool
    let onSend: () -> Void
    let onCancel: () -> Void
    @FocusState private var focused: Bool

    private let ringPad = 4.0

    var body: some View {
        GeometryReader { proxy in
            let place = PageViewRules.selectionComposerPlace(rect: asking.rect, width: proxy.size.width, height: proxy.size.height)
            ZStack(alignment: .topLeading) {
                // a tap elsewhere puts it away
                Color.clear.contentShape(Rectangle()).onTapGesture(perform: onCancel)
                ring
                composer
                    .frame(width: place.width)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: place.top != nil ? .topLeading : .bottomLeading)
                    .padding(.leading, place.left)
                    .padding(.top, place.top ?? 0)
                    .padding(.bottom, place.bottom ?? 0)
            }
        }
        .onAppear { focused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-selection-ask")
    }

    private var ring: some View {
        let rect = asking.rect
        return ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.accent.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.accent.opacity(0.9), lineWidth: 1.5))
                .frame(width: rect.w + 2 * ringPad, height: rect.h + 2 * ringPad)
            Text(String(localized: "Selected text"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.accentInk)
                .padding(.horizontal, 8)
                .frame(height: 18)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .offset(y: -18)
        }
        .offset(x: rect.x - ringPad, y: rect.y - ringPad)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ChatAvatarView(chat: chat, size: 28, state: working ? .working : .idle, animated: working)
                .frame(width: 28, height: 28)
            if asking.sent {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text(String(localized: "On it"))
                }
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .accessibilityIdentifier("page-selection-working")
            } else {
                TextField(String(localized: "Ask about this passage"), text: $asking.text, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(onSend)
                    .padding(.horizontal, 4)
                    .frame(minHeight: 28)
                    .accessibilityLabel(Text(String(localized: "Ask \(chat.name) about the selected text")))
                    .accessibilityIdentifier("page-selection-field")
                Button(action: onSend) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.white)
                        .frame(width: 28, height: 28)
                        .background(Theme.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(asking.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(asking.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                .accessibilityLabel(Text(String(localized: "Send")))
                .accessibilityIdentifier("page-selection-send")
            }
        }
        .padding(8)
        .frame(minHeight: 44)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 6)
    }
}

/// The one line after the bot's edit landed, with Undo.
struct PageEditUndoLine: View {
    let name: String
    let busy: Bool
    let onUndo: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(String(localized: "\(name) edited this passage"))
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 14)
                .padding(.trailing, 6)
            Button(action: onUndo) {
                Label(String(localized: "Undo"), systemImage: "arrow.uturn.backward")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.blue)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityIdentifier("page-edit-undo")
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "Close")))
        }
        .padding(.vertical, 3)
        .padding(.trailing, 3)
        .themeGlass(Capsule(), interactive: false)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-edit-undo-line")
    }
}
