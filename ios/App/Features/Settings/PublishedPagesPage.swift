// Published pages (C10): the desktop's Settings > Pages. Share is who can
// see the page, revoke takes the link down, delete removes it. The title
// is the one the bot proposed: the server has no rename.
import CompanionCore
import SwiftUI

struct PublishedPagesPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var pages: [PublishedPageSummary]?
    @State private var error: String?
    @State private var busy: String?
    @State private var deleting: PublishedPageSummary?
    @State private var copied: String?

    var body: some View {
        SettingsPage(title: "Published pages") {
            SettingsFooter(text: "Pages your bots proposed. A page goes online only when you publish it. Revoking takes the link down at once.")
            if let pages {
                if pages.isEmpty, error == nil {
                    SettingsFooter(text: "No page yet. Ask a bot to make you one.")
                }
                ForEach(pages) { page in
                    SettingsCard { row(page) }
                        .accessibilityIdentifier("published-page.\(page.id)")
                }
            } else if error == nil {
                ProgressView().tint(Theme.textSecondary).padding(.top, 12)
            }
            if let error {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, SettingsMetrics.rowInset)
            }
        }
        .task { await load() }
        .confirmationDialog(
            String(localized: "Delete \(deleting?.title ?? "")?"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) {
                if let page = deleting { Task { await delete(page) } }
            }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "Delete this page and all its versions?"))
        }
        .alert(String(localized: "Published pages"), isPresented: Binding(get: { copied != nil }, set: { if !$0 { copied = nil } })) {
            Button(String(localized: "OK"), role: .cancel) {}
        } message: {
            Text(String(localized: "Link copied."))
        }
    }

    @ViewBuilder
    private func row(_ page: PublishedPageSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(verbatim: page.title.isEmpty ? String(localized: "Page") : page.title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Text(verbatim: status(page))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
            }
            if page.isPublished {
                Picker(String(localized: "Who can see"), selection: Binding(
                    get: { PublishedPageAccess(rawValue: page.access) ?? .private },
                    set: { access in Task { await setAccess(page, access) } }
                )) {
                    Text(String(localized: "Only me")).tag(PublishedPageAccess.private)
                    Text(String(localized: "My organization")).tag(PublishedPageAccess.org)
                    Text(String(localized: "Anyone with the link")).tag(PublishedPageAccess.link)
                }
                .disabled(busy != nil)
                .accessibilityIdentifier("published-page-access.\(page.id)")
                if let url = page.url, RichBlocks.isSafeHttpUrl(url), let link = URL(string: url) {
                    HStack {
                        Link(String(localized: "Open"), destination: link)
                        Button(String(localized: "Copy the link")) {
                            UIPasteboard.general.string = url
                            copied = page.id
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.footnote)
                }
                Button(String(localized: "Revoke"), role: .destructive) { Task { await revoke(page) } }
                    .disabled(busy != nil)
                    .buttonStyle(.borderless)
                    .font(.footnote)
                    .accessibilityIdentifier("published-page-revoke.\(page.id)")
            }
            Button(String(localized: "Delete"), role: .destructive) { deleting = page }
                .disabled(busy != nil)
                .buttonStyle(.borderless)
                .font(.footnote)
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .padding(.vertical, 12)
    }

    private func status(_ page: PublishedPageSummary) -> String {
        if page.expired { return String(localized: "Expired") }
        switch page.status {
        case "published": return String(localized: "Published")
        case "revoked": return String(localized: "Revoked")
        default: return String(localized: "Not published")
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { pages = []; return }
        do {
            pages = try await client.publishedPages()
            error = nil
        } catch {
            pages = pages ?? []
            self.error = error.localizedDescription
        }
    }

    private func setAccess(_ page: PublishedPageSummary, _ access: PublishedPageAccess) async {
        guard access.rawValue != page.access, let client = session.settingsClient else { return }
        busy = page.id
        defer { busy = nil }
        do {
            let next = try await client.setPublishedPageAccess(id: page.id, access: access)
            replace(next)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func revoke(_ page: PublishedPageSummary) async {
        guard let client = session.settingsClient else { return }
        busy = page.id
        defer { busy = nil }
        do {
            let next = try await client.revokePublishedPage(id: page.id)
            replace(next)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ page: PublishedPageSummary) async {
        deleting = nil
        guard let client = session.settingsClient else { return }
        busy = page.id
        defer { busy = nil }
        do {
            try await client.deletePublishedPage(id: page.id)
            pages = pages?.filter { $0.id != page.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func replace(_ page: PublishedPageSummary) {
        pages = pages?.map { $0.id == page.id ? page : $0 }
    }
}
