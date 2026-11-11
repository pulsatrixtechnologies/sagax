// The bot's profile page fills the main column in place of the chat (#2136 /
// #1939): X or Escape goes back to the bot's chat; the right panel closes.
// Section rows open the same Edit bot pages the centred window used to host,
// still in the main column (never a narrow right panel).
import CompanionCore
import SwiftUI

struct DesktopBotProfileHost: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @State private var slackURL: URL?
    /// Knowledge > Routines opens in place, the desktop's routines sub-page.
    @State private var routinesOpen = false
    @State private var confirmingArchive = false
    @State private var confirmingDelete = false
    @State private var deleteFailed = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }

    /// Gear / Edit bot (overview, no panel section) show the profile root.
    /// Avatar / deep links open that Edit bot page in the main column.
    private var sectionPage: DesktopPersonaPage? {
        if model.personaPage == .overview && model.panelSection == nil { return nil }
        // Appearance unfolds inside the profile page (#1939 r7), like the desktop.
        if model.personaPage == .appearance && model.panelSection == nil { return nil }
        return model.personaPage
    }

    private var editContext: BotEditContext {
        BotEditContext(gate: gate, bot: current, slack: slackURL != nil)
    }

    private var editActions: BotEditActions {
        BotEditActions(
            // the tree's pages land on the matching persona page (#3017, G10)
            openPage: { page in
                let target: DesktopPersonaPage? = switch page {
                case .root, .identity: nil
                case .personality: .soul
                case .toolsApps: .access
                case .sharing: .sharing
                // Advanced is the Permissions "Advanced settings" part (#3030).
                case .advanced: .permissions
                }
                withAnimation(.easeOut(duration: 0.15)) {
                    model.permissionsPart = page == .advanced ? .advanced : .all
                    model.panelSection = target?.section
                    model.personaPage = target ?? .overview
                }
            },
            openSection: { section in
                withAnimation(.easeOut(duration: 0.15)) {
                    model.permissionsPart = .all
                    model.panelSection = section
                    model.personaPage = DesktopPersonaPage(section: section)
                }
            },
            openRoutines: {
                withAnimation(.easeOut(duration: 0.15)) { routinesOpen = true }
            },
            editAvatar: {
                withAnimation(.easeOut(duration: 0.15)) {
                    model.panelSection = nil
                    model.personaPage = .appearance
                }
            },
            archive: { confirmingArchive = true },
            delete: { confirmingDelete = true },
            close: { close() },
            openRules: { openPersona(.rules) },
            openFolder: { openPersona(.files) },
            openPermissions: { part in
                withAnimation(.easeOut(duration: 0.15)) {
                    model.permissionsPart = part
                    model.panelSection = .permissions
                    model.personaPage = DesktopPersonaPage(section: .permissions)
                }
            },
            // Bot accounts > "+ Add" > Apps: the Plugins window, the
            // desktop's togglePlugins (#3399); closing it comes back here.
            // MCP servers opens the profile's own page of servers.
            openApps: { model.modal = .plugins }
        )
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            theme.app.ignoresSafeArea()
            if routinesOpen {
                routinesHost
            } else if let sectionPage {
                sectionHost(sectionPage)
            } else {
                profileRoot
            }
            // The profile root carries its own X on its top bar (#2313); a
            // sub-page shows the back chevron and its title only, like the
            // desktop (#3017, G9).

        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.app)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-bot-profile-host")
        .task(id: bot.id) {
            if gate.allows(.botSlack) {
                slackURL = await session.profileClient?.slackManagementURL(botId: bot.id)
            }
        }
        .alert("Archive this bot?", isPresented: $confirmingArchive) {
            Button("Archive", role: .destructive) {
                Task {
                    if await session.setArchived(current, archived: true) { close() }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It leaves the sidebar. You can restore it later from Archived.")
        }
        .alert("Delete this bot?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) {
                Task {
                    // close only once the bot is really gone (#3017, G11)
                    if await session.deleteBot(current) {
                        close()
                    } else {
                        deleteFailed = true
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This cannot be undone.")
        }
        .alert("Couldn't delete the bot", isPresented: $deleteFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: session.actionError ?? "")
        }
        .background(DesktopEscapeKey(action: close))
    }

    private var profileRoot: some View {
        // NavigationStack keeps BotProfilePage's toolbar / bar-hidden
        // modifiers honest in the main column (same as the phone push).
        NavigationStack {
            BotProfilePage(
                bot: current,
                startTab: .general,
                context: editContext,
                actions: editActions,
                slackURL: slackURL,
                fillsMain: true,
                openAppearance: model.personaPage == .appearance && model.panelSection == nil,
                onAppearanceOpened: {
                    // The pane is open in the page: the request is spent.
                    model.personaPage = .overview
                }
            )
        }
        .environment(\.desktopTheme, theme)
    }

    /// The bot's routines in the main column, back to the profile.
    private var routinesHost: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { routinesOpen = false }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Profile")
                            .font(theme.font(13, .medium))
                    }
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-bot-profile-back")
                Text("Routines")
                    .font(theme.font(15, .semibold))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
            ScrollView {
                BotPanelRoutines(bot: current)
                    .frame(maxWidth: 760)
                    .padding(.horizontal, 32)
                    .padding(.vertical, 16)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-bot-profile-routines")
    }

    private func sectionHost(_ page: DesktopPersonaPage) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeOut(duration: 0.15)) {
                        model.personaPage = .overview
                        model.panelSection = nil
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Profile")
                            .font(theme.font(13, .medium))
                    }
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(height: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-bot-profile-back")
                Group {
                    if page == .permissions, model.permissionsPart != .all {
                        Text(model.permissionsPart.title)
                    } else {
                        Text(verbatim: page.label)
                    }
                }
                    .font(theme.font(15, .semibold))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
            .padding(.leading, 12)
            .padding(.trailing, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
            if let intro = subpageIntro(page) {
                Text(intro)
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("desktop-bot-profile-intro")
            }
            if let lock = lockNote(page) {
                Label { Text(lock) } icon: { Image(systemName: "lock") }
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("desktop-bot-profile-locked")
            }
            DesktopPersonaPageHost(bot: current, page: page, slackURL: slackURL, permissionsPart: model.permissionsPart)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // Page id on the body only: putting it on this VStack hid the
                // window-close chip from UITests (#1939).
                .accessibilityIdentifier("desktop-persona-window.page.\(page.rawValue)")
        }
    }

    /// The one line of intro under the title (desktop SubPage, #3030); the
    /// Permissions parts and Rules draw their own.
    private func subpageIntro(_ page: DesktopPersonaPage) -> LocalizedStringKey? {
        switch page {
        case .permissions, .rules, .overview, .appearance, .usage, .summary: nil
        case .files: DesktopPanelSection.memory.subpageIntro
        default: page.section?.subpageIntro
        }
    }

    /// The page's `botSectionLock` note: Rules and the Bot folder follow the soul.
    /// Personality and Model draw it in their locked card (PersonaLockedSection).
    private func lockNote(_ page: DesktopPersonaPage) -> LocalizedStringKey? {
        let section: DesktopPanelSection? = switch page {
        case .rules, .files: .soul
        case .soul, .model: nil
        default: page.section
        }
        return section.flatMap { session.sectionLock(current, $0) }
    }

    private func openPersona(_ page: DesktopPersonaPage) {
        withAnimation(.easeOut(duration: 0.15)) {
            model.permissionsPart = .all
            model.panelSection = nil
            model.personaPage = page
        }
    }

    private func close() {
        routinesOpen = false
        model.personaOpen = false
        model.panelSection = nil
        model.personaPage = .overview
        model.permissionsPart = .all
    }
}

