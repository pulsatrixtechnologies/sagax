// Edit bot in the Grok-style single page (lots 2 and 3, 2026-11-01):
// Back + Done, mascot with pencil, Name / Role / Description on the root,
// Appearance > Avatar, Voice calls (with More voice options), then Sagax
// rows (Instructions, Skills, Memory, Model, Approvals, Tools and apps,
// Routines, Sharing, Advanced). Drawn from `BotEditTree`.
//
// Rows keep the identifiers they had: a section is `panel-row.<section>`
// wherever it now sits; a tree page is `panel-edit-page.<page>`.
import CompanionCore
import SwiftUI

/// What Edit bot's rows do, given by the bot panel that holds the stack.
struct BotEditActions {
    var openPage: (BotEditPageID) -> Void
    var openSection: (DesktopPanelSection) -> Void
    var openRoutines: () -> Void
    var editAvatar: () -> Void
    var archive: () -> Void
    var delete: () -> Void
    var close: () -> Void
    /// iPad only: the bot's Rules document and its Folder (workspace files
    /// with the Memory inside), the desktop's Rules and Folder rows (#3017, G3).
    var openRules: (() -> Void)? = nil
    var openFolder: (() -> Void)? = nil
    /// A Permissions sub-page (When it acts alone, Advanced settings).
    var openPermissions: ((BotPermissionsPart) -> Void)? = nil
}

extension LocalizedStringKey {
    /// The English source text of a literal key (search labels).
    var sourceText: String {
        Mirror(reflecting: self).children.first { $0.label == "key" }?.value as? String ?? ""
    }
}

extension BotEditActions {
    /// What a search result does: the row's own action, else the page that holds it.
    func open(_ item: BotEditItem, context: BotEditContext) {
        if item == .avatar { editAvatar(); return }
        if item == .routines { openRoutines(); return }
        if item == .voiceAlerts { openSection(.voice); return }
        if let page = item.opens { openPage(page); return }
        if let section = item.section { openSection(section); return }
        if let page = BotEditTree.path(to: item, context)?.last { openPage(page) }
    }
}

extension BotEditPageID {
    var title: LocalizedStringKey {
        switch self {
        case .root: "Edit bot"
        case .identity: "Identity"
        case .personality: "Personality"
        case .toolsApps: "Tools and apps"
        case .sharing: "Sharing"
        case .advanced: "Advanced"
        }
    }
}

extension BotEditItem {
    /// The row's label (Instructions is the wizard's word for Soul).
    var title: LocalizedStringKey {
        switch self {
        case .header: "Edit bot"
        case .identity: "Identity"
        case .personality: "Personality"
        case .model: "Model"
        case .approvals: "Approvals"
        case .toolsApps: "Tools and apps"
        case .routines: "Routines"
        case .sharing: "Sharing"
        case .advanced: "Advanced"
        case .archive: "Archive…"
        case .delete: "Delete bot…"
        case .name: "Name"
        case .role: "Role"
        case .botDescription: "Description"
        case .avatar: "Avatar"
        case .callVoice: "Voice"
        case .callSpeed: "Speed"
        case .callLanguage: "Language"
        case .voiceAlerts: "More voice options"
        case .soul: "Instructions"
        default: section?.title ?? ""
        }
    }

    /// The identifier UI tests and the harness find the row by.
    var identifier: String {
        if let section { return "panel-row.\(section.rawValue)" }
        if let page = opens { return "panel-edit-page.\(page.rawValue)" }
        return "panel-edit-row.\(rawValue)"
    }
}

/// The recap line of each main row, in the wizard's words.
struct BotEditSummaries {
    let bot: Bot
    let rules: [CustomRuleRow]?
    let routines: [Routine]?
    /// Optional catalog label for the bot's model (`Grok 4.5`).
    var modelLabel: String?

