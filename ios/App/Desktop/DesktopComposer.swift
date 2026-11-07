// iPad I3: the desktop composer pill (Composer.tsx), measured in
// desktop-1376x1032-03-main.json (2026-11-03): 46 tall with its ring,
// radius 22, padded 6 x 8; from the left, the + (28, `SECONDARY_CIRCLE`:
// 6 % ink, a 0.5 pt inset border, a 15 pt plus in the tertiary ink), the
// field (13/20, 4 pt in), dictation (28, the same circle; hidden once there
// is text) and the call button (28, filled with the bot's colour), which
// becomes send while there is text. 4 pt between. The + opens the menu of
// the reference design: Attach files and Teach a task in the + menu. #2106
// puts the model choice back on a compact chip in the chat bar (same store
// as Settings > Models); the approval level stays in the bot's settings.
// The + menu and the "/" menu float above it, as the desktop's popovers do.
import SwiftUI
import UIKit
import CompanionCore

/// Which popover of the pill is open.
enum DesktopComposerMenu: Equatable {
    case approval
    /// The + menu (`ComposerPlusMenu`).
    case plus
}

struct DesktopComposerPill: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @Binding var draft: String
    let prompt: String
    var focused: FocusState<Bool>.Binding
    let canSend: Bool
    /// The bot cannot answer now (SendState.swift): send and voice wait.
    var blocked = false
    let busy: Bool
    let listening: Bool
    let inputLocked: Bool
    let bot: Bot?
    /// A group's call (GroupCallButton): its readiness sets the warning dot.
    var room: Room? = nil
    /// The slash or mention popup, floated above the pill's leading edge.
    let popup: AnyView?
    let attachPhotos: () -> Void
    let attachFiles: () -> Void
    let more: () -> Void
    let openModel: () -> Void
    let openAllowlist: () -> Void
    let toggleDictation: () -> Void
    let send: () -> Void
    let voice: () -> Void
    let hardwareReturn: () -> Void
    let draftChanged: (String, String) -> Void

    @State private var modelLabel: String?
    /// The bot's realtime voice: false, the call button says "Calls need a
    /// realtime voice" and opens Settings > Voice (CallView.tsx, 2026-11-02).
    @State private var realtimeReady: Bool?
    @State private var callHelpOpen = false
    /// A room: text to speech is set up on the computer.
    @State private var roomSpeechConfigured = false
    /// The model menu (#477, #478, #518), as the desktop chip opens it.
    @State private var modelMenuOpen = false
    @State private var menu: DesktopComposerMenu? = DesktopComposerPill.parityMenu

    #if DEBUG
    static var parityMenu: DesktopComposerMenu? { DesktopChatParity.openMenu }
    #else
    static let parityMenu: DesktopComposerMenu? = nil
    #endif

    private var hasText: Bool { !draft.isEmpty }

    /// The pill's width: under 30rem of content (`@max-[30rem]/composer`)
    /// the field takes a full line above the chips and the actions.
    @State private var pillWidth: CGFloat = 0
    private var wraps: Bool { pillWidth > 0 && pillWidth - 18 < 480 }

    var body: some View {
        Group {
            if wraps {
                VStack(alignment: .leading, spacing: 4) {
                    field
                    HStack(alignment: .bottom, spacing: 4) {
                        chips
                        Spacer(minLength: 4)
                        actions
                    }
                }
            } else {
                HStack(alignment: .bottom, spacing: 4) {
                    chips
                    field
                    actions
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .background(theme.composer, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(1)
        .overlay(
            RoundedRectangle(cornerRadius: 23, style: .continuous)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        // the guided tour's first step (`data-tour="composer"`)
        .desktopTourAnchor("composer")
        .overlay(alignment: .topLeading) {
            if let popup, menu == nil {
                // `absolute bottom-full left-2 mb-2 w-[26rem]`: a zero-high
                // frame on the pill's top edge, the popup hanging up from it
                popup
                    .frame(width: 416)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(height: 0, alignment: .bottom)
                    .offset(x: 8, y: -8)
                    .transition(.opacity)
            }
        }
        .background(GeometryReader { proxy in
            Color.clear
                .onAppear { pillWidth = proxy.size.width }
                .onValueChange(of: proxy.size.width) { pillWidth = $0 }
        })
        .task(id: bot?.currentTaskModelSelection) { await loadModelLabel() }
        .onValueChange(of: hasText) { _ in menu = nil }
    }

    @ViewBuilder
    private var chips: some View {
        plusButton
    }

    @ViewBuilder
    private var actions: some View {
        // #2106: compact model + effort chip; picking writes the bot's model
        // for every thread (ModelMenuSheet). Keep it out of the + menu. The
        // desktop (Grok Bot) shows it on the right, just before the mic.
        if modelLabel != nil { modelChip }
        // the mic stays beside the draft (ComposerActionBar: hidden only
        // while dictating or recording a voice note)
        dictationButton
        if canSend || busy { sendButton } else { voiceButton }
    }

    private func menuBinding(_ which: DesktopComposerMenu) -> Binding<Bool> {
        Binding(get: { menu == which }, set: { menu = $0 ? which : nil })
    }

    /// `SECONDARY_CIRCLE`: 28, 6 % ink, a 0.5 pt inset ring at 15 % ink,
    /// the glyph in the tertiary ink (the ink on hover). 44 pt for a finger.
    private func secondaryCircle<Glyph: View>(_ glyph: Glyph, tint: Color? = nil) -> some View {
        glyph
            .foregroundStyle(tint ?? theme.inkTertiary)
            .frame(width: 28, height: 28)
            .background(theme.ink.opacity(0.06), in: Circle())
            .overlay(Circle().strokeBorder(theme.border, lineWidth: 0.5))
            .frame(width: 32, height: 32)
            .contentShape(Circle())
    }

    private var plusButton: some View {
        Button { menu = menu == .plus ? nil : .plus } label: {
            secondaryCircle(DesktopIconView(icon: .plus, size: 15, strokeWidth: 2.25), tint: menu == .plus ? theme.ink : nil)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Composer actions"))
        .accessibilityIdentifier("desktop-composer-plus")
        .desktopTourAnchor("composer-plus")
        .overlay(alignment: .topLeading) {
            if menu == .plus { plusMenu }
        }
    }

    /// #2106: compact model label in the chat bar (web `data-tour="model"`).
    /// Opens ModelMenuSheet; a pick writes the bot default for every thread.
    private var modelChip: some View {
        Button {
            menu = nil
            if bot != nil { modelMenuOpen = true } else { openModel() }
        } label: {
            HStack(spacing: 4) {
                Text(verbatim: modelLabel ?? "")
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                DesktopLucideGlyph(paths: DesktopLucide.chevronDown, size: 14)
                    .foregroundStyle(theme.inkTertiary)
            }
            .padding(.horizontal, 6)
            .frame(height: 28)
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy || modelLabel == nil)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("Model: \(modelLabel ?? "")"))
        .accessibilityIdentifier("desktop-composer-model-chip")
        .popover(isPresented: $modelMenuOpen) {
            if let bot {
                ModelMenuSheet(bot: bot, close: { modelMenuOpen = false })
                    .environmentObject(session)
                    .frame(minWidth: 340, idealWidth: 360, minHeight: 480, idealHeight: 560)
            }
        }
        .onValueChange(of: modelMenuOpen) { open in
            if !open { Task { await loadModelLabel() } }
        }
    }

    /// `ComposerPlusMenu` (useComposerVoice.ts plusItems): min 220 wide,
    /// 6 in, rows 30 tall; Attach files and Teach a task, nothing else (the
    /// model and the approval level live in the bot's settings, Loop and
    /// Goal in the "/" menu). The desktop's Attach files opens the file
    /// picker; on the iPad it offers its two sources, the photo library and
    /// Files, as a submenu of that one row.
    private var plusMenu: some View {
        DesktopComposerMenuPanel(label: "Composer actions", width: 220) {
            Menu {
                Button {
                    menu = nil
                    attachPhotos()
                } label: { Label("Photo library", systemImage: "photo.on.rectangle") }
                Button {
                    menu = nil
                    attachFiles()
                } label: { Label("Files", systemImage: "folder") }
            } label: {
                HStack(spacing: 8) {
                    DesktopLucideGlyph(paths: DesktopLucide.paperclip, size: 16)
                        .frame(width: 16, height: 16)
                    Text("Attach files").font(theme.font(13)).lineLimit(1)
                    Spacer(minLength: 4)
                }
                .foregroundStyle(theme.ink)
                .padding(.horizontal, 8)
                .frame(width: 208, height: 30)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityIdentifier("desktop-composer-attach")
            if bot != nil {
                // Teach a task: the same as picking /learn in the "/" menu
                Button {
                    menu = nil
                    draft = "/learn "
                    focused.wrappedValue = true
                } label: {
                    HStack(spacing: 8) {
                        // RecordMark: a 5.6 ring (1.25) and a 2.9 dot in a 16 box
                        Circle().strokeBorder(theme.danger, lineWidth: 1.25)
                            .frame(width: 12.45, height: 12.45)
                            .overlay(Circle().fill(theme.danger).frame(width: 5.8, height: 5.8))
                            .frame(width: 16, height: 16)
                        Text("Teach a task").font(theme.font(13)).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(verbatim: "/learn")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(theme.inkTertiary)
                    }
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 8)
                    .frame(width: 208, height: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityIdentifier("desktop-composer-teach")
            }
        }
        .fixedSize()
        .frame(height: 0, alignment: .bottom)
        .offset(x: 0, y: -10)
        .accessibilityIdentifier("desktop-composer-plus-menu")
    }

    private var field: some View {
        TextField("", text: $draft, prompt: Text(prompt).foregroundColor(theme.inkSecondary), axis: .vertical)
            .lineLimit(1...6)
            .font(theme.font(DesktopChatMetrics.textSize))
            .lineSpacing(DesktopChatMetrics.lineSpacing(theme))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .padding(.leading, 3)
            .padding(.vertical, 6 + DesktopChatMetrics.halfLeading(theme))
            .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
            .focused(focused)
            .allowsHitTesting(!inputLocked)
            .accessibilityIdentifier("message-input")
            .onValueChangePair(of: draft) { old, new in draftChanged(old, new) }
            .onHardwareReturn(hardwareReturn)
    }

    private var dictationButton: some View {
        Button(action: toggleDictation) {
            secondaryCircle(DesktopLucideGlyph(paths: DesktopLucide.mic, size: 15), tint: listening ? theme.danger : nil)
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text(listening ? "Stop dictation" : "Start dictation"))
    }

    /// The call-to-action circle (`CTA_CIRCLE`): 28, filled with the bot's
    /// colour (my bubble's, BubbleColors.user), its ink; the call while the
    /// field is empty, send while there is text.
    private var cta: (fill: Color, ink: Color) {
        if let paint = BubbleColors.user(botColor: bot?.color) { return (paint.fill.color, paint.ink.color) }
        return (theme.accent, theme.accentInk)
    }

    private var voiceButton: some View {
        Button {
            // CallView.tsx: an unavailable call opens its help bubble
            if realtimeReady == false { callHelpOpen.toggle() } else { voice() }
        } label: {
            if bot != nil {
                DesktopLucideGlyph(paths: DesktopLucide.audioLines, size: 16)
                    .foregroundStyle(cta.ink)
                    .frame(width: 28, height: 28)
                    .background(cta.fill, in: Circle())
                    .frame(width: 32, height: 32)
                    .contentShape(Circle())
            } else {
                // a group's call: the quiet circle, no bot colour to wear
                secondaryCircle(DesktopLucideGlyph(paths: DesktopLucide.audioLines, size: 16))
            }
        }
        // the call is unavailable (no realtime voice): a 6 pt warning dot in
        // the circle's top-right, ringed in the app ground (CallView.tsx
        // `absolute right-1 top-1 size-1.5 rounded-full bg-warning ring-2 ring-app`)
        .overlay(alignment: .topTrailing) {
            if realtimeReady == false {
                Circle().fill(theme.warning)
                    .frame(width: 6, height: 6)
                    .padding(2)
                    .background(theme.app, in: Circle())
                    // the 28 circle sits 2 in the 32 frame, the dot 4 in it, its ring 2 out
                    .padding(4)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .accessibilityIdentifier("desktop-composer-voice-unavailable")
            }
        }
        .buttonStyle(.plain)
        .disabled(blocked)
        .opacity(blocked ? 0.45 : 1)
        .hoverEffect(.highlight)
        .accessibilityLabel(voiceLabel)
        .accessibilityHint(realtimeReady != false ? Text(verbatim: "")
            : room == nil ? Text("A call runs on the realtime voice, never text to speech. Add or fix the xAI key in Settings > Voice.")
            : roomSpeechConfigured ? Text("Give every group member a voice before starting a group call.")
            : Text("Set up ElevenLabs, Fish Audio, Chatterbox, or a built-in Mac voice so the bot can speak during calls."))
        .accessibilityIdentifier("desktop-composer-voice")
        .popover(isPresented: $callHelpOpen, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Call unavailable").font(theme.font(13, .medium)).foregroundStyle(theme.ink)
                callHelpReason.font(theme.font(12)).foregroundStyle(theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                Button {
                    callHelpOpen = false
                    shell.settingsSection = .voice
                    shell.modal = .settings
                } label: {
                    Text("Open agent settings").font(theme.font(12, .medium)).foregroundStyle(theme.accentInk)
                        .padding(.horizontal, 12).frame(height: 28)
                        .background(theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                .accessibilityIdentifier("desktop-composer-voice-setup")
            }
            .padding(12)
            .frame(width: 280, alignment: .leading)
            .accessibilityIdentifier("desktop-composer-voice-help")
        }
        .task(id: bot?.id ?? room.map { "room:\($0.id):\($0.memberIds.joined(separator: ","))" }) {
            if let id = bot?.id {
                realtimeReady = await session.voiceModeStatus(botId: id)?.realtimeCallReady
            } else if let room {
                // a room call speaks with text to speech: speech set up and
                // every member with its own voice (CallTargetButton)
                let speech = await session.configStatus()?.tts?.configured == true
                roomSpeechConfigured = speech
                realtimeReady = RoomCallReadiness.ready(
                    speechConfigured: speech,
                    memberVoices: room.memberIds.map { session.state.bot($0)?.voice })
            } else {
                realtimeReady = nil
            }
        }
    }

    /// The help bubble's reason (CallView.tsx `reason`).
    private var callHelpReason: Text {
        if room == nil { return Text("A call runs on the realtime voice, never text to speech. Add or fix the xAI key in Settings > Voice.") }
        return roomSpeechConfigured ? Text("Give every group member a voice before starting a group call.")
            : Text("Set up ElevenLabs, Fish Audio, Chatterbox, or a built-in Mac voice so the bot can speak during calls.")
    }

    /// `voiceMode.start` / `voiceMode.realtimeNeededLabel`.
    private var voiceLabel: Text {
        if let room {
            // CallTargetButton's labels for a group (requireExplicitVoices)
            if realtimeReady == false {
                return roomSpeechConfigured ? Text("Pick a voice in an agent profile to make calls") : Text("Set up a voice in an agent profile to make calls")
            }
            return Text("Call \(room.name)")
        }
        if realtimeReady == false { return Text("Calls need a realtime voice") }
        if let bot { return Text("Talk with \(bot.name) (voice mode)") }
        return Text("Voice mode")
    }

    private var sendButton: some View {
        Button {
            Haptics.selection()
            send()
        } label: {
            Group {
                if busy {
                    ProgressView().controlSize(.small).tint(cta.ink)
                } else {
                    DesktopIconView(icon: .arrowUp, size: 16, strokeWidth: 2.25)
                }
            }
            .foregroundStyle(cta.ink)
            .frame(width: 28, height: 28)
            .background(cta.fill, in: Circle())
            .frame(width: 32, height: 32)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!canSend || blocked)
        .opacity(blocked ? 0.45 : 1)
        .accessibilityLabel(Text("Send"))
        .accessibilityIdentifier("desktop-composer-send")
    }

    /// The bot's model by its catalogue label ("Claude Sonnet 5").
    private func loadModelLabel() async {
        guard let bot, session.canAdminister || session.canEditBotField(bot, "modelSelection") else { modelLabel = nil; return }
        let selection = bot.currentTaskModelSelection
        let instances = await DesktopModelCatalog.shared.instances(session)
        let instance = instances.first { $0.instanceId == selection.instanceId }
        let modelId = selection.model.isEmpty ? (instance?.models.default ?? "") : selection.model
        let label = instance?.models.options.first { $0.id == modelId }?.label ?? modelId
        modelLabel = label.isEmpty ? nil : label
    }
}

// MARK: - Policy menus

/// The desktop's menu panel (`bg-elevated`, 0.5 pt border at 15 % ink,
/// radius 12, 6 pt in), floated 8 pt above its trigger's leading edge.
struct DesktopComposerMenuPanel<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    /// The + menu is `min-w-[220px]` and fits its two rows.
    var width: CGFloat = 260
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 2) { content }
            .padding(6)
            .frame(width: width, alignment: .leading)
            .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 12, y: 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(label))
    }
}

/// One menu row: a 16 pt glyph, the label 13/18 ink, the detail 12/16
/// tertiary, a check on the current choice.
struct DesktopMenuRow: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    let title: Text
    var detail: Text? = nil
    var selected = false
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Group {
                    if let lucide = DesktopLucide.forSymbol(systemImage) {
                        DesktopLucideGlyph(paths: lucide, size: 16)
                    } else {
                        Image(systemName: systemImage)
                            .font(.system(size: 13, weight: .regular))
                            .frame(width: 16, height: 16)
                    }
                }
                .padding(.top, 1)
                VStack(alignment: .leading, spacing: 0) {
                    title
                        .font(theme.font(13))
                        .frame(minHeight: 18)
                    if let detail {
                        detail
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 4)
                if selected {
                    DesktopLucideGlyph(paths: DesktopLucide.check, size: 14)
                        .padding(.top, 2)
                }
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(hovered ? theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

/// A 32 pt round trigger with a 16 pt glyph at 80 %.
private struct DesktopPillTrigger: View {
    @Environment(\.desktopTheme) private var theme
    let systemImage: String
    var lucide: [String]? = nil
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            glyph
                .opacity(0.8)
                .foregroundStyle(active ? theme.ink : theme.inkSecondary)
                .frame(width: 32, height: 32)
                .background(active ? theme.control : .clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    @ViewBuilder
    private var glyph: some View {
        if let lucide {
            DesktopLucideGlyph(paths: lucide, size: 16)
        } else {
            Image(systemName: systemImage).font(.system(size: 14, weight: .regular))
        }
    }
}

/// ApprovalModeSelector: Ask for approval, Auto-accept edits, Approve for
/// me, then Command allowlist.
struct DesktopApprovalButton: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @Binding var open: Bool
    let openAllowlist: () -> Void

    var body: some View {
        let level = ApprovalLevel.of(approvalMode: bot.approvalMode, autoApprove: bot.autoApprove)
        DesktopPillTrigger(systemImage: Self.icon(level), lucide: DesktopLucide.forSymbol(Self.icon(level)), active: open) { open.toggle() }
            .accessibilityLabel(Text("\(String(localized: Self.labelResource(level))) for \(bot.name)"))
            .accessibilityIdentifier("desktop-composer-approval")
            .overlay(alignment: .topLeading) {
                if open {
                    DesktopComposerMenuPanel(label: "Approval mode") {
                        ForEach(ApprovalLevel.offered, id: \.self) { option in
                            DesktopMenuRow(systemImage: Self.icon(option), title: Text(Self.label(option)),
                                           detail: Text(Self.detail(option)), selected: option == level) {
                                open = false
                                guard option != level else { return }
                                Task { await session.updateApprovalMode(option, for: bot) }
                            }
                        }
                        DesktopMenuRow(systemImage: "checklist", title: Text("Command allowlist")) {
                            open = false
                            openAllowlist()
                        }
                    }
                    .fixedSize()
                    .frame(height: 0, alignment: .bottom)
                    .offset(x: 1, y: -8)
                    .accessibilityIdentifier("desktop-approval-menu")
                }
            }
    }

    static func icon(_ level: ApprovalLevel) -> String {
        switch level {
        case .ask: "hand.raised"
        case .edits: "square.and.pencil"
        case .auto: "checkmark.shield"
        case .full: "exclamationmark.triangle"
        case .custom: "gearshape"
        }
    }

    static func label(_ level: ApprovalLevel) -> LocalizedStringKey {
        switch level {
        case .ask: "Ask for approval"
        case .edits: "Auto-accept edits"
        case .auto: "Approve for me"
        case .full: "Full access"
        case .custom: "Custom (config.toml)"
        }
    }

    static func labelResource(_ level: ApprovalLevel) -> String.LocalizationValue {
        switch level {
        case .ask: "Ask for approval"
        case .edits: "Auto-accept edits"
        case .auto: "Approve for me"
        case .full: "Full access"
        case .custom: "Custom (config.toml)"
        }
    }

    static func detail(_ level: ApprovalLevel) -> LocalizedStringKey {
        LocalizedStringKey(level.detail)
    }
}

// MARK: - Session

extension Session {
    /// The composer's approval mode for this conversation (`updateTask`).
    func updateApprovalMode(_ level: ApprovalLevel, for bot: Bot) async {
        guard let client = profileClient else { return }
        do {
            applyProfileBot(try await client.updateApprovalMode(botId: bot.id, threadId: bot.threadId, mode: level))
        } catch {
            if !Task.isCancelled { actionError = error.localizedDescription }
        }
    }
}

// MARK: - Glyphs

/// The renderer's lucide glyphs the chat draws (lucide-react paths, 24 pt
/// viewBox), stroked at `strokeWidth` like `DesktopIconView`.
enum DesktopLucide {
    static let paperclip = ["m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"]
    static let hand = [
        "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2",
        "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8",
        "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
    ]
    static let sparkles = [
        "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
        "M20 2v4", "M22 4h-4", circle(4, 20, 2),
    ]
    static let mic = ["M12 19v3", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"]
    static let audioLines = ["M2 10v3", "M6 6v11", "M10 3v18", "M14 8v7", "M18 5v13", "M22 10v3"]
    static let chevronDown = ["m6 9 6 6 6-6"]
    /// lucide Maximize2 (RichTable.tsx's fullscreen button).
    static let maximize2 = ["M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6"]
    /// lucide Table2 (TableFilePreview.tsx's preview button).
    static let table2 = ["M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"]
    /// lucide Smile, SmilePlus, Reply, Ellipsis (MessageHoverActions.tsx).
    static let smile = [circle(12, 12, 10), "M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01"]
    static let smilePlus = ["M22 11v1a10 10 0 1 1-9-10", "M8 14s1.5 2 4 2 4-2 4-2", "M9 9h.01", "M15 9h.01", "M16 5h6", "M19 2v6"]
    static let reply = ["M20 18v-2a4 4 0 0 0-4-4H4", "m9 17-5-5 5-5"]
    static let ellipsis = [circle(12, 12, 1), circle(19, 12, 1), circle(5, 12, 1)]
    /// lucide Columns2 and Rows2 (ExportTranscriptMenu.tsx Split right / down).
    static let columns2 = ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M12 3v18"]
    static let rows2 = ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M3 12h18"]
    static let copy = ["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z",
                       "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"]
    static let download = ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"]
    static let share = ["M12 2v13", "m16 6-4-4-4 4", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"]
    static let shieldCheck = [
        "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
        "m9 12 2 2 4-4",
    ]
    static let play = ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"]
    static let pencilLine = [
        "M13 21h8", "m15 5 4 4",
        "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    ]
    static let eye = [
        "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
        circle(12, 12, 3),
    ]
    static let trash = [
        "M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18",
        "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    ]

    static let box = [
        "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",
        "m3.3 7 8.7 5 8.7-5", "M12 22V12",
    ]
    static let monitor = ["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M8 21h8", "M12 17v4"]
    static let cloud = ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"]
    static let globe = [circle(12, 12, 10), "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"]
    static let check = ["M20 6 9 17l-5-5"]
    static let filePen = [
        "M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5", "M14 2v4a2 2 0 0 0 2 2h4",
        "M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",
    ]
    static let triangleAlert = ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"]
    static let listChecks = ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"]

    /// The renderer's glyph for an SF Symbol name the menus use, if any.
    static func forSymbol(_ name: String) -> [String]? {
        switch name {
        case "sparkles": sparkles
        case "macwindow": box
        case "laptopcomputer": monitor
        case "cloud": cloud
        case "globe": globe
        case "hand.raised": hand
        case "square.and.pencil": filePen
        case "checkmark.shield": shieldCheck
        case "exclamationmark.triangle": triangleAlert
        case "checklist": listChecks
        case "doc.on.doc": copy
        case "arrow.down.to.line": download
        default: nil
        }
    }

    static func circle(_ cx: Double, _ cy: Double, _ r: Double) -> String {
        "M\(cx - r) \(cy)A\(r) \(r) 0 1 0 \(cx + r) \(cy)A\(r) \(r) 0 1 0 \(cx - r) \(cy)Z"
    }
}

/// One lucide glyph at `size` points.
struct DesktopLucideGlyph: View {
    let paths: [String]
    var size: CGFloat = 16
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
