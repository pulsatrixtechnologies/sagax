// iPad I3: the model picker (ModelPicker.tsx), opened by the composer's
// model chip: a centred 880 x 640 dialog over a 50 % scrim. On the left the
// engine rail (Cloud: each engine with its state; API keys), on the right
// the engine's name and version, a search and every model under Cloud and
// Local, always open (2026-10-12, the desktop's model window: no collapsed
// list), and a footer to the providers. One mode (#261): a pick runs this thread
// and becomes the bot's model in one request (`ModelPickerRules`); "Use
// <bot>'s model" puts the thread back on the bot's. An organization lists
// only the providers its admin allows.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopModelPicker: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let close: () -> Void
    let openProviders: () -> Void

    @State private var instances: [Instance] = []
    @State private var railId: String?
    /// Organization server: the providers its admin allows (#261).
    @State private var allowedEngines: [String]?
    @State private var query = ""
    @State private var saving = false
    @State private var refreshing = false
    @State private var updating = false
    @State private var updateError: String?
    @State private var terminalOpen = false

    private var selection: ModelSelection { bot.currentTaskModelSelection }
    /// engine-rail.ts `configuredModelInstances`: what someone can use or
    /// finish setting up; the full catalogue stays in Settings.
    private var pickerInstances: [Instance] {
        ModelPickerRules.listed(
            DesktopEngineRail.configured(instances, selected: selection.instanceId),
            allowed: allowedEngines, organization: organization, selectedId: selection.instanceId
        )
    }
    private var organization: Bool { session.surfaceGate.allows(.people) }
    private func notAllowed(_ instance: Instance) -> Bool {
        organization && !ModelPickerRules.engineAllowed(allowedEngines, instance.instanceId)
    }
    private var profile: Bot { session.state.bot(bot.id) ?? bot }
    /// The open thread follows the bot's model (nil: an older server).
    private var follows: Bool? { profile.tasks?.first { $0.threadId == bot.threadId }?.followsBotModel }
    private var rail: Instance? {
        pickerInstances.first { $0.instanceId == (railId ?? selection.instanceId) } ?? pickerInstances.first
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture(perform: close)
            GeometryReader { geometry in
                dialog
                    .frame(width: min(880, geometry.size.width - 40), height: min(640, geometry.size.height - 96))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            instances = await DesktopModelCatalog.shared.instances(session)
            allowedEngines = await session.configStatus()?.allowedEngines
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-model-picker")
    }

    private var dialog: some View {
        HStack(spacing: 0) {
            engineRail
                .frame(width: 224)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(theme.panel)
                .overlay(alignment: .trailing) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1) }
            VStack(spacing: 0) {
                ScrollView { pane.padding(.horizontal, 24).padding(.top, 21).padding(.bottom, 12) }
                footer
            }
        }
        .background(theme.app)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 14))
                    .foregroundStyle(theme.inkTertiary)
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .keyboardShortcut(.cancelAction)
            .padding(10)
            .accessibilityLabel(Text("Close"))
        }
        .shadow(color: .black.opacity(0.35), radius: 30, y: 12)
    }

    // MARK: Rail

    private var engineRail: some View {
        let groups = DesktopEngineRail.groups(pickerInstances)
        return ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                if !groups.cloud.isEmpty { railHeading("Cloud") }
                ForEach(groups.cloud) { railButton($0) }
                railHeading("API keys").padding(.top, groups.cloud.isEmpty ? 0 : 6)
                ForEach(groups.api) { railButton($0) }
                Button(action: openProviders) {
                    HStack(spacing: 8) {
                        DesktopLucideGlyph(paths: ["M5 12h14", "M12 5v14"], size: 14)
                        Text("Add API keys")
                    }
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if !groups.local.isEmpty { railHeading("Local").padding(.top, 6) }
                ForEach(groups.local) { railButton($0) }
            }
            .padding(12)
        }
    }

    /// One provider: a Claude account or the OpenAI sign-ins fold into one
    /// button named for the family, opening on the account in use.
    private func railButton(_ instance: Instance) -> some View {
        let family = DesktopEngineRail.family(instance)
        let target = family.flatMap { f in
            pickerInstances.first { DesktopEngineRail.family($0) == f && $0.instanceId == selection.instanceId }
        } ?? instance
        let selected = family.map { $0 == rail.flatMap(DesktopEngineRail.family) } ?? (instance.instanceId == rail?.instanceId)
        return Button {
            railId = target.instanceId
            query = ""
        } label: {
            HStack(spacing: 10) {
                Group {
                    if let mark = DesktopProviderMark(driverKind: target.driverKind, preset: nil) {
                        DesktopProviderMarkView(mark: mark, size: 16)
                    } else {
                        Image(systemName: "cpu").font(.system(size: 13)).foregroundStyle(theme.ink)
                    }
                }
                    .frame(width: 28, height: 28)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: DesktopEngineRail.label(instance))
                        .font(theme.font(13, .medium))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 19.5)
                    status(target)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 52)
            .background(selected ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(verbatim: DesktopEngineRail.label(instance)))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func railHeading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .textCase(.uppercase)
            .font(theme.font(10, .medium))
            .tracking(0.8)
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 10)
            .frame(height: 19)
    }

    /// `engineStatus`: Setup required, Sign-in required, or the version;
    /// amber while it needs something (or has an update).
    @ViewBuilder
    private func status(_ instance: Instance) -> some View {
        let warn = DesktopEngineRail.needsCli(instance) || DesktopEngineRail.needsSignIn(instance) || instance.snapshot.update != nil
        HStack(spacing: 4) {
            Circle().fill(warn ? theme.warning : theme.success).frame(width: 6, height: 6)
            Group {
                if DesktopEngineRail.needsCli(instance) {
                    Text("Setup required")
                } else if DesktopEngineRail.needsSignIn(instance) {
                    Text("Sign-in required")
                } else if let version = instance.snapshot.version {
                    Text(verbatim: version)
                } else {
                    Text("Ready")
                }
            }
            .font(theme.font(11))
            .foregroundStyle(warn ? theme.warning : theme.inkSecondary)
            .lineLimit(1)
        }
        .frame(height: 16.5)
    }

    // MARK: Pane

    @ViewBuilder
    private var pane: some View {
        if let rail {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) {
                    Text(verbatim: DesktopEngineRail.label(rail))
                        .font(theme.font(16, .semibold))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 24)
                    Spacer(minLength: 8)
                    Button { refresh() } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(theme.inkSecondary)
                            .rotationEffect(.degrees(refreshing ? 180 : 0))
                            .frame(width: 24, height: 24)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(refreshing)
                    .accessibilityLabel(Text("Refresh \(rail.displayName ?? rail.instanceId) models"))
                    if let version = rail.snapshot.version {
                        Text(verbatim: version)
                            .font(theme.font(10.5, .medium))
                            .foregroundStyle(theme.success)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(theme.success.opacity(0.1), in: Capsule())
                    }
                }
                .padding(.trailing, 40)

                // one mode (#261): no "Only this thread" any more
                Text("This thread and the bot's model. Groups and new threads use the bot's model; a thread on its own model keeps it.")
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 20)
                if follows != nil { followBotRow.padding(.top, 10) }
                if notAllowed(rail) {
                    Text("Not allowed by your organization")
                        .font(theme.font(11.5, .medium))
                        .foregroundStyle(theme.warning)
                        .padding(.top, 8)
                }

                Text("Model")
                    .font(theme.font(12.5, .medium))
                    .foregroundStyle(theme.ink)
                    .frame(minHeight: 18.8)
                    .padding(.top, 17.5)
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.inkSecondary)
                    TextField("Search models", text: $query)
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 10)
                .frame(height: 32.8)
                .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
                .padding(.horizontal, 8)
                .padding(.top, 4)

                if let update = rail.snapshot.update {
                    updateCard(rail, update).padding(.horizontal, 4).padding(.top, 8)
                }
                models(rail).padding(.top, 8)
            }
        } else {
            Text("No model providers yet.")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 40)
        }
    }

    /// "Use <bot>'s model": the thread back on the bot's model, checked
    /// while it follows it (`FollowBotModelRow`).
    private var followBotRow: some View {
        let own = ModelPickerRules.threadsOnOwnModel(botModel: profile.modelSelection, tasks: profile.tasks ?? [])
        return VStack(alignment: .leading, spacing: 4) {
            Button {
                guard follows == false else { return }
                saving = true
                Task {
                    _ = await session.updateModel(profile.modelSelection, for: bot, updateBotDefault: false)
                    saving = false
                    close()
                }
            } label: {
                HStack(spacing: 8) {
                    Text("Use \(profile.name)'s model")
                        .font(theme.font(12.5, .medium))
                        .foregroundStyle(theme.ink)
                    Text(verbatim: profile.modelSelection.model)
                        .font(theme.font(11))
                        .foregroundStyle(theme.inkSecondary)
                    Spacer(minLength: 8)
                    if follows == true {
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.accent)
                    }
                }
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(follows == true ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(saving || bot.busy == true)
            .accessibilityIdentifier("desktop-model-follow-bot")
            if own > 0 {
                Text(own == 1 ? String(localized: "1 thread uses its own model.") : String(localized: "\(own) threads use their own model."))
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
            }
        }
    }

    @ViewBuilder
    private func models(_ rail: Instance) -> some View {
        let current = selection.instanceId == rail.instanceId ? (selection.model.isEmpty ? rail.models.default : selection.model) : nil
        let groups = ModelPickerRules.groups(rail.models.options, organization: organization)
        let cloud = groups.cloud
        let shown = query.isEmpty ? cloud : ModelSuggestions.filter(cloud, query: query)
        let local = query.isEmpty ? groups.local : ModelSuggestions.filter(groups.local, query: query)
        VStack(alignment: .leading, spacing: 0) {
            // the whole list, always open (the desktop's model window, 2026-10-12)
            if !shown.isEmpty { groupHeading("Cloud") }
            ForEach(shown) { option in modelRow(rail, option, current: current) }
            if !local.isEmpty {
                groupHeading("Local").padding(.top, 10)
                ForEach(local) { option in modelRow(rail, option, current: current) }
            }
        }
    }

    private func groupHeading(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .textCase(.uppercase)
            .font(theme.font(10, .medium))
            .tracking(0.8)
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 8)
            .padding(.top, 2)
            .frame(height: 21, alignment: .top)
    }

    private func modelRow(_ rail: Instance, _ option: ModelOption, current: String?) -> some View {
        Button { pick(rail, option) } label: {
            HStack(spacing: 8) {
                Text(verbatim: option.label)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                if option.id == rail.models.default {
                    Text("Default")
                        .font(theme.font(10))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 4))
                }
                if option.loaded == true {
                    Text("Loaded")
                        .font(theme.font(10))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 4))
                }
                if follows != nil, profile.modelSelection.instanceId == rail.instanceId, profile.modelSelection.model == option.id {
                    Text("(bot's model)").font(theme.font(10.5)).foregroundStyle(theme.inkSecondary)
                }
                Spacer(minLength: 8)
                if option.id == current {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 35.5)
            .background(option.id == current ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .disabled(saving || bot.busy == true || notAllowed(rail))
        .accessibilityIdentifier("desktop-model-\(option.id)")
    }

    /// The engine's update notice (EngineSetup's update card): what the
    /// newer version brings, the update on this server (Claude Code), and
    /// the command for a terminal.
    private func updateCard(_ rail: Instance, _ update: EngineUpdateNotice) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(theme.warning)
                    .frame(width: 14, height: 14)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: update.title)
                        .font(theme.font(12.5, .semibold))
                        .foregroundStyle(theme.ink)
                        .frame(minHeight: 18.8)
                    Text(verbatim: update.message)
                        .font(theme.font(11.5))
                        .lineSpacing(18.7 - theme.uiFont(11.5).lineHeight)
                        .foregroundStyle(theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, (18.7 - theme.uiFont(11.5).lineHeight) / 2)
                }
            }
            if rail.driverKind == "claudeAgent" {
                Button { runUpdate(rail) } label: {
                    HStack(spacing: 8) {
                        if updating {
                            ProgressView().controlSize(.small).tint(theme.accentInk)
                        } else {
                            Image(systemName: "arrow.down.to.line").font(.system(size: 12, weight: .semibold))
                        }
                        Text("Update \(HumanID.readable(rail.displayName, rail.instanceId, or: String(localized: "Removed engine"))) on this server")
                            .font(theme.font(12.5, .semibold))
                    }
                    .foregroundStyle(theme.accentInk)
                    .frame(maxWidth: .infinity, minHeight: 34.8)
                    .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(updating)
                .padding(.top, 12)
                .accessibilityIdentifier("desktop-model-update")
            }
            if let updateError {
                Text(verbatim: updateError)
                    .font(theme.font(11.5))
                    .foregroundStyle(theme.danger)
                    .padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 8) {
                Button { withAnimation(.easeOut(duration: 0.15)) { terminalOpen.toggle() } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrowtriangle.right.fill")
                            .font(.system(size: 6.5))
                            .rotationEffect(.degrees(terminalOpen ? 90 : 0))
                        Text("Prefer a terminal?")
                    }
                    .font(theme.font(11.5))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity, minHeight: 17.2, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if terminalOpen {
                    HStack(spacing: 6) {
                        Text(verbatim: update.command)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button { PlatformBridge.copyToPasteboard(update.command) } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                                .font(theme.font(11, .medium))
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Copy command"))
                    }
                    .padding(.horizontal, 8)
                    .frame(minHeight: 38.5)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .padding(1)
            .background(theme.app, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
            .padding(.top, 8)
        }
        .padding(10)
        .padding(1)
        .background(theme.warning.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.warning.opacity(0.25), lineWidth: 1))
    }

    private func refresh() {
        refreshing = true
        Task {
            instances = await DesktopModelCatalog.shared.instances(session, reload: true)
            refreshing = false
        }
    }

    private func runUpdate(_ rail: Instance) {
        updating = true
        updateError = nil
        Task {
            do {
                _ = try await session.updateClaude(instanceId: rail.instanceId)
                instances = await DesktopModelCatalog.shared.instances(session, reload: true)
            } catch {
                updateError = error.localizedDescription
            }
            updating = false
        }
    }

    private var footer: some View {
        HStack(spacing: 0) {
            Button(action: openProviders) {
                Text("Model providers and accounts")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button(action: openProviders) {
                Label("Add API keys", systemImage: "key")
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 38)
            }
            .buttonStyle(.plain)
        }
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
    }

    /// One mode (#261): this thread and the bot's model in one request;
    /// the effort stays on the same engine, a variant on the same model.
    private func pick(_ rail: Instance, _ option: ModelOption) {
        guard !notAllowed(rail) else { return }
        let next = ModelPickerRules.selectionForPick(selection, instance: rail, model: option.id)
        saving = true
        Task {
            _ = await session.updateModel(next, for: bot, updateBotDefault: true)
            saving = false
            close()
        }
    }
}

