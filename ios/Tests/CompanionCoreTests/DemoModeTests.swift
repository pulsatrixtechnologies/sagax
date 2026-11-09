import Foundation
import XCTest
@testable import CompanionCore

/// Demo mode: realistic local data, simulated replies, and no network.
final class DemoModeTests: XCTestCase {
    private let clock = Date(timeIntervalSince1970: 1_790_000_000)

    func testTheFixtureIsDeterministicAndGeneric() {
        let a = DemoServer(now: clock, chunkDelay: 0).fleet
        let b = DemoServer(now: clock, chunkDelay: 0).fleet
        XCTAssertEqual(a.bots, b.bots)
        XCTAssertEqual(a.groups, b.groups)
        XCTAssertEqual(a.bots.map(\.name), ["Atlas", "Scout", "Pixel", "Forge"])
        XCTAssertEqual(a.groups.map(\.name), ["Launch room"])
        // an approval waits on you, a bot works, a person talks in the group
        XCTAssertTrue(a.bots.contains { $0.messages?.contains { $0.card?.isPending == true } == true })
        XCTAssertTrue(a.bots.contains { $0.busy == true })
        XCTAssertTrue(a.groups[0].messages?.contains { $0.from?.name == "Sam Rivera" } == true)
        // the demo shows owls (Hibou) only
        XCTAssertTrue(a.bots.allSatisfy { ($0.mascotLook?.character ?? .owl) == .owl })
        XCTAssertTrue(MascotUnlocks.demo.characterUnlocked(.owl))
        for character in MascotCharacter.allCases where character != .owl {
            XCTAssertTrue(MascotUnlocks.demo.characterLocked(character, current: .owl), "\(character)")
        }
        XCTAssertEqual(a.bots.first { $0.name == "Forge" }?.mascotSkin, .neon)
        XCTAssertNotNil(DemoServer(now: clock).connection.baseURL)
    }