    func value(_ item: BotEditItem) -> String? {
        switch item {
        case .identity:
            let parts = [BotEditSummary.role(bot), bot.chiefOfStaff == true ? String(localized: "Primary Bot") : ""].filter { !$0.isEmpty }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        case .personality, .soul:
            return BotEditSummary.soulWritten(bot) ? String(localized: "Written") : String(localized: "Not written yet")
        case .model:
            let selection = bot.modelSelection
            let name = BotEditSummary.modelName(selection, label: modelLabel)
            return selection.auto == true ? String(localized: "Auto · \(name)") : name
        case .approvals:
            let level = Self.levelTitle(ApprovalLevel.of(approvalMode: bot.approvalSettingMode, autoApprove: bot.autoApprove))
            guard let rules else { return level }
            let counts = BotEditSummary.ruleCounts(rules, botId: bot.id)
            let parts = [
                counts.ask > 0 ? String(localized: "\(counts.ask) asked") : "",
                counts.deny > 0 ? String(localized: "\(counts.deny) denied") : "",
                counts.allow > 0 ? String(localized: "\(counts.allow) allowed") : "",
            ].filter { !$0.isEmpty }
            return [level, parts.isEmpty ? String(localized: "No rule") : parts.joined(separator: ", ")].joined(separator: " · ")
        case .toolsApps:
            let place = BotEditSummary.workspaceOff(bot) ? String(localized: "Off") : String(localized: "Auto")
            let mcp: String
            switch BotEditSummary.mcp(bot.mcpServers) {
            case .all: mcp = String(localized: "Every MCP server")
            case .none: mcp = String(localized: "No MCP server")
            case let .some(names): mcp = String(localized: "MCP: \(names.joined(separator: ", "))")
            }
            return [String(localized: "Workspace: \(place)"), mcp].joined(separator: " · ")
        case .routines:
            guard let routines else { return nil }
            let names = BotEditSummary.routineNames(botId: bot.id, in: routines)
            return names.isEmpty ? String(localized: "No routine") : names.joined(separator: ", ")
        default:
            return nil
        }
    }

    static func levelTitle(_ level: ApprovalLevel) -> String {
        switch level {
        case .ask: String(localized: "Ask for approval")
        case .edits: String(localized: "Auto-accept edits")
        case .auto: String(localized: "Approve for me")
        case .full: String(localized: "Full access")
        case .custom: String(localized: "Custom")
        }
    }
}

// MARK: - Root

/// Edit bot: one Grok-style page (lots 2 and 3). Back + Done; drafts of
/// Name / Role / Description save on Done; Back asks before discarding.
struct PhoneBotEditRoot: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    let context: BotEditContext
    let routines: [Routine]?
    let actions: BotEditActions

    @State private var rules: [CustomRuleRow]?
    @State private var modelLabel: String?
    @State private var identityDirty = false
    @State private var confirmDiscard = false
    @State private var identityCommit: (() -> Void)?

    private var summaries: BotEditSummaries {
        BotEditSummaries(bot: bot, rules: rules, routines: routines, modelLabel: modelLabel)
    }

    var body: some View {
        ScrollViewReader { proxy in
            SettingsPage(title: "Edit bot", leading: .back, trailing: { doneButton }) {
                BotEditCards(
                    page: .root,
                    bot: bot,
                    context: context,
                    summaries: summaries,
                    actions: actions,
                    identityDirty: $identityDirty,
                    identityCommit: $identityCommit
                )
                Color.clear.frame(height: 1).id("persona-end")
            }
            // Intercept the glass Back: SettingsPage.back dismisses; we wrap
            // close through a confirm when drafts are dirty.
            .environment(\.settingsPop, { attemptClose() })
            .task {
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "parityBotEditBottom") {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    proxy.scrollTo("persona-end", anchor: .bottom)
                }
                #endif
            }
        }
        .task(id: bot.id) {
            guard let client = session.settingsClient else { return }
            if context.sections.contains(.permissions) {
                rules = (try? await client.customRules(botId: bot.id))?.rules
            }
            if let instances = try? await client.instances() {
                let selection = bot.modelSelection
                modelLabel = instances.first { $0.instanceId == selection.instanceId }?
                    .models.options.first { $0.id == selection.model }?.label
            }
        }
        .confirmationDialog(
            String(localized: "Discard changes?"),
            isPresented: $confirmDiscard,
            titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) { actions.close() }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("Name, role or description still have edits that are not saved.")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-persona")
    }

    private var doneButton: some View {
        Button {
            identityCommit?()
            identityDirty = false
            actions.close()
        } label: {
            Text("Done")
                .font(Theme.Font.rowTitle.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
        }
        .accessibilityIdentifier("panel-edit-done")
    }

    private func attemptClose() {
        if identityDirty {
            confirmDiscard = true
        } else {
            actions.close()
        }
    }
}

