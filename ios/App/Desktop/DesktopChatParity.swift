// iPad I3: the desktop chat surfaces of the parity harness
// (ios/parity/desktop/surfaces.mjs, "chat"), opened on Ara's chat the way
// the reference opens them: a scroll position, a draft, an open menu, or
// transcript rows injected into this screen only (the reference injects
// them into its page's store; nothing reaches the fixture server).
import SwiftUI
import UIKit
import CompanionCore

extension IPadParityScreen {
    /// Drawn by the desktop chat (DesktopShell opens Ara for these).
    var isDesktopChat: Bool {
        switch self {
        case .chatTop, .chatAttachments, .chatMarkdown, .chatApproval, .chatQuestion, .chatMessageHover,
             .chatComposerDraft, .chatComposerSlash, .chatExportMenu, .chatModelPicker, .chatApprovalMode,
             .chatWhereMenu, .chatFind, .chatThreads, .inspector, .groupChat:
            true
        default:
            false
        }
    }
}

#if DEBUG
enum DesktopChatParity {
    static var screen: IPadParityScreen? { ParityLaunch.current?.iPadScreen }

    /// chat-message-hover: the reply the pointer rests on.
    /// The other references keep the pointer where their capture left it,
    /// the middle of the window: over the reply it rests on there.
    static func forcesHover(_ message: Message) -> Bool {
        let text = message.text ?? ""
        switch screen {
        case .chatMessageHover, .chatApproval, .inspector: return text.contains("Veux-tu que je refasse")
        case .chatMarkdown: return text.hasPrefix("Voici le tableau de remplacement")
        case .chatQuestion: return text == "Planifie la sauvegarde."
        default: return false
        }
    }

    /// Which row the scroll is read from, and where its edge sits on the
    /// reference (window points; refs/*.json): chat-top, the top of the
    /// "Voici les références" row; chat-attachments, the bottom of the
    /// "Les deux captures" bubble, per window size.
    static var scrollTarget: (prefix: String, edge: CGFloat, bottom: Bool)? {
        switch screen {
        case .chatTop:
            return ("Voici les références", 45.5 - 7 - 12, false)
        case .chatAttachments:
            let size = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen.bounds.size }.first ?? .zero
            let wide = max(size.width, size.height) > 1300
            let landscape = size.width > size.height
            // read from the reference (surfaces.mjs centres the bubble)
            let bottom: CGFloat = wide ? (landscape ? 637 : 685) : (landscape ? 434 : 610.59)
            return ("Les deux captures de remplacement", bottom, true)
        default:
            return nil
        }
    }

    /// The probe in the row the reference's scroll is read from (in the
    /// live topic or an earlier one).
    @ViewBuilder
    static func rowProbe(_ row: TranscriptRow, desktop: Bool) -> some View {
        if desktop, let target = scrollTarget, row.head.role == .bot, (row.head.text ?? "").hasPrefix(target.prefix) {
            ParityRowProbe()
        }
    }

    /// The find bar draws as focused without taking the keyboard.
    static var findLooksFocused: Bool { screen == .chatFind }

    /// The composer's open policy menu on its surface.
    static var openMenu: DesktopComposerMenu? {
        switch screen {
        // the desktop's composer has no approval control any more: the
        // approval-mode and model-picker surfaces are the + menu (2026-11-03)
        case .chatApprovalMode, .chatModelPicker: .plus
        default: nil
        }
    }

    static let markdown = """
    Voici le tableau de remplacement demandé, avec un exemple de code :

    | Poste | Responsable | Échéance | État |
    | --- | --- | --- | --- |
    | Sauvegarde | Ara | 3 oct. | Fait |
    | Migration | Keepler | 10 oct. | En cours |
    | Documentation | Lux | 17 oct. | À faire |

    ```ts
    export function prochainLundi(date: Date): Date {
      const jour = date.getDay();
      const ecart = (8 - jour) % 7 || 7;
      return new Date(date.getTime() + ecart * 86_400_000);
    }
    ```

    1. **Gras** et *italique* pour la forme.
    2. Un lien : [documentation](https://docs.example.com).

    > Une citation courte, en texte de remplacement.
    """

    /// The rows surfaces.mjs injects, as wire JSON.
    static var injected: [[String: Any]] {
        switch screen {
        case .chatMarkdown:
            return [
                ["role": "user", "kind": "text", "text": "Montre-moi le tableau."],
                ["role": "bot", "kind": "text", "text": markdown, "turnTerminal": true],
            ]
        case .chatApproval:
            return [
                ["role": "user", "kind": "text", "text": "Pousse la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Run a command?", "subtitle": "git push origin main",
                    "options": ["Deny", "Always allow", "Allow once"], "requestId": "parity-req-1", "tool": "Bash",
                    "allowKey": "Bash:git",
                    "commandAllowlist": ["command": "git push origin main", "cwd": "/workspace/fixture", "providerInstanceId": "claude"],
                ] as [String: Any]],
            ]
        case .chatQuestion:
            return [
                ["role": "user", "kind": "text", "text": "Planifie la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Question", "subtitle": "", "options": ["Dimanche soir", "Lundi matin", "Chaque jour"],
                    "requestId": "parity-req-2", "tool": "AskUserQuestion",
                    "questionRequest": ["version": 1, "questions": [[
                        "question": "Quand faut-il refaire la sauvegarde ?", "header": "Horaire", "multiSelect": false,
                        "options": [
                            ["label": "Dimanche soir", "description": "Une fois par semaine, à 21 h."],
                            ["label": "Lundi matin", "description": "Avant la réunion d'équipe."],
                            ["label": "Chaque jour", "description": "À 2 h, en dehors des heures de travail."],
                        ],
                    ]]] as [String: Any],
                ] as [String: Any]],
            ]
        default:
            return []
        }
    }
}

