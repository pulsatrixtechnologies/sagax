// The step line, against the desktop's own catalogs (src/locales/en.json
// and fr.json): the same tool reads the same sentence on the phone as in
// src/lib/step-label.test.ts, src/lib/step-group.test.ts and
// shared/mcp-gateway-call.test.ts.
import XCTest
@testable import CompanionCore

final class StepLabelTests: XCTestCase {
    private static func catalog(_ name: String) -> [String: String] {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("src/locales/\(name).json")
        guard let data = try? Data(contentsOf: file),
              let table = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] else { return [:] }
        return table
    }

    private static let english = catalog("en")
    private static let french = catalog("fr")

    private let en = StepWords(locale: Locale(identifier: "en_US")) { StepLabelTests.english[$0] }
    private let fr = StepWords(locale: Locale(identifier: "fr_CA")) { StepLabelTests.french[$0] ?? StepLabelTests.english[$0] }

    override func setUpWithError() throws {
        if Self.english.isEmpty { throw XCTSkip("src/locales/en.json is not beside ios/") }
    }

    private func tool(_ name: String, ok: Bool? = true, input: [String: Any]? = nil, summary: String? = nil, durationMs: Double? = nil, product: String? = nil) -> ToolActivity {
        var tool = ToolActivity(name: name, ok: ok, summary: summary)
        tool.product = product
        if let input, let data = try? JSONSerialization.data(withJSONObject: input, options: [.sortedKeys]) {
            tool.input = String(decoding: data, as: UTF8.self)
        }
        tool.durationMs = durationMs
        return tool
    }

    private func step(_ id: String, _ tool: ToolActivity, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = tool
        return message
    }

    // MARK: - One step

    func testBuiltInsReadAsSentencesInEachTense() {
        XCTAssertEqual(StepLabel.read(tool("Read", input: ["file_path": "/repo/src/app.ts"]), words: en), StepReading(label: "Read a file", target: "app.ts"))
        XCTAssertEqual(StepLabel.read(tool("Read", ok: nil), words: en).label, "Reading a file")
        XCTAssertEqual(StepLabel.read(tool("Read", ok: false), words: en).label, "Could not read a file")
        XCTAssertEqual(StepLabel.read(tool("Bash", input: ["command": "pnpm test\nmore"]), words: en), StepReading(label: "Ran a command", target: "pnpm test"))
        XCTAssertEqual(StepLabel.read(tool("WebFetch", input: ["url": "https://example.com/a?b=1"]), words: en).target, "example.com")
        XCTAssertEqual(StepLabel.read(tool("Read", input: ["file_path": "/x/y.ts"]), words: fr).label, "A lu un fichier")
    }

    func testSagaxToolsAndTeammatesReadByName() {
        let names: StepNameOf = { $0 == "b1" ? "Wren" : $0 == "b2" ? "Olive" : nil }
        XCTAssertEqual(StepLabel.read(tool("mcp__agents__coordinate_bots", input: ["bot_ids": ["b1", "b2"]]), words: en, nameOf: names).label, "Coordinated Wren and Olive")
        XCTAssertEqual(StepLabel.read(tool("mcp__agents__ask_bot", input: ["bot_id": "0f3a9c2e-55aa-41"]), words: en).label, "Asked a teammate")
        XCTAssertEqual(StepLabel.read(tool("mcp__sagax-environment__run_command", input: ["command": "ls"]), words: en).label, "Ran a command")
    }

    func testAnMcpToolNamesItsProduct() {
        // the product is the name the server declared for the tool
        let query = tool("mcp__example-gw__acme_desk__query", input: ["resource": "service/tickets", "member": "jdoe"], product: "Acme Desk")
        XCTAssertEqual(StepLabel.read(query, words: en), StepReading(label: "Viewed tickets in Acme Desk", target: "jdoe"))
        XCTAssertEqual(StepLabel.read(query, words: fr).label, "A consulté les billets dans Acme Desk")
        var failed = query
        failed.ok = false
        XCTAssertEqual(StepLabel.read(failed, words: en).label, "Could not use Acme Desk")
        XCTAssertEqual(StepLabel.read(tool("mcp__perspicax__acme_guard__query", input: ["resource": "threats"], product: "AcmeGuard"), words: en).label, "Viewed alerts in AcmeGuard")
        // nothing declared: the product prefix's words, titled
        XCTAssertEqual(StepLabel.read(tool("mcp__perspicax__acme_guard__query", input: ["resource": "threats"]), words: en).label, "Viewed alerts in Acme Guard")
    }

    func testTheFoldedRowNeverShowsTheToolId() {
        var voice = tool("mcp__claude_ai_Example_Gateway__acme_voice__query", input: ["resource": "Accounts"], product: "Acme Voice")
        for ok in [true, nil, false] as [Bool?] {
            voice.ok = ok
            let label = StepLabel.read(voice, words: en).label
            XCTAssertNil(label.range(of: #"acme_voice|__|_query"#, options: .regularExpression), label)
            XCTAssertTrue(label.contains("Acme Voice"), label)
        }
        voice.ok = false
        XCTAssertEqual(StepLabel.read(voice, words: en), StepReading(label: "Could not use Acme Voice", target: "Accounts"))
        XCTAssertEqual(StepLabel.read(voice, words: fr), StepReading(label: "N'a pas pu utiliser Acme Voice", target: "Accounts"))
        var bare = tool("mcp__acme_api__query", input: [:])
        bare.ok = false
        XCTAssertEqual(StepLabel.read(bare, words: en).label, "Could not use Acme API")
        XCTAssertEqual(StepLabel.read(tool("mcp__perspicax__flow", input: [:]), words: en).label, "Used Pulsatrix")
        XCTAssertEqual(StepLabel.read(tool("mcp", input: ["server": "acme_crm"]), words: en).label, "Checked Acme Crm")
    }

    func testAGatewayCallReadsAsTheToolItRan() {
        let call = McpGateway.read("mcp", input: #"{"server":"example-gw","tool":"acme_desk__query","args":{"resource":"tickets"}}"#)
        guard case let .tool(server, toolName, id, _)? = call else { return XCTFail("a tool call") }
        XCTAssertEqual([server, toolName, id], ["example-gw", "acme_desk__query", "mcp__example-gw__acme_desk__query"])
        let step = tool("mcp", input: ["server": "example-gw", "tool": "acme_desk__query", "args": ["resource": "tickets"]], product: "Acme Desk")
        XCTAssertEqual(StepLabel.read(step, words: en).label, "Viewed tickets in Acme Desk")
        // `<server>_<tool>`: the first underscore splits, a known server first
        guard case let .tool(prefixed, _, _, _)? = McpGateway.read("mcp", input: #"{"tool":"example-gw_acme_desk__query"}"#) else { return XCTFail("prefixed") }
        XCTAssertEqual(prefixed, "example-gw")
        // housekeeping
        XCTAssertEqual(StepLabel.read(tool("mcp", input: ["search": "tickets"]), words: en), StepReading(label: "Searched for MCP tools", target: "tickets"))
        XCTAssertEqual(StepLabel.read(tool("mcp", input: ["connect": "github"]), words: en).label, "Connected to Github")
        XCTAssertEqual(StepLabel.read(tool("mcp", input: [:]), words: en).label, "Checked the MCP servers")
        XCTAssertNil(McpGateway.read("Bash", input: "{}"))
    }

    func testServerSentencesAndUnknownToolsStayReadable() {
        XCTAssertEqual(StepLabel.read(tool("Sent to Wren · Ops"), words: fr).label, "Envoyé à Wren dans Ops")
        XCTAssertEqual(StepLabel.read(tool("Something already said"), words: en).label, "Something already said")
        // an unknown tool keeps its own words, as the desktop (`step-label.ts`); the Composio phrase left with #1014
        XCTAssertEqual(StepLabel.read(tool("LINEAR_CREATE_LINEAR_COMMENT"), words: en).label, "Used LINEAR CREATE LINEAR COMMENT")
        XCTAssertEqual(StepLabel.read(tool("my_tool", summary: "the summary"), words: en), StepReading(label: "Used my tool", target: "the summary"))
    }

    func testDurationsAndDetail() {
        XCTAssertEqual(StepLabel.duration(400, words: en), "<1s")
        XCTAssertEqual(StepLabel.duration(15_000, words: fr), "15 s")
        XCTAssertEqual(StepLabel.duration(65_000, words: en), "1m 05s")
        let args = StepLabel.arguments(#"{"path":"/a","count":3,"nested":{"x":1},"list":["a","b"],"empty":""}"#, words: en)
        XCTAssertEqual(args.map(\.key), ["path", "count", "nested", "list"])
        XCTAssertEqual(args.map(\.value), ["/a", "3", "1 fields", "a, b"])
        XCTAssertEqual(StepLabel.result("1\n2\n3\n4\n5")?.cut, true)
    }

    // MARK: - The run

    func testIdenticalStepsMergeWithACount() {
        let messages = [
            step("a", tool("Read", input: ["file_path": "/a.ts"], durationMs: 100)),
            step("b", tool("Read", input: ["file_path": "/b.ts"], durationMs: 200)),
            step("c", tool("Read", input: ["file_path": "/c.ts"], durationMs: 300)),
            step("d", tool("Bash", input: ["command": "ls"])),
            step("e", tool("Read", ok: nil)),
            step("f", tool("Read", ok: nil)),
        ]
        let entries = StepGroup.merge(messages, words: en)
        XCTAssertEqual(entries.count, 4, "a running step is never merged")
        guard case let .steps(id, merged, label, target, phase, duration) = entries[0] else { return XCTFail("merged") }
        XCTAssertEqual(id, "a")
        XCTAssertEqual(merged.count, 3)
        XCTAssertEqual(label, "Read a file")
        XCTAssertNil(target, "different files: no single target")
        XCTAssertEqual(phase, .done)
        XCTAssertEqual(duration, 600)
    }

    func testTheLineSaysHowLongAndHowManyAndWhatRunsNow() {
        var done = [step("a", tool("Read")), step("b", tool("WebFetch", ok: false))]
        let summary = StepGroup.summarize(done)
        XCTAssertEqual(summary.tools, 2)
        XCTAssertEqual(summary.failed, 1)
        let words = StepGroup.words(summary, elapsed: 15_000, words: fr)
        XCTAssertEqual(words.label, "A travaillé 15 s")
        XCTAssertEqual(words.tools, "2 outils")
        XCTAssertEqual(words.failed, "1 échec")
        // the row draws the duration only; VoiceOver reads the whole count
        XCTAssertTrue(words.accessibility.hasPrefix("A travaillé 15 s, 2 outils, 1 échec"), words.accessibility)
        let spoken = StepWords(locale: Locale(identifier: "fr_CA")) { $0 == "step.turn.a11y" ? "{summary}, appuyez pour voir le détail" : StepLabelTests.french[$0] }
        XCTAssertEqual(StepGroup.words(summary, elapsed: 15_000, words: spoken).accessibility, "A travaillé 15 s, 2 outils, 1 échec, appuyez pour voir le détail")
        XCTAssertEqual(StepGroup.words(StepGroup.summarize([]), elapsed: nil, words: en).label, "Worked")
        done.append(step("c", tool("Bash", ok: nil, input: ["command": "pnpm i"])))
        // #3581: while the turn runs the row says "Working" and never names
        // the step (the working line under the transcript does, once)
        let live = StepGroup.words(StepGroup.summarize(done), elapsed: nil, words: en)
        XCTAssertEqual(live.phase, .running)
        XCTAssertEqual(live.label, "Working")
        XCTAssertNil(live.target)
        XCTAssertEqual(StepGroup.words(StepGroup.summarize(done), elapsed: nil, words: fr).label, "Au travail")
        // between two steps (a note being written) the turn still runs
        let between = StepGroup.words(StepGroup.summarize([step("a", tool("Read"))]), elapsed: 4_000, words: en, live: true)
        XCTAssertEqual(between.label, "Working")
        XCTAssertEqual(between.phase, .running)
    }

    func testSpanFromTheFirstStartToTheLastEnd() {
        let messages = [step("a", tool("Read", durationMs: 500), at: 1_000), step("b", tool("Read", durationMs: 2_000), at: 3_000)]
        XCTAssertEqual(StepGroup.span(messages), 4_000)
        XCTAssertNil(StepGroup.span([step("c", tool("Read", ok: nil))]))
    }

    func testTheWireCarriesInputAndDuration() throws {
        let json = #"{"id":"s","role":"bot","kind":"activity","at":1,"tool":{"name":"Read","ok":true,"input":"{\"file_path\":\"/a.ts\"}","durationMs":120}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(message.tool?.input, #"{"file_path":"/a.ts"}"#)
        XCTAssertEqual(message.tool?.durationMs, 120)
        let again = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(message))
        XCTAssertEqual(again.tool?.durationMs, 120)
    }
}
