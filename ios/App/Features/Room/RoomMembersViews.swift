// A room's people and bots (matrix RM6, RM18; ChannelMembers.tsx,
// GroupPeoplePicker.tsx, GroupBotPicker.tsx): who is in it, and for the
// pairings that manage rooms, adding and removing them. Desktop "+ Add"
// opens an inline picker; this sheet still opens on the section named by
// "+ Add" or "Manage members" (#1240, #1260). The owner removes anyone and
// edits the roster; a member brings their own bots in and takes them out
// (server/groups/group-ownership.ts).
import CompanionCore
import SwiftUI

struct RoomPeopleSection: View {
    let room: Room
    let access: RoomInfoAccess
    let directory: OrgDirectory?
    var addPeople: () -> Void
    @EnvironmentObject private var session: Session

    private struct Person: Identifiable {
        let id: String
        let label: String
        let detail: String?
        let removable: Bool
    }

    private var people: [Person] {
        let viewer = session.roomViewer
        let email = viewer.normalizedEmail
        let name = session.account?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let me = (name?.isEmpty == false ? name : nil) ?? email ?? String(localized: "You")
        var out = [Person(id: viewer.actorId, label: me, detail: email != me ? email : nil, removable: false)]
        for raw in room.humanIds ?? [] {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !id.isEmpty, id != viewer.actorId, id != email else { continue }
            out.append(Person(id: id, label: directory?.label(for: id) ?? id, detail: nil, removable: access.canRemoveHumans))
        }
        return out
    }

    var body: some View {
        Section {
            ForEach(people) { person in
                HStack(spacing: 12) {
                    Text(verbatim: initials(person.label))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: 32, height: 32)
                        .background(Theme.inset, in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: person.label)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if let detail = person.detail {
                            Text(verbatim: detail)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if person.removable {
                        Button {
                            Task { await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsRemoving(person.id, from: room))) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Remove \(person.label)")))
                        .accessibilityIdentifier("room-remove-person-\(person.id)")
                    }
                }
            }
            if access.canAddHuman {
                Button(action: addPeople) {
                    Label(String(localized: "Add"), systemImage: "plus")
                }
                .accessibilityIdentifier("room-add-person")
            }
        } header: {
            Text(String(localized: "People"))
        }
    }

    private func initials(_ label: String) -> String {
        let parts = label.split(whereSeparator: { " @._-".contains($0) })
        let letters = String(parts.first?.prefix(1) ?? "") + String(parts.dropFirst().first?.prefix(1) ?? "")
        return (letters.isEmpty ? String(label.prefix(2)) : letters).uppercased()
    }
}

