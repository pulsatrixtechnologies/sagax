// iPad I4/I4b: the bot panel's More tab (`BotSettingsDialog.tsx` "more",
// was Advanced, with `bot-settings/sections.ts`): a search field (33.5 tall,
// elevated fill, hairline-weak ring) over one bordered list of sections
// (rows 40.5: 15 pt glyph, label 13, chevron), each opening its section
// under a 14 medium heading with Back in the top bar. Which sections a
// pairing lists is `DesktopPanelSection.visible` (SurfaceGate; D1 opens
// the panel's advanced sections on the owner's sidecar).
//
// This file holds the list and the reading sections (Overview, Soul,
// Skills, Memory); BotPanelSettings.swift the switches (Access, Model,
// Permissions, Voice) and the rest. Deep work keeps the phone's own sheets
// (a memory file's editor, a skill's review) so there is one
// implementation of each.
import SwiftUI
import UIKit
import CompanionCore

extension DesktopPanelSection {
    var title: LocalizedStringKey {
        switch self {
        case .overview: "Overview"
        case .slack: "Slack"
        case .soul: "Personality"
        case .skills: "Skills"
        case .memory: "Memory"
        case .access: "Access"
        case .worksOn: "Computer"
        case .model: "Model"
        case .permissions: "Permissions"
        case .voice: "Voice & alerts"
        case .visibility: "Who can see it"
        case .sharing: "Shared with"
        case .perspicax: "Perspicax Profiles"
        case .history: "Changes"
        case .usage: "Usage"
        }
    }

    /// The label in the person's language, for the search.
    var localizedTitle: String {
        switch self {
        case .overview: String(localized: "Overview")
        case .slack: String(localized: "Slack")
        case .soul: String(localized: "Personality")
        case .skills: String(localized: "Skills")
        case .memory: String(localized: "Memory")
        case .access: String(localized: "Access")
        case .worksOn: String(localized: "Computer")
        case .model: String(localized: "Model")
        case .permissions: String(localized: "Permissions")
        case .voice: String(localized: "Voice & alerts")
        case .visibility: String(localized: "Who can see it")
        case .sharing: String(localized: "Shared with")
        case .perspicax: String(localized: "Perspicax Profiles")
        case .history: String(localized: "Changes")
        case .usage: String(localized: "Usage")
        }
    }

    /// The lucide glyph's nearest SF Symbol.
    var symbol: String {
        switch self {
        case .overview: "square.grid.2x2"
        case .slack: "number"
        case .soul: "sparkles"
        case .skills: "book"
        case .memory: "brain"
        case .access: "point.3.connected.trianglepath.dotted"
        case .worksOn: "desktopcomputer"
        case .model: "cpu"
        case .permissions: "checkmark.shield"
        case .voice: "mic"
        case .visibility: "eye"
        case .sharing: "person.2"
        case .perspicax: "powerplug"
        case .history: "clock.arrow.circlepath"
        case .usage: "dollarsign.circle"
        }
    }
}

extension DesktopPanelGroup {
    /// The group's label (`persona.group.*`).
    var title: LocalizedStringKey {
        switch self {
        case .profile: "Profile"
        case .instructions: "Instructions"
        case .memoryFiles: "Memory and files"
        case .modelTools: "Model and tools"
        case .behavior: "Behavior"
        case .activity: "History and usage"
        }
    }

    var localizedTitle: String {
        switch self {
        case .profile: String(localized: "Profile")
        case .instructions: String(localized: "Instructions")
        case .memoryFiles: String(localized: "Memory and files")
        case .modelTools: String(localized: "Model and tools")
        case .behavior: String(localized: "Behavior")
        case .activity: String(localized: "History and usage")
        }
    }
}

extension PhoneBotEditGroup {
    var title: LocalizedStringKey {
        switch self {
        case .instructions: "Instructions"
        case .modelTools: "Model and tools"
        case .security: "Security"
        case .activity: "History and usage"
        }
    }
}

