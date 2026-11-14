// The phone's side of a page's capabilities (#3413 lot 8, the desktop's
// src/components/PageCapabilityStrip.tsx): under the open page's floating
// row, what this version may read, the organization's Ask first card and the
// card of a link the page asks to open that no data answer named. The page
// is outside; the tap is here. A page that declares nothing shows nothing.
import CompanionCore
import SwiftUI
import WebKit

/// Posts the broker's messages to the page's frame, through the isolated
/// world of the web view that draws it (PageCapBridge).
@MainActor
final class PageCapRelay {
    weak var webView: WKWebView?

    func post(_ message: [String: Any]) {
        guard let source = PageCapBridge.postSource(message) else { return }
        webView?.evaluateJavaScript(source, in: nil, in: .world(name: PageCapBridge.world)) { _ in }
    }
}

enum PageCapWords {
    /// The parts of a declaration, in words (capabilityParts).
    static func parts(_ caps: PageCapabilities) -> [String] {
        caps.data.map { name in
            name == "team-board" ? String(localized: "the work of your coding teams") : name
        }
        + (caps.viewer ? [String(localized: "your name and role")] : [])
        + (caps.open ? [String(localized: "opens links and chats")] : [])
        + caps.files.map { $0 == "download" ? String(localized: "a file it hands you") : $0 }
    }
}

struct PageCapabilityStrip: View {
    @ObservedObject var broker: PageCapabilityBroker

    var body: some View {
        if let caps = broker.state.caps, caps.any {
            VStack(spacing: 0) {
                Text(String(localized: "Reads: \(PageCapWords.parts(caps).joined(separator: ", "))"))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .accessibilityLabel(Text(String(localized: "What this page may read")))
                    .accessibilityValue(Text(verbatim: PageCapWords.parts(caps).joined(separator: ", ")))
                    .accessibilityIdentifier("page-caps-line")
                ForEach(broker.state.approvals) { entry in approvalRow(entry) }
                ForEach(broker.state.links) { entry in PageCapLinkRow(entry: entry, broker: broker) }
            }
            .overlay(alignment: .top) { Rectangle().fill(Theme.textTertiary.opacity(0.18)).frame(height: 0.5) }
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.textTertiary.opacity(0.18)).frame(height: 0.5) }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("page-caps-strip")
        }
    }

    private func approvalRow(_ entry: PageCapApproval) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.shield")
                    .font(.system(size: 13))
                    .accessibilityHidden(true)
                Text(String(localized: "Your organization asks you first. This page wants to read: \(entry.label)"))
                    .font(.system(size: 12.5))
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                PageCapButton(title: String(localized: "Decline"), primary: false, id: "page-cap-decline") { broker.resolveApproval(entry.id, .decline) }
                PageCapButton(title: String(localized: "Always allow"), primary: true, id: "page-cap-always") { broker.resolveApproval(entry.id, .always) }
                PageCapButton(title: String(localized: "Allow"), primary: true, id: "page-cap-allow") { broker.resolveApproval(entry.id, .once) }
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.accent.opacity(0.10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-cap-approval-\(entry.name)")
    }
}

/// The address a page asks to open, in full: host first, then path, query
/// and fragment as written, cut in the middle only when long.
private struct PageCapLinkRow: View {
    let entry: PageCapLink
    @ObservedObject var broker: PageCapabilityBroker
    @State private var all = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 13))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    (Text(String(localized: "This page wants to open:")) + Text(verbatim: " ") + Text(verbatim: entry.host).fontWeight(.medium))
                        .font(.system(size: 12.5))
                        .accessibilityIdentifier("page-cap-host")
                    if !entry.rest.isEmpty {
                        Text(verbatim: all ? entry.rest : entry.short)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("page-cap-rest")
                    }
                    Text(String(localized: "That address was not in the data it read."))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                    if entry.cut {
                        Button(all ? String(localized: "Show less") : String(localized: "Show the whole address")) { all.toggle() }
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.accent)
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("page-cap-more")
                    }
                }
            }
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                PageCapButton(title: String(localized: "Cancel"), primary: false, id: "page-cap-link-cancel") { broker.resolveLink(entry.id, .cancel) }
                if entry.always {
                    PageCapButton(title: String(localized: "Always allow this site"), primary: true, id: "page-cap-link-always") { broker.resolveLink(entry.id, .always) }
                }
                PageCapButton(title: String(localized: "Open"), primary: true, id: "page-cap-link-open") { broker.resolveLink(entry.id, .open) }
            }
        }
        .foregroundStyle(Theme.textPrimary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.accent.opacity(0.10))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("page-cap-link")
    }
}

private struct PageCapButton: View {
    let title: String
    let primary: Bool
    let id: String
    let action: () -> Bool

    var body: some View {
        Button {
            if action() { Haptics.selection() }
        } label: {
            Text(verbatim: title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(primary ? Theme.accent : Theme.textSecondary)
                .padding(.horizontal, 8)
                .frame(minHeight: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }
}
