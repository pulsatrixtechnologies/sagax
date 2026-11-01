import CompanionCore
import SwiftUI

/// A read-only summary of one bot: who it is, what it does, what it can
/// reach, what it won't do, and its recent activity. No settings and no
/// transcript live here — this mirrors the paired-safe `BotOverview` payload
/// exactly.
struct BotOverviewView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    /// The bot panel's Overview also shows what the model sees
    /// (`OverviewSection.tsx` PromptPreview).
    var showsPromptPreview = false

    @EnvironmentObject private var session: Session
    @State private var overview: BotOverview?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        List {
            if let overview {
                Section("Who") {
                    Text(overview.who.name).font(.headline)
                    if !overview.who.title.isEmpty {
                        Text(overview.who.title)
                    }
                    if !overview.who.blurb.isEmpty {
                        Text(overview.who.blurb)
                    }
                    if !overview.who.soulLead.isEmpty {
                        Text(overview.who.soulLead)
                            .font(.footnote)
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    }
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))

                Section("Does") {
                    if overview.does.isEmpty {
                        Text("Nothing scheduled or learned yet.")
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    } else {
                        ForEach(Array(overview.does.enumerated()), id: \.offset) { _, line in
                            Label(line, systemImage: "calendar.badge.clock")
                        }
                    }
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))

                Section("Can reach") {
                    ForEach(Array(overview.reaches.enumerated()), id: \.offset) { _, line in
                        Label(line, systemImage: "network")
                    }
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))

                if let grants = overview.grants {
                    Section("App tools") {
                        if grants.isEmpty {
                            // The record exists but grants nothing: stronger
                            // than "no apps connected", and worth its own line.
                            Text("No tools granted on any connected app.")
                                .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                        } else {
                            ForEach(grants, id: \.slug) { grant in
                                HStack {
                                    Text(grant.slug)
                                    Spacer()
                                    Text(toolsLabel(grant))
                                        .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                                }
                            }
                        }
                    }
                    .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))
                }

                Section("Won't") {
                    ForEach(Array(overview.wont.enumerated()), id: \.offset) { _, line in
                        Label(line, systemImage: "hand.raised")
                    }
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))

                Section("Recent changes") {
                    if overview.recent.isEmpty {
                        Text("No changes recorded yet.")
                            .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                    } else {
                        ForEach(Array(overview.recent.enumerated()), id: \.offset) { _, change in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(change.summary)
                                Text(Date(timeIntervalSince1970: change.at / 1_000).formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption)
                                    .foregroundStyle(Theme.parity(Color.secondary, Theme.textSecondary))
                            }
                        }
                    }
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))
                if showsPromptPreview {
                    PromptPreviewSection(bot: bot)
                        .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))
                }
                // the persona Overview's "Export as zip" (#271)
                BotZipExportSection(bot: bot)
                    .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))
            } else if failed {
                Section {
                    EmptyStateView("Couldn't load", systemImage: "wifi.exclamationmark")
                }
                .listRowBackground(Theme.parity(Color(uiColor: .secondarySystemGroupedBackground), Theme.card))
            }
        }
        // Grok Bot's grouped inset cards (2026-11-01)
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Theme.parity(Color(uiColor: .systemGroupedBackground), Theme.bg))
        .navigationTitle("What \(bot.name) does")
        .overlay { if loading && overview == nil { ProgressView() } }
        .task(id: session.connection?.id) {
            overview = nil
            failed = false
            await load()
        }
        .refreshable { await load() }
    }

    private func load() async {
        let connectionID = session.connection?.id
        loading = true
        defer {
            if !Task.isCancelled, session.connection?.id == connectionID { loading = false }
        }
        let loaded = await session.botOverview(for: bot)
        guard !Task.isCancelled, session.connection?.id == connectionID else { return }
        if let loaded {
            overview = loaded
            failed = false
        } else {
            failed = true
        }
    }

    /// The same three summaries the desktop grant editor shows: every tool,
    /// an exact list, or none. Read-only here — grants are assigned on the
    /// computer, never from a paired phone.
    private func toolsLabel(_ grant: BotOverviewGrant) -> String {
        switch grant.level {
        case .all: "All tools"
        case .partial: grant.toolCount == 1 ? "1 tool" : "\(grant.toolCount) tools"
        case .none: "No tools"
        }
    }
}