extension ChatView {
    /// Opens this chat's parity surface once the transcript has settled
    /// (after the newest-message settle at 150 and 450 ms).
    func desktopParityLaunch(_ proxy: ScrollViewProxy) async {
        guard desktopChat != nil, let screen = DesktopChatParity.screen, screen.isDesktopChat else { return }
        for _ in 0..<100 where messages.isEmpty {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let rows = DesktopChatParity.injected
        // The rows exist only in this screen's state: a page of the thread
        // read again after the first one (the event stream's resync) drops
        // them, so they go back in until they stay.
        func inject() {
            let base = messages.filter { !$0.id.hasPrefix("parity-desktop-") }
            var parent = base.last?.id
            var at = base.last.map { $0.at } ?? Date().timeIntervalSince1970 * 1000
            for (index, row) in rows.enumerated() {
                at += 60_000
                var wire = row
                wire["id"] = "parity-desktop-\(index + 1)"
                wire["at"] = at
                if let parent { wire["parentId"] = parent }
                guard let data = try? JSONSerialization.data(withJSONObject: wire),
                      let message = try? JSONDecoder().decode(Message.self, from: data) else { continue }
                session.parityApply(.message(threadId: threadId, message: message))
                parent = message.id
            }
        }
        if !rows.isEmpty {
            inject()
            for _ in 0..<8 {
                try? await Task.sleep(nanoseconds: 400_000_000)
                if !messages.contains(where: { $0.id == "parity-desktop-\(rows.count)" }) {
                    inject()
                    proxy.scrollTo(Self.bottomId, anchor: .bottom)
                }
            }
        }
        try? await Task.sleep(nanoseconds: 900_000_000)
        switch screen {
        case .chatTop, .chatAttachments:
            // The reference's scroll, read from its DOM dump: the row of
            // "Voici les références" (its 12 pt gap, then the bubble) starts
            // at this window y. Again as late layout settles.
            guard let desired = DesktopChatParity.scrollTarget else { return }
            // the end must not re-arm the follow while the scroll leaves it:
            // its content-size pin would pull the transcript back down
            follow.hold()
            // the lazy transcript draws the row only once it is near the
            // screen: bring it there first, then set its exact edge
            // the row may be on an earlier page: read back until it is in
            // (the reference scrolls up, which loads them the same way)
            // or in an earlier topic of the one conversation
            func matches(_ row: TranscriptRow) -> Bool { row.head.role == .bot && (row.head.text ?? "").hasPrefix(desired.prefix) }
            func target() -> TranscriptRow? {
                if let live = self.rows.first(where: matches) { return live }
                for topic in earlierTopics.prefix(earlierTopicsShown) {
                    let rows = transcriptRows(session.state.visibleTranscript(forThread: topic.threadId), detail: toolCalls.detail, showThreads: false, threadBotId: current.id)
                    if let hit = rows.first(where: matches) { return hit }
                }
                return nil
            }
            for _ in 0..<8 where target() == nil && session.state.hasMore[threadId] == true {
                await session.loadOlder(threadId: threadId)
            }
            while target() == nil, earlierTopicsShown < earlierTopics.count {
                earlierTopicsShown += 1
                await session.loadThreadIfNeeded(earlierTopics[earlierTopicsShown - 1].threadId)
            }
            let row = target()
            // several passes: late answers (engines, achievements) re-pin
            // the transcript to its end, as on the reference (twice there)
            for pass in 0..<10 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(nanoseconds: pass == 0 ? 0 : 500_000_000)
                follow.pause()
                guard let row else { return }
                // SwiftUI owns the scroll position (a UIKit offset is undone
                // at the next layout): ask it for the anchor that puts the
                // row's edge at the reference's y
                let anchor = ParityRowProbe.anchor(edge: desired.edge, bottom: desired.bottom) ?? .top
                proxy.scrollTo(row.id, anchor: anchor)
                follow.pause()
                try? await Task.sleep(nanoseconds: 200_000_000)
                follow.pause()
            }

        case .chatComposerDraft:
            // the simulator's software keyboard would cover the screen: the
            // draft without the focus (the reference hides its caret anyway)
            draft = "Brouillon de remplacement : vérifie la sauvegarde de dimanche\net envoie le résumé à l'équipe."
        case .chatComposerSlash:
            draft = "/"
        case .chatFind:
            openFind()
            finder.query = "sauvegarde"
            // the fixture's search index can lag its first messages: ask
            // again until the hits are in
            for _ in 0..<10 {
                try? await Task.sleep(nanoseconds: 800_000_000)
                if !finder.hits.isEmpty { break }
                finder.queryChanged(threadId: threadId, session: session)
            }
        default:
            if !rows.isEmpty { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
        }
    }

    /// chat-top / chat-attachments: a probe in the row the reference's
    /// scroll position is read from ("Voici les références", the reply under
    /// the first question).
    @ViewBuilder
    func desktopParityRowProbe(_ row: TranscriptRow) -> some View {
        DesktopChatParity.rowProbe(row, desktop: desktopChat != nil)
    }

    /// The transcript row that holds this message (a folded turn holds several).
    private func rowId(for message: Message) -> String {
        rows.first { row in
            if case let .activityRun(run) = row { return run.messages.contains { $0.id == message.id } }
            if case let .voiceCall(card) = row { return card.messages.contains { $0.id == message.id } }
            return row.id == message.id
        }?.id ?? message.id
    }
}

/// A UIKit view inside the probed row: where it is in the window, and the
/// transcript's scroll view around it.
struct ParityRowProbe: UIViewRepresentable {
    private static weak var current: UIView?

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        Self.current = view
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { Self.current = view }

    /// The probed row is drawn.
    @MainActor
    static var ready: Bool { current?.window != nil }

    /// The unit point of the probed row whose `scrollTo` puts its top (or
    /// bottom) edge at `y` in the window: `scrollTo` lines up the same unit
    /// point of the row and of the visible area, so for a row of height h in
    /// an area of height V starting at window y0, the top lands at
    /// y0 + a (V - h): a = (y - y0) / (V - h) (the bottom: (y - y0 - h) / (V - h)).
    @MainActor
    static func anchor(edge y: CGFloat, bottom: Bool) -> UnitPoint? {
        guard let probe = current, probe.window != nil else { return nil }
        var view = probe.superview
        while let candidate = view, !(candidate is UIScrollView) { view = candidate.superview }
        guard let scroll = view as? UIScrollView else { return nil }
        let insets = scroll.adjustedContentInset
        let top = scroll.convert(CGPoint(x: 0, y: scroll.bounds.minY + insets.top), to: nil).y
        let visible = scroll.bounds.height - insets.top - insets.bottom
        let height = probe.bounds.height
        guard visible - height > 1 else { return .top }
        let a = (y - top - (bottom ? height : 0)) / (visible - height)
        return UnitPoint(x: 0.5, y: a)
    }
}


#endif