    func testTheClientReadsTheDemoWithoutANetwork() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        let fleet = try await client.fleet()
        XCTAssertEqual(fleet.bots.count, 4)
        let routines = try await client.routines()
        XCTAssertEqual(routines.routines.map(\.name), ["Morning digest", "Inbox triage", "Design inspiration", "Weekly plan", "Nightly build"])
        let page = try await client.messages(threadId: "demo-thread-scout")
        XCTAssertEqual(page.messages.last?.id, "scout-approval")
        XCTAssertTrue(server.handledRequests.allSatisfy { $0.contains("/api/") })
    }

    func testASendStreamsAReplyAndSettlesIt() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        _ = try await client.send(text: "hello", toBot: "demo-atlas", threadId: "demo-thread-atlas")
        let log = frames.all
        guard case let .message(_, user) = log.first else { return XCTFail("the user's line comes first") }
        XCTAssertEqual(user.role, .user)
        XCTAssertEqual(user.text, "hello")
        XCTAssertTrue(log.contains { if case .runtime = $0 { return true }; return false })
        guard case let .message(thread, reply) = log.last(where: { if case .message = $0 { return true }; return false }) else { return XCTFail() }
        XCTAssertEqual(thread, "demo-thread-atlas")
        XCTAssertEqual(reply.role, .bot)
        XCTAssertTrue(reply.text?.contains("demo") == true)
        // the transcript remembers it
        let page = try await client.messages(threadId: "demo-thread-atlas")
        XCTAssertEqual(page.messages.suffix(2).map(\.id), [user.id, reply.id])
        // same input, same answer
        XCTAssertEqual(DemoFixture.reply(to: "hello", from: "Atlas"), reply.text)
    }

    func testAnsweringTheApprovalSettlesTheCard() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        let outcome = try await client.respond(threadId: "demo-thread-scout", requestId: "demo-request-publish", behavior: "allow")
        XCTAssertEqual(outcome, "allowed")
        guard case let .messagePatch(_, card) = frames.all.first else { return XCTFail("the card is patched first") }
        XCTAssertEqual(card.card?.answered, "allow")
        XCTAssertFalse(card.card?.isPending ?? true)
        guard case let .message(_, reply) = frames.all.last(where: { if case .message = $0 { return true }; return false }) else { return XCTFail("the reply follows") }
        XCTAssertTrue(reply.text?.contains("Version 2.4") == true)
        XCTAssertFalse(reply.text?.localizedCaseInsensitiveContains("TestFlight") == true)
        // twice is refused, like a server
        do {
            _ = try await client.respond(threadId: "demo-thread-scout", requestId: "demo-request-publish", behavior: "deny")
            XCTFail("a second answer must be refused")
        } catch APIError.status(code: 409, _) {}
    }

    func testDeletingTheAccountDropsTheMadeUpData() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        let refused = server.respond(method: "DELETE", path: "/api/me", body: Data("{}".utf8))
        XCTAssertEqual(refused.status, 400)
        XCTAssertFalse(server.didDeleteAccount)
        XCTAssertEqual(server.fleet.bots.count, 4)

        let outcome = try await client.deleteAccount()
        XCTAssertEqual(outcome, .deleted)
        XCTAssertTrue(server.didDeleteAccount)
        XCTAssertTrue(server.fleet.bots.isEmpty)
        XCTAssertTrue(server.fleet.groups.isEmpty)
        let routines = try await client.routines()
        XCTAssertTrue(routines.routines.isEmpty)
        XCTAssertTrue(server.handledRequests.contains("DELETE /api/me"))
    }

    func testTheDemoSignsInAsAlexSoThePinnedBotOffersShare() throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        XCTAssertTrue(server.connection.pairedWithServer)
        let sessionBody = server.respond(method: "GET", path: "/api/auth/session", body: nil)
        XCTAssertEqual(sessionBody.status, 200)
        let session = try JSONDecoder().decode(AuthSession.self, from: sessionBody.body)
        XCTAssertEqual(session.principalId, "demo-alex")
        XCTAssertEqual(session.name, "Alex Martin")
        let gate = SurfaceGate(connection: server.connection, account: session)
        XCTAssertTrue(gate.allows(.botSharing))
        let atlas = try XCTUnwrap(server.fleet.bots.first { $0.name == "Atlas" })
        XCTAssertEqual(atlas.ownerUserId, session.principalId)
        XCTAssertEqual(atlas.pinned, true)
        XCTAssertEqual(atlas.chiefOfStaff, true)
        let plan = NavigationMenus.bot(atlas, BotMenuContext(
            gate: gate, showThreads: false, canMoveToSection: false,
            viewerId: session.principalId, activeBotCount: server.fleet.bots.count
        ))
        XCTAssertEqual(plan.items.first, .unpin)
        XCTAssertTrue(plan.items.contains(.share))
        let grants = server.respond(method: "GET", path: "/api/bots/demo-atlas/grants", body: nil)
        XCTAssertEqual(grants.status, 200)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: grants.body) as? [String: Any])
        let rows = try XCTUnwrap(json["grants"] as? [[String: Any]])
        XCTAssertTrue(rows.contains { $0["label"] as? String == "Sam Rivera" })
        XCTAssertTrue(rows.contains { $0["label"] as? String == "Jordan Lee" })
    }

    func testScoutThreadNamesNoDistributionService() {
        for language in [DemoLanguage.english, .french] {
            let fleet = DemoServer(now: clock, language: language, chunkDelay: 0).fleet
            let scout = fleet.bots.first { $0.name == "Scout" }
            let bits = (scout?.messages ?? []).flatMap { message in
                [message.text, message.card?.title, message.card?.subtitle, message.card?.tool, scout?.tasks?.first?.title]
            }
            let joined = bits.compactMap { $0 }.joined(separator: "\n")
            XCTAssertFalse(joined.localizedCaseInsensitiveContains("TestFlight"), language.rawValue)
            XCTAssertFalse(joined.localizedCaseInsensitiveContains("App Store Connect"), language.rawValue)
            XCTAssertTrue(joined.contains("2.4"), language.rawValue)
        }
    }

    func testAnythingElseSaysItIsADemoAndNeverLeavesThePhone() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        defer { server.stop() }
        let client = server.makeClient()
        do {
            // The demo serves its own bots' overview; anything outside the
            // demo fleet is refused with the demo message.
            _ = try await client.overview(botId: "not-a-demo-bot")
            XCTFail("no overview outside the demo fleet")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 404)
            XCTAssertEqual(message, DemoServer.unavailable)
        }
        // The demo session claims every request: one for a real host fails
        // locally instead of reaching the network.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DemoURLProtocol.self]
        let session = URLSession(configuration: configuration)
        do {
            _ = try await session.data(from: URL(string: "https://example.com/")!)
            XCTFail("a demo session must not reach another host")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .notConnectedToInternet)
        }
        XCTAssertTrue(DemoURLProtocol.refusedHosts.contains("example.com"))
    }

    // MARK: Beta App Review (2026-10-18)

    private var eastern: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        calendar.firstWeekday = 1
        return calendar
    }

    func testTheDataFollowsTheInterfaceLanguage() async throws {
        XCTAssertEqual(DemoLanguage(identifier: "fr"), .french)
        XCTAssertEqual(DemoLanguage(identifier: "fr-CA"), .french)
        XCTAssertEqual(DemoLanguage(identifier: "fr_FR"), .french)
        XCTAssertEqual(DemoLanguage(identifier: "en"), .english)
        XCTAssertEqual(DemoLanguage(identifier: "pt-BR"), .english)
        XCTAssertEqual(DemoLanguage(identifier: nil), .english)

        let server = DemoServer(now: clock, language: .french, chunkDelay: 0)
        defer { server.stop() }
        let fleet = server.fleet
        XCTAssertEqual(fleet.bots.map(\.name), ["Atlas", "Scout", "Pixel", "Forge"], "names stay")
        XCTAssertEqual(fleet.groups.map(\.name), ["Salon de lancement"])
        XCTAssertEqual(fleet.sections, ["Lancement", "Ingénierie"])
        XCTAssertTrue(fleet.bots.allSatisfy { ["Lancement", "Ingénierie"].contains($0.section ?? "") })
        XCTAssertTrue(fleet.bots.first { $0.name == "Pixel" }?.messages?.last?.text?.hasPrefix("C'est fait.") == true)
        XCTAssertEqual(fleet.bots.first { $0.name == "Scout" }?.messages?.last?.card?.title, "Approbation requise")
        let client = server.makeClient()
        let routines = try await client.routines()
        XCTAssertTrue(routines.routines.contains { $0.name == "Résumé du matin" })
        XCTAssertTrue(routines.runs.allSatisfy { $0.output?.isEmpty == false })
        // a reply in French, whatever the words typed
        XCTAssertTrue(DemoFixture.reply(to: "status?", from: "Pixel", language: .french).hasPrefix("Voici où on en est"))
        XCTAssertTrue(DemoFixture.reply(to: "anything", from: "Pixel", language: .french).hasPrefix("Bien reçu."))
        XCTAssertTrue(DemoFixture.reply(to: "hello", from: "Pixel", language: .french).hasPrefix("Avec plaisir"))
        XCTAssertTrue(DemoFixture.reply(to: "this one", from: "Pixel").hasPrefix("Got it."), "not a greeting")
        // nothing English left in what the home shows
        let english = DemoServer(now: clock, chunkDelay: 0).fleet
        for (fr, en) in zip(fleet.bots, english.bots) {
            XCTAssertNotEqual(fr.description, en.description)
            XCTAssertNotEqual(fr.messages?.first?.text, en.messages?.first?.text)
            XCTAssertNotNil(fr.messages?.first?.text)
        }
    }

    func testEveryDayOfTheWeekHasRoutinesWhateverTheDay() {
        let calendar = eastern
        // Sunday 2026-10-18, and each day of the week around it
        let sunday = calendar.date(from: DateComponents(year: 2026, month: 10, day: 18, hour: 11))!
        for offset in -3...3 {
            let now = calendar.date(byAdding: .day, value: offset, to: sunday)!
            let fixture = DemoFixture(now: now, language: .english, calendar: calendar)
            let week = calendar.dateInterval(of: .weekOfYear, for: now)!
            for dayIndex in 0..<7 {
                let day = calendar.date(byAdding: .day, value: dayIndex, to: week.start)!
                let items = RoutineCalendar.day(day, routines: fixture.routines, runs: fixture.runs, calendar: calendar)
                XCTAssertGreaterThanOrEqual(items.count, 2, "\(now) day \(dayIndex)")
            }
            // the run log covers what already ran, nothing in the future
            XCTAssertFalse(fixture.runs.isEmpty)
            XCTAssertTrue(fixture.runs.allSatisfy { $0.scheduledFor < now.timeIntervalSince1970 * 1000 })
            XCTAssertEqual(Set(fixture.runs.map(\.id)).count, fixture.runs.count)
            // every routine's next run is ahead
            XCTAssertTrue(fixture.routines.allSatisfy { ($0.nextRunAt ?? 0) > now.timeIntervalSince1970 * 1000 })
        }
    }

    func testACallTurnGetsASpokenReply() async throws {
        let server = DemoServer(now: clock, language: .english, chunkDelay: 0)
        defer { server.stop() }
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        let meta = VoiceCallMeta(callId: "call-1", language: "en", utteranceId: "u-1")
        _ = try await client.send(text: "can you hear me", toBot: "demo-pixel", threadId: "demo-thread-pixel", voiceCall: meta)
        guard case let .message(_, reply) = frames.all.last(where: { if case .message = $0 { return true }; return false }) else { return XCTFail() }
        XCTAssertEqual(reply.text, DemoFixture.reply(to: "can you hear me", from: "Pixel", onCall: true))
        XCTAssertTrue(reply.text?.contains("demo call") == true)
        // the call's other routes are refused here, never sent anywhere
        XCTAssertTrue(server.handledRequests.allSatisfy { $0.contains("/api/") })
    }

    func testStoppingSilencesReplies() async throws {
        let server = DemoServer(now: clock, chunkDelay: 0)
        let frames = FrameLog()
        server.onFrame = { frames.append($0) }
        let client = server.makeClient()
        server.stop()
        _ = try? await client.send(text: "hello", toBot: "demo-atlas", threadId: "demo-thread-atlas")
        XCTAssertTrue(frames.all.isEmpty)
    }
}

private final class FrameLog: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [Frame] = []
    func append(_ frame: Frame) { lock.lock(); frames.append(frame); lock.unlock() }
    var all: [Frame] { lock.lock(); defer { lock.unlock() }; return frames }
}