/// One Edit bot page drawn full-bleed in the main column (the body PersonaEditorWindow used).
struct DesktopPersonaPageHost: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let page: DesktopPersonaPage
    var slackURL: URL?
    var permissionsPart: BotPermissionsPart = .all

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        Group {
            switch page {
            case .overview:
                ScrollView {
                    PersonaIdentityPage(bot: current)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .appearance:
                // Bound width: an unbounded ScrollView can propose infinity and
                // PersonaGrid used to trap on NaN/Inf (#1939).
                ScrollView {
                    PersonaAppearancePane(bot: current)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            case .soul:
                // Personality = "What it does" then the soul (desktop
                // `personality: ["summary", "soul"]`, #3030).
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        BotPanelMore(bot: current, slackURL: slackURL, only: .overview)
                        if let lock = session.sectionLock(current, .soul) {
                            PersonaLockedSection(bot: current, section: .soul, lock: lock)
                        } else {
                            PersonaPersonalityPage(bot: current, slackURL: slackURL)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.vertical, 16)
                }
            case .skills:
                PersonaSkillsPage(bot: current, slackURL: slackURL)
            case .access:
                ScrollView {
                    PersonaAccessPage(bot: current, slackURL: slackURL)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .model:
                // Model and Works on on one page (desktop `model: ["model", "worksOn"]`).
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        PersonaModelPage(bot: current, slackURL: slackURL)
                        if let lock = session.sectionLock(current, .worksOn) {
                            PersonaLockedSection(bot: current, section: .worksOn, lock: lock)
                        } else {
                            BotPanelMore(bot: current, slackURL: slackURL, only: .worksOn)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.vertical, 16)
                }
            case .permissions:
                ScrollView {
                    PersonaPermissionsPage(bot: current, slackURL: slackURL, part: permissionsPart)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .voice:
                ScrollView {
                    PersonaVoicePage(bot: current, slackURL: slackURL, notifyElsewhere: true)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .history:
                ScrollView {
                    PersonaChangesPage(bot: current, slackURL: slackURL)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .usage:
                ScrollView {
                    PersonaUsagePage(bot: current, slackURL: slackURL)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                }
            case .rules:
                NavigationStack { BotRuleSetsPage(bot: current) }
            case .files:
                if PersonaBotFolderPage.replacesStack {
                    PersonaBotFolderPage(bot: current, slackURL: slackURL, memory: true)
                } else {
                    NavigationStack { BotDocsList(bot: current) }
                }
            default:
                if let section = page.section {
                    ScrollView {
                        BotPanelMore(bot: current, slackURL: slackURL, only: section)
                            .padding(.horizontal, 32)
                            .padding(.vertical, 16)
                    }
                } else {
                    EmptyView()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.app)
    }
}

/// The X of a page Sagax opens over the chat (#2149 / #2136): black circle,
/// white mark, top-leading. Twin of `WindowCloseButton.tsx`.
struct WindowCloseChip: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Color.black.opacity(0.85)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Close"))
        .accessibilityIdentifier("window-close")
    }
}
