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
        // The reference app's grouped inset cards (2026-11-01)
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
        switch loaded {
        case let .loaded(value):
            overview = value
            failed = false
        case .failed:
            failed = true
        case .hidden, .loading:
            // nothing to read for this pairing: no error, nothing shown
            failed = false
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

/// The Personality sub-page's "What it does" block (#3030), the desktop's
/// `BOT_PROFILE_SUBPAGE_SECTIONS.personality = ["summary", "soul"]`: who it
/// is and what it does, in one compact card; the whole overview stays one
/// tap away behind "See everything".
struct BotPersonalitySummary: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var load: BotOverviewLoad = .loading

    var body: some View {
        Group {
            // No overview for this pairing (no computer, 403, 404): the
            // block goes away, as on the desktop, never a spinner forever.
            if load != .hidden { summary }
        }
        .task(id: bot.id) { load = await session.botOverview(for: bot) }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 0) {
            ProfileSectionLabel(text: "What it does", margin: Theme.Profile.routineMargin)
            ProfileCard(margin: Theme.Profile.routineMargin) {
                VStack(alignment: .leading, spacing: 6) {
                    if let overview = load.overview {
                        let blurb = overview.who.blurb.isEmpty ? overview.who.title : overview.who.blurb
                        if !blurb.isEmpty {
                            Text(verbatim: blurb)
                                .font(Theme.Font.body)
                                .foregroundStyle(Theme.textPrimary)
                        }
                        if overview.does.isEmpty {
                            Text("Nothing scheduled or learned yet.")
                                .font(Theme.Profile.labelFont)
                                .foregroundStyle(Theme.textSecondary)
                        } else {
                            ForEach(Array(overview.does.prefix(3).enumerated()), id: \.offset) { _, line in
                                Label(line, systemImage: "calendar.badge.clock")
                                    .font(Theme.Profile.labelFont)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    } else if load == .failed {
                        Text("Couldn’t load the overview.")
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                    } else {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                ProfileDivider(leading: 14)
                NavigationLink {
                    BotOverviewPage(bot: bot)
                } label: {
                    HStack {
                        Text("See everything")
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: Theme.Profile.singleRow)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("personality-summary.more")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("personality-summary")
    }
}
