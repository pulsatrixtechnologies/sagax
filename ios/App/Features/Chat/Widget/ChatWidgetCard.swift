// A bot-authored widget in the transcript (message kind "widget"): the
// desktop's WidgetMessage (src/components/widget/WidgetMessage.tsx) in
// SwiftUI. One card with a header, a body drawn from the node tree
// (ChatWidgetNodes.swift) and its confirm and cancel under it. The card owns
// what the person typed into it and the life of a press: sending, sent,
// refused (the server's sentence in place, the card stays live) and settled
// into one line with a Details toggle. A press that settles it folds the card
// as soon as the server took it; the patched row (`message.patch`) then rules.
// docs/superpowers/specs/2026-10-13-chat-widgets-design.md
import CompanionCore
import SwiftUI

/// The row for a widget message: the card, or the row's text when there is
/// no tree this build can draw, or when it sits where a press cannot go.
struct ChatWidgetMessageView: View {
    let chat: Chat
    let message: Message
    let fallback: AnyView

    var body: some View {
        if case let .bot(bot) = chat, let payload = message.drawableWidget, let root = payload.root {
            // update_widget renumbers node ids: a new revision starts the card again
            ChatWidgetCard(botId: bot.id, threadId: chat.threadId, messageId: message.id, payload: payload, root: root)
                .id("\(message.id)-\(payload.rev)")
        } else {
            fallback
        }
    }
}

/// The colours and type a widget is drawn in: the phone's theme, or the
/// iPad desktop shell's (the same tokens the desktop card reads).
struct ChatWidgetInk {
    var ink: Color
    var secondary: Color
    var tertiary: Color
    var surface: Color
    var ring: Color
    var inset: Color
    var accent: Color
    var accentText: Color
    var accentInk: Color
    var success: Color
    var warning: Color
    var danger: Color
    var desktop: DesktopTheme?

    static func of(_ desktop: DesktopTheme?) -> ChatWidgetInk {
        if let desktop {
            return ChatWidgetInk(
                ink: desktop.ink, secondary: desktop.inkSecondary, tertiary: desktop.inkTertiary,
                surface: desktop.composer, ring: desktop.composerRing, inset: desktop.inset,
                accent: desktop.accent, accentText: desktop.accentText, accentInk: desktop.accentInk,
                success: desktop.success, warning: desktop.warning, danger: desktop.danger, desktop: desktop
            )
        }
        return ChatWidgetInk(
            ink: Theme.textPrimary, secondary: Theme.textSecondary, tertiary: Theme.textTertiary,
            surface: Theme.card, ring: Theme.hairline, inset: Theme.inset,
            accent: Theme.accent, accentText: Theme.accentText, accentInk: Theme.accentInk,
            success: Theme.success, warning: Theme.warning, danger: Theme.danger, desktop: nil
        )
    }

    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        desktop?.font(size, weight) ?? .system(size: size, weight: weight)
    }

    /// A text colour token of the canonical tree.
    func tone(_ name: String?) -> Color? {
        switch name {
        case "primary": ink
        case "secondary": secondary
        case "tertiary": tertiary
        case "success": success
        case "warning": warning
        case "danger": danger
        default: nil
        }
    }

    /// A badge colour.
    func badge(_ name: String) -> Color {
        switch name {
        case "success": success
        case "danger": danger
        case "warning": warning
        case "info": accentText
        case "discovery": Color(red: 0.62, green: 0.42, blue: 0.95)
        default: secondary
        }
    }
}

/// What every control in one card reads and writes, by field name.
@MainActor
final class ChatWidgetForm: ObservableObject {
    let root: ChatWidgetNode
    /// The widget row: what the controls' accessibility identifiers hang off.
    let messageId: String
    let actions: [String: ChatWidgetActionEntry]
    let fields: [String: ChatWidgetField]
    /// The fields a Label node names: their own `label` is not drawn twice.
    let labelled: Set<String>
    let initial: ChatWidgetValues

    @Published var edits: ChatWidgetValues = [:]
    /// The ref being sent, until the server answers.
    @Published var pending: String?
    /// The ref whose press just went through without settling the card.
    @Published var sent: String?
    @Published var problem: (text: String, field: String?)?
    @Published var imagesAllowed = false
    /// Settled, or drawn read-only in Details: nothing takes input.
    @Published var settled = false
    /// Too narrow for a label and a field side by side (under 400 pt).
    @Published var compact = true
    var press: (String) -> Void = { _ in }

