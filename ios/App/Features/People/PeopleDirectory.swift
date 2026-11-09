// The organization's people, for everything WP15 draws about them (matrix
// RM21, RM22): the directory asked once per pairing (`useOrgPeople`), the
// person sheet's presentation, and opening the direct conversation with
// someone (store.tsx `openPeopleDm`). Organization servers only: on any
// other pairing the directory stays empty and nothing here is drawn.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class PeopleDirectory: ObservableObject {
    static let shared = PeopleDirectory()

    /// Nil until it answers, or off an organization server.
    @Published private(set) var directory: OrgDirectory?
    /// The console's admin role (`GET /api/org` `viewerRole`), for "Manage
    /// in Perspicax".
    @Published private(set) var viewerIsAdmin = false
    /// The person whose sheet is open, wherever it was asked for.
    @Published var sheetPersonId: String?
    /// The conversation the sheet was opened from, if any: inside their
    /// direct conversation the sheet offers no Message.
    @Published var sheetFromRoomId: String?
    @Published var opening = false
    /// Who is online, away or offline (#167); empty off an organization server.
    @Published private(set) var presence = PresenceBook()
    /// People's labels (#172), live through `person.label` frames.
    @Published private(set) var labels = PersonLabelBook()
    /// People's Perspicax pictures by `/api/people/<id>/avatar` path, read
    /// once with the pairing's bearer.
    @Published private(set) var photos: [String: UIImage] = [:]
    private var photoReads: Set<String> = []
    /// The pairing the directory was read from, for the pictures.
    private var photoClient: CompanionClient?
    private var loadedFor: String?
    private var heartbeat: Task<Void, Never>?
    private let pageId = PresenceHeartbeat.newPageId()

    /// `loadOrgPeople`: once per pairing; `force` asks again.
    func load(_ session: Session, force: Bool = false) async {
        guard session.surfaceGate.allows(.people), let connection = session.connection else {
            directory = nil
            loadedFor = nil
            photoClient = nil
            photos = [:]
            photoReads = []
            presence.reset()
            labels = PersonLabelBook()
            heartbeat?.cancel()
            heartbeat = nil
            return
        }
        guard force || loadedFor != connection.id || directory == nil else { return }
        if loadedFor != connection.id {
            photos = [:]
            photoReads = []
        }
        loadedFor = connection.id
        photoClient = session.settingsClient
        let loaded = await session.orgDirectory()
        directory = loaded
        var book = PersonLabelBook()
        for person in loaded.people where person.label != nil { book.set(person.principalId, person.label) }
        if let client = session.settingsClient {
            viewerIsAdmin = (try? await client.organization())?.isAdmin ?? false
            if let fetched = try? await client.personLabels() {
                book = PersonLabelBook(fetched)
            }
            if let rows = try? await client.presence() {
                presence.applyList(rows)
                startHeartbeat(client)
            } else {
                presence.reset()
            }
        }
        labels = book
    }

    /// `POST /api/presence/heartbeat` about every minute while the app is in
    /// front: an open phone counts as online, not away after five minutes.
    private func startHeartbeat(_ client: CompanionClient) {
        heartbeat?.cancel()
        let page = pageId
        heartbeat = Task { [weak self] in
            while !Task.isCancelled {
                if UIApplication.shared.applicationState == .active {
                    if let own = try? await client.presenceHeartbeat(PresenceHeartbeat(pageId: page, idleMs: 0)) {
                        self?.presence.applyFrame(audience: own.principalId, rows: [own])
                    }
                }
                try? await Task.sleep(nanoseconds: UInt64(PresenceHeartbeat.interval * 1_000_000_000))
            }
        }
    }

    /// The live frames that concern people.
    func apply(_ frame: Frame) {
        switch frame {
        case let .presenceChanged(audience, rows):
            presence.applyFrame(audience: audience, rows: rows)
        case let .personLabel(principalId, label):
            labels.set(principalId, label)
        default:
            break
        }
    }

    /// A person's label: the live value, else what the directory carried.
    func label(_ principalId: String?) -> String? {
        labels.label(principalId) ?? principalId.flatMap { directory?.person($0)?.label }.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// `canEditPersonLabel`: the person, an admin, a manager of their team.
    func canEditLabel(_ personId: String, session: Session) -> Bool {
        PersonLabel.canEdit(
            personId: personId,
            viewerId: session.roomViewer.actorId,
            viewerAdmin: viewerIsAdmin || directory?.viewer?.orgRole == "admin",
            managedTeamIds: directory?.viewer?.managedTeamIds ?? [],
            personTeamIds: (directory?.person(personId)?.teams ?? []).map(\.id)
        )
    }

    /// `PUT /api/people/<id>/label`. Nil when saved, else the sentence to show.
    func saveLabel(_ personId: String, _ text: String, session: Session) async -> String? {
        let normalized: String?
        switch PersonLabel.normalize(text) {
        case let .success(value): normalized = value
        case .failure: return String(localized: "The label could not be saved.")
        }
        guard let client = session.settingsClient else { return String(localized: "The label could not be saved.") }
        do {
            let stored = try await client.setPersonLabel(principalId: personId, label: normalized)
            labels.set(personId, stored)
            return nil
        } catch {
            return String(localized: "The label could not be saved.")
        }
    }

    /// The presence of the other person of a people-only conversation.
    func presence(of room: Room, session: Session) -> PresenceEntry? {
        peer(room, session: session).flatMap { presence.entry($0.id) }
    }

    /// A people-only conversation as the viewer reads it: the other person.
    func peer(_ room: Room, session: Session) -> PeopleDMPeer? {
        room.peopleDMPeer(viewerId: session.roomViewer.actorId, directory: directory)
    }

    /// How a chat is named on the home and in its header: a people-only
    /// conversation by the other person, everything else as before.
    func name(_ chat: Chat, session: Session) -> String {
        if case let .room(room) = chat, let peer = peer(room, session: session) { return peer.name }
        return chat.name
    }

    /// `botSharer` (#985): who shared this bot with the viewer, nil for the
    /// viewer's own bot, a local bot or someone the directory does not list.
    func sharer(of bot: Bot, session: Session) -> BotSharer? {
        BotSharerRules.sharer(ownerUserId: bot.ownerUserId, viewerId: session.roomViewer.actorId, directory: directory)
    }

    /// A person's picture, once read; the first ask starts the read.
    func photo(_ path: String?) async {
        guard let path = BotSharerRules.personAvatarPath(path), photos[path] == nil, !photoReads.contains(path),
              let client = photoClient else { return }
        photoReads.insert(path)
        if let data = try? await client.personAvatar(path: path), let image = await ImageDecoding.prepared(data) {
            photos[path] = image
        }
    }

    func showPerson(_ id: String, fromRoomId: String? = nil) {
        Haptics.selection()
        sheetFromRoomId = fromRoomId
        sheetPersonId = id
    }

    /// `openPeopleDm`: the conversation that exists, else a new one.
    func openConversation(with principalId: String, session: Session) async -> Chat? {
        if let room = session.state.rooms.first(where: { room in
            room.peopleDm == true && (room.humanIds ?? []).contains { $0.lowercased() == principalId.lowercased() }
        }) {
            return .room(room)
        }
        guard let client = session.settingsClient else { return nil }
        opening = true
        defer { opening = false }
        do {
            let room = try await client.openPeopleDM(principalId: principalId)
            session.applyRoom(room)
            return .room(room)
        } catch {
            session.actionError = error.localizedDescription
            return nil
        }
    }
}

