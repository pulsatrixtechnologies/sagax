// #3712: one live turn, frame by frame, for the captures of where the bot's
// text is drawn while it works (the desktop's src/gallery/live-note.tsx, the
// same script and words). DEBUG only, with the store preview:
// `-store-preview -live-note-preview <frame> -previewOpenBot reviewer`.
// Every name and text is synthetic. Not shipped.
#if DEBUG
import CompanionCore
import Foundation

enum LiveNotePreview {
    static let frames = [
        "first-words", "short-sentence", "first-step", "second-step",
        "answer-first-words", "answer-opened", "turn-ended",
        // #4066: the note while the reasoning streams (Tool calls on), and a
        // note of nearly `LiveTextPlace.lineTextMax` units on the line
        "note-reasoning", "long-note",
        // #4066: a long answer with Markdown, still streaming, and settled
        "answer-markdown", "answer-markdown-ended",
    ]
    static let botId = "reviewer"
    static let threadId = "reviewer-thread"

    struct Scene {
        let fleet: Fleet
        /// The text being written now, if any.
        let streaming: String?
        /// The reasoning streaming now, if any (#4066).
        var reasoning: String? = nil
    }

    /// The frame named after `-live-note-preview`, if any.
    static func frame(in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: "-live-note-preview"), index + 1 < arguments.count,
              frames.contains(arguments[index + 1]) else { return nil }
        return arguments[index + 1]
    }

    static func scene(_ frame: String, french: Bool) -> Scene? {
        func say(_ en: String, _ fr: String) -> String { french ? fr : en }
        let now = (Date().timeIntervalSince1970 * 1000).rounded()
        let start = now - 60_000
        let note = say("Yes, I will check the request and its notes.", "Oui, je vérifie la demande et ses notes.")
        let answer = say(
            "Ticket 1042: the printer on the second floor has failed three times since Monday. Two of its notes repeat ticket 1040, which is still open. I suggest merging 1042 into 1040 and ordering the part.",
            "Billet 1042 : l'imprimante du 2e étage a fait défaut trois fois depuis lundi. Deux de ses notes reprennent le billet 1040, encore ouvert. Je te propose de fusionner 1042 dans 1040 et de commander la pièce."
        )
        func words(_ body: String, _ count: Int) -> String { body.split(separator: " ").prefix(count).joined(separator: " ") }
        func user(_ id: String, _ at: Double, _ text: String) -> [String: Any] {
            ["id": id, "role": "user", "kind": "text", "at": at, "text": text]
        }
        func text(_ id: String, _ at: Double, _ body: String, turn: String = "t", terminal: Bool = false) -> [String: Any] {
            var row: [String: Any] = ["id": id, "role": "bot", "kind": "text", "at": at, "text": body, "turnId": turn]
            if terminal { row["turnTerminal"] = true }
            return row
        }
        func step(_ id: String, _ at: Double, _ name: String, _ input: String, key: String, detail: String?, ok: Bool?) -> [String: Any] {
            var stepped: [String: Any] = ["key": key]
            if let detail { stepped["detail"] = detail }
            var tool: [String: Any] = ["name": name, "input": input, "step": stepped]
            if let ok { tool["ok"] = ok; tool["durationMs"] = 1_400 }
            return ["id": id, "role": "bot", "kind": "activity", "at": at, "turnId": "t", "tool": tool]
        }
        let earlier = [
            user("e-u", start - 600_000, say("Hi, are you there?", "Salut, es-tu là?")),
            text("e-a", start - 598_000, say("Yes, what can I do for you?", "Oui, qu'est-ce que je peux faire pour toi?"), turn: "e", terminal: true),
            user("u", start, say("Summarize ticket 1042 and tell me what to do with it.", "Résume le billet 1042 et dis-moi quoi en faire.")),
        ]
        let n1 = text("n1", start + 2_000, note)
        let readInput = #"{"file_path":"/srv/notes/1042.md"}"#
        let searchInput = #"{"query":"printer model 4250 fuser error"}"#
        let readRunning = step("s1", start + 4_000, "Read", readInput, key: "readFile", detail: "1042.md", ok: nil)
        let read = step("s1", start + 4_000, "Read", readInput, key: "readFile", detail: "1042.md", ok: true)
        let searchRunning = step("s2", start + 9_000, "WebSearch", searchInput, key: "searchWeb", detail: nil, ok: nil)
        let search = step("s2", start + 9_000, "WebSearch", searchInput, key: "searchWeb", detail: nil, ok: true)
        let longNote = say(
            "I read the request, its notes and the two tickets it points to, then I come back to you with a plan.",
            "Je lis la demande, ses notes et les deux billets liés, puis je reviens vers toi avec un plan clair."
        )
        let thinking = say(
            "The request names ticket 1042. Its notes mention ticket 1040, so both need reading before any answer.",
            "La demande nomme le billet 1042. Ses notes citent le billet 1040 : il faut lire les deux avant de répondre."
        )
        let markdown = say(
            "## Ticket 1042\n\nThe printer on the **second floor** has failed three times since Monday.\n\n- Two of its notes repeat ticket 1040, which is *still open*.\n- The fuser error matches the `4250` model.\n\nI suggest merging 1042 into 1040 and ordering the part. Then I will",
            "## Billet 1042\n\nL'imprimante du **2e étage** a fait défaut trois fois depuis lundi.\n\n- Deux de ses notes reprennent le billet 1040, *encore ouvert*.\n- L'erreur de l'unité de fusion correspond au modèle `4250`.\n\nJe te propose de fusionner 1042 dans 1040 et de commander la pièce. Ensuite je vais"
        )
        let table: [String: (rows: [[String: Any]], streaming: String?, busy: Bool)] = [
            "first-words": ([], words(note, 2), true),
            "short-sentence": ([], note, true),
            "first-step": ([n1, readRunning], nil, true),
            "second-step": ([n1, read, searchRunning], nil, true),
            "answer-first-words": ([n1, read, search], words(answer, 4), true),
            "answer-opened": ([n1, read, search], words(answer, 24), true),
            "turn-ended": ([n1, read, search, text("a", start + 40_000, answer, terminal: true)], nil, false),
            "note-reasoning": ([n1], nil, true),
            "answer-markdown": ([n1, read, search], markdown, true),
            "answer-markdown-ended": ([n1, read, search, text("a", start + 40_000, markdown, terminal: true)], nil, false),
            "long-note": ([text("n1", start + 2_000, longNote)], nil, true),
        ]
        guard let current = table[frame] else { return nil }
        var rows = earlier + current.rows
        for index in rows.indices { rows[index]["parentId"] = index > 0 ? rows[index - 1]["id"]! : NSNull() }
        var task: [String: Any] = ["threadId": threadId, "title": "Reviewer", "createdAt": start - 3_600_000, "busy": current.busy]
        if current.busy { task["turnStartedAt"] = start; task["activity"] = "working" }
        let bot: [String: Any] = [
            "id": botId, "threadId": threadId, "name": "Reviewer", "title": "", "description": "",
            "notifications": true, "color": "purple", "unread": false,
            "modelSelection": ["instanceId": "preview", "model": "m"], "createdAt": start - 3_600_000,
            "busy": current.busy, "activity": current.busy ? "working" : "idle",
            "tasks": [task], "messages": rows, "activeLeafId": rows.last?["id"] ?? NSNull(),
        ]
        let json: [String: Any] = ["bots": [bot], "groups": [], "botQueuedMessages": [:], "sections": []]
        guard let data = try? JSONSerialization.data(withJSONObject: json),
              let fleet = try? JSONDecoder().decode(Fleet.self, from: data) else { return nil }
        return Scene(fleet: fleet, streaming: current.streaming, reasoning: frame == "note-reasoning" ? thinking : nil)
    }
}
#endif
