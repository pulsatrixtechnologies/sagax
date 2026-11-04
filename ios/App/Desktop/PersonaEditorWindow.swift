// iPad: the bot editor ("Edit bot", src/components/persona/PersonaEditorModal.tsx
// in the category-modal.ts shell): a centred 900 x 700 window (radius 14,
// `bg-app`, 50 % scrim) with the 198 pt left column in `bg-panel` ("Edit
// bot" over the bot's name, the search, then the groups of
// lib/persona-sections.ts PERSONA_GROUPS as grey headings over their pages,
// each with its lucide icon from bot-settings/sections.ts BOT_SECTIONS),
// the close button top right and the open page under its title.
//
// The bot panel's "..." Edit bot and the sidebar menu's Edit bot open it on
// Identity; a click on the panel's mascot opens it on Appearance
// (`openPersonaEditor`). Every page draws the iPad's own section view
// (BotPanelMore's sections, the bot folder and rules editors), so it saves
// through the same session paths the panel used; Appearance is
// PersonaAppearancePane.swift. A page this pairing may not change stays
// listed with its padlock and says so, as the desktop's `botSectionLock`.
//
// Sub-trees are type-erased (`AnyView`): a deep SwiftUI type overflowed the
// iPad's main-thread stack once (I1, build 6).
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Pages

/// A page of the editor (`PERSONA_CATEGORIES`), in the column's order.
enum DesktopPersonaPage: String, CaseIterable, Hashable {
    case overview, appearance, sharing, visibility, summary
    case soul, rules, skills, files
    case model, worksOn, access, slack, voice
    case permissions, perspicax
    case usage, history

    /// The page that shows a panel section (`personaCategoryForSection`):
    /// the memory is managed in the Bot folder; nil opens Identity.
    init(section: DesktopPanelSection?) {
        switch section {
        case nil, .overview?: self = .overview
        case .memory?: self = .files
        case let section?: self = DesktopPersonaPage(rawValue: section.rawValue) ?? .overview
        }
    }

    /// The iPad section view this page draws (BotPanelMore), if it is one.
    var section: DesktopPanelSection? {
        switch self {
        case .summary: .overview
        case .sharing: .sharing
        case .visibility: .visibility
        case .soul: .soul
        case .skills: .skills
        case .model: .model
        case .worksOn: .worksOn
        case .access: .access
        case .slack: .slack
        case .voice: .voice
        case .permissions: .permissions
        case .perspicax: .perspicax
        case .usage: .usage
        case .history: .history
        case .overview, .appearance, .rules, .files: nil
        }
    }

    /// The label (`BOT_SECTIONS` labelKey), in the app's language.
    var label: String {
        switch self {
        case .overview: AppStrings.localized("Identity")
        case .appearance: AppStrings.localized("Appearance")
        case .sharing: AppStrings.localized("Shared with")
        case .visibility: AppStrings.localized("Who can see it")
        case .summary: AppStrings.localized("What it does")
        case .soul: AppStrings.localized("Personality")
        case .rules: AppStrings.localized("Rules")
        case .skills: AppStrings.localized("Skills")
        case .files: AppStrings.localized("Bot folder")
        case .model: AppStrings.localized("Model")
        case .worksOn: AppStrings.localized("computer.worksOn")
        case .access: AppStrings.localized("Access")
        case .slack: "Slack"
        case .voice: AppStrings.localized("Voice")
        case .permissions: AppStrings.localized("Permissions")
        case .perspicax: AppStrings.localized("Perspicax Profiles")
        case .usage: AppStrings.localized("Usage")
        case .history: AppStrings.localized("Changes")
        }
    }

    /// The search words beside the label (`BOT_SECTIONS` keywords).
    var keywords: [String] {
        switch self {
        case .overview: ["identity", "name", "label", "description", "owner", "status"]
        case .appearance: ["appearance", "mascot", "avatar", "character", "skin", "color", "colour", "look", "picture", "image", "generate", "upload", "moves"]
        case .rules: ["rules", "rules.md", "constraints", "never", "always", "policy", "guardrails"]
        case .files: ["files", "workspace", "docs", "documents", "markdown", "folder", "upload", "procedures", "templates", "memory", "notes", "remember", "topics"]
        case .summary: ["summary", "what it does", "won't", "reaches", "prompt", "what the model sees"]
        default: section?.keywords ?? []
        }
    }