struct BotPanelMore: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let slackURL: URL?

    @State private var query = ""

    private var sections: [DesktopPanelSection] { DesktopPanelSection.visible(gate: session.surfaceGate, slack: slackURL != nil) }

    var body: some View {
        if let section = model.panelSection, sections.contains(section) {
            VStack(alignment: .leading, spacing: 12) {
                Text(section.title)
                    .font(theme.font(14, .medium))
                    .foregroundStyle(theme.ink)
                    .frame(height: 21)
                AnyView(body(of: section))
            }
            .padding(.leading, 17)
            .padding(.trailing, 16)
            .padding(.bottom, 24)
            .id(section)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-panel-section.\(section.rawValue)")
        } else {
            AnyView(list)
        }
    }

    private func groupRows(_ rows: [DesktopPanelSection]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element) { index, section in
                Button { model.panelSection = section } label: {
                    HStack(spacing: 10) {
                        Image(systemName: section.symbol)
                            .font(.system(size: 13))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 15, height: 15)
                        Text(section.title)
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 39.5)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityIdentifier("desktop-panel-row.\(section.rawValue)")
                if index < rows.count - 1 {
                    Rectangle().fill(theme.hairlineWeak).frame(height: 1)
                }
            }
        }
        .padding(1)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
    }

    private var list: some View {
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // a group's own name finds all its sections
        let shown = sections.filter { section in
            section.matches(query, label: section.localizedTitle)
                || (!wanted.isEmpty && DesktopPanelGroup.of(section).localizedTitle.lowercased().contains(wanted))
        }
        return VStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12.5))
                    .foregroundStyle(theme.inkSecondary)
                TextField("", text: $query, prompt: Text("Search").foregroundColor(theme.inkSecondary))
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .tint(theme.focus)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(Text("Search settings"))
            }
            .padding(.horizontal, 10)
            .frame(height: 33.5)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
            // the editor's six groups (#518), each with its sections
            ForEach(DesktopPanelGroup.visible(shown), id: \.self) { group in
                VStack(alignment: .leading, spacing: 6) {
                    Text(group.title)
                        .font(theme.font(12, .medium))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.leading, 4)
                    groupRows(group.sections(in: shown))
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("desktop-panel-group.\(group.rawValue)")
            }
            if shown.isEmpty {
                Text("Nothing matches “\(query.trimmingCharacters(in: .whitespacesAndNewlines))”")
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
        }
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-more")
    }

    @ViewBuilder
    private func body(of section: DesktopPanelSection) -> some View {
        switch section {
        case .overview: BotPanelOverview(bot: bot)
        case .soul: BotPanelSoul(bot: bot)
        case .skills: BotPanelSkills(bot: bot)
        case .memory: BotPanelMemory(bot: bot)
        case .access: BotPanelAccess(bot: bot, showsWorksOn: !sections.contains(.worksOn))
        case .worksOn: BotPanelWorksOn(bot: bot)
        case .model: BotPanelModel(bot: bot)
        case .permissions: BotPanelPermissions(bot: bot)
        case .voice: BotPanelVoice(bot: bot)
        case .usage: BotPanelUsage(bot: bot)
        case .history: BotPanelHistory(bot: bot)
        case .visibility: BotPanelPhoneSection { BotVisibilitySection(bot: bot) }
        case .sharing: BotPanelPhoneSection { BotSharingSection(bot: bot) }
        case .perspicax: BotPanelPhoneSection { BotPerspicaxSection(bot: bot) }
        case .slack:
            if let slackURL { BotPanelPhoneSection { BotSlackSection(url: slackURL) } }
        }
    }
}

/// A section the phone already draws as a form section (History, Who can
/// see it, Shared with, Perspicax, Slack): the same view in a form sized
/// to the panel, on the panel's ground.
struct BotPanelPhoneSection<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    @ViewBuilder let content: Content

    var body: some View {
        ThemedForm { content }
            .scrollDisabled(false)
            .frame(minHeight: 520)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }
}

// MARK: - Overview