/// A person's round face: their initials on the inset surface (the
/// desktop's `InitialsAvatar`; a Perspicax picture needs the session's
/// bearer and is not fetched yet).
struct PersonAvatar: View {
    @Environment(\.themePalette) var themePalette
    let initials: String
    var size: CGFloat = 28
    /// Draws the person's presence dot (#167) at the bottom right.
    var presenceId: String?
    /// Their Perspicax picture (`/api/people/<id>/avatar`), else the initials.
    var avatarUrl: String?
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        face
            .frame(width: size, height: size)
            .overlay(alignment: .bottomTrailing) {
                if let entry = people.presence.entry(presenceId) {
                    PresenceDot(entry: entry, size: max(8, size * 0.26))
                }
            }
            .task(id: avatarUrl) { await people.photo(avatarUrl) }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var face: some View {
        if let path = avatarUrl, let photo = people.photos[path] {
            Image(uiImage: photo)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            Text(verbatim: initials)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: size, height: size)
                .background(Theme.inset, in: Circle())
        }
    }
}

/// The face of the person who shared a bot (#985, SidebarSharerBadge.tsx),
/// on the bot's avatar's bottom-right corner, ringed in the surface. The
/// id is never shown; VoiceOver reads "Shared by <name>".
struct SharerBadge: View {
    let sharer: BotSharer
    let avatarSize: CGFloat
    var ring: Color = Theme.bg