    var icon: PersonaIcon {
        switch self {
        case .overview: .layoutDashboard
        case .appearance: .palette
        case .sharing: .users
        case .visibility: .eye
        case .summary: .info
        case .soul: .sparkles
        case .rules: .scrollText
        case .skills: .bookOpen
        case .files: .folderTree
        case .model: .cpu
        case .worksOn: .monitor
        case .access: .network
        case .slack: .hash
        case .voice: .mic
        case .permissions: .shieldCheck
        case .perspicax: .plug
        case .usage: .coins
        case .history: .history
        }
    }

    func matches(_ query: String) -> Bool {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !wanted.isEmpty else { return true }
        return ([rawValue, label] + keywords).contains { $0.lowercased().contains(wanted) }
    }
}

/// The column's groups (`PERSONA_GROUPS`).
enum DesktopPersonaGroup: String, CaseIterable {
    case profile, instructions, modelTools, security, activity

    var pages: [DesktopPersonaPage] {
        switch self {
        case .profile: [.overview, .appearance, .sharing, .visibility, .summary]
        case .instructions: [.soul, .rules, .skills, .files]
        case .modelTools: [.model, .worksOn, .access, .slack, .voice]
        case .security: [.permissions, .perspicax]
        case .activity: [.usage, .history]
        }
    }

    /// `persona.group.*`.
    var label: String {
        switch self {
        case .profile: AppStrings.localized("Profile")
        case .instructions: AppStrings.localized("Instructions")
        case .modelTools: AppStrings.localized("Model and tools")
        case .security: AppStrings.localized("Security")
        case .activity: AppStrings.localized("persona.group.activity")
        }
    }
}

// MARK: - Icons

/// The editor's lucide icons (lucide-react 1.51, ISC), in the 24 pt viewBox.
enum PersonaIcon: String {
    case layoutDashboard, palette, info, sparkles, scrollText, bookOpen, folderTree, cpu, monitor, network
    case mic, shieldCheck, plug, coins, history, users, eye, lock, play, shuffle, check, chevronDown, search, x, hash

    var paths: [String] {
        switch self {
        case .layoutDashboard: ["M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z", "M15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z", "M15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1Z", "M4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1Z"]
        case .palette: ["M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z", "M13 6.5A0.5 0.5 0 1 0 14 6.5A0.5 0.5 0 1 0 13 6.5Z", "M17 10.5A0.5 0.5 0 1 0 18 10.5A0.5 0.5 0 1 0 17 10.5Z", "M6 12.5A0.5 0.5 0 1 0 7 12.5A0.5 0.5 0 1 0 6 12.5Z", "M8 7.5A0.5 0.5 0 1 0 9 7.5A0.5 0.5 0 1 0 8 7.5Z"]
        case .info: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z", "M12 16v-4", "M12 8h.01"]
        case .sparkles: ["M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z", "M20 2v4", "M22 4h-4", "M2 20A2 2 0 1 0 6 20A2 2 0 1 0 2 20Z"]
        case .scrollText: ["M15 12h-5", "M15 8h-5", "M19 17V5a2 2 0 0 0-2-2H4", "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"]
        case .bookOpen: ["M12 5v16", "M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"]
        case .folderTree: ["M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z", "M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z", "M3 5a2 2 0 0 0 2 2h3", "M3 3v13a2 2 0 0 0 2 2h3"]
        case .cpu: ["M12 20v2", "M12 2v2", "M17 20v2", "M17 2v2", "M2 12h2", "M2 17h2", "M2 7h2", "M20 12h2", "M20 17h2", "M20 7h2", "M7 20v2", "M7 2v2", "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2Z", "M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1Z"]
        case .monitor: ["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2Z", "M8 21L16 21", "M12 17L12 21"]
        case .network: ["M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1Z", "M3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1Z", "M10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1Z", "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"]
        case .mic: ["M12 19v3", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 2h0a3 3 0 0 1 3 3v7a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-7a3 3 0 0 1 3 -3Z"]
        case .shieldCheck: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4"]
        case .plug: ["M12 22v-5", "M15 8V2", "M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z", "M9 8V2"]
        case .coins: ["M13.744 17.736a6 6 0 1 1-7.48-7.48", "M15 6h1v4", "m6.134 14.768.866-.5 2 3.464", "M10 8A6 6 0 1 0 22 8A6 6 0 1 0 10 8Z"]
        case .history: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"]
        case .users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M16 3.128a4 4 0 0 1 0 7.744", "M22 21v-2a4 4 0 0 0-3-3.87", "M5 7A4 4 0 1 0 13 7A4 4 0 1 0 5 7Z"]
        case .eye: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z"]
        case .lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2Z", "M7 11V7a5 5 0 0 1 10 0v4"]
        case .play: ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"]
        case .shuffle: ["m18 14 4 4-4 4", "m18 2 4 4-4 4", "M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22", "M2 6h1.972a4 4 0 0 1 3.6 2.2", "M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"]
        case .check: ["M20 6 9 17l-5-5"]
        case .chevronDown: ["m6 9 6 6 6-6"]
        case .search: ["m21 21-4.34-4.34", "M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11Z"]
        case .x: ["M18 6 6 18", "m6 6 12 12"]
        case .hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3l-2 18"]
        }
    }
}

struct PersonaIconView: View {
    let icon: PersonaIcon
    var size: CGFloat = 15
    var strokeWidth: CGFloat = 1.5

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Window

struct PersonaEditorWindow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let close: () -> Void

