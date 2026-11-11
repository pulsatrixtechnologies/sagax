// History of changes (BA18, bot-settings/HistorySection.tsx and the dialog's
// loadHistory / rollbackHistory): every recorded change to this bot's
// profile, newest first; a soul row that can be undone offers "Undo this
// change" (and a swipe), confirmed as on the desktop, then the list reloads
// whether the rollback worked or not.
//
// Lot 8 (2026-11-01): the line a person reads is a phrase without ids or
// byte sizes; those stay behind "Show details" with Copy. The page title
// matches the Edit bot row: Changes.
import CompanionCore
import SwiftUI
import UIKit

struct BotHistorySection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var history: BotHistory?
    @State private var loadFailed = false
    @State private var rollingBack = false
    @State private var target: BotHistoryRow?
    @State private var request = 0
    @State private var expanded: Set<String> = []

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        Section {
            if let history {
                if loadFailed {
                    Text(String(localized: "Couldn’t refresh history."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                if history.rows.isEmpty {
                    Text(String(localized: "Each change to this bot's settings will show here, and you can restore it."))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("history-empty")
                }
                ForEach(history.sorted) { row in
                    rowView(row, revision: history.revision)
                }
            } else if loadFailed {
                Text(String(localized: "Couldn’t load history."))
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            }
        } header: {
            Text(String(localized: "Changes"))
        }
        .task(id: bot.id) { await load() }
        .confirmationDialog(
            String(localized: "Restore previous instructions?"),
            isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
            titleVisibility: .visible,
            presenting: target
        ) { row in
            Button(String(localized: "Restore instructions")) { Task { await rollback(row) } }
                .accessibilityIdentifier("history-restore-confirm")
            Button(String(localized: "Cancel"), role: .cancel) { target = nil }
        } message: { _ in
            Text(String(localized: "Replaces current SOUL with the version before this change. Current version stays in Changes."))
        }
    }

    @ViewBuilder
    private func rowView(_ row: BotHistoryRow, revision: String?) -> some View {
        let details = DisplayHygiene.historyDetails(row)
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: DisplayHygiene.historyPhrase(row, botName: current.name))
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("history-line.\(row.id)")
            if row.restorable {
                Button(String(localized: "Undo this change")) { target = row }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.blue)
                    .buttonStyle(.borderless)
                    .disabled(rollingBack || revision == nil)
                    .accessibilityIdentifier("history-undo.\(row.id)")
            } else if row.showsRestoreReason {
                Text(verbatim: row.restoreUnavailableReason
                     ?? String(localized: "The exact previous instructions are unavailable, so this change cannot be undone."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            if !details.isEmpty {
                DisclosureGroup(
                    isExpanded: Binding(
                        get: { expanded.contains(row.id) },
                        set: { open in
                            if open { expanded.insert(row.id) } else { expanded.remove(row.id) }
                        }
                    )
                ) {
                    ForEach(Array(details.enumerated()), id: \.offset) { _, detail in
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: detail.label)
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                                Text(verbatim: detail.value)
                                    .font(Theme.mono(12))
                                    .foregroundStyle(Theme.textPrimary)
                                    .textSelection(.enabled)
                            }
                            Spacer(minLength: 0)
                            Button(String(localized: "Copy")) {
                                UIPasteboard.general.string = detail.value
                            }
                            .font(.caption)
                            .buttonStyle(.borderless)
                            .accessibilityLabel(Text(String(localized: "Copy \(detail.label)")))
                        }
                        .padding(.vertical, 2)
                    }
                } label: {
                    Text(String(localized: "Show details"))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                .accessibilityIdentifier("history-details.\(row.id)")
            }
        }
        .swipeActions(edge: .trailing) {
            if row.restorable, revision != nil, !rollingBack {
                Button(String(localized: "Restore")) { target = row }.tint(Theme.accent)
            }
        }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        request += 1
        let mine = request
        do {
            let next = try await client.botHistory(botId: bot.id)
            guard mine == request else { return }
            history = next
            loadFailed = false
        } catch {
            if mine == request { loadFailed = true }
        }
    }

    private func rollback(_ row: BotHistoryRow) async {
        target = nil
        guard !rollingBack, let revision = history?.revision, let client = session.profileClient else { return }
        rollingBack = true
        do {
            try await client.rollbackHistory(botId: bot.id, rowId: row.id, expectedRevision: revision)
        } catch {
            session.actionError = error.localizedDescription
        }
        await load()
        rollingBack = false
    }
}

struct BotHistoryPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedList { BotHistorySection(bot: bot) }
            .navigationTitle(String(localized: "Changes"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("history-page")
    }
}