/// engine-rail.ts: which engines the picker lists, how sign-ins fold, and
/// the rail's groups.
enum DesktopEngineRail {
    enum Family: Equatable { case claude, openai }

    static func configured(_ instances: [Instance], selected: String) -> [Instance] {
        instances.filter { instance in
            instance.instanceId == selected
                || (instance.snapshot.isAvailable && (!instance.models.options.isEmpty || instance.snapshot.chatgptPlan == true))
        }
    }

    static func family(_ instance: Instance) -> Family? {
        guard instance.access != "api" else { return nil }
        switch instance.driverKind {
        case "claudeAgent": return .claude
        case "codex": return .openai
        default: return nil
        }
    }

    static func label(_ instance: Instance) -> String {
        switch family(instance) {
        case .claude: "Claude"
        case .openai: "OpenAI"
        case nil: HumanID.readable(instance.displayName, instance.instanceId, or: String(localized: "Removed engine"))
        }
    }

    static func needsSignIn(_ instance: Instance) -> Bool { instance.snapshot.isAvailable && instance.snapshot.authenticated == false }
    static func needsCli(_ instance: Instance) -> Bool { !instance.snapshot.isAvailable }

    /// One button per family (its first engine), then Cloud / API keys / Local.
    static func groups(_ instances: [Instance]) -> (cloud: [Instance], api: [Instance], local: [Instance]) {
        var seen: [Family] = []
        var cloud: [Instance] = [], api: [Instance] = [], local: [Instance] = []
        for instance in instances {
            if let f = family(instance) {
                if seen.contains(f) { continue }
                seen.append(f)
            }
            switch instance.access {
            case "custom": local.append(instance)
            case "api": api.append(instance)
            default: cloud.append(instance)
            }
        }
        return (cloud, api, local)
    }
}
