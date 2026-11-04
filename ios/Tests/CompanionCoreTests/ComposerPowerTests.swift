// WP3: the composer's power features, decided as the Electron renderer
// decides them (Composer.tsx, BusySendChooser.tsx, ComposerQueuedMessages.tsx,
// ComposerCommandMenu.tsx, src/lib/composer-commands.ts, src/lib/mentions.ts,
// src/lib/thread-refs.ts, src/lib/composer-attachments.ts,
// shared/harness-commands.ts, shared/parallel-tasks.ts), and their requests.
import Foundation
import XCTest
@testable import CompanionCore

final class ComposerCommandsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testDecodesTheHarnessCommandsAnswerLeniently() throws {
        let answer = try decode(HarnessCommandsAnswer.self, #"""
        {"available":true,"engine":"claude","commands":[
          {"name":"compact","description":"Compact","argumentHint":"","group":"engine"},
          {"name":"pulsatrix-flow:using-px-flow","description":"Flow","group":"plugins"},
          {"name":"mcp__docs__search","description":"Docs","group":"mcp","argumentHint":"<q>"},
          {"name":"theme","description":"Theme","group":"engine","unavailable":"interactive"},
          {"name":"future","group":"someday","unavailable":"later"},
          {"description":"no name"}
        ]}
        """#)
        XCTAssertTrue(answer.available)
        XCTAssertEqual(answer.engine, "claude")
        XCTAssertEqual(answer.commands.map(\.name), ["compact", "pulsatrix-flow:using-px-flow", "mcp__docs__search", "theme", "future"])
        XCTAssertNil(answer.commands[0].argumentHint, "an empty hint is no hint")
        XCTAssertEqual(answer.commands[2].argumentHint, "<q>")
        XCTAssertEqual(answer.commands[3].unavailable, .interactive)
        XCTAssertEqual(answer.commands[4].group, .engine, "an unknown group reads as the engine's")
        XCTAssertNil(answer.commands[4].unavailable)

        let refused = try decode(HarnessCommandsAnswer.self, #"{"available":false,"commands":[],"reason":"no_session"}"#)
        XCTAssertFalse(refused.available)
        XCTAssertEqual(refused.reason, "no_session")
    }

    func testSlashTriggerOnlyAtTheStartOfTheDraft() {
        XCTAssertEqual(ComposerSlashTrigger.at("/"), ComposerSlashTrigger(query: "", start: 0, end: 1))
        XCTAssertEqual(ComposerSlashTrigger.at("/comp")?.query, "comp")
        XCTAssertEqual(ComposerSlashTrigger.at("/pulsatrix-flow:using")?.query, "pulsatrix-flow:using")
        XCTAssertNil(ComposerSlashTrigger.at("/compact now"), "the first token is done")
        XCTAssertNil(ComposerSlashTrigger.at("say /compact"))
        XCTAssertNil(ComposerSlashTrigger.at(""))
        let trigger = ComposerSlashTrigger.at("/com")!
        XCTAssertEqual(trigger.replacing(in: "/com", with: "/compact "), "/compact ")
    }

    func testGoalTextFromComposer() {
        XCTAssertEqual(goalTextFromComposer("/goal ship the plan"), "ship the plan")
        XCTAssertEqual(goalTextFromComposer("/goal"), "")
        XCTAssertEqual(goalTextFromComposer("/GOAL  x"), "x")
        XCTAssertNil(goalTextFromComposer("/goals"))
        XCTAssertNil(goalTextFromComposer("hello"))
    }

    func testSagaxCommandsOfferedAsTheDesktopDoes() {
        let loops: [SagaxSlashCommand] = [.loop, .loopStatus, .loopStop]
        XCTAssertEqual(SagaxSlashCommand.offered(isRoom: false, isDM: false, skillAuthoring: true, supportsAgents: true), [.goal, .learn, .setup] + loops)
        XCTAssertEqual(SagaxSlashCommand.offered(isRoom: false, isDM: false, skillAuthoring: false, supportsAgents: true), [.goal, .setup] + loops)
        XCTAssertEqual(SagaxSlashCommand.offered(isRoom: false, isDM: false, skillAuthoring: true, supportsAgents: false), [.goal] + loops)
        XCTAssertEqual(SagaxSlashCommand.offered(isRoom: true, isDM: false, skillAuthoring: true, supportsAgents: true), [.goal, .learn] + loops)
        XCTAssertEqual(SagaxSlashCommand.offered(isRoom: true, isDM: true, skillAuthoring: true, supportsAgents: false), [])
        XCTAssertEqual(SagaxSlashCommand.learn.insertion, "/learn ")
        XCTAssertEqual(SagaxSlashCommand.setup.insertion, "/setup ")
        XCTAssertEqual(SagaxSlashCommand.loop.insertion, "/loop ")
        XCTAssertEqual(SagaxSlashCommand.goal.insertion, "")
        XCTAssertEqual(SagaxSlashCommand.loopStatus.label, "/loop status")
        XCTAssertTrue(SagaxSlashCommand.loopStop.runsAtOnce)
        XCTAssertFalse(SagaxSlashCommand.loop.runsAtOnce)
    }

    func testGoalHeadsTheMenuUnderItsOwnSection() {
        let items = ComposerCommandMenu.items(
            sagax: [.goal, .learn, .setup, .loop, .loopStatus, .loopStop],
            sagaxHint: { $0 == .goal ? "<goal>" : $0 == .loop ? "5m prompt" : nil },
            engine: [HarnessCommand(name: "compact")], query: ""
        )
        XCTAssertEqual(items.map(\.label), ["/goal", "/learn", "/setup", "/loop", "/loop status", "/loop stop", "/compact"])
        XCTAssertEqual(items.map(\.group), [.goal, .sagax, .sagax, .sagax, .sagax, .sagax, .engine])
        XCTAssertEqual(items.first?.argumentHint, "<goal>")
        XCTAssertEqual(items[3].argumentHint, "5m prompt")
    }

    func testLoopCommandParsesAsTheDesktopDoes() {
        XCTAssertNil(LoopCommand.parse("hello"))
        XCTAssertNil(LoopCommand.parse("/loops 5m x"))
        XCTAssertEqual(LoopCommand.parse("/loop"), .incomplete)
        XCTAssertEqual(LoopCommand.parse("/loop 5m"), .incomplete)
        XCTAssertEqual(LoopCommand.parse("/loop soon check"), .incomplete)
        XCTAssertEqual(LoopCommand.parse("/loop status"), .status)
        XCTAssertEqual(LoopCommand.parse("/loop stop board"), .stop(name: "board"))
        XCTAssertEqual(LoopCommand.parse("/loop stop"), .stop(name: ""))
        XCTAssertEqual(LoopCommand.parse("/loop 10m check the board"), .start(everyMinutes: 10, prompt: "check the board", raised: false, capped: false))
        XCTAssertEqual(LoopCommand.parse("/LOOP 1m x"), .start(everyMinutes: 5, prompt: "x", raised: true, capped: false))
        XCTAssertEqual(LoopCommand.parse("/loop 2d x"), .start(everyMinutes: 1_440, prompt: "x", raised: false, capped: true))
        XCTAssertEqual(LoopCommand.parse("/loop 2h x"), .start(everyMinutes: 120, prompt: "x", raised: false, capped: false))
        XCTAssertEqual(LoopCommand.routineName(everyMinutes: 120, prompt: "check   the board"), "Loop 2h check the board")
        XCTAssertEqual(LoopCommand.routineName(everyMinutes: 1_440, prompt: "x"), "Loop 1d x")
        XCTAssertEqual(LoopCommand.routineName(everyMinutes: 5, prompt: String(repeating: "a", count: 60)), "Loop 5m " + String(repeating: "a", count: 42))
    }

    func testMenuOrdersSagaxThenGroupsClosestFirstUnavailableLast() {
        let engine = [
            HarnessCommand(name: "review", description: "Review a PR"),
            HarnessCommand(name: "compact", description: "Compact the context", argumentHint: "[focus]"),
            HarnessCommand(name: "theme", description: "Color theme", unavailable: .interactive),
            HarnessCommand(name: "pulsatrix-flow:using-px-flow", description: "Flow entry", group: .plugins),
            HarnessCommand(name: "mcp__docs__search", description: "Search docs", group: .mcp),
            HarnessCommand(name: "setup", description: "Engine setup"),
        ]
        let all = ComposerCommandMenu.items(sagax: [.learn, .setup], engine: engine, query: "")
        XCTAssertEqual(all.map(\.label), [
            "/learn", "/setup", "/review", "/compact", "/engine:setup", "/theme",
            "/pulsatrix-flow:using-px-flow", "/mcp__docs__search",
        ])
        XCTAssertEqual(all.map(\.group), [.sagax, .sagax, .engine, .engine, .engine, .engine, .plugins, .mcp])
        XCTAssertNil(all[5].insertion, "a command the chat cannot run inserts nothing")
        XCTAssertEqual(all[3].insertion, "/compact ")
        XCTAssertEqual(all[3].argumentHint, "[focus]")
        XCTAssertEqual(all[0].insertion, "/learn ")

        let using = ComposerCommandMenu.items(sagax: [], engine: engine, query: "using")
        XCTAssertEqual(using.map(\.label), ["/pulsatrix-flow:using-px-flow"], "a plugin command by its short name")
        let byDescription = ComposerCommandMenu.items(sagax: [], engine: engine, query: "context")
        XCTAssertEqual(byDescription.map(\.label), ["/compact"])
        let prefix = ComposerCommandMenu.items(sagax: [.setup], engine: engine, query: "se")
        XCTAssertEqual(prefix.first?.label, "/setup")
    }

    func testMenuListsTheBotsSkillsBetweenSagaxAndTheEngine() {
        let engine = [
            HarnessCommand(name: "compact", description: "Compact the context"),
            HarnessCommand(name: "presentation", description: "An engine command a skill shadows"),
        ]
        let skills = SlashSkill.menu([
            ManagedSkill(name: "presentation", description: "Give your name", enabled: true),
            ManagedSkill(name: "draft", description: "Off for now", enabled: false),
            ManagedSkill(name: "setup", description: "Cannot shadow a built-in", enabled: true),
        ])
        XCTAssertEqual(skills.map(\.name), ["presentation"])
        let all = ComposerCommandMenu.items(sagax: [.setup], skills: skills, engine: engine, query: "")
        XCTAssertEqual(all.map(\.label), ["/setup", "/presentation", "/compact"])
        XCTAssertEqual(all.map(\.group), [.sagax, .skills, .engine])
        XCTAssertEqual(all[1].insertion, "/presentation ")
        XCTAssertEqual(ComposerCommandMenu.items(sagax: [.setup], skills: skills, engine: engine, query: "p").map(\.label), ["/presentation"])
        // one letter never matches a description or the inside of a name
        XCTAssertEqual(ComposerCommandMenu.items(sagax: [.setup], skills: skills, engine: engine, query: "o").map(\.label), [])
    }

    func testRoomMenuGroupsEngineCommandsUnderEachBot() {
        let members = [RoomCommandMember(id: "a", name: "Scout"), RoomCommandMember(id: "b", name: "Atlas")]
        let everyone = GroupResponder(kind: "everyone", botId: nil)
        let targets = RoomCommandRouting.targets(botId: nil, members: members, defaultResponder: everyone)
        XCTAssertEqual(targets.map(\.member.id), ["a", "b"])
        XCTAssertTrue(targets.allSatisfy(\.mention))
        let lead = RoomCommandRouting.targets(botId: nil, members: members, defaultResponder: GroupResponder(kind: "member", botId: "b"))
        XCTAssertEqual(lead.map(\.member.id), ["b"])
        XCTAssertFalse(lead[0].mention)

        let sets = targets.map {
            ComposerCommandMenu.RoomEngineCommands(
                bot: .init(id: $0.member.id, name: $0.member.name),
                commands: [HarnessCommand(name: "compact")], mention: $0.mention
            )
        }
        let items = ComposerCommandMenu.roomItems(sagax: [.goal], sets: sets, query: "")
        XCTAssertEqual(items.map(\.label), ["/goal", "/compact", "/compact"])
        XCTAssertEqual(items[1].insertion, "@Scout /compact ")
        XCTAssertEqual(items[2].section, "bot:b")
        XCTAssertEqual(ComposerCommandMenu.limitPerBot(2), 40)
        XCTAssertEqual(ComposerCommandMenu.limitPerBot(20), 8)
    }

    func testRoomSlashAfterALeadingMention() {
        let members = [RoomCommandMember(id: "a", name: "Scout"), RoomCommandMember(id: "c", name: "Scout Pro")]
        let after = RoomCommandRouting.slash("@Scout Pro /comp", members: members)
        XCTAssertEqual(after?.botId, "c", "the longest name wins")
        XCTAssertEqual(after?.trigger.query, "comp")
        XCTAssertEqual(after?.trigger.start, 11)
        XCTAssertEqual(after?.trigger.replacing(in: "@Scout Pro /comp", with: "/compact "), "@Scout Pro /compact ")
        XCTAssertNil(RoomCommandRouting.slash("@Scoutx /comp", members: members))
        XCTAssertEqual(RoomCommandRouting.slash("/x", members: members)?.botId, nil)
        XCTAssertNotNil(RoomCommandRouting.slash("/x", members: members))
    }
}

final class ComposerSuggestionsTests: XCTestCase {
    private func bot(_ id: String, _ name: String, hidden: Bool = false, tasks: [(String, String, Double)] = []) throws -> Bot {
        let taskJSON = tasks.map { #"{"threadId":"\#($0.0)","title":"\#($0.1)","createdAt":\#($0.2)}"# }.joined(separator: ",")
        return try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"\#(id)","threadId":"t-\#(id)","name":"\#(name)","title":"","description":"","soul":"","notifications":true,
         "color":"teal","unread":false,"modelSelection":{"instanceId":"claude","model":"m"},"createdAt":1,
         "hidden":\#(hidden),"tasks":[\#(taskJSON)]}
        """#.utf8))
    }

