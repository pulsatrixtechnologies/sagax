// The working line's step on the phone (shared/working-step.ts): decoded
// from the row, named only while its call runs, and quiet time in minutes.
import XCTest
@testable import CompanionCore

final class WorkingStepTests: XCTestCase {
    private func row(_ tool: String, at: Double = 5_000, kind: String = "activity") throws -> Message {
        let json = #"{"id":"m1","role":"bot","kind":"\#(kind)","at":\#(at),"tool":\#(tool)}"#
        return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testNamesTheRunningCallsStep() throws {
        let running = try row(#"{"name":"Bash","step":{"key":"run","detail":"scrape.py"}}"#)
        let current = WorkingStepLine.current([running])
        XCTAssertEqual(current?.step, WorkingStep(key: "run", detail: "scrape.py"))
        XCTAssertEqual(current?.since, 5_000)
        XCTAssertTrue(WorkingStepLine.readsDetail(current!.step))
    }

    func testNothingOnceTheCallEndsOrForAnOlderServer() throws {
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash","ok":true,"step":{"key":"run"}}"#)]))
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash"}"#)]))
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash","step":{"key":"fromTheFuture"}}"#)]))
        XCTAssertNil(WorkingStepLine.current([]))
    }

    func testABadStepNeverBreaksTheRow() throws {
        let message = try row(#"{"name":"Bash","step":{"detail":3}}"#)
        XCTAssertEqual(message.tool?.name, "Bash")
        XCTAssertNil(message.tool?.step)
    }

    func testDetailOnlyOnKeysThatReadWithIt() {
        XCTAssertFalse(WorkingStepLine.readsDetail(WorkingStep(key: "readMail", detail: "x")))
        XCTAssertFalse(WorkingStepLine.readsDetail(WorkingStep(key: "openApp")))
        XCTAssertTrue(WorkingStepLine.readsDetail(WorkingStep(key: "openApp", detail: "Chrome")))
    }

    func testQuietMinutes() {
        XCTAssertNil(WorkingStepLine.quietMinutes(since: 0, now: 59_000))
        XCTAssertEqual(WorkingStepLine.quietMinutes(since: 0, now: 125_000), 2)
    }

    // MARK: - workingStepFor (shared/working-step.ts)

    private func json(_ value: Any) -> String {
        let data = try! JSONSerialization.data(withJSONObject: value)
        return String(data: data, encoding: .utf8)!
    }

    func testWorkingStepForNamesTheScriptAShellCallRuns() {
        let calls: [WorkingStepCall] = [
            WorkingStepCall(name: "Bash", summary: "python3 scrape.py --token abc", input: json(["command": "python3 scrape.py --token abc"])),
            WorkingStepCall(name: "python3 scrape.py --token abc", summary: "python3 scrape.py --token abc"),
            WorkingStepCall(name: "run_shell_command", input: json(["command": "cd tools && python3 scrape.py"])),
            WorkingStepCall(name: "bash", summary: "uv run scrape.py"),
            WorkingStepCall(name: "run_command", input: json(["command": "python3 ./jobs/scrape.py -v"])),
        ]
        for call in calls {
            XCTAssertEqual(workingStepFor(call), WorkingStep(key: "run", detail: "scrape.py"), call.name)
        }
    }

    func testWorkingStepForNamesTheProgramOfAnyOtherCommand() {
        XCTAssertEqual(commandStep("cd app && FOO=1 pnpm test --run"), WorkingStep(key: "run", detail: "pnpm"))
        XCTAssertEqual(commandStep("git status"), WorkingStep(key: "run", detail: "git"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "Bash")), WorkingStep(key: "run"))
    }

    func testWorkingStepForOpensAnApp() {
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "Bash", summary: "open -a \"Google Chrome\" https://example.com")),
            WorkingStep(key: "openApp", detail: "Google Chrome")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "mcp__computer-use__open_application", input: json(["app": "Chrome"]))),
            WorkingStep(key: "openApp", detail: "Chrome")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "open_application", input: json(["app": "Chrome"]))),
            WorkingStep(key: "openApp", detail: "Chrome")
        )
    }

    func testWorkingStepForReadsMailCalendarAndTeams() {
        for name in [
            "mcp__claude_ai_Microsoft_365__outlook_email_search",
            "outlook_email_search",
            "microsoft_365.outlook_email_search",
            "mcp__gmail__search_threads",
        ] {
            XCTAssertEqual(workingStepFor(WorkingStepCall(name: name)), WorkingStep(key: "readMail"), name)
        }
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "mcp__claude_ai_Microsoft_365__outlook_send_mail")), WorkingStep(key: "writeMail"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "outlook_create_reply_draft")), WorkingStep(key: "writeMail"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "mcp__claude_ai_Microsoft_365__outlook_calendar_search")), WorkingStep(key: "calendar"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "outlook_create_event")), WorkingStep(key: "writeCalendar"))
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "mcp__claude_ai_Microsoft_365__teams_list_chats")),
            WorkingStep(key: "readChat", detail: "Teams")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "teams_send_chat_message")),
            WorkingStep(key: "writeChat", detail: "Teams")
        )
    }

    func testWorkingStepForSearchesAndReadsTheWeb() {
        for name in ["WebSearch", "web_search", "google_web_search", "mcp__brave__brave_search"] {
            XCTAssertEqual(workingStepFor(WorkingStepCall(name: name)), WorkingStep(key: "searchWeb"), name)
        }
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "WebFetch", input: json(["url": "https://www.example.com/a?b=c"]))),
            WorkingStep(key: "readPage", detail: "example.com")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "web_fetch", input: json(["url": "https://example.com/x"]))),
            WorkingStep(key: "readPage", detail: "example.com")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "mcp__claude-in-chrome__navigate", input: json(["url": "https://news.example.org/"]))),
            WorkingStep(key: "browse", detail: "news.example.org")
        )
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "browser_click")), WorkingStep(key: "browse"))
    }

    func testWorkingStepForNamesTheFileAFileToolTouches() {
        let reads: [WorkingStepCall] = [
            WorkingStepCall(name: "Read", input: json(["file_path": "/home/me/project/notes.md"])),
            WorkingStepCall(name: "read_file", input: json(["path": "project/notes.md"])),
            WorkingStepCall(name: "Read project/notes.md"),
            WorkingStepCall(name: "read", input: json(["path": #"C:\work\notes.md"#])),
        ]
        for call in reads {
            XCTAssertEqual(workingStepFor(call), WorkingStep(key: "readFile", detail: "notes.md"), call.name)
        }
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "Write", input: json(["file_path": "/tmp/out/report.csv", "content": "a,b"]))),
            WorkingStep(key: "writeFile", detail: "report.csv")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "edit", input: json([["path": "src/app.ts", "kind": "update"]]))),
            WorkingStep(key: "editFile", detail: "app.ts")
        )
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "Grep")), WorkingStep(key: "searchFiles"))
    }

    func testWorkingStepForNamesScreenComputerTeammatesSubagentsAndMemory() {
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "screenshot")), WorkingStep(key: "screen"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "mcp__computer__click")), WorkingStep(key: "computer"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "mcp__agents__ask_bot")), WorkingStep(key: "teammate"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "Agent")), WorkingStep(key: "subagent"))
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "mcp__agents__memory_save")), WorkingStep(key: "memory"))
    }

    func testWorkingStepForNamesOtherConnectorsAndSkipsBookkeeping() {
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "acme_desk_ticket_get", product: "Acme Desk")),
            WorkingStep(key: "tool", detail: "Acme Desk")
        )
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "mcp__github__create_issue")),
            WorkingStep(key: "tool", detail: "github")
        )
        XCTAssertEqual(workingStepFor(WorkingStepCall(name: "make_invoice")), WorkingStep(key: "tool"))
        XCTAssertNil(workingStepFor(WorkingStepCall(name: "TodoWrite")))
        XCTAssertNil(workingStepFor(WorkingStepCall(name: "error: something")))
    }

    func testWorkingStepForNeverCarriesARedactedOrLongDetail() {
        XCTAssertEqual(
            workingStepFor(WorkingStepCall(name: "Read", input: json(["file_path": "[redacted]"]))),
            WorkingStep(key: "readFile")
        )
        let long = workingStepFor(WorkingStepCall(name: "Read", input: json(["file_path": "/x/\(String(repeating: "a", count: 80)).txt"])))
        XCTAssertLessThanOrEqual(long?.detail?.count ?? 0, 40)
    }
}
