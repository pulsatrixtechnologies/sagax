// The person sheet (matrix RM21; PersonPanel.tsx #2117): someone of the
// organization as the directory knows them, the groups the viewer shares
// with them, their bots shared with the viewer, and what the viewer may do:
// write to them. Nothing from a private thread shows here. No Connections
// section and no Manage in Perspicax link. Profile is the default tab; In
// common draws only when there is something to show; Library lists the
// files of the rooms both people are in; Achievements reads the public card.
//
// `PersonSheetContent` is presentation-free so the iPad shell can dock it
// as the desktop's right panel; the phone wraps it in a sheet.
import CompanionCore
import SwiftUI

struct PersonSheet: View {
    let personId: String
    var openedFromRoomId: String? = nil
    var openChat: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PersonSheetContent(personId: personId, openedFromRoomId: openedFromRoomId, openChat: openChat)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Close")) { dismiss() }
                            .accessibilityIdentifier("person-close")
                    }
                }
        }
    }
}

struct PersonSheetContent: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    let personId: String
    /// The conversation the sheet was opened from (no Message inside theirs).
    var openedFromRoomId: String? = nil
    var openChat: (Chat) -> Void
    var initialTab: PersonPanelTab = .profile
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared
    @State private var card: PublicAchievementCard?
    @State private var cardLoaded = false
    @State private var editingLabel = false
    @State private var labelDraft = ""
    @State private var labelError: String?
    @State private var tab: PersonPanelTab = .profile

    private var model: PersonSheetModel {
        PersonSheetModel(
            personId: personId, directory: people.directory, state: session.state,
            viewerId: session.roomViewer.actorId, viewerIsAdmin: people.viewerIsAdmin,
            openedFromRoomId: openedFromRoomId
        )
    }

    private var language: String? { AchievementLanguage.current ?? locale.language.languageCode?.identifier }

    var body: some View {
        let model = self.model
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header(model)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                tabRow
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                Group {
                    switch tab {
                    case .profile: profileTab(model)
                    case .library: PersonLibraryView(personId: personId, openChat: openChat)
                    case .achievements: achievementsTab
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        }
        .background(Theme.bg)
        .accessibilityIdentifier("person-panel")
        .task(id: session.connection?.id) { await people.load(session) }
        .task(id: personId) {
            tab = initialTab
            card = nil
            cardLoaded = false
            card = try? await session.settingsClient?.publicAchievementCard(principalId: personId)
            cardLoaded = true
        }
        .onAppear { tab = initialTab }
    }

    // MARK: Header

    /// PersonPanel.tsx's header: the name, their label (editable by them, an
    /// admin or their team's manager), the role line only for an admin or a
    /// disabled account, then Message. Title and points live on the
    /// Achievements tab (#2117), never on the name line.
    private func header(_ model: PersonSheetModel) -> some View {
        VStack(spacing: 6) {
            PersonAvatar(initials: model.initials, size: 88, presenceId: personId)
            Text(verbatim: model.name)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .accessibilityIdentifier("person-name")
            if let entry = people.presence.entry(personId) {
                Text(verbatim: PresenceDot.words(entry))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-presence")
            }
            labelLine
            if let person = model.person, let role = roleLine(person) {
                Text(verbatim: role)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-role")
            }
            HStack(spacing: 10) {
                if model.canMessage, let person = model.person {
                    Button {
                        Task {
                            if let chat = await people.openConversation(with: person.principalId, session: session) {
                                if case let .room(room) = chat { sidebarPrefs.reopenIfClosed(session, room: room) }
                                openChat(chat)
                            }
                        }
                    } label: {
                        Label(String(localized: "Message"), systemImage: "bubble.left")
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.textPrimary)
                    .disabled(people.opening)
                    .accessibilityIdentifier("person-message")
                }
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }

    private var tabRow: some View {
        HStack(spacing: 2) {
            ForEach(PersonPanelTab.allCases) { item in
                let selected = item == tab
                Button {
                    tab = item
                } label: {
                    Text(tabTitle(item))
                        .font(.system(size: 13))
                        .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .background(selected ? Theme.cardRaised : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("person-tab.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(String(localized: "Member")))
    }

    private func tabTitle(_ tab: PersonPanelTab) -> String {
        switch tab {
        case .profile: String(localized: "Profile")
        case .library: String(localized: "Library")
        case .achievements: String(localized: "Achievements")
        }
    }

    // MARK: Profile

    @ViewBuilder
    private func profileTab(_ model: PersonSheetModel) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if model.person == nil, people.directory != nil {
                Text(String(localized: "This person is not in your organization's directory."))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityIdentifier("person-not-in-directory")
            }
            if let person = model.person {
                aboutCard(person, teams: model.teams)
            }
            if model.hasInCommon {
                inCommonCard(model)
            }
        }
        .accessibilityIdentifier("person-tabpanel.profile")
    }

    private func aboutCard(_ person: OrgDirectoryPerson, teams: [PersonSheetModel.Team]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(String(localized: "About"))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .padding(.bottom, 6)
            VStack(spacing: 0) {
                if let email = person.email, !email.isEmpty {
                    field(String(localized: "Email"), email)
                }
                if !person.login.isEmpty, person.login != person.email {
                    field(String(localized: "Login"), person.login)
                }
                field(
                    String(localized: "Teams"),
                    teams.isEmpty
                        ? String(localized: "None")
                        : teams.map { $0.manager ? String(localized: "\($0.name) (manager)") : $0.name }.joined(separator: ", "),
                    dim: teams.isEmpty
                )
                .accessibilityIdentifier("person-teams")
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func inCommonCard(_ model: PersonSheetModel) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(String(localized: "In common"))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .padding(.bottom, 6)
            VStack(alignment: .leading, spacing: 10) {
                if !model.sharedRooms.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Groups in common"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 8)
                        ForEach(model.sharedRooms) { room in
                            Button { openChat(.room(room)) } label: {
                                Label(room.name, systemImage: "person.2")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Theme.textPrimary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 8)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("person-group-\(room.id)")
                        }
                    }
                    .accessibilityIdentifier("person-section.groups")
                }
                if !model.sharedBots.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Their bots shared with you"))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 8)
                        ForEach(model.sharedBots) { bot in
                            Button { openChat(.bot(bot)) } label: {
                                HStack(spacing: 10) {
                                    BotMascotView(bot: bot, size: 24)
                                        .frame(width: 24, height: 24)
                                    Text(verbatim: bot.name)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textPrimary)
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    if !bot.title.isEmpty {
                                        Text(verbatim: bot.title)
                                            .font(.system(size: 12))
                                            .foregroundStyle(Theme.textSecondary)
                                            .lineLimit(1)
                                    }
                                }
                                .padding(.horizontal, 8)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("person-bot-\(bot.id)")
                        }
                    }
                    .accessibilityIdentifier("person-section.bots")
                }
            }
            .padding(.vertical, 6)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .accessibilityIdentifier("person-in-common")
    }

    // MARK: Achievements

    @ViewBuilder
    private var achievementsTab: some View {
        if !cardLoaded {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.top, 24)
        } else if let card {
            PersonAchievementsView(card: card, language: language)
        } else {
            Text(String(localized: "This person keeps their achievements private."))
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("person-achievements-private")
        }
    }

    // MARK: Label / fields

    /// The label under the name, as under a bot's name in its panel.
    @ViewBuilder
    private var labelLine: some View {
        let label = people.label(personId)
        if people.canEditLabel(personId, session: session) {
            Button {
                labelDraft = label ?? ""
                editingLabel = true
            } label: {
                Text(verbatim: label ?? String(localized: "Add a label"))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "Edit the label")))
            .accessibilityValue(Text(verbatim: label ?? ""))
            .accessibilityIdentifier("person-label-edit")
            .alert(String(localized: "Label"), isPresented: $editingLabel) {
                TextField(String(localized: "Add a label"), text: $labelDraft)
                Button(String(localized: "Cancel"), role: .cancel) {}
                Button(String(localized: "Save")) {
                    let text = labelDraft
                    Task {
                        if let problem = await people.saveLabel(personId, text, session: session) { labelError = problem }
                    }
                }
            } message: {
                Text(String(localized: "Shown beside the name, like a bot's label. 40 characters at most."))
            }
            .alert(String(localized: "Label"), isPresented: Binding(get: { labelError != nil }, set: { if !$0 { labelError = nil } })) {
                Button(String(localized: "OK"), role: .cancel) {}
            } message: {
                Text(verbatim: labelError ?? "")
            }
        } else if let label {
            Text(verbatim: label)
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("person-label")
        }
    }

    /// "Member" is not shown (#219): only an admin or a disabled account.
    private func roleLine(_ person: OrgDirectoryPerson) -> String? {
        let admin = person.role == "admin"
        let disabled = person.disabled == true
        switch (admin, disabled) {
        case (true, true): return "\(String(localized: "Administrator")) · \(String(localized: "Disabled"))"
        case (true, false): return String(localized: "Administrator")
        case (false, true): return String(localized: "Disabled")
        case (false, false): return nil
        }
    }

    private func field(_ label: String, _ value: String, dim: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(verbatim: label)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 8)
            Text(verbatim: value)
                .foregroundStyle(dim ? Theme.textSecondary : Theme.textPrimary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.subheadline)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