/// A page of the tree below the root.
struct PhoneBotEditPage: View {
    @Environment(\.themePalette) var themePalette
    let page: BotEditPageID
    let bot: Bot
    let context: BotEditContext
    let actions: BotEditActions

    var body: some View {
        ScrollViewReader { proxy in
            SettingsPage(title: page.title) {
                BotEditCards(
                    page: page,
                    bot: bot,
                    context: context,
                    summaries: BotEditSummaries(bot: bot, rules: nil, routines: nil),
                    actions: actions,
                    identityDirty: .constant(false),
                    identityCommit: .constant(nil)
                )
                Color.clear.frame(height: 1).id("edit-page-end")
            }
            .task {
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "parityBotEditBottom") {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    proxy.scrollTo("edit-page-end", anchor: .bottom)
                }
                #endif
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-edit.\(page.rawValue)")
    }
}

// MARK: - Cards

/// A page's cards, with the few labels and footers the layout keeps.
private struct BotEditCards: View {
    @Environment(\.themePalette) var themePalette
    let page: BotEditPageID
    let bot: Bot
    let context: BotEditContext
    let summaries: BotEditSummaries
    let actions: BotEditActions
    @Binding var identityDirty: Bool
    @Binding var identityCommit: (() -> Void)?

    var body: some View {
        let cards = BotEditTree.cards(page, context)
        ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
            if let label = Self.label(card) {
                SettingsSectionLabel(text: label)
            } else if index > 0, Self.footer(cards[index - 1]) == nil {
                SettingsSpacer(SettingsMetrics.cardGap)
            }
            switch card.first {
            case .name?:
                PhoneBotIdentityFields(
                    bot: bot,
                    onAvatar: actions.editAvatar,
                    // The root saves its drafts on Done; the Identity page
                    // has no Done, so it saves as each field is left.
                    autosave: page != .root,
                    isDirty: $identityDirty,
                    registerCommit: { identityCommit = $0 }
                )
            case .callVoice?:
                PhoneBotCallVoiceCard(bot: bot)
            default:
                SettingsCard {
                    ForEach(Array(card.enumerated()), id: \.element) { position, item in
                        if position > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        row(item)
                    }
                }
            }
            if let footer = Self.footer(card) {
                SettingsFooter(text: footer)
            }
        }
    }

    @ViewBuilder
    private func row(_ item: BotEditItem) -> some View {
        let value = summaries.value(item)
        let accessory: SettingsRow.Accessory = value.map { .valueChevron($0) } ?? .chevron
        if item.destructive {
            SettingsRow(title: item.title, style: .destructive, height: 44, identifier: item.identifier) {
                item == .archive ? actions.archive() : actions.delete()
            }
        } else {
            SettingsRow(title: item.title, accessory: accessory, height: 44, identifier: item.identifier,
                        accessibilityValueText: value) { open(item) }
        }
    }

    private func open(_ item: BotEditItem) {
        if item == .avatar { actions.editAvatar(); return }
        if item == .routines { actions.openRoutines(); return }
        if item == .voiceAlerts { actions.openSection(.voice); return }
        if let page = item.opens { actions.openPage(page); return }
        if let section = item.section { actions.openSection(section) }
    }

    private static func label(_ card: [BotEditItem]) -> LocalizedStringKey? {
        switch card.first {
        case .callVoice?: "Voice calls"
        case .avatar?: "Appearance"
        default: nil
        }
    }

    private static func footer(_ card: [BotEditItem]) -> LocalizedStringKey? {
        switch card.first {
        case .name?: "Shown in rosters, on the phone and to other bots. Standing instructions go in Instructions."
        case .archive?: "Its conversations are kept. Archived bots in the account menu brings it back."
        case .delete?: "The bot and its conversations will be deleted. This cannot be undone."
        default: nil
        }
    }
}