    init(root: ChatWidgetNode, messageId: String) {
        self.root = root
        self.messageId = messageId
        let entries = ChatWidgetRules.actions(root)
        actions = Dictionary(entries.map { ($0.ref, $0) }, uniquingKeysWith: { first, _ in first })
        fields = Dictionary(ChatWidgetRules.fields(root).map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
        labelled = ChatWidgetRules.labelledFields(root)
        initial = ChatWidgetRules.initialValues(root)
    }

    var locked: Bool { settled || pending != nil }

    func value(_ name: String, overlay: ChatWidgetValues? = nil) -> ChatWidgetValue? {
        overlay?[name] ?? edits[name] ?? initial[name]
    }

    func text(_ name: String) -> String { value(name)?.text ?? "" }
    func flag(_ name: String) -> Bool { value(name)?.flag == true }

    func set(_ name: String, _ value: ChatWidgetValue) {
        guard !locked else { return }
        edits[name] = value
        if problem?.field == name { problem = nil }
    }

    var values: ChatWidgetValues { initial.merging(edits) { _, edit in edit } }

    /// Whether a press on this action does anything now. A link still opens
    /// from a settled card; everything else waits for an unlocked one.
    func canPress(_ entry: ChatWidgetActionEntry?) -> Bool {
        guard let entry else { return false }
        return entry.client ? pending == nil : !locked
    }
}

struct ChatWidgetCard: View {
    let botId: String
    let threadId: String
    let messageId: String
    let payload: ChatWidgetPayload
    let root: ChatWidgetNode

    @EnvironmentObject private var session: Session
    @Environment(\.openURL) private var openURL
    @Environment(\.desktopChatText) private var desktop
    @StateObject private var form: ChatWidgetForm
    @StateObject private var detailsForm: ChatWidgetForm
    /// Settled by a press from this card, ahead of the patch frame.
    @State private var settledHere: ChatWidgetSettled?
    /// The row has said it is settled since this card's last press: from
    /// then on its word is the only one (a cancelled queued press reopens it).
    @State private var rowSpoke = false
    @State private var details = false
    /// A press that got no answer goes again under the same sendId.
    @State private var retry: (key: String, sendId: String)?
    @State private var sentClear: Task<Void, Never>?

    init(botId: String, threadId: String, messageId: String, payload: ChatWidgetPayload, root: ChatWidgetNode) {
        self.botId = botId
        self.threadId = threadId
        self.messageId = messageId
        self.payload = payload
        self.root = root
        _form = StateObject(wrappedValue: ChatWidgetForm(root: root, messageId: messageId))
        _detailsForm = StateObject(wrappedValue: ChatWidgetForm(root: root, messageId: messageId))
    }

    private var ink: ChatWidgetInk { .of(desktop) }
    private var settled: ChatWidgetSettled? { payload.settled ?? (rowSpoke ? nil : settledHere) }

    var body: some View {
        Group {
            if let settled {
                settledLine(settled)
            } else {
                card(form: form)
            }
        }
        .onAppear {
            if payload.settled != nil { rowSpoke = true }
            form.press = { ref in press(ref) }
            detailsForm.press = { ref in
                // read-only: only a link still opens
                if let url = detailsForm.actions[ref]?.url { openURL(url) }
            }
        }
        .onValueChange(of: payload.settled) { value in
            if value != nil {
                rowSpoke = true
                form.pending = nil
            }
        }
    }

    // MARK: - The card