    @State private var query = ""
    @State private var slackURL: URL?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }

    private func reachable(_ section: DesktopPanelSection) -> Bool {
        section.reachable(gate: gate, slack: slackURL != nil, bot: current)
    }

    /// The pages this server offers (`offered`): Slack with its Admin link,
    /// Shared with and Who can see it where the server has them. Nothing is
    /// left out for lack of a permission: such a page shows its padlock.
    private func offered(_ page: DesktopPersonaPage) -> Bool {
        switch page {
        case .slack: reachable(.slack)
        case .sharing: reachable(.sharing)
        // showBotVisibility (bot-capabilities.ts): only on a page the server
        // serves in a browser, never in the desktop app; the iPad is an app
        case .visibility: false
        default: true
        }
    }

    /// The page this viewer may not change (`botSectionLock`), or Perspicax off a Perspicax server.
    private func locked(_ page: DesktopPersonaPage) -> Bool {
        switch page {
        case .overview, .appearance, .slack, .sharing, .visibility, .voice: false
        case .rules, .files: !reachable(.soul)
        case .worksOn: !reachable(.access)
        default: page.section.map { !reachable($0) } ?? false
        }
    }

    private var groups: [(group: DesktopPersonaGroup, pages: [DesktopPersonaPage])] {
        DesktopPersonaGroup.allCases.map { group in
            (group, group.pages.filter { offered($0) && $0.matches(query) })
        }
        .filter { !$0.pages.isEmpty }
    }

    private var page: DesktopPersonaPage {
        let shown = groups.flatMap(\.pages)
        if shown.contains(model.personaPage) { return model.personaPage }
        // a link to a page this server does not offer lands on its stand-in
        if model.personaPage == .visibility, shown.contains(.sharing) { return .sharing }
        if model.personaPage == .sharing, shown.contains(.visibility) { return .visibility }
        return query.isEmpty ? .overview : (shown.first ?? model.personaPage)
    }

