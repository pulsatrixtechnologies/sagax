import Foundation

// #3465: the demo's proactive choices, so Settings, « Ce que je reçois », a
// bot's « Ce que ce bot suit pour toi » and the choice card can be seen and
// captured with no server. Made-up and in memory only: nothing is on until
// the person turns it on, as on a server.
extension DemoServer {
    private var proactiveReceive: [String: Any] {
        let t = language.pick
        let now = Date().timeIntervalSince1970 * 1000
        return [
            "bots": [["id": "demo-atlas", "brief": true], ["id": "demo-pixel", "brief": false, "checklist": true]],
            "domains": [
                [
                    "domain": "dispatch", "label": ["en": "Dispatch", "fr": "Répartition"],
                    "carriers": ["demo-atlas", "demo-pixel"],
                    "watches": [
                        ["id": "dispatch.unassigned", "summary": t("Tickets with no technician", "Billets sans technicien"), "cadence": "15m",
                         "runsOn": ["demo-atlas", "demo-pixel"], "lastAlertAt": now - 42 * 60_000],
                        ["id": "dispatch.late", "summary": t("Tickets past their due time", "Billets en retard"), "cadence": "daily@8:00",
                         "runsOn": ["demo-atlas", "demo-pixel"]],
                    ],
                    "lastAlertAt": now - 42 * 60_000,
                ],
                [
                    "domain": "security", "label": ["en": "Security", "fr": "Sécurité"], "carriers": ["demo-pixel"],
                    "watches": [["id": "security.threats", "summary": t("New threats on a device", "Nouvelles menaces sur un poste"),
                                 "cadence": "1h", "runsOn": ["demo-pixel"]]],
                ],
            ],
        ]
    }

    func proactiveChoicesResponse(method: String, json: [String: Any]) -> Response {
        lock.lock(); defer { lock.unlock() }
        if method == "PUT", let domain = json["domain"] as? String {
            var row = proactiveDemoChoices[domain] ?? ["state": "off", "at": 1, "via": "settings", "by": "demo"]
            if let watch = json["watch"] as? String, let on = json["on"] as? Bool {
                var off = row["watchesOff"] as? [String: Any] ?? [:]
                off[watch] = on ? nil : ["at": 1, "via": "settings"]
                row["watchesOff"] = off
            } else if let state = json["state"] as? String {
                row["state"] = state
                row["botId"] = state == "on" ? (json["botId"] as? String ?? "demo-atlas") : nil
            }
            proactiveDemoChoices[domain] = row
        } else if method != "GET" {
            return refusal(status: 405)
        }
        let body: [String: Any] = ["domains": proactiveDemoChoices, "available": [], "receive": proactiveReceive]
        return .init(status: 200, body: (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8))
    }

    /// Answers a choice card (`POST /api/bots/:id/proactive/:p[/feedback]`).
    func proactiveAnswerResponse(parts: [String], json: [String: Any]) -> Response {
        let t = language.pick
        lock.lock(); defer { lock.unlock() }
        let feedback = parts.count == 6
        let accept = json["accept"] as? Bool ?? false
        let words = feedback ? t("Never suggest again", "Ne plus proposer") : (accept ? t("Yes", "Oui") : t("Not now", "Pas maintenant"))
        if feedback { proactiveDemoChoices["dispatch"] = ["state": "never", "at": 1, "via": "card", "by": "demo"] }
        if accept { proactiveDemoChoices["dispatch"] = ["state": "on", "botId": parts[2], "at": 1, "via": "card", "by": "demo"] }
        return .init(status: 200, body: Data((#"{"ok":true,"answered":"# + "\"\(words)\"}").utf8))
    }

    /// The choice card a bot posts when a domain fits (the screenshot of
    /// `-demo-proactive-card`), at the end of the first bot's conversation.
    public func addProactiveChoiceCard() {
        let t = language.pick
        let json: [String: Any] = [
            "id": "demo-proactive-choice", "role": "bot", "kind": "options", "at": Date().timeIntervalSince1970 * 1000,
            "card": [
                "title": t("Receive Dispatch alerts?", "Recevoir les alertes de répartition ?"),
                "subtitle": t("Tickets with no technician (every 15 min). On Pixel, only if you say yes.",
                              "Billets sans technicien (aux 15 min). Sur Pixel, seulement si tu dis oui."),
                "options": [t("Yes", "Oui"), t("Not now", "Pas maintenant")],
                "proactiveProposal": ["id": "demo-pp-1"],
                "proactiveChoice": [
                    "domain": "dispatch", "label": t("Dispatch", "Répartition"), "botName": "Pixel",
                    "watches": [
                        ["id": "dispatch.unassigned", "label": t("Tickets with no technician", "Billets sans technicien"),
                         "cadence": t("every 15 min", "aux 15 min"), "on": true, "tools": ["find_tickets"]],
                        ["id": "dispatch.late", "label": t("Tickets past their due time", "Billets en retard"),
                         "cadence": t("every day at 08:00", "chaque jour à 08:00"), "on": false, "tools": ["find_tickets", "find_schedule_entries"]],
                    ],
                ],
            ],
        ]
        // an alert of a chosen watch before it, with its two exits
        let alert: [String: Any] = [
            "id": "demo-watch-alert", "role": "bot", "kind": "routine.run", "at": Date().timeIntervalSince1970 * 1000 - 60_000,
            "text": t("2 tickets have no technician.", "2 billets n'ont pas de technicien."),
            "routineRun": [
                "runId": "demo-watch-run", "routineId": "demo-watch", "routineName": t("Dispatch", "Répartition"),
                "status": "completed", "wakeTopic": "watch",
                "summary": t("2 tickets have no technician since this morning.", "2 billets n'ont pas de technicien depuis ce matin."),
                "watches": [["id": "dispatch.unassigned", "domain": "dispatch"]],
            ],
        ]
        lock.lock(); defer { lock.unlock() }
        guard let index = bots.firstIndex(where: { $0.id == "demo-pixel" }) else { return }
        for json in [alert, json] {
            var row = json
            // on the conversation's active branch, after its last message
            if let last = bots[index].activeLeafId ?? bots[index].messages?.last?.id { row["parentId"] = last }
            guard let data = try? JSONSerialization.data(withJSONObject: row),
                  let message = try? JSONDecoder().decode(Message.self, from: data) else { continue }
            bots[index].messages = (bots[index].messages ?? []) + [message]
            bots[index].activeLeafId = message.id
        }
    }
}