    func testMentionQueryAtTheEndOfTheDraft() {
        XCTAssertEqual(MentionQuery.at("hi @Sc"), MentionQuery(start: 3, query: "Sc"))
        XCTAssertEqual(MentionQuery.at("@"), MentionQuery(start: 0, query: ""))
        XCTAssertNil(MentionQuery.at("mail me at owner@host"), "user@host is not a tag")
        XCTAssertNil(MentionQuery.at("@a\nb"))
        XCTAssertEqual(MentionQuery.at("hi @Sc")?.completing("hi @Sc", with: MentionChoice(id: "a", name: "Scout")), "hi @Scout ")
    }

    func testMentionPoolAndChoices() throws {
        let scout = try bot("a", "Scout"), atlas = try bot("b", "Atlas"), ghost = try bot("c", "Ghost", hidden: true)
        let pool = MentionSuggestions.pool(for: .bot(scout), bots: [scout, atlas, ghost])
        XCTAssertEqual(pool.map(\.name), ["Atlas"], "other visible bots only")
        let room = try JSONDecoder().decode(Room.self, from: Data(#"""
        {"id":"g","threadId":"tg","name":"Team","memberIds":["a","b"],"defaultResponder":{"kind":"mentions"},
         "bulletin":"","unread":false,"createdAt":1}
        """#.utf8))
        let roomPool = MentionSuggestions.pool(for: .room(room), bots: [scout, atlas, ghost])
        XCTAssertEqual(roomPool.map(\.name), ["everyone", "Scout", "Atlas"])
        XCTAssertTrue(roomPool[0].isEveryone)
        XCTAssertEqual(MentionSuggestions.choices(roomPool, query: "at").map(\.name), ["Atlas"])
        XCTAssertEqual(MentionSuggestions.choices(roomPool, query: "").count, 3)
        XCTAssertEqual(MentionSuggestions.choices(roomPool, query: "Scout "), [], "a completed tag closes the strip")
    }

    func testThreadQueryAndChoices() throws {
        XCTAssertEqual(ThreadRefQuery.at("see #QA")?.query, "QA")
        XCTAssertEqual(ThreadRefQuery.at("#")?.query, "")
        XCTAssertNil(ThreadRefQuery.at("C#"), "C# is not a reference")
        XCTAssertNil(ThreadRefQuery.at("# Heading"))
        XCTAssertNil(ThreadRefQuery.at("&#39"))

        let scout = try bot("a", "Scout", tasks: [("t1", "QA PR 245", 10), ("t2", "Release notes", 20), ("t9", "123", 30)])
        let atlas = try bot("b", "Atlas", tasks: [("t3", "QA sweep", 40)])
        let threads = ThreadRefCandidate.collect(bots: [scout, atlas], rooms: [])
        let all = ThreadRefSuggestions.choices(threads, query: "", currentBotId: "a", currentThreadId: "t2")
        XCTAssertEqual(all.map(\.threadId), ["t1", "t3"], "own bot first, the open thread and number titles left out")
        XCTAssertEqual(ThreadRefSuggestions.choices(threads, query: "sweep", currentBotId: "a", currentThreadId: nil).map(\.threadId), ["t3"])
        XCTAssertEqual(ThreadRefSuggestions.choices(threads, query: "QA sweep ", currentBotId: "a", currentThreadId: nil), [])
        let query = ThreadRefQuery.at("look at #qa")!
        XCTAssertEqual(query.completing("look at #qa", with: threads[0]), "look at #QA PR 245 ")
    }

    func testSerializeThreadRefsAsTheDesktopSends() throws {
        let scout = try bot("a", "Scout", tasks: [("t1", "QA PR 245", 10), ("t2", "QA", 20)])
        let atlas = try bot("b", "Atlas", tasks: [("t3", "QA PR 245", 40)])
        let threads = ThreadRefCandidate.collect(bots: [scout, atlas], rooms: [])
        XCTAssertEqual(
            ThreadRefs.serialize("look at #qa pr 245 now", threads: threads, currentBotId: "a"),
            "look at [QA PR 245](sagax://thread/t1?bot=a) now",
            "the longest title wins, the open bot's own thread among equals"
        )
        XCTAssertEqual(
            ThreadRefs.serialize("#QA PR 245", threads: threads, currentBotId: "z"),
            "[QA PR 245](sagax://thread/t3?bot=b)",
            "else the newest"
        )
        XCTAssertEqual(ThreadRefs.serialize("C#QA and `#QA` and #QAx", threads: threads, currentBotId: "a"), "C#QA and `#QA` and #QAx")
        XCTAssertEqual(
            ThreadRefs.serialize("[#QA](https://x.example) #QA", threads: threads, currentBotId: "a"),
            "[#QA](https://x.example) [QA](sagax://thread/t2?bot=a)"
        )
        XCTAssertEqual(ThreadRefs.serialize("no refs", threads: threads, currentBotId: "a"), "no refs")
        let parsed = ThreadRefs.parse("sagax://thread/t1?bot=a")
        XCTAssertEqual(parsed?.threadId, "t1")
        XCTAssertEqual(parsed?.botId, "a")
        XCTAssertNil(ThreadRefs.parse("sagax://thread/t1?bot=a&x=1"))
        XCTAssertNil(ThreadRefs.parse("https://thread/t1"))
    }
}

final class ComposerSendTests: XCTestCase {
    func testBusySendIsRoutedByTheBot() {
        var working = Bot(id: "b", threadId: "t", name: "B", title: "", description: "", notifications: true, color: "blue",
                          unread: false, modelSelection: ModelSelection(instanceId: "own", model: "m"), createdAt: 0)
        working.busy = true
        var resting = working
        resting.busy = false
        let busy = Chat.bot(working)
        let idle = Chat.bot(resting)
        XCTAssertTrue(BusySendChoice.routesAuto(for: busy))
        XCTAssertFalse(BusySendChoice.routesAuto(for: busy, onCall: true), "a call joins the running turn")
        XCTAssertFalse(BusySendChoice.routesAuto(for: idle))
        // auto travels as routeWhileBusy (an older server ignores it), never as a busyMode
        var body: [String: Any] = [:]
        SendOptions(busyMode: .auto).apply(to: &body, destination: .bot(id: "b", threadId: "t"))
        XCTAssertEqual(body["routeWhileBusy"] as? Bool, true)
        XCTAssertNil(body["busyMode"])
    }

    func testLongPasteBecomesAChip() {
        XCTAssertFalse(PastedText.isLong("short"))
        XCTAssertTrue(PastedText.isLong(String(repeating: "x", count: 900)))
        XCTAssertTrue(PastedText.isLong(Array(repeating: "l", count: 12).joined(separator: "\n")))
        let long = Array(repeating: "line", count: 14).joined(separator: "\n")
        let detected = PastedText.detect(old: "Look: ", new: "Look: \(long) thanks")
        XCTAssertEqual(detected?.pasted, "\(long) thanks")
        XCTAssertEqual(detected?.remaining, "Look: ")
        XCTAssertNil(PastedText.detect(old: "abc", new: "abcd"), "typing is not a paste")
        XCTAssertNil(PastedText.detect(old: "", new: ""))
        let exact = PastedText.detect(old: "ab", new: "a\(long)b")
        XCTAssertEqual(exact?.pasted, long)
        XCTAssertEqual(exact?.remaining, "ab")
        let paste = PastedText(text: long)
        XCTAssertEqual(paste.lines, 14)
        XCTAssertEqual(paste.summary, "14 lines, \(long.utf8.count) B")
        XCTAssertEqual(PastedText.formatSize(2048), "2.0 KB")
        XCTAssertEqual(PastedText.compose("Look", pastes: [paste]), "Look\n\n<pasted-text index=\"1\">\n\(long)\n</pasted-text>")
        XCTAssertEqual(PastedText.compose("", pastes: []), "")
        XCTAssertEqual(PastedText.appending("p", to: "a"), "a\n\np")
        XCTAssertEqual(PastedText.appending("p", to: ""), "p")
    }

    func testFailedSendKeepsWhatToSendAgain() {
        let failed = FailedSend(text: "  ", requestText: "<attached-image path=\"x\" />", replyToId: "m1", busyMode: .parallel, threadId: "t", error: "offline")
        XCTAssertNil(failed.quote)
        XCTAssertEqual(failed.options, SendOptions(replyToId: "m1", busyMode: .parallel))
    }

    func testQueueSteerRules() {
        XCTAssertTrue(QueueSteer.available(busy: true, queued: 1, approvalPending: false))
        XCTAssertFalse(QueueSteer.available(busy: false, queued: 1, approvalPending: false))
        XCTAssertFalse(QueueSteer.available(busy: true, queued: 0, approvalPending: false))
        XCTAssertFalse(QueueSteer.available(busy: true, queued: 2, approvalPending: true))
        XCTAssertEqual(QueueSteer.label(count: 1, isRoom: false, steering: false), .steer)
        XCTAssertEqual(QueueSteer.label(count: 2, isRoom: false, steering: false), .steerAll)
        XCTAssertEqual(QueueSteer.label(count: 2, isRoom: true, steering: false), .steerNext)
        XCTAssertEqual(QueueSteer.label(count: 2, isRoom: true, steering: true), .steering)
        XCTAssertEqual(QueueSteer.action(canSteer: nil), .steerRoute)
        XCTAssertEqual(QueueSteer.action(canSteer: true), .steerRoute)
        XCTAssertEqual(QueueSteer.action(canSteer: false), .interrupt)
    }

    func testDecodesTheSteerAnswer() throws {
        let steered = try JSONDecoder().decode(QueueSteerResult.self, from: Data(#"""
        {"ok":true,"steered":true,"threadId":"t","queueIds":["q1","q2"],
         "messages":[{"id":"m","role":"user","kind":"text","at":1,"text":"hi","steered":true},{"bogus":1}]}
        """#.utf8))
        XCTAssertEqual(steered.steered, true)
        XCTAssertEqual(steered.queueIds, ["q1", "q2"])
        XCTAssertEqual(steered.messages?.map(\.id), ["m"])
        let held = try JSONDecoder().decode(QueueSteerResult.self, from: Data(#"{"ok":true,"queued":true,"threadId":"t"}"#.utf8))
        XCTAssertEqual(held.queued, true)
        XCTAssertNil(held.steered)
    }
}

final class ComposerClientTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")

    private func body(_ request: URLRequest) -> [String: Any] {
        request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }

    func testHarnessCommandsRequest() throws {
        let request = try client.harnessCommandsRequest(botId: "b1", threadId: "t1", groupId: "g1", refresh: true)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/bots/b1/harness-commands")
        XCTAssertEqual(request.url?.query, "threadId=t1&groupId=g1&refresh=1")
        XCTAssertNil(try client.harnessCommandsRequest(botId: "b1", threadId: nil).url?.query)
        XCTAssertThrowsError(try client.harnessCommandsRequest(botId: "../x", threadId: nil))
    }

    func testSteerRequests() throws {
        let bot = try client.steerQueuedRequest(queueId: "q1", to: .bot(id: "b1", threadId: "t1"))
        XCTAssertEqual(bot.httpMethod, "POST")
        XCTAssertEqual(bot.url?.path, "/api/bots/b1/queue/q1/steer")
        XCTAssertEqual(body(bot)["threadId"] as? String, "t1")
        let room = try client.steerQueuedRequest(queueId: "q2", to: .room(id: "g1", threadId: "tg"))
        XCTAssertEqual(room.url?.path, "/api/groups/g1/queue/q2/steer")
        XCTAssertEqual(body(room)["threadId"] as? String, "tg")
        XCTAssertThrowsError(try client.steerQueuedRequest(queueId: "q/1", to: .bot(id: "b1", threadId: "t1")))
    }

    func testRoomInterruptAndCompactRequests() throws {
        let interrupt = try client.interruptRoomRequest(groupId: "g1", threadId: "tg")
        XCTAssertEqual(interrupt.httpMethod, "POST")
        XCTAssertEqual(interrupt.url?.path, "/api/groups/g1/interrupt")
        XCTAssertEqual(body(interrupt)["threadId"] as? String, "tg")
        XCTAssertNil(body(try client.interruptRoomRequest(groupId: "g1", threadId: nil))["threadId"])
        let compact = try client.compactRequest(botId: "b1", threadId: "t1")
        XCTAssertEqual(compact.httpMethod, "POST")
        XCTAssertEqual(compact.url?.path, "/api/bots/b1/compact")
        XCTAssertEqual(body(compact)["threadId"] as? String, "t1")
        XCTAssertThrowsError(try client.compactRequest(botId: "b1", threadId: ""))
    }

    func testSendCarriesTheBusyMode() {
        var body: [String: Any] = [:]
        SendOptions(busyMode: .parallel).apply(to: &body, destination: .bot(id: "b", threadId: "t"))
        XCTAssertEqual(body["busyMode"] as? String, "parallel")
        var room: [String: Any] = [:]
        SendOptions(busyMode: .after, goal: true).apply(to: &room, destination: .room(id: "g", threadId: "t"))
        XCTAssertNil(room["busyMode"], "rooms never take a busy mode")
        XCTAssertEqual(room["mode"] as? String, "goal")
    }
}
