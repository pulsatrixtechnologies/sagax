// iPad lot 6: Edit N bots (`BulkEditBotsDialog.tsx`), the selection bar's
// Edit. Every setting stays as it is unless the person changes it: each
// section starts on "Not changed" with a Change pill; a value the bots share
// shows, differing values say "Mixed values". Review lists one line per
// change, Apply runs the bots one after the other through the session's own
// calls (the model, the profile's voice, the bot panel's permissions), then
// one result per bot and Undo, which puts every bot back.
import SwiftUI
import UIKit
import CompanionCore

private enum BulkSection: String, CaseIterable, Identifiable {
    case model, voice, permissions
    var id: String { rawValue }

    var title: String {
        switch self {
        case .model: String(localized: "Model")
        case .voice: String(localized: "Voice section")
        case .permissions: String(localized: "Permissions")
        }
    }
}

/// What a bot was before a run, for Undo.
private struct BulkBefore {
    var model: ModelSelection
    var speakReplies: Bool?
    var approval: ApprovalLevel
    var proactive: ProactiveMode
}

struct DesktopBulkEditSheet: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let botIds: [String]
    let close: () -> Void

    private enum Step { case edit, review, running, done }
    @State private var step = Step.edit
    @State private var opened: Set<BulkSection> = []
    @State private var instances: [Instance] = []
    @State private var model: ModelSelection?
    @State private var speakReplies: Bool?
    @State private var approval: ApprovalLevel?
    @State private var proactive: ProactiveMode?
    @State private var outcomes: [(id: String, outcome: DesktopBulkOutcome)] = []
    @State private var before: [String: BulkBefore] = [:]
    @State private var undoState: UndoState = .idle
    @State private var undone: [(id: String, outcome: DesktopBulkOutcome)] = []

    private enum UndoState { case idle, running, done }

    private var bots: [Bot] { botIds.compactMap { session.state.bot($0) } }
    private var countText: String { String(bots.count) }

    private var touched: [BulkSection] {
        BulkSection.allCases.filter { section in
            guard opened.contains(section) else { return false }
            switch section {
            case .model: return model != nil
            case .voice: return speakReplies != nil
            case .permissions: return approval != nil || proactive != nil
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 0.5)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    switch step {
                    case .edit: editBody
                    case .review, .running: summaryBody
                    case .done: doneBody
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 0.5)
            footer
        }
        .background(theme.panel)
        .presentationDetents([.large])
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-bulk-edit")
        .task { instances = await session.modelInstances() }
    }

    // MARK: Header and footer

    private var header: some View {
        HStack {
            Text("Edit \(countText) bots")
                .font(theme.font(15, .semibold))
                .foregroundStyle(theme.ink)
            Spacer()
            Button(action: close) {
                DesktopIconView(icon: .x, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Close"))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            Spacer()
            switch step {
            case .edit:
                pill("Cancel", action: close)
                pill("Review changes", primary: true, disabled: touched.isEmpty || bots.isEmpty, id: "review") { step = .review }
            case .review, .running:
                pill("Back", disabled: step == .running) { step = .edit }
                pill("Apply", primary: true, disabled: step == .running, id: "apply") { Task { await run() } }
            case .done:
                if undoState == .idle, outcomes.contains(where: { $0.outcome == .changed }) {
                    pill("Undo this change", id: "undo") { Task { await undo() } }
                }
                pill("Close", primary: true, disabled: undoState == .running, action: close)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func pill(_ title: LocalizedStringKey, primary: Bool = false, disabled: Bool = false, id: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(13, .medium))
                .foregroundStyle(primary ? theme.accentInk : theme.ink)
                .padding(.horizontal, 14)
                .frame(minHeight: 32)
                .background(primary ? theme.accent : theme.control, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityIdentifier(id.map { "desktop-bulk-\($0)" } ?? "desktop-bulk-pill")
    }

    // MARK: Edit

    @ViewBuilder
    private var editBody: some View {
        Text("Every setting stays as it is unless you change it. Open a section to change it for all the selected bots.")
            .font(theme.font(12.5))
            .foregroundStyle(theme.inkSecondary)
        ForEach(BulkSection.allCases) { section in
            sectionCard(section)
        }
    }

    private func sectionCard(_ section: BulkSection) -> some View {
        let isOpen = opened.contains(section)
        let changed = touched.contains(section)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(verbatim: section.title)
                    .font(theme.font(13, .semibold))
                    .foregroundStyle(theme.ink)
                if changed {
                    Text("Will change")
                        .font(theme.font(12, .medium))
                        .foregroundStyle(theme.accentText)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(theme.accent.opacity(0.15), in: Capsule())
                } else {
                    Text("Not changed").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                }
                if let common = commonText(section) {
                    Text(verbatim: "· " + common)
                        .font(theme.font(12)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Button {
                    if isOpen || changed { reset(section) } else { opened.insert(section) }
                } label: {
                    Text(isOpen || changed ? "Do not change" : "Change")
                        .font(theme.font(12.5, .medium))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 12).frame(minHeight: 30)
                        .background(theme.control, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-bulk-section.\(section.rawValue)")
            }
            if isOpen {
                Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 0.5).padding(.top, 12)
                sectionControls(section).padding(.top, 12)
            }
        }
        .padding(14)
        .background(theme.raised.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    private func reset(_ section: BulkSection) {
        opened.remove(section)
        switch section {
        case .model: model = nil
        case .voice: speakReplies = nil
        case .permissions: approval = nil; proactive = nil
        }
    }

    @ViewBuilder
    private func sectionControls(_ section: BulkSection) -> some View {
        switch section {
        case .model:
            Menu {
                ForEach(instances) { instance in
                    Section(instance.displayName ?? instance.instanceId) {
                        ForEach(instance.models.options) { option in
                            Button(option.label) { model = ModelSelection(instanceId: instance.instanceId, model: option.id) }
                        }
                    }
                }
            } label: {
                menuLabel(model.map(modelLabel) ?? String(localized: "Model"))
            }
            .accessibilityIdentifier("desktop-bulk-model")
        case .voice:
            Toggle(isOn: Binding(get: { speakReplies ?? false }, set: { speakReplies = $0 })) {
                Text("Read replies aloud").font(theme.font(13)).foregroundStyle(theme.ink)
            }
            .accessibilityIdentifier("desktop-bulk-speak")
        case .permissions:
            VStack(alignment: .leading, spacing: 10) {
                Text("Approval level").font(theme.font(12, .medium)).foregroundStyle(theme.inkSecondary)
                Menu {
                    ForEach(ApprovalLevel.offered, id: \.self) { level in
                        Button(String(localized: DesktopApprovalButton.labelResource(level))) { approval = level }
                    }
                } label: {
                    menuLabel(approval.map { String(localized: DesktopApprovalButton.labelResource($0)) } ?? String(localized: "Approval level"))
                }
                .accessibilityIdentifier("desktop-bulk-approval")
                Text("Takes the initiative").font(theme.font(12, .medium)).foregroundStyle(theme.inkSecondary)
                Menu {
                    ForEach(ProactiveMode.allCases, id: \.self) { mode in Button(mode.label) { proactive = mode } }
                } label: {
                    menuLabel(proactive?.label ?? String(localized: "Takes the initiative"))
                }
                .accessibilityIdentifier("desktop-bulk-proactive")
            }
        }
    }

    private func menuLabel(_ text: String) -> some View {
        HStack {
            Text(verbatim: text).font(theme.font(13)).foregroundStyle(theme.ink).lineLimit(1)
            Spacer(minLength: 8)
            DesktopIconView(icon: .chevronRight, size: 14).rotationEffect(.degrees(90)).foregroundStyle(theme.inkSecondary)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }

    private func modelLabel(_ selection: ModelSelection) -> String {
        if selection.auto == true { return String(localized: "Auto") }
        let instance = instances.first { $0.instanceId == selection.instanceId }
        let id = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        let label = instance?.models.options.first { $0.id == id }?.label ?? id
        return label.isEmpty ? String(localized: "Default") : label
    }

    /// The value every selected bot shares, or nil (and "Mixed values").
    private func commonText(_ section: BulkSection) -> String? {
        guard !bots.isEmpty else { return nil }
        func common<T: Hashable>(_ value: (Bot) -> T) -> T? {
            let values = Set(bots.map(value))
            return values.count == 1 ? values.first : nil
        }
        switch section {
        case .model:
            if let shared = common({ $0.modelSelection }) { return modelLabel(shared) }
        case .voice:
            if let shared = common({ $0.speakReplies == true }) { return shared ? String(localized: "On") : String(localized: "Off") }
        case .permissions:
            if let shared = common({ ApprovalLevel.of(approvalMode: $0.approvalMode, autoApprove: $0.autoApprove) }) {
                return String(localized: DesktopApprovalButton.labelResource(shared))
            }
        }
        return String(localized: "Mixed values")
    }

    // MARK: Review and results

    private var summaryBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            let parts = summaryParts()
            (Text("\(countText) bots").font(theme.font(14, .semibold))
                + Text(verbatim: parts.map { " · " + $0 }.joined()).font(theme.font(14)))
                .foregroundStyle(theme.ink)
                .accessibilityIdentifier("desktop-bulk-summary")
            Text("Each bot is changed in turn, as if you had edited it alone: the change shows in its Changes, and a bot that refuses says why.")
                .font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
            if step == .running { ProgressView().controlSize(.small) }
        }
    }

    private func summaryParts() -> [String] {
        var out: [String] = []
        for section in touched {
            switch section {
            case .model:
                if let model { out.append(String(localized: "\(String(localized: "Model")) → \(modelLabel(model))")) }
            case .voice:
                if let speakReplies {
                    out.append(String(localized: "\(String(localized: "Read replies aloud")) → \(speakReplies ? String(localized: "On") : String(localized: "Off"))"))
                }
            case .permissions:
                if let approval {
                    out.append(String(localized: "\(String(localized: "Approval level")) → \(String(localized: DesktopApprovalButton.labelResource(approval)))"))
                }
                if let proactive {
                    out.append(String(localized: "\(String(localized: "Takes the initiative")) → \(proactive.label)"))
                }
            }
        }
        return out
    }

    private var doneBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            let counts = DesktopBulkOutcome.counts(outcomes.map(\.outcome))
            Text("\(String(counts.ok)) changed, \(String(counts.failed)) refused, \(String(counts.skipped)) already set")
                .font(theme.font(13)).foregroundStyle(theme.ink)
                .accessibilityIdentifier("desktop-bulk-counts")
            resultList(outcomes)
            if undoState == .running {
                Text("Putting the bots back…").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
            } else if undoState == .done {
                Text("The bots are back as they were.").font(theme.font(13)).foregroundStyle(theme.ink)
                    .accessibilityIdentifier("desktop-bulk-undone")
                resultList(undone)
            }
        }
    }

    private func resultList(_ rows: [(id: String, outcome: DesktopBulkOutcome)]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: icon(row.outcome)).font(.system(size: 12)).padding(.top, 3)
                        .foregroundStyle(row.outcome == .changed ? theme.success : (row.outcome == .skipped ? theme.inkSecondary : theme.danger))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(verbatim: session.state.bot(row.id)?.name ?? String(localized: "A removed bot"))
                            .font(theme.font(13)).foregroundStyle(theme.ink)
                        Text(verbatim: detail(row.outcome)).font(theme.font(12))
                            .foregroundStyle(row.outcome.isRefused ? theme.danger : theme.inkSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 14)
        .background(theme.raised.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    private func icon(_ outcome: DesktopBulkOutcome) -> String {
        switch outcome {
        case .changed: "checkmark"
        case .skipped: "minus"
        case .refused: "exclamationmark.circle"
        }
    }

    private func detail(_ outcome: DesktopBulkOutcome) -> String {
        switch outcome {
        case .changed: String(localized: "Bot changed")
        case .skipped: String(localized: "Already set, nothing to change")
        case let .refused(reason): reason
        }
    }

    // MARK: Run and Undo

    private func run() async {
        step = .running
        var results: [(id: String, outcome: DesktopBulkOutcome)] = []
        for bot in bots {
            before[bot.id] = BulkBefore(
                model: bot.modelSelection, speakReplies: bot.speakReplies,
                approval: ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: bot.autoApprove),
                proactive: ProactiveMode.of(bot.proactiveMode)
            )
            results.append((bot.id, await apply(to: bot)))
        }
        outcomes = results
        step = .done
    }

    /// One bot, field by field, through the same calls its own editor uses.
    private func apply(to bot: Bot) async -> DesktopBulkOutcome {
        var changed = false
        func fail(_ fallback: String) -> DesktopBulkOutcome {
            .refused(session.actionError ?? fallback)
        }
        if touched.contains(.model), let model, model != bot.modelSelection {
            session.actionError = nil
            guard await session.updateModel(model, for: bot) != nil else { return fail(String(localized: "Model")) }
            changed = true
        }
        if touched.contains(.voice), let speakReplies, speakReplies != (bot.speakReplies == true) {
            session.actionError = nil
            guard await session.updateProfile(BotProfilePatch(speakReplies: speakReplies), for: bot) != nil else { return fail(String(localized: "Voice section")) }
            changed = true
        }
        if touched.contains(.permissions) {
            let patch = BotPanelPatch(
                approvalMode: approval.flatMap { $0 == ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: bot.autoApprove) ? nil : $0.rawValue },
                proactiveMode: proactive.flatMap { $0 == ProactiveMode.of(bot.proactiveMode) ? nil : $0.rawValue }
            )
            if !patch.isEmpty {
                guard let client = session.profileClient else { return .refused(String(localized: "This computer is offline.")) }
                do {
                    session.applyProfileBot(try await client.patchBotSettings(botId: bot.id, patch: patch))
                    changed = true
                } catch {
                    return .refused(error.localizedDescription)
                }
            }
        }
        return changed ? .changed : .skipped
    }

    private func undo() async {
        undoState = .running
        var results: [(id: String, outcome: DesktopBulkOutcome)] = []
        for (id, outcome) in outcomes where outcome == .changed {
            guard let bot = session.state.bot(id), let old = before[id] else { continue }
            var ok = true
            if touched.contains(.model), bot.modelSelection != old.model {
                let reverted = await session.updateModel(old.model, for: bot)
                ok = ok && reverted != nil
            }
            if touched.contains(.voice), (bot.speakReplies == true) != (old.speakReplies == true) {
                let reverted = await session.updateProfile(BotProfilePatch(speakReplies: old.speakReplies == true), for: bot)
                ok = ok && reverted != nil
            }
            if touched.contains(.permissions), let client = session.profileClient {
                let patch = BotPanelPatch(
                    approvalMode: approval == nil ? nil : old.approval.rawValue,
                    proactiveMode: proactive == nil ? nil : old.proactive.rawValue
                )
                if !patch.isEmpty {
                    do { session.applyProfileBot(try await client.patchBotSettings(botId: id, patch: patch)) } catch { ok = false }
                }
            }
            results.append((id, ok ? .changed : .refused(session.actionError ?? "")))
        }
        undone = results
        undoState = .done
    }
}

private extension DesktopBulkOutcome {
    var isRefused: Bool { if case .refused = self { true } else { false } }
}