    var body: some View {
        DesktopModalFrame(width: 900, close: close) {
            HStack(spacing: 0) {
                AnyView(nav).frame(width: 198)
                AnyView(pane).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: bot.id) {
            if gate.allows(.botSlack) {
                slackURL = await session.profileClient?.slackManagementURL(botId: bot.id)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityLabel(Text(verbatim: "\(AppStrings.localized("Edit bot")): \(current.name)"))
        .accessibilityIdentifier("desktop-persona-window")
    }

    // MARK: Nav

    private var nav: some View {
        VStack(alignment: .leading, spacing: 2) {
            VStack(alignment: .leading, spacing: 0) {
                // `text-[13px]` lines at the body's 1.5 line height
                DesktopText(verbatim: AppStrings.localized("Edit bot"), size: 13, weight: .semibold, line: 19.5)
                    .lineLimit(1)
                DesktopText(verbatim: current.name, size: 12, line: 18, color: \.inkSecondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("desktop-persona-window.bot")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .accessibilityAddTraits(.isHeader)
            search
                .padding(.top, 4)
                .padding(.bottom, 8)
            if groups.isEmpty {
                DesktopText(verbatim: String(format: AppStrings.localized("persona.noMatch"), query.trimmingCharacters(in: .whitespacesAndNewlines)),
                            size: 12.5, line: 20.3, color: \.inkSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 16)
                    .accessibilityIdentifier("desktop-persona-window.no-match")
            }
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(groups, id: \.group) { entry in
                        DesktopText(verbatim: entry.group.label, size: 11.5, weight: .medium, line: 16, color: \.inkTertiary)
                            .padding(.horizontal, 9)
                            .padding(.top, 12)
                            .padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(entry.pages, id: \.self) { item in navRow(item) }
                    }
                }
                .padding(.bottom, 16)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 16)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.panel)
        .overlay(alignment: .trailing) { Rectangle().fill(theme.hairlineWeak).frame(width: 1) }
    }

    private func navRow(_ item: DesktopPersonaPage) -> some View {
        let isLocked = locked(item)
        return Button { model.personaPage = item } label: {
            HStack(spacing: 9) {
                PersonaIconView(icon: item.icon, size: 15)
                DesktopText(verbatim: item.label)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if isLocked {
                    PersonaIconView(icon: .lock, size: 12, strokeWidth: 2)
                        .foregroundStyle(theme.inkTertiary)
                        .accessibilityLabel(Text(verbatim: AppStrings.localized("Read only")))
                }
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 9)
            .frame(height: 32)
            .background(item == page ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 8))
        .accessibilityAddTraits(item == page ? .isSelected : [])
        .accessibilityIdentifier("desktop-persona-window.nav.\(item.rawValue)")
    }

    private var search: some View {
        HStack(spacing: 8) {
            PersonaIconView(icon: .search, size: 14, strokeWidth: 2)
                .foregroundStyle(theme.inkSecondary)
            TextField(text: $query, prompt: Text(verbatim: AppStrings.localized("Search")).foregroundColor(theme.inkSecondary)) {
                Text(verbatim: AppStrings.localized("Search this bot's settings"))
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .accessibilityIdentifier("desktop-persona-window.search")
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
    }

    // MARK: Pane

    private var title: some View {
        DesktopText(verbatim: page.label, size: 17, weight: .semibold, line: 24, tracking: -0.136)
            .padding(.horizontal, 32)
            .padding(.top, 24)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("desktop-persona-window.title")
    }

    private var pane: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if !locked(page), page == .rules || page == .files {
                    // the editors with their own Save keep their navigation bar
                    VStack(spacing: 0) {
                        title
                        AnyView(stacked(page))
                            .padding(.top, 8)
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            title
                            AnyView(pageBody(page))
                                .padding(.horizontal, 32)
                                .padding(.top, 16)
                                .padding(.bottom, 24)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .id(page)
                    }
                    .scrollIndicators(.hidden)
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-persona-window.page.\(page.rawValue)")
            DesktopCloseButton(label: "Close", identifier: "desktop-persona-close", action: close)
                .padding(.top, 10)
                .padding(.trailing, 10)
        }
    }

    @ViewBuilder
    private func pageBody(_ page: DesktopPersonaPage) -> some View {
        if page == .perspicax, !reachable(.perspicax) {
            note(AppStrings.localized("Perspicax profiles are offered on a server signed in with Perspicax."), lock: false)
        } else if locked(page) {
            note(AppStrings.localized("Read only"), lock: true)
        } else {
            switch page {
            case .overview:
                PhoneBotIdentityFields(bot: current) { model.personaPage = .appearance }
            case .appearance:
                PersonaAppearancePane(bot: current)
            default:
                if let section = page.section {
                    BotPanelMore(bot: current, slackURL: slackURL, only: section)
                }
            }
        }
    }

    /// Rules (RULES.md) and the Bot folder (its files, the memory under
    /// them), the phone's editors in a navigation stack for their Save.
    @ViewBuilder
    private func stacked(_ page: DesktopPersonaPage) -> some View {
        NavigationStack {
            if page == .rules {
                BotWorkspaceDocEditor(bot: current, path: BotWorkspaceFiles.rulesPath)
            } else {
                BotDocsList(bot: current)
                    .safeAreaInset(edge: .bottom) {
                        if reachable(.memory) {
                            ScrollView {
                                BotPanelMore(bot: current, slackURL: slackURL, only: .memory)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                            }
                            .frame(maxHeight: 280)
                            .background(theme.app)
                            .overlay(alignment: .top) { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
                        }
                    }
            }
        }
        .environment(\.desktopTheme, theme)
    }

    private func note(_ text: String, lock: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if lock {
                PersonaIconView(icon: .lock, size: 13, strokeWidth: 2)
                    .padding(.top, 2)
            }
            Text(verbatim: text)
                .font(theme.font(12.5))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(theme.inkSecondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityIdentifier("desktop-persona-window.note")
    }
}
