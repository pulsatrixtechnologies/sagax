import Foundation
import XCTest
@testable import CompanionCore

private final class ChoicesRequestStub: URLProtocol {
    static var requests: [(URLRequest, Data?)] = []
    static var answer = Data("{}".utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request, Self.readBody(from: request)))
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.answer)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func readBody(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

/// #3465 (lot 8 of #3408): the choice card's three answers on the phone,
/// and the person's choices read and written in the desktop's store.
final class ProactiveChoicesTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        ChoicesRequestStub.requests = []
        ChoicesRequestStub.answer = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ChoicesRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        client = nil
        super.tearDown()
    }

    private func body(_ index: Int) throws -> [String: Any] {
        let data = try XCTUnwrap(ChoicesRequestStub.requests[index].1)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private let choiceJSON = #"""
    {"title":"Recevoir les alertes de répartition ?","subtitle":"Billets sans technicien (aux 15 min). Sur Nova, seulement si tu dis oui.",
     "options":["Oui","Pas maintenant"],"proactiveProposal":{"id":"pp-1"},
     "proactiveChoice":{"domain":"dispatch","label":"Répartition","botName":"Nova","watches":[
       {"id":"dispatch.unassigned","label":"Billets sans technicien","cadence":"aux 15 min","on":true,"tools":["tickets_read"]},
       {"id":"dispatch.sla","label":"Délais dépassés","cadence":"chaque heure","on":false,"tools":[]},
       {"label":"no id: dropped"}]}}
    """#

    // MARK: the card

    func testChoiceCardDecodesItsDomainAndWatches() throws {
        let card = try JSONDecoder().decode(OptionCard.self, from: Data(choiceJSON.utf8))
        XCTAssertTrue(ProactiveProposalRules.isChoice(card))
        XCTAssertEqual(card.proactiveChoice?.label, "Répartition")
        XCTAssertEqual(card.proactiveChoice?.botName, "Nova")
        XCTAssertEqual(card.proactiveChoice?.watches.map(\.id), ["dispatch.unassigned", "dispatch.sla"])
        XCTAssertEqual(card.proactiveChoice?.watches.map(\.on), [true, false])
        // a plain proposal is not a choice card
        let plain = try JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"T","subtitle":"","options":["Yes","No"],"proactiveProposal":{"id":"p"}}"#.utf8))
        XCTAssertFalse(ProactiveProposalRules.isChoice(plain))
    }

    func testChoiceCardOffersItsThreeAnswers() throws {
        var card = try JSONDecoder().decode(OptionCard.self, from: Data(choiceJSON.utf8))
        // « Oui » is options[0], « Pas maintenant » options[1], « Ne plus proposer » the feedback row
        XCTAssertTrue(ProactiveProposalRules.accepts(card, answer: "Oui"))
        XCTAssertFalse(ProactiveProposalRules.accepts(card, answer: "Pas maintenant"))
        XCTAssertFalse(ProactiveProposalRules.neverLabel.isEmpty)
        XCTAssertFalse(ProactiveProposalRules.isFolded(card))
        XCTAssertFalse(ProactiveProposalRules.saidNever(card))
        card.feedback = "never"
        XCTAssertTrue(ProactiveProposalRules.saidNever(card))
        // answered, the card folds to its receipt: a yes is marked accepted
        card.answered = "Oui"
        XCTAssertTrue(ProactiveProposalRules.isFolded(card))
        XCTAssertTrue(ProactiveProposalRules.receiptAccepted(card))
        card.answered = "Pas maintenant"
        XCTAssertFalse(ProactiveProposalRules.receiptAccepted(card))
        card.answered = "Oui"
        card.expired = true
        XCTAssertFalse(ProactiveProposalRules.receiptAccepted(card))
    }

    func testYesWithEverySwitchOffCannotBeSent() throws {
        let card = try JSONDecoder().decode(OptionCard.self, from: Data(choiceJSON.utf8))
        XCTAssertTrue(ProactiveProposalRules.canSayYes(card, switches: [:]))
        XCTAssertFalse(ProactiveProposalRules.canSayYes(card, switches: ["dispatch.unassigned": false]))
        XCTAssertTrue(ProactiveProposalRules.canSayYes(card, switches: ["dispatch.unassigned": false, "dispatch.sla": true]))
    }

    /// #3465: a watch's tool reads as what it does in its product, in the
    /// card's language, the desktop's `watchToolLabel`: never the English
    /// name of the tool on a French card.
    func testWatchToolReadsAsItsActionInTheCardsLanguage() {
        let catalog: [String: [String: String]] = [
            "en": ["approval.verb.read": "view {resource}", "approval.resource.tickets": "tickets", "approval.phrase.inProduct": "{action} in {product}"],
            "fr": ["approval.verb.read": "consulter {resource}", "approval.resource.tickets": "les billets", "approval.phrase.inProduct": "{action} dans {product}"],
        ]
        func words(_ language: String) -> StepWords {
            StepWords(locale: Locale(identifier: language)) { catalog[language]?[$0] }
        }
        let english = ProactiveProposalRules.toolWords("find_tickets", words: words("en"))
        let french = ProactiveProposalRules.toolWords("find_tickets", words: words("fr"))
        XCTAssertEqual(english, "View tickets in Pulsatrix")
        XCTAssertEqual(french, "Consulter les billets dans Pulsatrix")
        XCTAssertFalse(french.contains("Find"))
        // a full tool id reads the same way, never its raw name
        XCTAssertFalse(ProactiveProposalRules.toolWords("mcp__acme__tickets_read", words: words("en")).contains("_"))
    }

    /// #3465: a yes or a « Pas maintenant » the server did not keep (offline,
    /// a conflict) leaves the card open to answer again; only a kept answer
    /// folds it to its receipt.
    func testAnswerTheServerDidNotKeepBringsTheCardBack() {
        XCTAssertEqual(ProactiveProposalRules.heldAnswer("Oui", kept: true), "Oui")
        XCTAssertNil(ProactiveProposalRules.heldAnswer("Oui", kept: false))
        XCTAssertNil(ProactiveProposalRules.heldAnswer("Pas maintenant", kept: false))
    }

    func testYesKeepsTheSwitchesTheCardShows() throws {
        let card = try JSONDecoder().decode(OptionCard.self, from: Data(choiceJSON.utf8))
        XCTAssertEqual(ProactiveProposalRules.watchesOn(card, switches: [:]), ["dispatch.unassigned"])
        XCTAssertEqual(ProactiveProposalRules.watchesOn(card, switches: ["dispatch.sla": true, "dispatch.unassigned": false]), ["dispatch.sla"])
        let bare = try JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"T","subtitle":"","options":["Yes","No"],"proactiveProposal":{"id":"p"},"proactiveChoice":{"domain":"d","label":"D","botName":"B","watches":[]}}"#.utf8))
        XCTAssertNil(ProactiveProposalRules.watchesOn(bare, switches: [:]))
    }

    func testTheThreeAnswersReachTheServerAsOnDesktop() async throws {
        try await client.answerProactiveProposal(botId: "bot-1", proposalId: "pp-1", accept: true, watches: ["dispatch.unassigned"])
        try await client.answerProactiveProposal(botId: "bot-1", proposalId: "pp-1", accept: false, watches: ["dispatch.unassigned"])
        try await client.proactiveProposalFeedback(botId: "bot-1", proposalId: "pp-1", choice: "never")
        XCTAssertEqual(ChoicesRequestStub.requests.count, 3)
        XCTAssertEqual(ChoicesRequestStub.requests[0].0.httpMethod, "POST")
        XCTAssertEqual(ChoicesRequestStub.requests[0].0.url?.path, "/api/bots/bot-1/proactive/pp-1")
        XCTAssertEqual(try body(0)["accept"] as? Bool, true)
        XCTAssertEqual(try body(0)["watches"] as? [String], ["dispatch.unassigned"])
        // "Pas maintenant" carries no watch
        XCTAssertEqual(try body(1)["accept"] as? Bool, false)
        XCTAssertNil(try body(1)["watches"])
        XCTAssertEqual(ChoicesRequestStub.requests[2].0.url?.path, "/api/bots/bot-1/proactive/pp-1/feedback")
        XCTAssertEqual(try body(2)["choice"] as? String, "never")
    }

    // MARK: the choices

    private let answerJSON = #"""
    {"domains":{
       "dispatch":{"state":"on","botId":"bot-1","watchesOff":{"dispatch.sla":{"at":5,"via":"settings"},"bad":{"at":"x"}},"coversReads":true,"at":4,"via":"card","by":"user:1"},
       "security":{"state":"never","at":3,"via":"card","by":"user:1"},
       "backup":{"state":"on","botId":"bot-gone","at":2,"via":"card","by":"user:1"},
       "broken":{"state":"maybe","at":1,"via":"card","by":"user:1"}},
     "available":[],
     "receive":{"bots":[{"id":"bot-1","brief":true,"checklist":false},{"id":"bot-2","brief":false,"screen":true}],
       "domains":[
         {"domain":"dispatch","label":{"fr":"Répartition","en":"Dispatch"},"carriers":["bot-1","bot-2"],"watches":[
           {"id":"dispatch.unassigned","summary":"Unassigned tickets","cadence":"15m","runsOn":["bot-1","bot-2"],"lastAlertAt":1000},
           {"id":"dispatch.sla","summary":"Late tickets","cadence":"daily@8:00","runsOn":["bot-1"]}],"lastAlertAt":1000},
         {"domain":"security","label":{"en":"Security"},"carriers":["bot-2"],"watches":[
           {"id":"security.threats","summary":"New threats","cadence":"1h","runsOn":["bot-2"]}]},
         {"domain":"backup","label":{"fr":"Sauvegardes"},"carriers":["bot-2"],"watches":[
           {"id":"backup.failed","summary":"Failed backups","cadence":"weekly:sun@8:00","runsOn":["bot-2"]}]},
         {"domain":"empty","label":{"en":"Nothing runs"},"carriers":["bot-1"],"watches":[
           {"id":"empty.one","summary":"Not here","cadence":"1h","runsOn":["bot-9"]}]}]}}
    """#

    private func state() throws -> ProactiveReceiveState {
        let answer = try JSONDecoder().decode(ProactiveChoicesAnswer.self, from: Data(answerJSON.utf8))
        return try XCTUnwrap(ProactiveReceiveState(answer))
    }

    func testChoicesDecodeAndDropWhatDoesNotMatch() throws {
        let answer = try JSONDecoder().decode(ProactiveChoicesAnswer.self, from: Data(answerJSON.utf8))
        XCTAssertEqual(Set(answer.domains.keys), ["dispatch", "security", "backup"])
        XCTAssertEqual(answer.domains["dispatch"]?.state, .on)
        XCTAssertEqual(answer.domains["dispatch"]?.botId, "bot-1")
        XCTAssertEqual(answer.domains["dispatch"]?.watchesOff?.keys.sorted(), ["dispatch.sla"])
        XCTAssertEqual(answer.domains["dispatch"]?.coversReads, true)
        XCTAssertEqual(answer.domains["security"]?.state, .never)
        XCTAssertEqual(answer.receive?.bots.map(\.id), ["bot-1", "bot-2"])
        XCTAssertNil(answer.receive?.bots[0].screen)
        XCTAssertEqual(answer.receive?.bots[1].screen, true)
        // an older server without `receive`: nothing to draw
        let older = try JSONDecoder().decode(ProactiveChoicesAnswer.self, from: Data(#"{"domains":{}}"#.utf8))
        XCTAssertNil(ProactiveReceiveState(older))
    }

    func testSettingsRowsFollowTheDesktop() throws {
        let rows = ProactiveReceiveRules.domainRows(try state(), french: true)
        // a domain with no watch running on its carrier is not drawn
        XCTAssertEqual(rows.map(\.domain), ["dispatch", "security", "backup"])
        let dispatch = rows[0]
        XCTAssertEqual(dispatch.label, "Répartition")
        XCTAssertTrue(dispatch.on)
        XCTAssertEqual(dispatch.botId, "bot-1")
        XCTAssertEqual(dispatch.watches.map(\.id), ["dispatch.unassigned", "dispatch.sla"])
        XCTAssertEqual(dispatch.watches.map(\.on), [true, false])
        // "never": off, still turned on from here; nothing is on by default
        XCTAssertFalse(rows[1].on)
        XCTAssertTrue(rows[1].never)
        XCTAssertEqual(rows[1].label, "Security")
        // stored on a bot that can no longer carry it: off, paused, moved by a yes
        XCTAssertFalse(rows[2].on)
        XCTAssertEqual(rows[2].pausedOn, "bot-gone")
        XCTAssertEqual(rows[2].botId, "bot-2")
        XCTAssertEqual(rows[2].label, "Sauvegardes")
        XCTAssertEqual(ProactiveReceiveRules.domainRows(try state(), french: false)[0].label, "Dispatch")
    }

    func testBotPageRowsAreThatBotsOwn() throws {
        let state = try state()
        let two = ProactiveReceiveRules.domainRows(state, botId: "bot-2", french: false)
        XCTAssertEqual(two.map(\.domain), ["dispatch", "security", "backup"])
        // dispatch is carried by bot-1: off on bot-2's page, with a note
        XCTAssertFalse(two[0].on)
        XCTAssertEqual(two[0].watches.map(\.id), ["dispatch.unassigned"])
        XCTAssertEqual(ProactiveReceiveRules.carriedElsewhere(state, row: two[0], botId: "bot-2"), "bot-1")
        let one = ProactiveReceiveRules.domainRows(state, botId: "bot-1", french: false)
        XCTAssertEqual(one.map(\.domain), ["dispatch"])
        XCTAssertTrue(one[0].on)
        XCTAssertNil(ProactiveReceiveRules.carriedElsewhere(state, row: one[0], botId: "bot-1"))
    }

    func testSwitchesDrawBeforeTheAnswer() throws {
        let state = try state()
        let rows = ProactiveReceiveRules.domainRows(state, french: false)
        let off = ProactiveReceiveRules.settingDomain(state, row: rows[0], on: false, now: 9)
        XCTAssertEqual(off.choices["dispatch"]?.state, .off)
        XCTAssertNil(off.choices["dispatch"]?.botId)
        let moved = ProactiveReceiveRules.settingDomain(state, row: rows[1], on: true, botId: "bot-2", now: 9)
        XCTAssertEqual(moved.choices["security"]?.state, .on)
        XCTAssertEqual(moved.choices["security"]?.botId, "bot-2")
        let watch = ProactiveReceiveRules.settingWatch(state, domain: "dispatch", watch: "dispatch.sla", on: true, now: 9)
        XCTAssertNil(watch.choices["dispatch"]?.watchesOff)
        let watchOff = ProactiveReceiveRules.settingWatch(state, domain: "dispatch", watch: "dispatch.unassigned", on: false, now: 9)
        XCTAssertEqual(watchOff.choices["dispatch"]?.watchesOff?.keys.sorted(), ["dispatch.sla", "dispatch.unassigned"])
        let brief = ProactiveReceiveRules.settingBot(state, botId: "bot-2", brief: true)
        XCTAssertEqual(brief.receive.bots[1].brief, true)
    }

    func testCadenceInWordsNeverRaw() {
        XCTAssertEqual(ProactiveReceiveRules.cadenceText("15m"), "Every 15 min")
        XCTAssertEqual(ProactiveReceiveRules.cadenceText("60m"), "Every hour")
        XCTAssertEqual(ProactiveReceiveRules.cadenceText("2h"), "Every 2 hours")
        XCTAssertEqual(ProactiveReceiveRules.cadenceText("daily@8:00"), "Every day at 08:00")
        XCTAssertEqual(ProactiveReceiveRules.cadenceText("weekly:sun@8:30", locale: Locale(identifier: "en_US")), "Every Sunday at 08:30")
        XCTAssertNil(ProactiveReceiveRules.cadenceText("cron:*/5"))
    }

    func testListsReadAndWriteTheDesktopStore() async throws {
        ChoicesRequestStub.answer = Data(answerJSON.utf8)
        let answer = try await client.proactiveReceive()
        XCTAssertNotNil(answer.receive)
        try await client.setProactiveDomain("security", on: true, botId: "bot-2")
        try await client.setProactiveDomain("dispatch", on: false, botId: "bot-1")
        try await client.setProactiveWatch(domain: "dispatch", watch: "dispatch.sla", on: false)
        try await client.setProactiveBotRow(botId: "bot-1", brief: true, timeZone: "America/Toronto")
        try await client.setProactiveBotRow(botId: "bot-1", checklist: false)
        let get = ChoicesRequestStub.requests[0].0
        XCTAssertEqual(get.httpMethod, "GET")
        XCTAssertEqual(get.url?.path, "/api/me/proactive")
        XCTAssertEqual(get.url?.query, "view=all")
        for index in 1...3 {
            XCTAssertEqual(ChoicesRequestStub.requests[index].0.httpMethod, "PUT")
            XCTAssertEqual(ChoicesRequestStub.requests[index].0.url?.path, "/api/me/proactive")
            XCTAssertEqual(ChoicesRequestStub.requests[index].0.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(try body(index)["via"] as? String, "settings")
        }
        XCTAssertEqual(try body(1)["state"] as? String, "on")
        XCTAssertEqual(try body(1)["botId"] as? String, "bot-2")
        XCTAssertEqual(try body(2)["state"] as? String, "off")
        XCTAssertNil(try body(2)["botId"])
        XCTAssertEqual(try body(3)["watch"] as? String, "dispatch.sla")
        XCTAssertEqual(try body(3)["on"] as? Bool, false)
        XCTAssertEqual(ChoicesRequestStub.requests[4].0.url?.path, "/api/bots/bot-1/background-brief")
        XCTAssertEqual(try body(4)["enabled"] as? Bool, true)
        XCTAssertEqual(try body(4)["timeZone"] as? String, "America/Toronto")
        XCTAssertEqual(try body(5)["checklist"] as? Bool, false)
        XCTAssertNil(try body(5)["timeZone"])
    }

    func testDemoAnswersTheSameShapes() throws {
        let demo = DemoServer(now: Date(timeIntervalSince1970: 1_791_000_000), chunkDelay: 0)
        let got = demo.respond(method: "GET", path: "/api/me/proactive", body: nil, query: [URLQueryItem(name: "view", value: "all")])
        XCTAssertEqual(got.status, 200)
        let state = try XCTUnwrap(ProactiveReceiveState(try JSONDecoder().decode(ProactiveChoicesAnswer.self, from: got.body)))
        XCTAssertEqual(ProactiveReceiveRules.domainRows(state, french: false).map(\.domain), ["dispatch", "security"])
        XCTAssertTrue(ProactiveReceiveRules.domainRows(state, french: false).allSatisfy { !$0.on }, "nothing is on by default")
        let put = demo.respond(method: "PUT", path: "/api/me/proactive", body: try JSONSerialization.data(withJSONObject: ["domain": "dispatch", "state": "on", "botId": "demo-pixel"]))
        let after = try JSONDecoder().decode(ProactiveChoicesAnswer.self, from: put.body)
        XCTAssertEqual(after.domains["dispatch"]?.botId, "demo-pixel")
        demo.addProactiveChoiceCard()
        let card = demo.fleet.bots.first { $0.id == "demo-pixel" }?.messages?.last?.card
        XCTAssertTrue(card.map(ProactiveProposalRules.isChoice) ?? false)
    }

    // MARK: a watch alert's two exits

    private let alertRunJSON = #"""
    {"runId":"r1","routineId":"w","routineName":"Watch","status":"completed","wakeTopic":"watch",
     "watches":[{"id":"dispatch.unassigned","domain":"dispatch"},{"id":"dispatch.sla","domain":"dispatch"},{"domain":"no id"}]}
    """#

    func testWatchAlertCarriesItsWatches() throws {
        let run = try JSONDecoder().decode(RoutineRunCard.self, from: Data(alertRunJSON.utf8))
        XCTAssertEqual(WatchAlertRules.alert(of: run)?.map(\.id), ["dispatch.unassigned", "dispatch.sla"])
        // a plain run, or a heartbeat, has no exits
        let plain = try JSONDecoder().decode(RoutineRunCard.self, from: Data(#"{"runId":"r","routineId":"x","routineName":"R","status":"completed"}"#.utf8))
        XCTAssertNil(WatchAlertRules.alert(of: plain))
        var heartbeat = run
        heartbeat.wakeTopic = "heartbeat"
        XCTAssertNil(WatchAlertRules.alert(of: heartbeat))
    }

    func testWatchAlertExitsWriteTheDesktopStore() async throws {
        let run = try JSONDecoder().decode(RoutineRunCard.self, from: Data(alertRunJSON.utf8))
        let watches = try XCTUnwrap(WatchAlertRules.alert(of: run))
        XCTAssertEqual(WatchAlertRules.changes(watches, exit: .watch).count, 2)
        // the domain exit turns each domain off once
        let domain = WatchAlertRules.changes(watches, exit: .domain)
        XCTAssertEqual(domain, [ProactiveChoiceChange(domain: "dispatch", state: .off, via: "alert")])
        for change in WatchAlertRules.changes(watches, exit: .watch) + domain { try await client.setProactiveChoice(change) }
        XCTAssertEqual(ChoicesRequestStub.requests.map { $0.0.httpMethod }, ["PUT", "PUT", "PUT"])
        XCTAssertEqual(ChoicesRequestStub.requests[0].0.url?.path, "/api/me/proactive")
        XCTAssertEqual(try body(0)["domain"] as? String, "dispatch")
        XCTAssertEqual(try body(0)["watch"] as? String, "dispatch.unassigned")
        XCTAssertEqual(try body(0)["on"] as? Bool, false)
        XCTAssertEqual(try body(0)["via"] as? String, "alert")
        XCTAssertEqual(try body(2)["state"] as? String, "off")
        XCTAssertNil(try body(2)["watch"])
        XCTAssertEqual(try body(2)["via"] as? String, "alert")
    }

    func testWatchAlertSaysWhatStoppedByItsLabel() throws {
        let run = try JSONDecoder().decode(RoutineRunCard.self, from: Data(alertRunJSON.utf8))
        let watches = try XCTUnwrap(WatchAlertRules.alert(of: run))
        let listed = try state().receive.domains
        XCTAssertEqual(WatchAlertRules.stoppedLabel(watches, exit: .watch, listed: listed, french: true), "Unassigned tickets, Late tickets")
        XCTAssertEqual(WatchAlertRules.stoppedLabel(watches, exit: .domain, listed: listed, french: true), "Répartition")
        XCTAssertEqual(WatchAlertRules.stoppedLabel(watches, exit: .domain, listed: listed, french: false), "Dispatch")
        // a listing that does not name a watch leaves the plain line, never an id
        XCTAssertNil(WatchAlertRules.stoppedLabel([.init(id: "x.y", domain: "x")], exit: .watch, listed: listed, french: true))
        XCTAssertFalse(WatchAlertRules.stoppedLine(.watch, label: nil).contains("x.y"))
    }
}