/// Overview (`OverviewSection.tsx`): who it is, Does, Can reach, Won't
/// (`rounded-xl bg-hover p-3`), the prompt preview and recent changes.
private struct BotPanelOverview: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    @State private var overview: BotOverview?
    @State private var loaded = false
    @State private var prompt: PromptPreview?
    @State private var promptFailed = false
    @State private var promptOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let overview {
                PanelFillCard {
                    Text(verbatim: overview.who.name).panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    if !overview.who.title.isEmpty {
                        Text(verbatim: overview.who.title).panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 2)
                    }
                    if !overview.who.blurb.isEmpty {
                        Text(verbatim: overview.who.blurb).panelText(13, 21.125).foregroundStyle(theme.ink).padding(.top, 8)
                    }
                    if !overview.who.soulLead.isEmpty {
                        Text(verbatim: overview.who.soulLead).panelText(13, 21.125).foregroundStyle(theme.inkSecondary).padding(.top, 12)
                        Button { model.panelSection = .soul } label: {
                            Text("Read all").panelText(12, 18, .medium).foregroundStyle(theme.accentText)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 6)
                    }
                }
                listCard("Does", overview.does, empty: "Nothing scheduled or learned yet.")
                listCard("Can reach", overview.reaches, empty: "Nothing yet.")
                listCard("Won’t", overview.wont, empty: nil)
                promptCard
                recentCard(overview.recent)
            } else if loaded {
                PanelNotice(text: String(localized: "Couldn’t load the overview."))
            } else {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity).padding(24)
            }
        }
        .task(id: bot.id) {
            overview = await session.botOverview(for: bot)
            loaded = true
            if session.surfaceGate.allows(.advancedBotPanel), let client = session.profileClient {
                do { prompt = try await client.systemPrompt(botId: bot.id) } catch { promptFailed = true }
            }
        }
    }

    private func listCard(_ title: LocalizedStringKey, _ lines: [String], empty: LocalizedStringKey?) -> some View {
        PanelFillCard {
            Text(title).panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            if lines.isEmpty, let empty {
                Text(empty).panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 8)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        Text(verbatim: line).panelText(13, 21.125).foregroundStyle(theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var promptCard: some View {
        if session.surfaceGate.allows(.advancedBotPanel) {
            PanelCard {
                Button { withAnimation(.easeOut(duration: 0.15)) { promptOpen.toggle() } } label: {
                    HStack(spacing: 12) {
                        Group {
                            if let prompt {
                                Text("Prompt preview · \(prompt.totalBytes.formatted()) bytes ≈ \(prompt.approxTokens.formatted()) tokens")
                            } else {
                                Text("Prompt preview")
                            }
                        }
                        .panelText(13, 19.5, .medium)
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12))
                            .foregroundStyle(theme.inkSecondary)
                            .rotationEffect(.degrees(promptOpen ? 180 : 0))
                            .frame(width: 16)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if promptOpen {
                    VStack(alignment: .leading, spacing: 8) {
                        if let prompt {
                            ForEach(prompt.sections, id: \.id) { section in
                                PromptSectionRow(section: section)
                            }
                            if !prompt.note.isEmpty { let note = prompt.note
                                Text(verbatim: note).font(theme.font(11)).foregroundStyle(theme.inkSecondary)
                            }
                        } else {
                            Text(promptFailed ? "Couldn’t load the prompt preview." : "Loading…")
                                .font(theme.font(13))
                                .foregroundStyle(theme.inkSecondary)
                        }
                    }
                    .padding(.top, 12)
                }
            }
        }
    }

    private func recentCard(_ recent: [BotOverviewRecent]) -> some View {
        PanelFillCard {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent changes").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                Spacer(minLength: 12)
                if session.surfaceGate.allows(.advancedBotPanel) {
                    Button { model.panelSection = .history } label: {
                        Text("View all →").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            if recent.isEmpty {
                Text("Nothing changed recently.").panelText(13, 19.5).foregroundStyle(theme.inkSecondary).padding(.top, 8)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(recent.enumerated()), id: \.offset) { _, entry in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(verbatim: entry.summary).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                            Spacer(minLength: 0)
                            Text(verbatim: "· " + Self.when(entry.at)).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                        }
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    private static func when(_ at: Double) -> String { DesktopWhenLabel.label(at) }
}

/// One section of the prompt preview, opened to read its text.
private struct PromptSectionRow: View {
    @Environment(\.desktopTheme) private var theme
    let section: PromptPreview.Section
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { open.toggle() } label: {
                HStack {
                    Text(verbatim: section.label).font(theme.font(13)).foregroundStyle(theme.ink)
                    Spacer(minLength: 12)
                    Text("\(section.bytes.formatted()) bytes").font(theme.font(13)).monospacedDigit().foregroundStyle(theme.inkSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                ScrollView {
                    Text(verbatim: section.text)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 192)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }
}

// MARK: - Soul

/// Soul (`SoulSection` + `SoulField`): the standing instructions edited in
/// place (220 tall), the mirror path and the byte count against the cap.
private struct BotPanelSoul: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var soul: BotSoul?
    @State private var draft = ""
    @State private var problem: String?
    @State private var saving = false

    private var bytes: Int { draft.utf8.count }
    private var limit: Int { soul?.limit ?? 24_000 }
    private var dirty: Bool { soul.map { $0.soul != draft } ?? false }
    private var canEdit: Bool { session.surfaceGate.allows(.advancedBotPanel) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Who this bot is and the rules it never breaks. Always in its context.")
                .panelText(13, 21.125)
                .foregroundStyle(theme.inkSecondary)
            PanelLabel(text: "Standing instructions (SOUL.md)")
                .frame(height: 19.5)
                .padding(.top, 16)
            if soul != nil {
                // the markdown editor (desktop SoulField, #258)
                MarkdownEditor(
                    text: $draft, placeholder: String(localized: "Standing instructions"), minHeight: 220, monospaced: true,
                    accessibilityLabel: String(localized: "Standing instructions (SOUL.md)"), identifier: "desktop-panel-soul"
                )
                .padding(.top, 6)
                .disabled(!canEdit)
                BotWorkspaceShortcuts(bot: bot).padding(.top, 8)
            } else if let problem {
                PanelNotice(text: problem).padding(.top, 6)
            } else {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 220).padding(.top, 6)
            }
            HStack(alignment: .top, spacing: 12) {
                Group {
                    if let file = soul?.file, !file.isEmpty {
                        // break-all: the path wraps anywhere, as the desktop's does
                        Text("In this bot’s context on every turn. Mirrored to \(file.map(String.init).joined(separator: "\u{200B}")).")
                    } else {
                        Text("In this bot’s context on every turn.")
                    }
                }
                .panelText(11, 16.5)
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(verbatim: "\(bytes.formatted()) / \(limit.formatted()) bytes")
                    .panelText(11, 16.5, bytes > limit ? .medium : .regular)
                    .monospacedDigit()
                    .foregroundStyle(bytes > limit ? theme.danger : theme.inkSecondary)
            }
            .padding(.top, 13)
            if dirty {
                HStack(spacing: 8) {
                    PanelButton(title: "Save", prominent: true, disabled: saving || bytes > limit) { Task { await save() } }
                        .accessibilityIdentifier("desktop-panel-soul-save")
                    PanelButton(title: "Discard") { draft = soul?.soul ?? "" }
                }
                .padding(.top, 12)
            }
        }
        .task(id: bot.id) { await load() }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.soul(botId: bot.id)
            soul = loaded
            draft = loaded.soul
        } catch {
            problem = error.localizedDescription
        }
    }

    private func save() async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            session.applyProfileBot(try await client.saveSoul(botId: bot.id, soul: draft))
            soul?.soul = draft
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: - Skills

/// Skills (`SkillsSection.tsx`): the Learned skills card (glyph, title,
/// explanation, the import field and button, the installed list).
struct BotPanelSkills: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var model: BotSkillsModel
    @State private var source = ""
    @State private var removing: ManagedSkill?

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotSkillsModel(botId: bot.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PanelCard {
                HStack(spacing: 8) {
                    Image(systemName: "book")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 16)
                    Text("Learned skills").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                }
                Text(model.authoring
                     ? "Save a bot's verification run as a skill from the Verify card, or import one below. Every change waits for your review."
                     : "Skill authoring is off, but skills you already enabled stay under your control here.")
                    .panelText(12, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 4)
                HStack(spacing: 8) {
                    PanelTextField(placeholder: "owner/repo, https://github.com/…", text: $source) { importSkill() }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel(Text("Import a skill"))
                    Button { importSkill() } label: {
                        Text(model.importing ? "Importing…" : "Import")
                            .font(theme.font(13))
                            .foregroundStyle(theme.ink)
                            .padding(.horizontal, 12)
                            .frame(height: 35.5)
                            .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.importing || SkillRules.importSource(source) == nil)
                    .opacity(model.importing || SkillRules.importSource(source) == nil ? 0.5 : 1)
                }
                .padding(.top, 12)
                if !model.importMessage.isEmpty {
                    Text(verbatim: model.importMessage).font(theme.font(12)).foregroundStyle(theme.inkSecondary).padding(.top, 8)
                }
                Group {
                    if model.loading {
                        Text("Loading…")
                    } else if model.skills.isEmpty {
                        Text("No installed skills yet.")
                    }
                }
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.top, 12)
                .opacity(model.loading || model.skills.isEmpty ? 1 : 0)
                .frame(height: model.loading || model.skills.isEmpty ? nil : 0)
                if !model.skills.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(model.skills) { skill in row(skill) }
                    }
                    .padding(.top, 8)
                }
                if model.staged > 0 {
                    Text(model.staged == 1
                         ? String(localized: "1 proposal is waiting for a decision in chat.")
                         : String(localized: "\(model.staged) proposals are waiting for a decision in chat."))
                        .font(theme.font(12))
                        .foregroundStyle(theme.warning)
                        .padding(.top, 8)
                }
                if !model.error.isEmpty {
                    Text(verbatim: model.error).font(theme.font(12)).foregroundStyle(theme.danger).padding(.top, 8)
                }
            }
            if session.surfaceGate.allows(.orgSkillsLibrary) {
                BotPanelPhoneSection { OrgSkillsSection(bot: bot) { Task { await model.refresh() } } }
            }
        }
        .task(id: bot.id) {
            model.client = session.profileClient
            await model.refresh(first: true)
        }
        .sheet(item: $model.reviewing) { sheet in SkillReviewSheet(sheet: sheet, model: model) }
        .sheet(item: $model.viewing) { sheet in SkillTextSheet(sheet: sheet, model: model) }
        .confirmationDialog(
            removing.map { String(localized: "Remove the learned skill “\($0.name)”?") } ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { skill in
            Button(String(localized: "Remove skill"), role: .destructive) {
                removing = nil
                Task { await model.remove(skill) }
            }
        }
    }

    private func importSkill() {
        let text = source
        Task { if await model.importSkill(text) { source = "" } }
    }

    private func row(_ skill: ManagedSkill) -> some View {
        HStack(spacing: 10) {
            Button { Task { await model.view(skill) } } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: skill.name).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
                    if !skill.description.isEmpty {
                        Text(verbatim: skill.description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            PanelSwitch(label: "Enabled", isOn: skill.enabled, disabled: model.working == skill.name) { _ in
                Task { await model.toggle(skill) }
            }
            Button { removing = skill } label: {
                Image(systemName: "trash")
                    .font(.system(size: 12))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .disabled(model.working == skill.name)
            .accessibilityLabel(Text("Remove skill"))
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Memory

/// Memory (`MemorySection.tsx`): the on/off card with the folder, how much
/// of MEMORY.md loads (two 6 pt gauges), then Memory upkeep. The files and
/// their journal open in the phone's memory page.
private struct BotPanelMemory: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var memory: BotMemoryModel
    @State private var saving = false
    @State private var newTopic = ""
    @State private var deleting: MemoryFileInfo?

    init(bot: Bot) {
        self.bot = bot
        _memory = StateObject(wrappedValue: BotMemoryModel(botId: bot.id))
    }

    private var enabled: Bool { bot.memoryEnabled != false }
    private var upkeep: Bool { bot.memoryUpkeep != false }
    private var canEdit: Bool { session.surfaceGate.allows(.advancedBotPanel) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelCard {
                Text("Memory").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                Button { Task { await patch(BotAccessPatch(memoryEnabled: !enabled)) } } label: {
                    HStack(spacing: 8) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(enabled ? theme.accent : Color.clear)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .strokeBorder(enabled ? Color.clear : theme.inkSecondary, lineWidth: 1)
                            if enabled {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 8.5, weight: .heavy))
                                    .foregroundStyle(.white)
                            }
                        }
                        .frame(width: 13, height: 13)
                        Text("Let this bot use memory").panelText(13, 19.5).foregroundStyle(theme.ink)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canEdit || saving || bot.busy == true)
                .padding(.top, 12)
                Text(bot.busy == true
                     ? "Off stops memory prompts, recall, native memory tools, upkeep, and automatic turn logs. Existing files remain available for review. Stop this bot's turn before changing this setting."
                     : "Off stops memory prompts, recall, native memory tools, upkeep, and automatic turn logs. Existing files remain available for review.")
                    .panelText(12, 18)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 4)
                Text("Notes this bot keeps between tasks. They are plain markdown files in a folder on this computer — open them in any editor, or in Obsidian.")
                    .panelText(13, 21.125)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 4)
                if let overview = memory.overview {
                    HStack(spacing: 8) {
                        Text(verbatim: overview.workspacePath)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button {
                            let path = overview.workspacePath
                            Task.detached(priority: .userInitiated) { UIPasteboard.general.string = path }
                        } label: {
                            Label("Copy path", systemImage: "square.on.square")
                                .font(theme.font(13))
                                .foregroundStyle(theme.ink)
                                .padding(.horizontal, 12)
                                .frame(height: 31.5)
                                .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("desktop-memory-files")
                    }
                    .padding(.top, 12)
                }
            }
            if let capacity = memory.overview?.index {
                capacityBlock(capacity)
                    .padding(.top, 20)
            } else if let error = memory.error {
                PanelNotice(text: error).padding(.top, 16)
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Text("Memory upkeep").panelText(15, 22.5, .medium).foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    PanelSwitch(label: "Memory upkeep", isOn: upkeep, disabled: !canEdit || saving || !enabled) { on in
                        Task { await patch(BotAccessPatch(memoryUpkeep: on)) }
                    }
                }
                Text("Keeps these notes in shape without the bot having to remember to: notices facts you mention in chats and files them — core facts here, detail in topic files it creates — and tidies up every night: expired notes are archived, duplicates merged, contradicted notes crossed out. Facts about you are added to About me (Settings → General), where every bot reads them and you can remove any. Every change shows below and can be undone.")
                    .panelText(13, 21.125)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 4)
                    .padding(.trailing, 56)
                if upkeep {
                    PanelFlow(spacing: 12, lineSpacing: 12) {
                        quietButton(memory.tidying ? "Tidying…" : "Tidy up now", disabled: memory.tidying || !canEdit) {
                            Task { await memory.tidy() }
                        }
                        Text(verbatim: lastUpkeepLine)
                            .font(theme.font(12.5))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(minHeight: 31.5)
                    }
                    .padding(.top, 12)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.top, 20)
            if let editing = memory.editing {
                editor(editing).padding(.top, 16)
            }
            if let overview = memory.overview {
                filesCard(overview).padding(.top, 16)
            }
            changesCard.padding(.top, 16)
            if let notice = memory.notice {
                Text(verbatim: notice).panelText(12.5, 18.75).foregroundStyle(theme.inkSecondary).padding(.top, 12)
            }
        }
        .padding(.top, 24)
        .task(id: bot.id) {
            memory.client = session.profileClient
            await memory.activate()
        }
        .confirmationDialog(
            deleting.map { String(localized: "Delete \($0.name)? The journal below can bring it back.") } ?? "",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { file in
            Button(String(localized: "Delete"), role: .destructive) {
                deleting = nil
                Task { await memory.remove(file) }
            }
        }
    }

    // MARK: Files and changes

    private func quietButton(_ title: LocalizedStringKey, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .padding(.horizontal, 12)
                .frame(height: 31.5)
                .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
    }

    private var lastUpkeepLine: String {
        var line = memory.upkeep?.lastTidy.map {
            String(localized: "Last tidy-up \(BotAdvancedWording.ago($0.at)): \(BotAdvancedWording.tidySummary($0).lowercased()).")
        } ?? String(localized: "Not tidied yet.")
        if let capture = memory.upkeep?.lastCapture {
            let receipt = BotAdvancedWording.captureReceipt(capture)
            if !receipt.isEmpty { line += " " + receipt }
        }
        return line
    }

    /// The open file (MEMORY.md first): edited in place, saved with its
    /// hash so a change the bot made meanwhile is never overwritten.
    private func editor(_ editing: BotMemoryModel.Editing) -> some View {
        PanelCard {
            HStack(spacing: 8) {
                Text(verbatim: editing.path)
                    .font(.system(size: 12.5, design: .monospaced))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if editing.path != MemoryRules.index {
                    Button { Task { await memory.open(MemoryRules.index) } } label: {
                        Text("Back to MEMORY.md").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            if memory.conflict != nil {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(bot.name) changed this file while you were editing.").panelText(12.5, 18.75, .medium).foregroundStyle(theme.ink)
                    Text("Nothing has been saved. Reload to see \(bot.name)'s version (your draft is kept below), or overwrite it with yours.")
                        .panelText(12.5, 18.75).foregroundStyle(theme.inkSecondary)
                    HStack(spacing: 8) {
                        quietButton("Reload", disabled: memory.saving) { memory.reloadFromConflict() }
                        quietButton("Overwrite with mine", disabled: memory.saving) {
                            Task { await memory.save(expectedHash: memory.conflict?.currentHash) }
                        }
                    }
                }
                .padding(12)
                .background(theme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.top, 8)
            }
            // the markdown editor (desktop MemoryEditorDialog, #258)
            MarkdownEditor(
                text: Binding(get: { memory.editing?.text ?? "" }, set: { memory.edit($0) }),
                placeholder: editing.path == MemoryRules.index
                    ? String(localized: "Nothing remembered yet. The bot writes durable notes here — or add your own.")
                    : String(localized: "Write the note here."),
                minHeight: 200, monospaced: true,
                accessibilityLabel: editing.path == MemoryRules.index ? String(localized: "Bot memory") : String(localized: "Memory file \(editing.path)")
            )
            .disabled(editing.readOnly || !canEdit)
            .padding(.top, 8)
            if editing.readOnly {
                Text("Daily logs are the bot's own record of what it did; they are not loaded into conversations and are read-only here.")
                    .panelText(12, 18).foregroundStyle(theme.inkSecondary).padding(.top, 8)
            } else {
                HStack(spacing: 12) {
                    quietButton(memory.saving ? "Saving…" : "Save", disabled: memory.saving || !editing.dirty || !canEdit) {
                        Task { await memory.save(expectedHash: editing.hash) }
                    }
                    if editing.dirty {
                        Button { Task { await memory.open(editing.path) } } label: {
                            Text("Discard changes").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 8)
            }
            if let draft = memory.savedDraft {
                Text("Your unsaved draft, kept so nothing is lost:").font(theme.font(12)).foregroundStyle(theme.inkSecondary).padding(.top, 12)
                Text(verbatim: draft)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(theme.ink)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(.top, 4)
                Button { memory.savedDraft = nil } label: {
                    Text("Dismiss draft").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
    }

    private func filesCard(_ overview: MemoryOverview) -> some View {
        PanelCard {
            fileRows(title: "Topic files", hint: "Longer notes the bot reads on demand. Tap one to edit it.", files: overview.topics)
            HStack(spacing: 8) {
                PanelTextField(placeholder: "New topic name, e.g. clients", text: $newTopic) { createTopic() }
                    .accessibilityLabel(Text("New topic name"))
                quietButton("New topic", disabled: newTopic.trimmingCharacters(in: .whitespaces).isEmpty || !canEdit) { createTopic() }
            }
            .padding(.top, 12)
            if !overview.logs.isEmpty {
                fileRows(title: "Daily logs", hint: "What the bot did each day, in its own words. Not loaded into conversations.", files: overview.logs)
                    .padding(.top, 16)
            }
        }
    }

    private func createTopic() {
        let name = newTopic
        Task { if await memory.createTopic(name) != nil { newTopic = "" } }
    }

    private func fileRows(title: LocalizedStringKey, hint: LocalizedStringKey, files: [MemoryFileInfo]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).textCase(.uppercase).font(theme.font(12, .medium)).tracking(0.96).foregroundStyle(theme.inkSecondary)
            Text(hint).panelText(12, 18).foregroundStyle(theme.inkSecondary).padding(.top, 2)
            if files.isEmpty {
                Text("None yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary).padding(.top, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
                        HStack(spacing: 8) {
                            Button { Task { await memory.open(file.path) } } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "doc.text").font(.system(size: 12)).foregroundStyle(theme.inkSecondary)
                                    Text(verbatim: file.name).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(theme.ink).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(verbatim: "\(MemoryCapacity.formatBytes(file.bytes)) · \(BotAdvancedWording.ago(file.modifiedAt))")
                                        .font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Button { deleting = file } label: {
                                Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(theme.inkSecondary).frame(width: 24, height: 24)
                            }
                            .buttonStyle(.plain)
                            .disabled(!canEdit)
                            .accessibilityLabel(Text("Delete \(file.name)"))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(memory.editing?.path == file.path ? theme.control.opacity(0.6) : .clear)
                        if index < files.count - 1 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
                .padding(.top, 8)
            }
        }
    }

    private var changesCard: some View {
        PanelCard {
            Text("Changes").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
            Text("Every change to these files, whoever made it. Undo puts a file back the way it was before that change.")
                .panelText(13, 21.125).foregroundStyle(theme.inkSecondary).padding(.top, 4)
            VStack(alignment: .leading, spacing: 10) {
                if let journal = memory.journal {
                    if journal.isEmpty {
                        Text("No changes recorded yet.").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    }
                    ForEach(journal) { row in
                        HStack(alignment: .top, spacing: 8) {
                            Text(verbatim: [BotAdvancedWording.journalSummary(row, botName: bot.name), BotAdvancedWording.ago(row.at),
                                            BotAdvancedWording.journalSource(row)].compactMap { $0 }.joined(separator: " · "))
                                .panelText(12.5, 18.75)
                                .foregroundStyle(theme.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if row.canRevert {
                                Button { Task { await memory.revert(row) } } label: {
                                    Text(memory.reverting == row.id ? "Undoing…" : "Undo").font(theme.font(12, .medium)).foregroundStyle(theme.accentText)
                                }
                                .buttonStyle(.plain)
                                .disabled(memory.reverting != nil || !canEdit)
                            }
                        }
                    }
                } else {
                    Text("Loading…").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                }
                if let error = memory.error {
                    Text(verbatim: error).font(theme.font(12.5)).foregroundStyle(theme.danger)
                }
            }
            .padding(.top, 12)
        }
    }

    private func capacityBlock(_ capacity: MemoryCapacity) -> some View {
        let lines = String(localized: "\(capacity.lines) / \(capacity.maxLines) lines")
        let size = "\(MemoryCapacity.formatBytes(capacity.bytes)) / \(MemoryCapacity.formatBytes(capacity.maxBytes))"
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Text(verbatim: "MEMORY.md").panelText(13, 19.5, .medium).foregroundStyle(theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .layoutPriority(1)
                Text(verbatim: "\(lines) · \(size)").panelText(12, 18).foregroundStyle(theme.inkSecondary)
                    .frame(width: 135, alignment: .leading)
            }
            gauge("Lines", share: capacity.lineShare).padding(.top, 8)
            gauge("Size", share: capacity.byteShare).padding(.top, 8)
            // The numbers are said once, above; a line only when a cut happens (desktop MemoryGauge).
            if let warning = summary(capacity) {
                Text(verbatim: warning).panelText(12.5, 20.3125).foregroundStyle(theme.danger).padding(.top, 8)
            }
        }
        .padding(.horizontal, 4)
    }

    private func gauge(_ label: LocalizedStringKey, share: Double) -> some View {
        HStack(spacing: 8) {
            Text(label).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).frame(width: 40, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.inset)
                    Capsule().fill(theme.accent).frame(width: max(proxy.size.width * min(1, share), share > 0 ? 3 : 0))
                }
            }
            .frame(height: 6)
        }
        .frame(height: 17.25)
        .accessibilityElement()
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: "\(Int((share * 100).rounded())) %"))
    }

    /// `capacityStatus(...).warning` (src/lib/memory.ts): only when lines are cut.
    private func summary(_ capacity: MemoryCapacity) -> String? {
        guard capacity.truncated, capacity.missingLines > 0 else { return nil }
        return String(localized: "\(capacity.missingLines) lines are not loaded. Trim MEMORY.md or move notes into a topic.")
    }

    private func patch(_ patch: BotAccessPatch) async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            session.applyProfileBot(try await client.patchBotAccess(botId: bot.id, patch: patch))
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: - History

/// History (`HistorySection.tsx`): a bordered card per change, newest first
/// (the time secondary, then who, how and what, 13 / 21.125), and "Undo
/// this change" (12 medium accent) beside a soul row that can be undone,
/// confirmed as on the desktop; the list reloads after.
private struct BotPanelHistory: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @State private var history: BotHistory?
    @State private var loadFailed = false
    @State private var rollingBack = false
    @State private var target: BotHistoryRow?
    @State private var request = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let history {
                if loadFailed {
                    PanelNotice(text: String(localized: "Couldn’t refresh history."))
                }
                if history.rows.isEmpty {
                    Text("No changes recorded yet.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
                }
                ForEach(history.sorted) { row in
                    AnyView(card(row, revision: history.revision))
                }
            } else if loadFailed {
                Text("Couldn’t load history.").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
            } else {
                Text("Loading…").font(theme.font(13)).foregroundStyle(theme.inkSecondary)
            }
        }
        .task(id: bot.id) { await load() }
        .confirmationDialog(
            String(localized: "Restore previous instructions?"),
            isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }),
            titleVisibility: .visible,
            presenting: target
        ) { row in
            Button(String(localized: "Restore instructions")) { Task { await rollback(row) } }
            Button(String(localized: "Cancel"), role: .cancel) { target = nil }
        } message: { _ in
            Text(String(localized: "Replaces current SOUL with the version before this change. Current version stays in History."))
        }
    }

    private func card(_ row: BotHistoryRow, revision: String?) -> some View {
        PanelCard {
            HStack(alignment: .top, spacing: 12) {
                (Text(verbatim: DesktopWhenLabel.label(row.at)).foregroundColor(theme.inkSecondary)
                 + Text(verbatim: " · " + String(localized: "\(row.actor) via \(row.via)") + " · \(row.summary)").foregroundColor(theme.ink))
                    .panelText(13, 21.125)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if row.restorable {
                    Button { target = row } label: {
                        Text("Undo this change")
                            .font(theme.font(12, .medium))
                            .foregroundStyle(theme.accentText)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .disabled(rollingBack || revision == nil)
                    .opacity(rollingBack || revision == nil ? 0.5 : 1)
                    .accessibilityIdentifier("desktop-history-undo.\(row.id)")
                }
            }
            if row.showsRestoreReason {
                Text(verbatim: row.restoreUnavailableReason
                     ?? String(localized: "The exact previous instructions are unavailable, so this change cannot be undone."))
                    .panelText(12, 19.5)
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 8)
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