    var body: some View {
        let size = max(14, (avatarSize * 0.4).rounded())
        PersonAvatar(initials: sharer.initials, size: size, avatarUrl: sharer.avatarUrl)
            .padding(2)
            .background(ring, in: Circle())
            .offset(x: 2, y: 2)
            .accessibilityElement()
            .accessibilityLabel(Text("Shared by \(sharer.name)"))
            .accessibilityIdentifier("sidebar-sharer")
    }
}

/// The presence dot (`PresenceDot`, #167): green online, amber away, grey
/// offline, ringed in the surface so it reads on any avatar.
struct PresenceDot: View {
    @Environment(\.themePalette) var themePalette
    let entry: PresenceEntry
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(Self.color(entry.state))
            .frame(width: size, height: size)
            .overlay(Circle().strokeBorder(Theme.bg, lineWidth: max(1.5, size * 0.18)))
            .accessibilityElement()
            .accessibilityLabel(Text(Self.words(entry)))
            .accessibilityIdentifier("presence.\(entry.state.rawValue)")
    }

    static func color(_ state: PresenceState) -> Color {
        switch state {
        case .online: Color(hex: 0x34C759)
        case .away: Color(hex: 0xF5A524)
        case .offline: Color(hex: 0x8E8E93)
        }
    }

    /// `presenceLabel`: "Online", "Away", "Offline, last seen 2 h ago",
    /// with "(hidden from others)" on one's own hidden dot.
    static func words(_ entry: PresenceEntry, now: Date = Date()) -> String {
        let state: String
        switch entry.state {
        case .online: state = String(localized: "Online")
        case .away: state = String(localized: "Away")
        case .offline:
            if let at = entry.lastSeenAt {
                let when: String
                switch PresenceLastSeen.ago(at, now: now.timeIntervalSince1970 * 1000) {
                case .justNow: when = String(localized: "just now")
                case let .minutes(count): when = String(localized: "\(count) min ago")
                case let .hours(count): when = String(localized: "\(count) h ago")
                case let .days(count): when = String(localized: "\(count) d ago")
                }
                state = String(localized: "Offline, last seen \(when)")
            } else {
                state = String(localized: "Offline")
            }
        }
        return entry.hidden ? String(localized: "\(state) (hidden from others)") : state
    }
}

/// A person's label (#172), drawn as a bot's label tag.
struct PersonLabelTag: View {
    let personId: String?
    var font: Font = Theme.Font.roleChip
    var horizontalPadding: CGFloat = 6.7
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        if let label = people.label(personId) {
            RoleChip(text: label, font: font, horizontalPadding: horizontalPadding)
                .accessibilityIdentifier("person-label")
        }
    }
}

extension View {
    /// Mounts the person sheet once per host.
    func personSheetPresenter(onOpenChat: @escaping (Chat) -> Void) -> some View {
        modifier(PersonSheetPresenter(onOpenChat: onOpenChat))
    }
}

private struct PersonSheetPresenter: ViewModifier {
    let onOpenChat: (Chat) -> Void
    @ObservedObject private var people = PeopleDirectory.shared

    func body(content: Content) -> some View {
        content.sheet(item: Binding(
            get: { people.sheetPersonId.map(PersonRef.init) },
            set: { people.sheetPersonId = $0?.id }
        )) { ref in
            PersonSheet(personId: ref.id, openedFromRoomId: people.sheetFromRoomId) { chat in
                people.sheetPersonId = nil
                onOpenChat(chat)
            }
        }
    }
}

private struct PersonRef: Identifiable {
    let id: String
}