struct RoomBotsSection: View {
    let room: Room
    let access: RoomInfoAccess
    var addBots: () -> Void
    var manageMembers: () -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        Section {
            ForEach(room.memberIds, id: \.self) { id in
                let bot = session.state.bot(id)
                HStack(spacing: 12) {
                    if let bot {
                        BotMascotView(bot: bot, size: 32)
                            .frame(width: 32, height: 32)
                    } else {
                        Circle().fill(Theme.inset).frame(width: 32, height: 32)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: bot?.name ?? id)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if let title = bot?.title, !title.isEmpty {
                            Text(verbatim: title)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if access.removableBotIds.contains(id) {
                        Button {
                            Task { await session.patchRoom(room, RoomPatch(memberIds: room.memberIds.filter { $0 != id })) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Remove \(bot?.name ?? id)")))
                        .accessibilityIdentifier("room-remove-bot-\(id)")
                    }
                }
            }
            if access.canAddBot {
                Button(action: addBots) {
                    Label(access.owns ? String(localized: "Add") : String(localized: "Add my bot"), systemImage: "plus")
                }
                .accessibilityIdentifier("room-add-own-bot")
            }
            if access.canManageRoster {
                Button(String(localized: "Manage members"), action: manageMembers)
                    .accessibilityIdentifier("room-manage-members")
            }
        } header: {
            Text(String(localized: "Bots"))
        }
    }
}

/// The section the roster sheet opens on: the row that opened it.
enum RoomRosterFocus: String, Identifiable {
    case people, bots
    var id: String { rawValue }
}

/// The roster editor: the room's people and its bots,
/// ticked for who is in, saved together. The owner edits everything;
/// anyone else ticks only their own bots. Archived bots stay listed while
/// they are still members.
struct RoomManageMembersSheet: View {
    @Environment(\.themePalette) var themePalette
    let room: Room
    let access: RoomInfoAccess
    let directory: OrgDirectory?
    let focus: RoomRosterFocus
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String>
    @State private var pickedPeople: Set<String>
    /// People ticked in from the search, in order, with how they read.
    @State private var added: [(id: String, label: String)] = []
    @State private var query = ""
    @State private var saveError: String?
    @State private var saving = false

    init(room: Room, access: RoomInfoAccess, directory: OrgDirectory?, focus: RoomRosterFocus) {
        self.room = room
        self.access = access
        self.directory = directory
        self.focus = focus
        _picked = State(initialValue: Set(room.memberIds))
        _pickedPeople = State(initialValue: Set(Self.norm(room.humanIds ?? [])))
    }

    private static func norm(_ ids: [String]) -> [String] {
        ids.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty }
    }

    private var humanIds: [String] { Self.norm(room.humanIds ?? []) }

    private var bots: [Bot] {
        RoomOwnership.rosterBotChoices(room, bots: session.state.bots, viewer: session.roomViewer, owns: access.owns)
    }

    private var memberIds: [String] {
        RoomOwnership.nextMemberIds(current: room.memberIds, picked: picked, order: bots.map(\.id))
    }

    private var nextPeople: [String] {
        RoomOwnership.nextHumanIds(current: humanIds, picked: pickedPeople, added: added.map(\.id))
    }

    private var peopleRows: [(id: String, label: String)] {
        let viewer = session.roomViewer
        let email = viewer.normalizedEmail
        let name = session.account?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let me = (name?.isEmpty == false ? name : nil) ?? email ?? String(localized: "You")
        var seen: Set<String> = [viewer.actorId]
        var out: [(id: String, label: String)] = [(viewer.actorId, me)]
        for id in humanIds where id != email && seen.insert(id).inserted {
            out.append((id, directory?.label(for: id) ?? id))
        }
        for row in added where seen.insert(row.id).inserted { out.append(row) }
        return out
    }

    private var taken: [String] { [session.roomViewer.actorId] + humanIds + added.map(\.id) }

    private var typedEmail: String { query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    private var emailAddable: Bool {
        !access.organization && access.canAddHuman && typedEmail.contains("@") && typedEmail.contains(".")
            && !typedEmail.contains(" ") && !taken.contains(typedEmail)
    }

    private func add(_ id: String, label: String) {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !id.isEmpty else { return }
        pickedPeople.insert(id)
        if !humanIds.contains(id), !added.contains(where: { $0.id == id }) { added.append((id, label)) }
        query = ""
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ThemedList {
                    peopleSection
                    botsSection
                }
                .onAppear { proxy.scrollTo(focus, anchor: .top) }
            }
            .searchable(text: $query, prompt: Text(access.organization ? String(localized: "Search people") : String(localized: "Email address")))
            .navigationTitle(String(localized: "Manage members"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveTitle) { save() }
                        .disabled(memberIds.isEmpty || saving)
                        .accessibilityIdentifier("room-members-save")
                }
            }
        }
    }

    @ViewBuilder private var peopleSection: some View {
        let searching = !typedEmail.isEmpty
        Section {
            if searching, access.canAddHuman {
                if access.organization {
                    let candidates = directory?.candidates(taken: taken, query: query) ?? []
                    if directory != nil, candidates.isEmpty {
                        Text(String(localized: "No one to add"))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(candidates) { person in
                        let label = person.name.isEmpty ? person.login : person.name
                        tickRow(label: label, detail: person.name.isEmpty ? nil : person.login, on: false) { add(person.principalId, label: label) }
                            .accessibilityIdentifier("room-add-\(person.principalId)")
                    }
                } else if emailAddable {
                    tickRow(label: typedEmail, detail: nil, on: false) { add(typedEmail, label: typedEmail) }
                        .accessibilityIdentifier("room-add-email")
                }
            } else {
                ForEach(peopleRows, id: \.id) { row in
                    let mine = row.id == session.roomViewer.actorId
                    let locked = mine || !access.canRemoveHumans
                    tickRow(label: row.label, detail: nil, on: mine || pickedPeople.contains(row.id), locked: locked) {
                        if pickedPeople.contains(row.id) { pickedPeople.remove(row.id) } else { pickedPeople.insert(row.id) }
                    }
                    .accessibilityIdentifier("room-pick-person-\(row.id)")
                }
            }
        } header: {
            Text(String(localized: "People"))
        }
        .id(RoomRosterFocus.people)
    }

    @ViewBuilder private var botsSection: some View {
        Section {
            if bots.isEmpty {
                Text(String(localized: "Create a bot first: groups are made of bots."))
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(bots) { bot in
                Button {
                    if picked.contains(bot.id) { picked.remove(bot.id) } else { picked.insert(bot.id) }
                } label: {
                    HStack(spacing: 12) {
                        BotMascotView(bot: bot, size: 32).frame(width: 32, height: 32)
                        Text(verbatim: bot.name).foregroundStyle(Theme.textPrimary)
                        Spacer(minLength: 0)
                        Image(systemName: picked.contains(bot.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(picked.contains(bot.id) ? Theme.accent : Theme.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(picked.contains(bot.id) ? .isSelected : [])
                .accessibilityValue(Text(verbatim: picked.contains(bot.id) ? "on" : "off"))
                .accessibilityIdentifier("room-pick-\(bot.id)")
            }
        } header: {
            HStack {
                Text(String(localized: "Bots"))
                Spacer()
                if !bots.isEmpty {
                    Text(verbatim: "\(bots.filter { picked.contains($0.id) }.count)/\(bots.count)").monospacedDigit()
                }
            }
        } footer: {
            if memberIds.isEmpty {
                Text(String(localized: "A group needs at least one bot."))
            } else if let saveError {
                Text(verbatim: saveError).foregroundStyle(Theme.danger)
            } else if !access.owns {
                Text(String(localized: "You can add or remove your own bots. The group's owner manages the rest."))
            }
        }
        .id(RoomRosterFocus.bots)
    }

    private func tickRow(label: String, detail: String?, on: Bool, locked: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: label).foregroundStyle(Theme.textPrimary).lineLimit(1)
                    if let detail, !detail.isEmpty {
                        Text(verbatim: detail)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if !locked {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(on ? Theme.accent : Theme.textTertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(locked)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var saveTitle: String {
        let count = memberIds.count
        if count == 0 || nextPeople != humanIds { return String(localized: "Save") }
        return count == 1 ? String(localized: "Save · 1 bot") : String(localized: "Save · \(count) bots")
    }

    private func save() {
        guard !memberIds.isEmpty else { return }
        let live = session.state.rooms.first { $0.id == room.id }
        guard (live?.memberIds ?? room.memberIds) == room.memberIds,
              Self.norm(live?.humanIds ?? room.humanIds ?? []) == humanIds else {
            saveError = String(localized: "This group's members changed while the panel was open. Close it and try again.")
            return
        }
        let botsChanged = memberIds != room.memberIds
        let peopleChanged = nextPeople != humanIds
        guard botsChanged || peopleChanged else { dismiss(); return }
        saving = true
        Task {
            let kept = await session.patchRoom(room, RoomPatch(memberIds: botsChanged ? memberIds : nil, humanIds: peopleChanged ? nextPeople : nil))
            saving = false
            if kept { dismiss() } else { saveError = session.actionError }
        }
    }
}
