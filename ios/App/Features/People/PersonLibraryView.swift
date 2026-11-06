// A person's Library tab (#2117): the bot Library's look for the files the
// viewer and this person have together (GET /api/people/:id/library). Each
// file carries its conversation; Show in chat opens its room.
import CompanionCore
import SwiftUI

struct PersonLibraryView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let personId: String
    var openChat: (Chat) -> Void

    @State private var files: [ThreadFile]?
    @State private var failed = false
    @State private var olderExpanded = false
    @State private var status: String?

    private var groups: LibraryGroups {
        LibraryRules.groups(files: files ?? [], artifacts: [], pages: [], now: Date().timeIntervalSince1970 * 1000)
    }

    var body: some View {
        Group {
            if failed && files == nil {
                VStack(spacing: 10) {
                    Text(String(localized: "Couldn't load the library."))
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textSecondary)
                    Button(String(localized: "Retry")) { Task { await reload() } }
                        .accessibilityIdentifier("person-library-retry")
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
            } else if files == nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 24)
                    .accessibilityLabel(Text(String(localized: "Loading")))
            } else if groups.isEmpty {
                Text(String(localized: "Files you and this person share in your groups and conversations show up here."))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
                    .accessibilityIdentifier("person-library-empty")
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    group("pinned", title: "Pinned", entries: groups.pinned)
                    group("today", title: "Today", entries: groups.today)
                    group("this-week", title: "This week", entries: groups.thisWeek)
                    group(
                        "older",
                        title: "Older",
                        entries: LibraryOlder.shown(groups.older, expanded: olderExpanded),
                        more: LibraryOlder.hidesRows(groups.older, expanded: olderExpanded)
                    )
                    if let status {
                        Text(verbatim: status)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .accessibilityIdentifier("person-library")
        .task(id: personId) { await reload() }
    }

    @ViewBuilder
    private func group(_ id: String, title: LocalizedStringKey, entries: [LibraryEntry], more: Bool = false) -> some View {
        if !entries.isEmpty || more {
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.bottom, 6)
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        row(entry)
                    }
                    if more {
                        Button {
                            olderExpanded = true
                        } label: {
                            Text(String(localized: "Show more"))
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("person-library-show-more")
                    }
                }
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .accessibilityIdentifier("person-library-group.\(id)")
        }
    }

    @ViewBuilder
    private func row(_ entry: LibraryEntry) -> some View {
        if case let .file(file) = entry {
            let threadId = file.threadId ?? ""
            HStack(spacing: 10) {
                LibraryEntryGlyph(threadId: threadId, entry: entry, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: file.name)
                        .font(.system(size: 13))
                        .foregroundStyle(file.available ? Theme.textPrimary : Theme.textSecondary)
                        .lineLimit(1)
                    if let groupName = file.groupName, !groupName.isEmpty {
                        Text(verbatim: groupName)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Menu {
                    if let room = room(for: file) {
                        Button(String(localized: "Show in chat")) { openChat(.room(room)) }
                    }
                    Button(file.pinned ? String(localized: "Unpin") : String(localized: "Pin")) {
                        Task { await pin(file, !file.pinned) }
                    }
                    .disabled(threadId.isEmpty)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .accessibilityIdentifier("person-library-file.\(threadId).\(file.id)")
        }
    }

    private func room(for file: ThreadFile) -> Room? {
        if let groupId = file.groupId {
            return session.state.rooms.first { $0.id == groupId }
        }
        if let threadId = file.threadId {
            return session.state.rooms.first { $0.threadId == threadId }
        }
        return nil
    }

    private func reload() async {
        failed = false
        files = nil
        guard let client = session.settingsClient else {
            failed = true
            files = []
            return
        }
        do {
            files = try await client.personLibrary(personId: personId)
        } catch {
            failed = true
            if files == nil { files = nil }
        }
    }

    private func pin(_ file: ThreadFile, _ pinned: Bool) async {
        guard let threadId = file.threadId, let client = session.settingsClient,
              let index = files?.firstIndex(where: { $0.id == file.id && $0.threadId == file.threadId }) else { return }
        files?[index].pinned = pinned
        do {
            try await client.setThreadFilePin(threadId: threadId, fileId: file.id, pinned: pinned)
            status = nil
        } catch {
            if let back = files?.firstIndex(where: { $0.id == file.id && $0.threadId == file.threadId }) {
                files?[back].pinned = !pinned
            }
            status = String(localized: "Couldn't update the pin.")
        }
    }
}