    private func card(form: ChatWidgetForm) -> some View {
        let title = root.string("title")
        let caption = root.string("caption")
        let meta = root.string("meta")
        let status = root["status"]?.object
        let statusText = status?["text"]?.string
        let headed = title != nil || caption != nil || meta != nil || statusText != nil
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                if headed {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            if let statusText {
                                HStack(spacing: 6) {
                                    if let icon = status?["icon"]?.string {
                                        ChatWidgetGlyph(name: icon, size: 13)
                                    }
                                    Text(verbatim: statusText).lineLimit(1)
                                }
                                .font(ink.font(12.5, .semibold))
                                .foregroundStyle(ink.accentText)
                                .padding(.bottom, title != nil || caption != nil ? 2 : 0)
                            }
                            if let title {
                                Text(verbatim: title)
                                    .font(ink.font(15, .semibold))
                                    .foregroundStyle(ink.ink)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                            }
                            if let caption {
                                Text(verbatim: caption)
                                    .font(ink.font(13))
                                    .foregroundStyle(ink.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if let meta {
                            Text(verbatim: meta)
                                .font(ink.font(12))
                                .monospacedDigit()
                                .foregroundStyle(ink.tertiary)
                                .lineLimit(1)
                                .padding(.top, 3)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, root.children.isEmpty ? 14 : 12)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }
                ChatWidgetBody(root: root, headed: headed)
                if let problem = form.problem {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.circle")
                            .font(.system(size: 13))
                        Text(verbatim: problem.text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .font(ink.font(13))
                    .foregroundStyle(ink.danger)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Rectangle().fill(ink.ink.opacity(0.12)).frame(height: 1).padding(.horizontal, 16) }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("widget-problem")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ink.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(ink.ring, lineWidth: 1))
            .opacity(form.pending != nil ? 0.55 : 1)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { form.compact = proxy.size.width < 400 }
                        .onValueChange(of: proxy.size.width) { width in form.compact = width < 400 }
                }
            )
            if !form.settled, form.actions["confirm"] != nil || form.actions["cancel"] != nil {
                ChatWidgetFlow(spacing: 8) {
                    if let confirm = form.actions["confirm"] {
                        ChatWidgetButton(actionRef: "confirm", label: confirm.label, look: "primary", tall: true)
                    }
                    if let cancel = form.actions["cancel"] {
                        ChatWidgetButton(actionRef: "cancel", label: cancel.label, look: "outline", tall: true)
                    }
                }
            }
        }
        .frame(maxWidth: desktop == nil ? .infinity : 600, alignment: .leading)
        .environmentObject(form)
        .environment(\.chatWidgetInk, ink)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title ?? statusText ?? String(localized: "Card from your bot")))
        .accessibilityValue(Text(form.pending != nil ? "Sending" : form.sent != nil ? "Sent" : ""))
        .accessibilityIdentifier("widget-\(messageId)")
    }

    /// One tick line with the label, and Details for the card as answered.
    private func settledLine(_ settled: ChatWidgetSettled) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: settled.tone == "cancel" ? "xmark" : "checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(settled.tone == "cancel" ? ink.secondary : ink.success)
                Text(verbatim: settled.label)
                    .font(ink.font(14))
                    .foregroundStyle(ink.ink)
                    .lineLimit(2)
                Spacer(minLength: 8)
                Button(details ? String(localized: "Hide details") : String(localized: "Details")) {
                    details.toggle()
                }
                .font(ink.font(13, .medium))
                .foregroundStyle(ink.secondary)
                .frame(minHeight: 44)
                .accessibilityIdentifier("widget-details-\(messageId)")
            }
            .padding(.horizontal, 14)
            .background(ink.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(ink.ring, lineWidth: 1))
            if details {
                card(form: detailsForm)
                    .onAppear {
                        detailsForm.settled = true
                        detailsForm.edits = settled.values ?? [:]
                    }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("widget-settled-\(messageId)")
    }

    // MARK: - A press

    private func press(_ ref: String) {
        guard let entry = form.actions[ref], form.pending == nil else { return }
        if entry.client {
            if let place = entry.appAction {
                // An in-app place opens here at once; the press is then
                // recorded for the bot as already done (it starts no turn).
                session.openWidgetAppAction(place, botId: botId)
                Task {
                    _ = await session.sendWidgetAction(
                        botId: botId, threadId: threadId, messageId: messageId, ref: ref, rev: payload.rev,
                        values: nil, sendId: UUID().uuidString.lowercased()
                    )
                }
                return
            }
            // open_url: opens on this device and is never sent
            if let url = entry.url { openURL(url) }
            return
        }
        guard settled == nil, !form.settled else { return }
        let (sending, missing) = ChatWidgetRules.valuesToSend(root, entry: entry, values: form.values)
        if let missing {
            form.problem = (String(localized: "\(missing.label) is required."), missing.name)
            return
        }
        let key = "\(ref)\n\(sending.map { String(describing: $0.sorted { $0.key < $1.key }) } ?? "-")"
        let sendId = retry?.key == key ? retry!.sendId : UUID().uuidString.lowercased()
        retry = (key, sendId)
        rowSpoke = false
        settledHere = nil
        form.problem = nil
        form.sent = nil
        form.pending = ref
        Task {
            let result = await session.sendWidgetAction(
                botId: botId, threadId: threadId, messageId: messageId, ref: ref, rev: payload.rev,
                values: sending, sendId: sendId
            )
            switch result {
            case .sent:
                retry = nil
                if let tone = entry.tone {
                    // taken: fold now from what was pressed and sent
                    settledHere = ChatWidgetSettled(
                        ref: ref, label: entry.label, tone: tone, at: Date().timeIntervalSince1970 * 1000,
                        sendId: sendId, values: sending
                    )
                    form.settled = true
                    form.pending = nil
                } else {
                    form.pending = nil
                    form.sent = ref
                    sentClear?.cancel()
                    sentClear = Task {
                        try? await Task.sleep(nanoseconds: 1_600_000_000)
                        if !Task.isCancelled { form.sent = nil }
                    }
                }
            case let .failed(refused, message):
                // a refusal is an answer: the next press is a new one
                if refused { retry = nil }
                form.pending = nil
                form.problem = (message ?? String(localized: "That did not send. Try again."), nil)
            }
        }
    }
}

// MARK: - Environment

private struct ChatWidgetInkKey: EnvironmentKey {
    static var defaultValue: ChatWidgetInk { .of(nil) }
}

extension EnvironmentValues {
    var chatWidgetInk: ChatWidgetInk {
        get { self[ChatWidgetInkKey.self] }
        set { self[ChatWidgetInkKey.self] = newValue }
    }
}
